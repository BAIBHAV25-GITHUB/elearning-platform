import { enrollStudentInDb, dropEnrollmentInDb, getStudentEnrollmentsFromDb } from '../repositories/enrollment.repository.js';

export const enrollStudent = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { courseId, batchId } = req.body;

    if (!courseId || !batchId) {
      return res.status(400).json({ message: 'courseId and batchId are required' });
    }

    const enrollmentId = await enrollStudentInDb(studentId, courseId, batchId);

    return res.status(201).json({
      success: true,
      message: 'Student enrolled successfully',
      enrollmentId
    });
  } catch (error) {
    console.error('Enrollment transaction failed:', error);
    if (error.message && error.message.includes('Batch capacity limit reached')) {
      return res.status(409).json({ message: 'Batch capacity limit reached' });
    }
    return res.status(500).json({ message: error.message || 'Failed to process enrollment' });
  }
};

export const dropEnrollment = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { id: enrollmentId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ message: 'Drop reason is required' });
    }

    await dropEnrollmentInDb(enrollmentId, studentId, reason);

    return res.status(200).json({
      success: true,
      message: 'Enrollment dropped and seat released successfully'
    });
  } catch (error) {
    console.error('Error dropping enrollment:', error);
    return res.status(500).json({ message: error.message || 'Failed to drop enrollment' });
  }
};

export const getMyEnrollments = async (req, res) => {
  try {
    const studentId = req.user.id;
    const enrollments = await getStudentEnrollmentsFromDb(studentId);
    return res.status(200).json({ success: true, enrollments });
  } catch (error) {
    console.error('Error fetching student enrollments:', error);
    return res.status(500).json({ message: 'Failed to fetch enrollments' });
  }
};