import db, { query } from '../config/db.js';
import { listRows } from '../utils/pagination.js';
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

export const getPublishedCoursesFromDb = async (paging) => {
  const sql = `
    SELECT c.course_id, c.instructor_id, c.title, c.description, c.price, c.thumbnail_url, c.status, c.created_at,
           u.user_name AS instructor_name
    FROM courses c
    JOIN users u ON c.instructor_id = u.user_id
    WHERE c.status = 'published'
    ORDER BY c.created_at DESC, c.course_id DESC
  `;
  return listRows(sql, [], paging); // plain array without paging, { rows, total } with it
};

export const getAllCourses = getPublishedCoursesFromDb;

/**
 * One published course + instructor_name + modules[] each with contents[] (F9).
 * Returns null if the course does not exist or is not published (archived courses are
 * still shown to people who may view the content, i.e. enrolled students / managers).
 * Media URLs are hidden unless includeUrls is true; pass
 * includeUrls = await canViewCourseContent(courseId, userId) (X10).
 */
export const getPublishedCourseDetailsFromDb = async (courseId, { includeUrls = false } = {}) => {
  const sql = `
    SELECT ${COURSE_COLUMNS}, u.user_name AS instructor_name
      FROM courses c
      JOIN users u ON u.user_id = c.instructor_id
     WHERE c.course_id = $1
       AND (c.status = 'published' OR (c.status = 'archived' AND $2::boolean))
  `;
  const { rows } = await query(sql, [courseId, includeUrls]);
  if (!rows[0]) return null;

  const modules = await findModulesByCourseId(courseId, { includeUrls, readyOnly: true });
  return { ...rows[0], modules };
};

/**
 * Change a course's status through fn_set_course_status, which enforces ownership,
 * the publish checklist (>= 1 ready lesson, >= 1 open batch) and the "no unpublish
 * while students are enrolled" rule. Business-rule errors come back as P0001 and are
 * turned into 400 responses by handleError. Returns the updated row.
 */
export const updateCourseStatusInDb = async (courseId, userId, status) => {
  const { rows } = await query(
    `SELECT * FROM fn_set_course_status($1, $2, $3::course_status_enum)`,
    [courseId, userId, status]
  );
  return rows[0] || null;
};

/**
 * Edit a course. `patch` only contains the keys to change
 * (title, description, price, thumbnail_url); fn_update_course validates it.
 */
export const updateCourseInDb = async (courseId, userId, patch) => {
  const { rows } = await query(
    `SELECT * FROM fn_update_course($1, $2, $3::jsonb)`,
    [courseId, userId, JSON.stringify(patch)]
  );
  return rows[0] || null;
};

/** One course of the logged-in manager, any status, with the same counts as the dashboard. */
export const findManagedCourseById = async (courseId) => {
  const { rows } = await query(
    `SELECT ${COURSE_COLUMNS},
            (SELECT COUNT(*)::int FROM enrollments e
              WHERE e.course_id = c.course_id AND e.status <> 'dropped') AS enrollment_count
       FROM courses c WHERE c.course_id = $1`,
    [courseId]
  );
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

/**
 * Delete a course for good (owner / admin). Only allowed while NO student has ever enrolled
 * (enrollments and payments are history we must keep; for those courses archive instead).
 * Modules, lessons, batches, announcements and certificates go with it by ON DELETE CASCADE.
 * Returns { assets } (Cloudinary files to remove afterwards). Errors use the usual codes:
 * P0002 not found, 42501 not allowed, P0001 rule violated.
 */
export const deleteCourseInDb = async (courseId, userId) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(`SELECT status FROM courses WHERE course_id = $1 FOR UPDATE`, [courseId]);
    if (!found.rowCount) {
      throw Object.assign(new Error('Course not found'), { code: 'P0002' });
    }
    const allowed = await client.query(`SELECT fn_can_manage_course($1, $2) AS ok`, [courseId, userId]);
    if (!allowed.rows[0].ok) {
      throw Object.assign(new Error('You do not manage this course'), { code: '42501' });
    }
    const enrolled = await client.query(`SELECT 1 FROM enrollments WHERE course_id = $1 LIMIT 1`, [courseId]);
    if (enrolled.rowCount) {
      throw Object.assign(
        new Error('This course has enrollments, so it cannot be deleted. Archive it instead.'),
        { code: 'P0001' }
      );
    }
    const busy = await client.query(
      `SELECT 1 FROM content ct JOIN content_modules m ON m.module_id = ct.module_id
        WHERE m.course_id = $1 AND ct.status IN ('uploading', 'processing') LIMIT 1`,
      [courseId]
    );
    if (busy.rowCount) {
      throw Object.assign(
        new Error('A video of this course is still being processed. Try again once it finishes.'),
        { code: 'P0001' }
      );
    }
    const files = await client.query(
      `SELECT ct.type, ct.cloudinary_id,
              ARRAY(SELECT cp.cloudinary_id FROM content_parts cp WHERE cp.content_id = ct.content_id) AS part_ids
         FROM content ct JOIN content_modules m ON m.module_id = ct.module_id
        WHERE m.course_id = $1`,
      [courseId]
    );
    await client.query(`DELETE FROM courses WHERE course_id = $1`, [courseId]);
    await client.query('COMMIT');

    const assets = files.rows.flatMap((r) => {
      const resourceType = r.type === 'video' ? 'video' : 'raw';
      return [r.cloudinary_id, ...(r.part_ids || [])].filter(Boolean).map((publicId) => ({ publicId, resourceType }));
    });
    return { assets };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};
