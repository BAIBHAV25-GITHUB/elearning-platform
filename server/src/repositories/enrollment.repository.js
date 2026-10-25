import { query } from '../config/db.js';
import { listRows } from '../utils/pagination.js';

/**
 * Enroll via fn_enroll_student. Returns the enrollment id (an existing PENDING
 * enrollment for the same batch is returned again, so a closed payment popup can
 * be retried). Free courses come back already 'active' - use findEnrollmentById
 * to read the status.
 * DB error codes: P0001 rule violated (closed/full batch, unpublished course...),
 * P0002 not found, 23505 already enrolled, 42501 inactive account.
 */
export const enrollStudentInDb = async (studentId, courseId, batchId) => {
  const sql = `SELECT fn_enroll_student($1, $2, $3) AS enrollment_id`;
  const { rows } = await query(sql, [studentId, courseId, batchId]);
  return rows[0]?.enrollment_id;
};

/**
 * Drop an enrollment. Ownership + state are enforced inside fn_drop_enrollment
 * (P0002 when the enrollment is not the student's, P0001 when it cannot be dropped).
 */
export const dropEnrollmentInDb = async (enrollmentId, studentId, reason = null) => {
  const sql = `SELECT fn_drop_enrollment($1, $2, $3)`;
  await query(sql, [enrollmentId, studentId, reason]);
  return true;
};

export const findEnrollmentById = async (enrollmentId) => {
  const sql = `
    SELECT enrollment_id, student_id, course_id, batch_id,
           status AS enrollment_status, enroll_date AS enrolled_at
    FROM enrollments
    WHERE enrollment_id = $1
  `;
  const { rows } = await query(sql, [enrollmentId]);
  return rows[0] || null;
};

export const getStudentEnrollmentsFromDb = async (studentId, paging) => {
  const sql = `
    SELECT e.enrollment_id, e.course_id, e.batch_id,
           e.status AS enrollment_status, e.enroll_date AS enrolled_at,
           c.title AS course_title, c.thumbnail_url,
           b.batch_name, b.start_date, b.end_date,
           (SELECT COUNT(*)::int FROM content ct JOIN content_modules m ON m.module_id = ct.module_id
             WHERE m.course_id = e.course_id AND ct.status = 'ready') AS total_lessons,
           (SELECT COUNT(*)::int FROM progress p JOIN content ct ON ct.content_id = p.content_id
              JOIN content_modules m ON m.module_id = ct.module_id
             WHERE p.enrollment_id = e.enrollment_id AND p.completed AND ct.status = 'ready'
               AND m.course_id = e.course_id) AS completed_lessons
    FROM enrollments e
    JOIN courses c ON e.course_id = c.course_id
    LEFT JOIN batches b ON e.batch_id = b.batch_id
    WHERE e.student_id = $1
    ORDER BY e.enroll_date DESC, e.enrollment_id DESC
  `;
  return listRows(sql, [studentId], paging);
};

/** Frees seats held by PENDING enrollments older than `minutes` (F4). Returns how many expired. */
export const expirePendingEnrollmentsInDb = async (minutes = 30) => {
  const { rows } = await query(`SELECT fn_expire_pending_enrollments($1) AS expired`, [minutes]);
  return rows[0].expired;
};
