import * as moduleRepo from '../repositories/module.repository.js';
import * as courseRepo from '../repositories/course.repository.js';
import { handleError, toId } from '../utils/errors.js';
import { removeCloudinaryAssets } from '../services/assetCleanup.service.js';

export const createModule = async (req, res) => {
  try {
    const courseId = req.courseId; // set by requireCourseOwner
    const { title, description, sequenceNo } = req.body; // validated by createModuleSchema

    const module = await moduleRepo.createModuleInDb({
      courseId,
      title,
      description,
      sequenceNo,
    });

    return res.status(201).json({ success: true, module });
  } catch (err) {
    // Unique constraint violation in PostgreSQL (UNIQUE(course_id, sequence_no))
    if (err.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'That sequence number is already assigned to another module in this course.',
      });
    }
    return handleError(res, err);
  }
};

/**
 * Syllabus. Guests/students of a published course see titles only (no media
 * URLs); managers see everything, including drafts.
 */
export const getCourseModules = async (req, res) => {
  try {
    const courseId = toId(req.params.courseId);
    if (!courseId) return res.status(400).json({ success: false, message: 'Invalid course id' });

    const info = await courseRepo.findCourseAccessInfo(courseId);
    const isManager = info ? await courseRepo.canManageCourse(courseId, req.user?.id) : false;
    const canView = info ? await courseRepo.canViewCourseContent(courseId, req.user?.id) : false;
    // drafts: managers only; archived: managers + enrolled students; published: everyone
    const visible = info && (info.status === 'published' || isManager || (info.status === 'archived' && canView));
    if (!visible) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    const includeUrls = isManager || canView;
    const modules = await moduleRepo.findModulesByCourseId(courseId, {
      includeUrls,
      readyOnly: !isManager,
    });
    return res.status(200).json({ success: true, modules });
  } catch (err) {
    return handleError(res, err);
  }
};

/** Edit title / description (owner / admin). Send only what changes. */
export const updateModule = async (req, res) => {
  try {
    const moduleId = toId(req.params.moduleId);
    if (!moduleId) return res.status(400).json({ success: false, message: 'Invalid module id' });

    const patch = {}; // validated by updateModuleSchema: only the keys that were sent are present
    if (req.body.title !== undefined) patch.title = req.body.title;
    if (req.body.description !== undefined) patch.description = req.body.description;

    const module = await moduleRepo.updateModuleInDb(req.courseId, moduleId, req.user.id, patch);
    return res.status(200).json({ success: true, module });
  } catch (err) {
    return handleError(res, err);
  }
};

/** Body: { moduleIds: [3, 1, 2] } = every module of the course in the new order. */
export const reorderModules = async (req, res) => {
  try {
    const parsed = req.body.moduleIds; // validated by reorderModulesSchema: unique, valid ids

    await moduleRepo.reorderModulesInDb(req.courseId, req.user.id, parsed);
    const modules = await moduleRepo.findModulesByCourseId(req.courseId, { includeUrls: true });
    return res.status(200).json({ success: true, modules });
  } catch (err) {
    return handleError(res, err);
  }
};

/** Delete a module and all its lessons (owner / admin). Cloudinary files are removed afterwards. */
export const deleteModule = async (req, res) => {
  try {
    const moduleId = toId(req.params.moduleId);
    if (!moduleId) return res.status(400).json({ success: false, message: 'Invalid module id' });

    const result = await moduleRepo.deleteModuleInDb(req.courseId, moduleId);
    if (!result) return res.status(404).json({ success: false, message: 'Module not found in this course' });
    if (result.busy) {
      return res.status(409).json({ success: false, message: 'A video in this module is still being processed. Try again once it finishes.' });
    }

    const failed = await removeCloudinaryAssets(result.assets);
    return res.status(200).json({
      success: true,
      message: failed.length
        ? 'Deleted, but some files could not be removed from Cloudinary (see server log).'
        : 'Deleted.',
      cloudinaryFailed: failed,
    });
  } catch (err) {
    return handleError(res, err);
  }
};
