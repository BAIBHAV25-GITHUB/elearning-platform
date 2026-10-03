import { query } from '../config/db.js';

export const createModuleInDb = async ({ courseId, title, description, sequenceNo }) => {
  const res = await query(
    `INSERT INTO content_modules (course_id, title, description, sequence_no)
     VALUES ($1, $2, $3, $4)
     RETURNING module_id, course_id, title, description, sequence_no, created_at`,
    [courseId, title, description, sequenceNo]
  );
  return res.rows[0];
};

export const findModulesByCourseId = async (courseId) => {
  const res = await query(
    `SELECT module_id, course_id, title, description, sequence_no, created_at
     FROM content_modules
     WHERE course_id = $1
     ORDER BY sequence_no ASC`,
    [courseId]
  );
  return res.rows;
};