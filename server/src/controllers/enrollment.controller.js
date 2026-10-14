import {
  enrollStudentInDb,
  dropEnrollmentInDb,
  findEnrollmentById,
  getStudentEnrollmentsFromDb,
} from '../repositories/enrollment.repository.js';
import { handleError, toId } from '../utils/errors.js';

export const enrollStudent = async (req, res) => {
  try {
    const studentId = req.user.id;
    const courseId = toId(req.body?.courseId);
    const batchId = toId(req.body?.batchId);

    if (!courseId || !batchId) {
      return res.status(400).json({ message: 'Valid courseId and batchId are required' });
    }

    // DB rules (published course, batch belongs to course, capacity, duplicates...)
    // raise coded errors that handleError maps to 400 / 404 / 409 (F8).
    const enrollmentId = await enrollStudentInDb(studentId, courseId, batchId);
    const enrollment = await findEnrollmentById(enrollmentId);

    // Free courses come back 'active' already, so the client must skip the payment step (F5).
    const status = enrollment?.enrollment_status;
    return res.status(201).json({
      success: true,
      message: status === 'active' ? 'Enrolled successfully' : 'Enrollment created, payment required',
      enrollmentId,
      status,
      requiresPayment: status === 'pending',
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const dropEnrollment = async (req, res) => {
  try {
    const enrollmentId = toId(req.params.id);
    if (!enrollmentId) return res.status(400).json({ message: 'Invalid enrollment id' });

    // req.body is undefined in Express 5 when no body is sent (F22)
    const { reason } = req.body ?? {};
    if (reason !== undefined && (typeof reason !== 'string' || reason.length > 255)) {
      return res.status(400).json({ message: 'reason must be text (max 255 characters)' });
    }

    // ownership is enforced inside fn_drop_enrollment (X7)
    await dropEnrollmentInDb(enrollmentId, req.user.id, reason);

    return res.status(200).json({
      success: true,
      message: 'Enrollment dropped and seat released successfully',
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const getMyEnrollments = async (req, res) => {
  try {
    const enrollments = await getStudentEnrollmentsFromDb(req.user.id);
    return res.status(200).json({ success: true, enrollments });
  } catch (error) {
    return handleError(res, error);
  }
};
