import { query } from '../config/db.js';

export const getCertificatesByStudentFromDb = async (studentId) => {
  const sql = `
    SELECT cert.certificate_id, cert.enrollment_id, cert.certificate_url, cert.issued_at,
           c.course_id, c.title AS course_title, c.thumbnail_url,
           u.user_name AS student_name
    FROM certificates cert
    JOIN enrollments e ON cert.enrollment_id = e.enrollment_id
    JOIN courses c ON e.course_id = c.course_id
    JOIN users u ON e.student_id = u.user_id
    WHERE e.student_id = $1
    ORDER BY cert.issued_at DESC
  `;
  const { rows } = await query(sql, [studentId]);
  return rows;
};