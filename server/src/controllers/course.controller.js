import * as courseRepo from '../repositories/course.repository.js';
import { handleError, toId } from '../utils/errors.js';

/**
 * Create a new course (Instructor / Admin). Created as a draft.
 */
export const createCourse = async (req, res) => {
  try {
    const { courseName, title, description, price, thumbnailUrl } = req.body ?? {};
    const name = String(courseName ?? title ?? '').trim();

    if (!name) {
      return res.status(400).json({ message: 'Course name is required' });
    }
    if (name.length > 255) {
      return res.status(400).json({ message: 'Course name is too long (max 255 characters)' });
    }

    const parsedPrice = Number(price);
    if (price === undefined || price === null || price === '' || !Number.isFinite(parsedPrice) || parsedPrice < 0 || parsedPrice > 99999999.99) {
      return res.status(400).json({ message: 'Price must be a number greater than or equal to 0' });
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
    const courses = await courseRepo.getPublishedCoursesFromDb();
    return res.status(200).json({ success: true, courses });
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
    if (!courseId) return res.status(400).json({ message: 'Invalid course id' });

    const includeUrls = await courseRepo.canViewCourseContent(courseId, req.user?.id);
    const course = await courseRepo.getPublishedCourseDetailsFromDb(courseId, { includeUrls });

    if (!course) {
      return res.status(404).json({ message: 'Course not found or is not published yet' });
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
    if (!courseId) return res.status(400).json({ message: 'Invalid course id' });

    const publishedCourse = await courseRepo.updateCourseStatusInDb(courseId, req.user.id, 'published');

    if (!publishedCourse) {
      return res.status(404).json({ message: 'Course not found or unauthorized' });
    }

    return res.status(200).json({ success: true, course: publishedCourse });
  } catch (err) {
    return handleError(res, err);
  }
};
