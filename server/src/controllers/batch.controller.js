import { createBatchInDb, getBatchesByCourseFromDb } from '../repositories/batch.repository.js';
import { findCourseAccessInfo, canManageCourse } from '../repositories/course.repository.js';
import { handleError, toId } from '../utils/errors.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const createBatch = async (req, res) => {
  try {
    const courseId = req.courseId; // set by requireCourseOwner
    const { batchName, startDate, endDate, maxCapacity } = req.body ?? {};

    if (typeof batchName !== 'string' || !batchName.trim() || batchName.length > 100) {
      return res.status(400).json({ message: 'batchName is required (max 100 characters)' });
    }
    if (!DATE_RE.test(String(startDate)) || !DATE_RE.test(String(endDate))) {
      return res.status(400).json({ message: 'startDate and endDate must be YYYY-MM-DD' });
    }
    if (maxCapacity === undefined) {
      return res.status(400).json({ message: 'All batch parameters are required' });
    }

    const parsedCapacity = Number(maxCapacity);
    if (!Number.isInteger(parsedCapacity) || parsedCapacity < 1 || parsedCapacity > 30) {
      return res.status(400).json({ message: 'maxCapacity must be an integer BETWEEN 1 AND 30' });
    }

    if (startDate >= endDate) {
      return res.status(400).json({ message: 'startDate must be earlier than endDate' });
    }

    const batch = await createBatchInDb({
      courseId,
      batchName: batchName.trim(),
      startDate,
      endDate,
      maxCapacity: parsedCapacity,
    });

    return res.status(201).json({
      success: true,
      message: 'Batch created successfully',
      batch,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * Public for published courses: students/guests only see batches that are still
 * 'open' (F12); the course's instructor / admins see all of them.
 */
export const getBatchesByCourse = async (req, res) => {
  try {
    const courseId = toId(req.params.courseId);
    if (!courseId) return res.status(400).json({ message: 'Invalid course id' });

    const info = await findCourseAccessInfo(courseId);
    const isManager = info ? await canManageCourse(courseId, req.user?.id) : false;
    if (!info || (info.status !== 'published' && !isManager)) {
      return res.status(404).json({ message: 'Course not found' });
    }

    const batches = await getBatchesByCourseFromDb(courseId, { onlyOpen: !isManager });
    return res.status(200).json({ success: true, batches });
  } catch (error) {
    return handleError(res, error);
  }
};
