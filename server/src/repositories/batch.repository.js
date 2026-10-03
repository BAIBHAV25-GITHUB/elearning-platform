import { query } from '../config/db.js';

export const createBatchInDb = async ({ courseId, batchName, startDate, endDate, maxCapacity }) => {
  const sql = `
    INSERT INTO batches (course_id, batch_name, start_date, end_date, max_capacity, current_capacity, status)
    VALUES ($1, $2, $3, $4, $5, 0, 'open')
    RETURNING batch_id, course_id, batch_name, start_date, end_date, max_capacity, current_capacity, status, created_at
  `;
  const values = [courseId, batchName, startDate, endDate, maxCapacity];
  const { rows } = await query(sql, values);
  return rows[0];
};

export const getBatchesByCourseFromDb = async (courseId) => {
  const sql = `
    SELECT batch_id, course_id, batch_name, start_date, end_date, max_capacity, current_capacity, status, created_at
    FROM batches
    WHERE course_id = $1
    ORDER BY start_date ASC
  `;
  const { rows } = await query(sql, [courseId]);
  return rows;
};