import { query } from '../config/db.js';

export const getBatchCapacityView = async () => {
  const sql = `SELECT * FROM vw_batch_capacity ORDER BY batch_id DESC`;
  const { rows } = await query(sql);
  return rows;
};

export const getStudentProgressView = async () => {
  const sql = `SELECT * FROM vw_student_progress ORDER BY completion_percentage DESC`;
  const { rows } = await query(sql);
  return rows;
};

export const getCourseRevenueView = async () => {
  const sql = `SELECT * FROM vw_course_revenue ORDER BY total_revenue DESC`;
  const { rows } = await query(sql);
  return rows;
};