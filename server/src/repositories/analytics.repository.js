import { query } from '../config/db.js';

// The views expose instructor_id. Pass it to scope the rows to one instructor's
// courses; call without arguments (admins) for everything.

export const getBatchCapacityView = async (instructorId = null) => {
  const sql = `
    SELECT * FROM vw_batch_capacity
    WHERE ($1::int IS NULL OR instructor_id = $1)
    ORDER BY batch_id DESC`;
  const { rows } = await query(sql, [instructorId]);
  return rows;
};

export const getStudentProgressView = async (instructorId = null) => {
  const sql = `
    SELECT * FROM vw_student_progress
    WHERE ($1::int IS NULL OR instructor_id = $1)
    ORDER BY completion_percentage DESC`;
  const { rows } = await query(sql, [instructorId]);
  return rows;
};

export const getCourseRevenueView = async (instructorId = null) => {
  const sql = `
    SELECT * FROM vw_course_revenue
    WHERE ($1::int IS NULL OR instructor_id = $1)
    ORDER BY total_revenue DESC`;
  const { rows } = await query(sql, [instructorId]);
  return rows;
};
