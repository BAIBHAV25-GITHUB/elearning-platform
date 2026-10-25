import {
  getBatchCapacityView,
  getStudentProgressView,
  getCourseRevenueView,
  getMonthlyTimeline
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

// Revenue (gross / refunded / net) and enrollments per month, same owner/admin scoping as the overview.
export const getAnalyticsTimeline = async (req, res) => {
  try {
    const instructorId = req.user.role === 'admin' ? null : req.user.id;
    const months = req.valid?.query?.months ?? 12;
    const timeline = await getMonthlyTimeline(instructorId, months);
    return res.status(200).json({ success: true, data: { months: timeline } });
  } catch (error) {
    return handleError(res, error);
  }
};
