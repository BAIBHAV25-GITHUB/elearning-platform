import { query } from '../config/db.js';

export const createAnnouncementInDb = async (courseId, title, content) => {
  const sql = `
    INSERT INTO announcements (course_id, title, content)
    VALUES ($1, $2, $3)
    RETURNING announcement_id, course_id, title, content, created_at
  `;
  const { rows } = await query(sql, [courseId, title, content]);
  return rows[0];
};

export const notifyEnrolledStudentsForCourse = async (courseId, message) => {
  const sql = `
    INSERT INTO notifications (user_id, message)
    SELECT DISTINCT student_id, $2
    FROM enrollments
    WHERE course_id = $1 AND enrollment_status = 'active'
  `;
  await query(sql, [courseId, message]);
};