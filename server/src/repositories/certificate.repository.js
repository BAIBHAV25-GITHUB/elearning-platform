import { query } from '../config/db.js';

const SELECT = `
    SELECT cert.certificate_id, cert.enrollment_id, cert.verification_code,
           cert.issue_date AS issued_at,
           c.course_id, c.title AS course_title, c.thumbnail_url,
           u.user_id AS student_id, u.user_name AS student_name,
           i.user_name AS instructor_name
    FROM certificates cert
    JOIN enrollments e ON cert.enrollment_id = e.enrollment_id
    JOIN courses c ON e.course_id = c.course_id
    JOIN users u ON e.student_id = u.user_id
    JOIN users i ON c.instructor_id = i.user_id
`;

export const getCertificatesByStudentFromDb = async (studentId) => {
  const { rows } = await query(`${SELECT} WHERE e.student_id = $1 ORDER BY cert.issue_date DESC`, [studentId]);
  return rows;
};

/** One certificate by id (the caller decides who may see it). */
export const getCertificateByIdFromDb = async (certificateId) => {
  const { rows } = await query(`${SELECT} WHERE cert.certificate_id = $1`, [certificateId]);
  return rows[0] || null;
};

/** Public lookup by verification code (case-insensitive). */
export const getCertificateByCodeFromDb = async (code) => {
  const { rows } = await query(`${SELECT} WHERE cert.verification_code = upper($1)`, [code]);
  return rows[0] || null;
};
