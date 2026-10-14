import { query } from '../config/db.js';
import { findModulesByCourseId } from './module.repository.js';

const COURSE_COLUMNS = `c.course_id, c.instructor_id, c.title, c.description, c.price,
                        c.thumbnail_url, c.status, c.created_at, c.updated_at`;

/** Creates a DRAFT course. `title` is the only name column in the schema. */
export const createCourse = async ({ instructorId, title, description, price, thumbnailUrl }) => {
  const sql = `
    INSERT INTO courses (instructor_id, title, description, price, thumbnail_url, status)
    VALUES ($1, $2, $3, $4, $5, 'draft')
    RETURNING *
  `;
  const { rows } = await query(sql, [
    instructorId,
    title,
    description ?? null,
    price ?? 0,
    thumbnailUrl ?? null,
  ]);
  return rows[0];
};

/** Name used by course.controller (it still receives `courseName` from the request body). */
export const createCourseInDb = async ({ courseName, title, ...rest }) =>
  createCourse({ ...rest, title: title ?? courseName });

/** Instructor's own courses, any status, with a few counts for the dashboard. */
export const findCoursesByInstructorId = async (instructorId) => {
  const sql = `
    SELECT ${COURSE_COLUMNS},
           (SELECT COUNT(*)::int FROM content_modules m WHERE m.course_id = c.course_id) AS module_count,
           (SELECT COUNT(*)::int FROM batches b WHERE b.course_id = c.course_id)         AS batch_count,
           (SELECT COUNT(*)::int FROM enrollments e
             WHERE e.course_id = c.course_id AND e.status <> 'dropped')                  AS enrollment_count
      FROM courses c
     WHERE c.instructor_id = $1
     ORDER BY c.created_at DESC
  `;
  const { rows } = await query(sql, [instructorId]);
  return rows;
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

/**
 * One published course + instructor_name + modules[] each with contents[] (F9).
 * Returns null if the course does not exist or is not published.
 * Media URLs are hidden unless includeUrls is true; pass
 * includeUrls = await canViewCourseContent(courseId, userId) (X10).
 */
export const getPublishedCourseDetailsFromDb = async (courseId, { includeUrls = false } = {}) => {
  const sql = `
    SELECT ${COURSE_COLUMNS}, u.user_name AS instructor_name
      FROM courses c
      JOIN users u ON u.user_id = c.instructor_id
     WHERE c.course_id = $1 AND c.status = 'published'
  `;
  const { rows } = await query(sql, [courseId]);
  if (!rows[0]) return null;

  const modules = await findModulesByCourseId(courseId, { includeUrls, readyOnly: true });
  return { ...rows[0], modules };
};

/**
 * Change a course's status. Only the course's instructor or an admin may do it;
 * returns the updated row, or null if the course is missing / not allowed.
 */
export const updateCourseStatusInDb = async (courseId, userId, status) => {
  const sql = `
    UPDATE courses
       SET status = $3::course_status_enum
     WHERE course_id = $1 AND fn_can_manage_course($1, $2)
    RETURNING *
  `;
  const { rows } = await query(sql, [courseId, userId, status]);
  return rows[0] || null;
};

/** Minimal course row for access checks: { course_id, instructor_id, status } or null. */
export const findCourseAccessInfo = async (courseId) => {
  const { rows } = await query(
    `SELECT course_id, instructor_id, status FROM courses WHERE course_id = $1`,
    [courseId]
  );
  return rows[0] || null;
};

/** True for the course's instructor or any admin (fn_can_manage_course). */
export const canManageCourse = async (courseId, userId) => {
  if (!userId) return false;
  const { rows } = await query(`SELECT fn_can_manage_course($1, $2) AS allowed`, [courseId, userId]);
  return rows[0].allowed;
};

/** True for the course's instructor, admins, and students with an active/completed enrollment. */
export const canViewCourseContent = async (courseId, userId) => {
  if (!userId) return false;
  const sql = `
    SELECT (fn_can_manage_course($1, $2)
            OR EXISTS (SELECT 1 FROM enrollments e
                        WHERE e.course_id = $1 AND e.student_id = $2
                          AND e.status IN ('active', 'completed'))) AS allowed
  `;
  const { rows } = await query(sql, [courseId, userId]);
  return rows[0].allowed;
};
