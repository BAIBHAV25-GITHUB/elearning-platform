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
    // enrollmentId / contentId are validated by trackProgressSchema in progress.routes.js
    const { enrollmentId, contentId } = req.body;
    const watchDuration = Number(req.body.watchDuration);

    // Only the owner of the enrollment may record progress on it (X6).
    // 404 rather than 403 so enrollment ids can't be probed.
    const enrollment = await findEnrollmentById(enrollmentId);
    if (!enrollment || enrollment.student_id !== req.user.id) {
      return res.status(404).json({ success: false, message: 'Enrollment not found.' });
    }

    const content = await getContentDurationFromDb(contentId);
    if (!content) {
      return res.status(404).json({ success: false, message: 'Content not found.' });
    }
    if (content.status !== 'ready') {
      return res.status(409).json({ success: false, message: 'This lesson is not available yet.' });
    }

    let watched;
    let completed;
    if (content.type === 'video') {
      // watchDuration is only meaningful for videos
      if (!Number.isFinite(watchDuration)) {
        return res.status(400).json({ success: false, message: 'watchDuration is required for video lessons.' });
      }
      // fn_upsert_progress also checks: enrollment is active, content belongs to the
      // course, and clamps watch time to [0, duration]. Client-reported watch time
      // stays advisory.
      const durationSec = content.duration_sec || 0;
      watched = Math.max(0, Math.round(durationSec > 0 ? Math.min(watchDuration, durationSec) : watchDuration));
      // Enforce 80% rule
      completed = durationSec > 0 ? watched >= durationSec * 0.8 : true;
    } else {
      // PDF / text lessons have no playback: the student marks them as complete. Without this a
      // course containing one of them could never reach 100% (and never issue a certificate).
      watched = 0;
      completed = true;
    }

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
    if (!enrollmentId) return res.status(400).json({ success: false, message: 'Invalid enrollment id' });

    const enrollment = await findEnrollmentById(enrollmentId);
    // owner, or the course's instructor / an admin
    const allowed =
      enrollment &&
      (enrollment.student_id === req.user.id || (await canManageCourse(enrollment.course_id, req.user.id)));
    if (!allowed) {
      return res.status(404).json({ success: false, message: 'Enrollment not found.' });
    }

    const progress = await getEnrollmentProgressFromDb(enrollmentId);
    return res.status(200).json({ success: true, progress });
  } catch (error) {
    return handleError(res, error);
  }
};
