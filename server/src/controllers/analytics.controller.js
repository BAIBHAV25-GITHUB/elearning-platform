import {
  getBatchCapacityView,
  getStudentProgressView,
  getCourseRevenueView
} from '../repositories/analytics.repository.js';

export const getAnalyticsSummary = async (req, res) => {
  try {
    const [batchCapacity, studentProgress, courseRevenue] = await Promise.all([
      getBatchCapacityView(),
      getStudentProgressView(),
      getCourseRevenueView()
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
    console.error('Error fetching analytics view data:', error);
    return res.status(500).json({ message: error.message || 'Failed to fetch analytics.' });
  }
};