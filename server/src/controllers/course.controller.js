import * as courseRepo from '../repositories/course.repository.js';
import { handleError, toId } from '../utils/errors.js';
import { pagingFrom, listResponse } from '../utils/pagination.js';
import { auditOldCourse } from '../middleware/audit.middleware.js';
import { removeCloudinaryAssets } from '../services/assetCleanup.service.js';

/**
 * Create a new course (Instructor / Admin). Created as a draft.
 */
export const createCourse = async (req, res) => {
  try {
    const { courseName, title, description, price, thumbnailUrl } = req.body ?? {};
    const name = String(courseName ?? title ?? '').trim();

    if (!name) {
      return res.status(400).json({ success: false, message: 'Course name is required' });
    }
    if (name.length > 255) {
      return res.status(400).json({ success: false, message: 'Course name is too long (max 255 characters)' });
    }

    const parsedPrice = Number(price);
    if (price === undefined || price === null || price === '' || !Number.isFinite(parsedPrice) || parsedPrice < 0 || parsedPrice > 99999999.99) {
      return res.status(400).json({ success: false, message: 'Price must be a number greater than or equal to 0' });
    }

    const course = await courseRepo.createCourseInDb({
      courseName: name,
      description: typeof description === 'string' ? description : null,
      price: parsedPrice,
      thumbnailUrl: typeof thumbnailUrl === 'string' && thumbnailUrl ? thumbnailUrl : null,
      instructorId: req.user.id,
    });

    return res.status(201).json({ success: true, course });
  } catch (err) {
    return handleError(res, err);
  }
};

/**
 * Fetch all courses created by the logged-in instructor (all statuses).
 */
export const getInstructorCourses = async (req, res) => {
  try {
    const courses = await courseRepo.findCoursesByInstructorId(req.user.id);
    return res.status(200).json({ success: true, courses });
  } catch (err) {
    return handleError(res, err);
  }
};

/**
 * Public Course Catalog
 */
export const getPublishedCourses = async (req, res) => {
  try {
    const paging = pagingFrom(req.valid?.query);
    const result = await courseRepo.getPublishedCoursesFromDb(paging);
    return res.status(200).json(listResponse('courses', result, paging));
  } catch (err) {
    return handleError(res, err);
  }
};

/**
 * Public course page: syllabus (modules + contents) for everyone, but media URLs
 * only for the instructor / admins / enrolled students (X10).
 */
export const getCourseDetails = async (req, res) => {
  try {
    const courseId = toId(req.params.courseId);
    if (!courseId) return res.status(400).json({ success: false, message: 'Invalid course id' });

    const includeUrls = await courseRepo.canViewCourseContent(courseId, req.user?.id);
    const course = await courseRepo.getPublishedCourseDetailsFromDb(courseId, { includeUrls });

    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found or is not published yet' });
    }

    return res.status(200).json({ success: true, course });
  } catch (err) {
    return handleError(res, err);
  }
};

/**
 * Publish a course so it appears in the student catalog (owner / admin only).
 */
export const publishCourse = async (req, res) => {
  try {
    const courseId = toId(req.params.courseId);
    if (!courseId) return res.status(400).json({ success: false, message: 'Invalid course id' });

    // fn_set_course_status checks ownership and the publish checklist
    const publishedCourse = await courseRepo.updateCourseStatusInDb(courseId, req.user.id, 'published');
    return res.status(200).json({ success: true, course: publishedCourse });
  } catch (err) {
    return handleError(res, err);
  }
};

const COURSE_STATUSES = ['draft', 'published', 'archived'];

/**
 * Change status: publish / unpublish (draft) / archive / restore (owner / admin).
 * Body: { status: 'draft' | 'published' | 'archived' }. The rules live in fn_set_course_status.
 */
export const setCourseStatus = async (req, res) => {
  try {
    const courseId = toId(req.params.courseId);
    if (!courseId) return res.status(400).json({ success: false, message: 'Invalid course id' });

    const status = req.body?.status;
    if (!COURSE_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: `status must be one of: ${COURSE_STATUSES.join(', ')}` });
    }

    auditOldCourse(res, await courseRepo.findManagedCourseById(courseId), { status });
    const course = await courseRepo.updateCourseStatusInDb(courseId, req.user.id, status);
    return res.status(200).json({ success: true, course });
  } catch (err) {
    return handleError(res, err);
  }
};

/**
 * Edit title / description / price / thumbnail (owner / admin). Send only what changes.
 * Price is locked once students have enrolled (enforced in fn_update_course).
 */
export const updateCourse = async (req, res) => {
  try {
    const courseId = toId(req.params.courseId);
    if (!courseId) return res.status(400).json({ success: false, message: 'Invalid course id' });

    const body = req.body ?? {};
    const patch = {};

    if (body.title !== undefined || body.courseName !== undefined) {
      const name = String(body.title ?? body.courseName ?? '').trim();
      if (!name || name.length > 255) {
        return res.status(400).json({ success: false, message: 'Course name is required (max 255 characters)' });
      }
      patch.title = name;
    }
    if (body.description !== undefined) {
      if (body.description !== null && typeof body.description !== 'string') {
        return res.status(400).json({ success: false, message: 'Description must be text' });
      }
      patch.description = body.description?.trim() ? body.description : null;
    }
    if (body.price !== undefined) {
      const price = Number(body.price);
      if (body.price === null || body.price === '' || !Number.isFinite(price) || price < 0 || price > 99999999.99) {
        return res.status(400).json({ success: false, message: 'Price must be a number greater than or equal to 0' });
      }
      patch.price = price;
    }
    if (body.thumbnailUrl !== undefined || body.thumbnail_url !== undefined) {
      const url = body.thumbnailUrl ?? body.thumbnail_url;
      if (url !== null && typeof url !== 'string') {
        return res.status(400).json({ success: false, message: 'Thumbnail must be a URL' });
      }
      patch.thumbnail_url = url && url.trim() ? url.trim() : null;
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ success: false, message: 'Nothing to update' });
    }

    auditOldCourse(res, await courseRepo.findManagedCourseById(courseId), req.body);
    const course = await courseRepo.updateCourseInDb(courseId, req.user.id, patch);
    return res.status(200).json({ success: true, course });
  } catch (err) {
    return handleError(res, err);
  }
};

/** One course of the manager (any status) for the edit form. */
export const getManagedCourse = async (req, res) => {
  try {
    const course = await courseRepo.findManagedCourseById(req.courseId);
    return res.status(200).json({ success: true, course });
  } catch (err) {
    return handleError(res, err);
  }
};

/**
 * Delete a course permanently (owner / admin). Refused once anyone has enrolled
 * (archive it instead); the rules are checked inside deleteCourseInDb.
 */
export const deleteCourse = async (req, res) => {
  try {
    const courseId = toId(req.params.courseId);
    if (!courseId) return res.status(400).json({ success: false, message: 'Invalid course id' });

    const { assets } = await courseRepo.deleteCourseInDb(courseId, req.user.id);
    const failed = await removeCloudinaryAssets(assets);
    return res.status(200).json({
      success: true,
      message: failed.length
        ? 'Course deleted, but some files could not be removed from Cloudinary (see server log).'
        : 'Course deleted.',
      cloudinaryFailed: failed,
    });
  } catch (err) {
    return handleError(res, err);
  }
};
