import { query } from '../config/db.js';

/**
 * Create a module. If sequenceNo is omitted the next free number
 * (MAX + 1) is used, so deleting a module never causes a collision.
 */
export const createModuleInDb = async ({ courseId, title, description, sequenceNo }) => {
  const res = await query(
    `INSERT INTO content_modules (course_id, title, description, sequence_no)
     VALUES ($1, $2, $3,
             COALESCE($4::smallint,
                      (SELECT COALESCE(MAX(sequence_no), 0) + 1
                         FROM content_modules WHERE course_id = $1)))
     RETURNING module_id, course_id, title, description, sequence_no, created_at`,
    [courseId, title, description ?? null, sequenceNo ?? null]
  );
  return res.rows[0];
};

/**
 * Modules of a course, each with a `contents` array (F9 / F10).
 *   includeUrls - false (default): video_url is null, so guests / unenrolled
 *                 users see the syllabus but not the media (X10).
 *   readyOnly   - only content with status 'ready'.
 */
export const findModulesByCourseId = async (
  courseId,
  { includeUrls = false, readyOnly = false } = {}
) => {
  const res = await query(
    `SELECT m.module_id, m.course_id, m.title, m.description, m.sequence_no, m.created_at,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'content_id',   ct.content_id,
                       'module_id',    ct.module_id,
                       'title',        ct.title,
                       'type',         ct.type,
                       'duration_sec', ct.duration_sec,
                       'sequence_no',  ct.sequence_no,
                       'status',       ct.status,
                       'video_url',    CASE WHEN $2::boolean THEN ct.video_url END
                     ) ORDER BY ct.sequence_no)
                FROM content ct
               WHERE ct.module_id = m.module_id
                 AND (NOT $3::boolean OR ct.status = 'ready')
            ), '[]'::json) AS contents
       FROM content_modules m
      WHERE m.course_id = $1
      ORDER BY m.sequence_no ASC`,
    [courseId, includeUrls, readyOnly]
  );
  return res.rows;
};

/** True if the module exists and belongs to the given course. */
export const moduleBelongsToCourse = async (moduleId, courseId) => {
  const res = await query(
    `SELECT 1 FROM content_modules WHERE module_id = $1 AND course_id = $2`,
    [moduleId, courseId]
  );
  return res.rowCount > 0;
};

/**
 * Who may read / post in a module's discussion (X11): the course's instructor,
 * admins, and students with an active/completed enrollment.
 * Returns null if the module does not exist, else { course_id, allowed }.
 */
export const findModuleAccess = async (moduleId, userId) => {
  const res = await query(
    `SELECT m.course_id,
            (fn_can_manage_course(m.course_id, $2)
             OR EXISTS (SELECT 1 FROM enrollments e
                         WHERE e.course_id = m.course_id AND e.student_id = $2
                           AND e.status IN ('active', 'completed'))) AS allowed
       FROM content_modules m
      WHERE m.module_id = $1`,
    [moduleId, userId]
  );
  return res.rows[0] || null;
};
