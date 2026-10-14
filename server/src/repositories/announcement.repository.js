import { query } from '../config/db.js';

/**
 * Posts the announcement AND notifies every active/completed student of the
 * course, atomically, through fn_create_announcement. Only the course's
 * instructor or an admin may post (42501 otherwise, P0002 if no such course).
 *
 * NOTE the new 4th argument: authorId (= req.user.id).
 */
export const createAnnouncementInDb = async (courseId, title, content, authorId) => {
  if (!authorId) {
    throw new Error('createAnnouncementInDb: authorId is required');
  }

  const created = await query(
    `SELECT fn_create_announcement($1, $2, $3, $4) AS announcement_id`,
    [courseId, authorId, title, content]
  );
  const announcementId = created.rows[0].announcement_id;

  const { rows } = await query(
    `SELECT announcement_id, course_id, author_id, title, content, created_at
       FROM announcements
      WHERE announcement_id = $1`,
    [announcementId]
  );
  return rows[0];
};

/**
 * Deprecated no-op. fn_create_announcement already inserts the notifications
 * (with title + type), so calling this after createAnnouncementInDb must not
 * create duplicates. Remove the call from announcement.controller.js.
 */
export const notifyEnrolledStudentsForCourse = async () => {};
