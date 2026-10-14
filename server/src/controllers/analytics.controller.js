import {
  getBatchCapacityView,
  getStudentProgressView,
  getCourseRevenueView
} from '../repositories/analytics.repository.js';
import { handleError } from '../utils/errors.js';

export const getAnalyticsSummary = async (req, res) => {
  try {
    // admins see everything, instructors only their own courses (X9)
    const instructorId = req.user.role === 'admin' ? null : req.user.id;

    const [batchCapacity, studentProgress, courseRevenue] = await Promise.all([
      getBatchCapacityView(instructorId),
      getStudentProgressView(instructorId),
      getCourseRevenueView(instructorId)
    ]);

    return res.status(200).json({
      success: true,
      data: {
        batchCapacity,
        studentProgress,
        courseRevenue
      }
    });
  } catch (error) {
    return handleError(res, error);
  }
};
