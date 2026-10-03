import { query } from '../config/db.js';

/**
 * Day 6: Create a new course (default status: draft)
 */
export const createCourse = async ({ instructorId, title, description, price, thumbnailUrl }) => {
  const res = await query(
    `INSERT INTO courses (instructor_id, title, description, price, thumbnail_url, status)
     VALUES ($1, $2, $3, $4, $5, 'draft')
     RETURNING *`,
    [instructorId, title, description, price, thumbnailUrl || null]
  );
  return res.rows[0];
};

/**
 * Day 6: Fetch courses owned by a specific instructor (includes drafts and published)
 */
export const getCoursesByInstructorId = async (instructorId) => {
  const res = await query(
    `SELECT course_id, title, description, price, thumbnail_url, status, created_at
     FROM courses
     WHERE instructor_id = $1
     ORDER BY created_at DESC`,
    [instructorId]
  );
  return res.rows;
};

/**
 * Day 9: Fetch published courses for the public student catalog
 */
export const getAllCourses = async () => {
  const res = await query(`
    SELECT c.course_id, c.instructor_id, c.title, c.description, c.price, c.thumbnail_url, c.status, c.created_at,
           u.name AS instructor_name
    FROM courses c
    JOIN users u ON c.instructor_id = u.user_id
    WHERE c.status = 'published'
    ORDER BY c.created_at DESC
  `);
  return res.rows;
};

/**
 * Day 8 & 9: Fetch course details by ID along with ordered content modules
 */
export const getCourseById = async (courseId) => {
  const courseRes = await query(
    `SELECT c.course_id, c.instructor_id, c.title, c.description, c.price, c.thumbnail_url, c.status, c.created_at,
            u.name AS instructor_name
     FROM courses c
     JOIN users u ON c.instructor_id = u.user_id
     WHERE c.course_id = $1`,
    [courseId]
  );

  if (!courseRes.rows[0]) return null;

  // Fetch ordered modules for Day 8 curriculum rendering
  const modulesRes = await query(
    `SELECT module_id, course_id, title, description, sequence_no, created_at
     FROM content_modules
     WHERE course_id = $1
     ORDER BY sequence_no ASC`,
    [courseId]
  );

  return {
    ...courseRes.rows[0],
    modules: modulesRes.rows,
  };
};

/**
 * Helper: Update course status (e.g., publish a course)
 */
export const updateCourseStatus = async (courseId, status) => {
  const res = await query(
    `UPDATE courses
     SET status = $1, updated_at = CURRENT_TIMESTAMP
     WHERE course_id = $2
     RETURNING *`,
    [status, courseId]
  );
  return res.rows[0];
};

import { query } from '../config/db.js';

export const getPublishedCoursesFromDb = async () => {
  const res = await query(`
    SELECT 
      c.course_id, 
      c.instructor_id, 
      c.title, 
      c.description, 
      c.price, 
      c.thumbnail_url, 
      c.status, 
      c.created_at,
      u.user_name AS instructor_name
    FROM courses c
    JOIN users u ON c.instructor_id = u.user_id
    WHERE c.status = 'published'
    ORDER BY c.created_at DESC
  `);
  return res.rows;
};