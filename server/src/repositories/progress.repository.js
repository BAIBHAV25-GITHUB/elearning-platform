import { query } from '../config/db.js';

/**
 * fn_upsert_progress checks the enrollment is active/completed, the content
 * belongs to its course, clamps watch time to [0, duration] and applies the
 * 80 % rule. Ownership (enrollment belongs to the caller) is NOT checked here:
 * use findEnrollmentById(...).student_id in the controller.
 */
export const upsertProgressInDb = async (enrollmentId, contentId, watchDuration, completed) => {
  const sql = `SELECT fn_upsert_progress($1, $2, $3, $4)`;
  await query(sql, [enrollmentId, contentId, watchDuration, completed]);
  return true;
};

export const getContentDurationFromDb = async (contentId) => {
  const sql = `SELECT content_id, duration_sec, module_id, type, status FROM content WHERE content_id = $1`;
  const { rows } = await query(sql, [contentId]);
  return rows[0];
};

export const getEnrollmentProgressFromDb = async (enrollmentId) => {
  const sql = `
    SELECT p.content_id, p.watch_duration, p.completed, p.completed_at, p.last_accessed_at
    FROM progress p
    WHERE p.enrollment_id = $1
  `;
  const { rows } = await query(sql, [enrollmentId]);
  return rows;
};
