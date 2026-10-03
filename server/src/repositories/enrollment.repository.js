import { query } from '../config/db.js';

export const enrollStudentInDb = async (studentId, courseId, batchId) => {
  const sql = `SELECT fn_enroll_student($1, $2, $3) AS enrollment_id`;
  const { rows } = await query(sql, [studentId, courseId, batchId]);
  return rows[0]?.enrollment_id;
};

export const dropEnrollmentInDb = async (enrollmentId, studentId, reason) => {
  const sql = `SELECT fn_drop_enrollment($1, $2, $3) AS result`;
  const { rows } = await query(sql, [enrollmentId, studentId, reason]);
  return rows[0]?.result;
};

export const getStudentEnrollmentsFromDb = async (studentId) => {
  const sql = `
    SELECT e.enrollment_id, e.course_id, e.batch_id, e.enrollment_status, e.enrolled_at,
           c.title AS course_title, c.thumbnail_url,
           b.batch_name, b.start_date, b.end_date
    FROM enrollments e
    JOIN courses c ON e.course_id = c.course_id
    LEFT JOIN batches b ON e.batch_id = b.batch_id
    WHERE e.student_id = $1
    ORDER BY e.enrolled_at DESC
  `;
  const { rows } = await query(sql, [studentId]);
  return rows;
};