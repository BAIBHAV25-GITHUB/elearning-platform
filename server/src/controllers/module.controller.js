import * as moduleRepo from '../repositories/module.repository.js';
import * as courseRepo from '../repositories/course.repository.js';
import { handleError, toId } from '../utils/errors.js';

export const createModule = async (req, res) => {
  try {
    const courseId = req.courseId; // set by requireCourseOwner
    const { title, description, sequenceNo } = req.body ?? {};

    if (typeof title !== 'string' || !title.trim() || title.length > 200) {
      return res.status(400).json({ message: 'Module title is required (max 200 characters)' });
    }

    // sequenceNo is optional: the repository assigns MAX + 1
    let seq = null;
    if (sequenceNo !== undefined && sequenceNo !== null && sequenceNo !== '') {
      seq = Number(sequenceNo);
      if (!Number.isInteger(seq) || seq < 1 || seq > 32767) {
        return res.status(400).json({ message: 'Sequence number must be a positive integer' });
      }
    }

    const module = await moduleRepo.createModuleInDb({
      courseId,
      title: title.trim(),
      description: typeof description === 'string' ? description : null,
      sequenceNo: seq,
    });

    return res.status(201).json({ success: true, module });
  } catch (err) {
    // Unique constraint violation in PostgreSQL (UNIQUE(course_id, sequence_no))
    if (err.code === '23505') {
      return res.status(409).json({
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
    if (!courseId) return res.status(400).json({ message: 'Invalid course id' });

    const info = await courseRepo.findCourseAccessInfo(courseId);
    const isManager = info ? await courseRepo.canManageCourse(courseId, req.user?.id) : false;
    if (!info || (info.status !== 'published' && !isManager)) {
      return res.status(404).json({ message: 'Course not found' });
    }

    const includeUrls = isManager || (await courseRepo.canViewCourseContent(courseId, req.user?.id));
    const modules = await moduleRepo.findModulesByCourseId(courseId, {
      includeUrls,
      readyOnly: !isManager,
    });
    return res.status(200).json({ success: true, modules });
  } catch (err) {
    return handleError(res, err);
  }
};
