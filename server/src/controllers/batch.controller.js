import { createBatchInDb, getBatchesByCourseFromDb, findBatchInCourse, updateBatchInDb } from '../repositories/batch.repository.js';
import { findCourseAccessInfo, canManageCourse } from '../repositories/course.repository.js';
import { handleError, toId } from '../utils/errors.js';

export const createBatch = async (req, res) => {
  try {
    const courseId = req.courseId; // set by requireCourseOwner
    // validated + trimmed by createBatchSchema (src/validation/catalog.schemas.js)
    const { batchName, startDate, endDate, maxCapacity } = req.body;

    const batch = await createBatchInDb({
      courseId,
      batchName,
      startDate,
      endDate,
      maxCapacity,
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
    if (!courseId) return res.status(400).json({ success: false, message: 'Invalid course id' });

    const info = await findCourseAccessInfo(courseId);
    const isManager = info ? await canManageCourse(courseId, req.user?.id) : false;
    if (!info || (info.status !== 'published' && !isManager)) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    const batches = await getBatchesByCourseFromDb(courseId, { onlyOpen: !isManager });
    return res.status(200).json({ success: true, batches });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * Edit / close / reopen a batch (owner / admin). Send only what changes:
 *   { batchName, startDate, endDate, maxCapacity, status: 'open' | 'closed' }
 * Rules (seats already taken, ended batches, ...) live in fn_update_batch.
 */
export const updateBatch = async (req, res) => {
  try {
    const batchId = toId(req.params.batchId);
    if (!batchId) return res.status(400).json({ success: false, message: 'Invalid batch id' });
    if (!(await findBatchInCourse(batchId, req.courseId))) {
      return res.status(404).json({ success: false, message: 'Batch not found in this course' });
    }

    // validated by updateBatchSchema: only the keys that were sent are present
    const { batchName, startDate, endDate, maxCapacity, status } = req.body;
    const patch = {};
    if (batchName !== undefined) patch.batch_name = batchName;
    if (startDate !== undefined) patch.start_date = startDate;
    if (endDate !== undefined) patch.end_date = endDate;
    if (maxCapacity !== undefined) patch.max_capacity = maxCapacity;
    if (status !== undefined) patch.status = status;

    const batch = await updateBatchInDb(batchId, req.user.id, patch);
    return res.status(200).json({ success: true, batch });
  } catch (error) {
    return handleError(res, error);
  }
};
