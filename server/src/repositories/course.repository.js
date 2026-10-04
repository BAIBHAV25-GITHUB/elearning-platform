import { query } from '../config/db.js';

export const createCourse = async ({ instructorId, title, description, price, thumbnailUrl }) => {
  const sql = `
    INSERT INTO courses (instructor_id, title, description, price, thumbnail_url, status)
    VALUES ($1, $2, $3, $4, $5, 'draft')
    RETURNING *
  `;
  const { rows } = await query(sql, [instructorId, title, description, price, thumbnailUrl]);
  return rows[0];
};

export const getPublishedCoursesFromDb = async () => {
  const sql = `
    SELECT c.course_id, c.instructor_id, c.title, c.description, c.price, c.thumbnail_url, c.status, c.created_at,
           u.user_name AS instructor_name
    FROM courses c
    JOIN users u ON c.instructor_id = u.user_id
    WHERE c.status = 'published'
    ORDER BY c.created_at DESC
  `;
  const { rows } = await query(sql);
  return rows;
};

export const getAllCourses = getPublishedCoursesFromDb;