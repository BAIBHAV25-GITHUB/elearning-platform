import { query } from '../config/db.js';

/** Platform-wide numbers for the admin dashboard (one round trip). */
export const getPlatformOverview = async () => {
  const { rows } = await query(`
    SELECT
      (SELECT COUNT(*)::int FROM users)                                                   AS users_total,
      (SELECT COUNT(*)::int FROM users WHERE fn_user_role(user_id) = 'student')           AS students,
      (SELECT COUNT(*)::int FROM users WHERE fn_user_role(user_id) = 'instructor')        AS instructors,
      (SELECT COUNT(*)::int FROM users WHERE status <> 'active')                          AS inactive_or_banned,
      (SELECT COUNT(*)::int FROM courses)                                                 AS courses_total,
      (SELECT COUNT(*)::int FROM courses WHERE status = 'published')                      AS courses_published,
      (SELECT COUNT(*)::int FROM courses WHERE status = 'draft')                          AS courses_draft,
      (SELECT COUNT(*)::int FROM courses WHERE status = 'archived')                       AS courses_archived,
      (SELECT COUNT(*)::int FROM enrollments WHERE status IN ('active', 'completed'))     AS enrollments_active,
      (SELECT COUNT(*)::int FROM enrollments WHERE status = 'completed')                  AS enrollments_completed,
      (SELECT COUNT(*)::int FROM certificates)                                            AS certificates_issued,
      (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'success')            AS revenue_total,
      (SELECT COUNT(*)::int FROM payments WHERE status = 'failed')                        AS payments_failed,
      (SELECT COUNT(*)::int FROM payments WHERE status = 'pending')                       AS payments_pending,
      (SELECT COUNT(*)::int FROM payments WHERE needs_refund AND status <> 'refunded')    AS payments_needs_refund,
      (SELECT COUNT(*)::int FROM payments WHERE status = 'refunded')                      AS payments_refunded
  `);
  return rows[0];
};

/** Top courses by revenue across the whole platform. */
export const getTopCourses = async (limit = 5) => {
  const { rows } = await query(
    `SELECT course_id, course_title, instructor_name, total_enrollments, total_revenue
       FROM vw_course_revenue ORDER BY total_revenue DESC, total_enrollments DESC LIMIT $1`,
    [limit]
  );
  return rows;
};

/** All courses (any status) with instructor + counts; optional search and status filter. */
export const listAllCourses = async ({ search = null, status = null, limit = 20, offset = 0 }) => {
  const { rows } = await query(
    `SELECT c.course_id, c.title, c.price, c.status, c.created_at, c.instructor_id,
            u.user_name AS instructor_name, u.email AS instructor_email,
            (SELECT COUNT(*)::int FROM enrollments e
              WHERE e.course_id = c.course_id AND e.status <> 'dropped') AS enrollment_count,
            COUNT(*) OVER () AS total_count
       FROM courses c
       JOIN users u ON u.user_id = c.instructor_id
      WHERE ($1::text IS NULL
             OR c.title ILIKE '%' || replace(replace(replace($1, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%'
             OR u.user_name ILIKE '%' || replace(replace(replace($1, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%')
        AND ($2::course_status_enum IS NULL OR c.status = $2)
      ORDER BY c.created_at DESC, c.course_id DESC
      LIMIT $3 OFFSET $4`,
    [search, status, limit, offset]
  );
  const total = rows.length ? Number(rows[0].total_count) : 0;
  return { courses: rows.map(({ total_count, ...c }) => c), total };
};

/** Current status of a course (for the audit before/after). */
export const getCourseStatus = async (courseId) => {
  const { rows } = await query(`SELECT status FROM courses WHERE course_id = $1`, [courseId]);
  return rows[0]?.status ?? null;
};

/** Audit log viewer with filters. */
export const listAuditLogs = async ({ tableName = null, actionType = null, userId = null, limit = 25, offset = 0 }) => {
  const { rows } = await query(
    `SELECT a.log_id, a.user_id, u.user_name, a.table_name, a.record_id, a.action_type,
            a.old_values, a.new_values, a.ip_address, a."timestamp",
            COUNT(*) OVER () AS total_count
       FROM audit_logs a
       LEFT JOIN users u ON u.user_id = a.user_id
      WHERE ($1::text IS NULL OR a.table_name = $1)
        AND ($2::audit_action_enum IS NULL OR a.action_type = $2)
        AND ($3::int IS NULL OR a.user_id = $3)
      ORDER BY a."timestamp" DESC, a.log_id DESC
      LIMIT $4 OFFSET $5`,
    [tableName, actionType, userId, limit, offset]
  );
  const total = rows.length ? Number(rows[0].total_count) : 0;
  return { logs: rows.map(({ total_count, ...l }) => l), total };
};

/**
 * Move a course to another instructor (fn_reassign_course).
 * Returns { course_id, title, old_instructor_id, instructor_id, instructor_name }.
 */
export const reassignCourse = async (adminId, courseId, instructorId) => {
  const { rows } = await query('SELECT * FROM fn_reassign_course($1, $2, $3)', [adminId, courseId, instructorId]);
  return rows[0];
};
