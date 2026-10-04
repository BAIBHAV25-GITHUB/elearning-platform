import { query } from '../config/db.js';

export const upsertProgressInDb = async (enrollmentId, contentId, watchDuration, completed) => {
  const sql = `SELECT fn_upsert_progress($1, $2, $3, $4) AS result`;
  const { rows } = await query(sql, [enrollmentId, contentId, watchDuration, completed]);
  return rows[0]?.result;
};

export const getContentDurationFromDb = async (contentId) => {
  const sql = `SELECT content_id, duration_sec, module_id FROM course_contents WHERE content_id = $1`;
  const { rows } = await query(sql, [contentId]);
  return rows[0];
};

export const getEnrollmentProgressFromDb = async (enrollmentId) => {
  const sql = `
    SELECT cp.content_id, cp.watch_duration, cp.completed, cp.last_accessed_at
    FROM content_progress cp
    WHERE cp.enrollment_id = $1
  `;
  const { rows } = await query(sql, [enrollmentId]);
  return rows;
};