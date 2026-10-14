import {
  upsertProgressInDb,
  getContentDurationFromDb,
  getEnrollmentProgressFromDb,
} from '../repositories/progress.repository.js';
import { findEnrollmentById } from '../repositories/enrollment.repository.js';
import { canManageCourse } from '../repositories/course.repository.js';
import { handleError, toId } from '../utils/errors.js';

export const trackProgress = async (req, res) => {
  try {
    const enrollmentId = toId(req.body?.enrollmentId);
    const contentId = toId(req.body?.contentId);
    const watchDuration = Number(req.body?.watchDuration);

    if (!enrollmentId || !contentId || !Number.isFinite(watchDuration)) {
      return res.status(400).json({ message: 'enrollmentId, contentId, and watchDuration are required.' });
    }

    // Only the owner of the enrollment may record progress on it (X6).
    // 404 rather than 403 so enrollment ids can't be probed.
    const enrollment = await findEnrollmentById(enrollmentId);
    if (!enrollment || enrollment.student_id !== req.user.id) {
      return res.status(404).json({ message: 'Enrollment not found.' });
    }

    const content = await getContentDurationFromDb(contentId);
    if (!content) {
      return res.status(404).json({ message: 'Content not found.' });
    }

    // fn_upsert_progress also checks: enrollment is active, content belongs to the
    // course, and clamps watch time to [0, duration]. Client-reported watch time
    // stays advisory.
    const durationSec = content.duration_sec || 0;
    const watched = Math.max(0, Math.round(durationSec > 0 ? Math.min(watchDuration, durationSec) : watchDuration));
    // Enforce 80% rule
    const completed = durationSec > 0 ? watched >= durationSec * 0.8 : true;

    await upsertProgressInDb(enrollmentId, contentId, watched, completed);

    return res.status(200).json({
      success: true,
      completed,
      watchDuration: watched,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const getStudentProgress = async (req, res) => {
  try {
    const enrollmentId = toId(req.params.enrollmentId);
    if (!enrollmentId) return res.status(400).json({ message: 'Invalid enrollment id' });

    const enrollment = await findEnrollmentById(enrollmentId);
    // owner, or the course's instructor / an admin
    const allowed =
      enrollment &&
      (enrollment.student_id === req.user.id || (await canManageCourse(enrollment.course_id, req.user.id)));
    if (!allowed) {
      return res.status(404).json({ message: 'Enrollment not found.' });
    }

    const progress = await getEnrollmentProgressFromDb(enrollmentId);
    return res.status(200).json({ success: true, progress });
  } catch (error) {
    return handleError(res, error);
  }
};
