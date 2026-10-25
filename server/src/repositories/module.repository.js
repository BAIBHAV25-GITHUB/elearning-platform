import db, { query } from '../config/db.js';
import { mediaUrl } from '../integrations/cloudinary.js';

/**
 * Create a module. If sequenceNo is omitted the next free number
 * (MAX + 1) is used, so deleting a module never causes a collision.
 */
export const createModuleInDb = async ({ courseId, title, description, sequenceNo }) => {
  const res = await query(
    `INSERT INTO content_modules (course_id, title, description, sequence_no)
     VALUES ($1, $2, $3,
             COALESCE($4::smallint,
                      (SELECT COALESCE(MAX(sequence_no), 0) + 1
                         FROM content_modules WHERE course_id = $1)))
     RETURNING module_id, course_id, title, description, sequence_no, created_at`,
    [courseId, title, description ?? null, sequenceNo ?? null]
  );
  return res.rows[0];
};

/**
 * Modules of a course, each with a `contents` array (F9 / F10).
 *   includeUrls - false (default): video_url is null, so guests / unenrolled
 *                 users see the syllabus but not the media (X10).
 *   readyOnly   - only content with status 'ready'.
 */
export const findModulesByCourseId = async (
  courseId,
  { includeUrls = false, readyOnly = false } = {}
) => {
  const res = await query(
    `SELECT m.module_id, m.course_id, m.title, m.description, m.sequence_no, m.created_at,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'content_id',   ct.content_id,
                       'module_id',    ct.module_id,
                       'title',        ct.title,
                       'type',         ct.type,
                       'duration_sec', ct.duration_sec,
                       'sequence_no',  ct.sequence_no,
                       'status',       ct.status,
                       'video_url',    CASE WHEN $2::boolean THEN ct.video_url END,
                       'delivery',     CASE WHEN $2::boolean THEN ct.delivery END,
                       'cloudinary_id', CASE WHEN $2::boolean THEN ct.cloudinary_id END,
                       'text_body',    CASE WHEN $2::boolean THEN ct.text_body END,
                       'error_message', ct.error_message,
                       -- pieces of a long video, in play order (only for people allowed to watch)
                       'parts',        CASE WHEN $2::boolean THEN (
                                         SELECT json_agg(json_build_object(
                                                  'part_no',      cp.part_no,
                                                  'video_url',    cp.video_url,
                                                  'delivery',     cp.delivery,
                                                  'cloudinary_id', cp.cloudinary_id,
                                                  'duration_sec', cp.duration_sec
                                                ) ORDER BY cp.part_no)
                                           FROM content_parts cp
                                          WHERE cp.content_id = ct.content_id)
                                       END
                     ) ORDER BY ct.sequence_no)
                FROM content ct
               WHERE ct.module_id = m.module_id
                 AND (NOT $3::boolean OR ct.status = 'ready')
            ), '[]'::json) AS contents
       FROM content_modules m
      WHERE m.course_id = $1
      ORDER BY m.sequence_no ASC`,
    [courseId, includeUrls, readyOnly]
  );
  // protected files: swap the stored URL for a signed one, and never send delivery / public ids to the client
  return res.rows.map((m) => ({
    ...m,
    contents: (m.contents || []).map(({ delivery, cloudinary_id, parts, ...c }) => ({
      ...c,
      video_url: mediaUrl({
        delivery,
        publicId: cloudinary_id,
        resourceType: c.type === 'pdf' ? 'raw' : 'video',
        storedUrl: c.video_url,
      }),
      parts: parts
        ? parts.map(({ delivery: d, cloudinary_id: id, ...p }) => ({
            ...p,
            video_url: mediaUrl({ delivery: d, publicId: id, resourceType: 'video', storedUrl: p.video_url }),
          }))
        : parts,
    })),
  }));
};

/** True if the module exists and belongs to the given course. */
export const moduleBelongsToCourse = async (moduleId, courseId) => {
  const res = await query(
    `SELECT 1 FROM content_modules WHERE module_id = $1 AND course_id = $2`,
    [moduleId, courseId]
  );
  return res.rowCount > 0;
};

/**
 * Who may read / post in a module's discussion (X11): the course's instructor,
 * admins, and students with an active/completed enrollment.
 * Returns null if the module does not exist, else { course_id, allowed }.
 */
export const findModuleAccess = async (moduleId, userId) => {
  const res = await query(
    `SELECT m.course_id,
            (fn_can_manage_course(m.course_id, $2)
             OR EXISTS (SELECT 1 FROM enrollments e
                         WHERE e.course_id = m.course_id AND e.student_id = $2
                           AND e.status IN ('active', 'completed'))) AS allowed
       FROM content_modules m
      WHERE m.module_id = $1`,
    [moduleId, userId]
  );
  return res.rows[0] || null;
};

/** Edit title / description through fn_update_module (patch keys: title, description). */
export const updateModuleInDb = async (courseId, moduleId, userId, patch) => {
  const { rows } = await query(
    `SELECT * FROM fn_update_module($1, $2, $3, $4::jsonb)`,
    [courseId, moduleId, userId, JSON.stringify(patch)]
  );
  return rows[0] || null;
};

/** New order = every module id of the course, first to last (fn_reorder_modules validates it). */
export const reorderModulesInDb = async (courseId, userId, moduleIds) => {
  await query(`SELECT fn_reorder_modules($1, $2, $3::int[])`, [courseId, userId, moduleIds]);
};

const assetsOf = (rows) =>
  rows.flatMap((r) => {
    const resourceType = r.type === 'video' ? 'video' : 'raw';
    return [r.cloudinary_id, ...(r.part_ids || [])].filter(Boolean).map((publicId) => ({ publicId, resourceType }));
  });

/**
 * Delete a module with its lessons (content, parts, progress, comments go with it by
 * ON DELETE CASCADE) and close the gap in the numbering of the remaining modules.
 * Returns null if the module is not in the course, { busy: true } while a video of it is
 * still being processed, else { assets } = Cloudinary files to remove afterwards.
 */
export const deleteModuleInDb = async (courseId, moduleId) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT module_id FROM content_modules WHERE module_id = $1 AND course_id = $2 FOR UPDATE`,
      [moduleId, courseId]
    );
    if (!found.rowCount) {
      await client.query('ROLLBACK');
      return null;
    }
    const busy = await client.query(
      `SELECT 1 FROM content WHERE module_id = $1 AND status IN ('uploading', 'processing') LIMIT 1`,
      [moduleId]
    );
    if (busy.rowCount) {
      await client.query('ROLLBACK');
      return { busy: true };
    }
    const files = await client.query(
      `SELECT ct.type, ct.cloudinary_id,
              ARRAY(SELECT cp.cloudinary_id FROM content_parts cp WHERE cp.content_id = ct.content_id) AS part_ids
         FROM content ct WHERE ct.module_id = $1`,
      [moduleId]
    );
    await client.query(`DELETE FROM content_modules WHERE module_id = $1`, [moduleId]);
    await client.query(`SET CONSTRAINTS uq_module_seq DEFERRED`);
    await client.query(
      `UPDATE content_modules m SET sequence_no = r.n
         FROM (SELECT module_id, ROW_NUMBER() OVER (ORDER BY sequence_no) AS n
                 FROM content_modules WHERE course_id = $1) r
        WHERE m.module_id = r.module_id AND m.sequence_no <> r.n`,
      [courseId]
    );
    await client.query('COMMIT');
    return { assets: assetsOf(files.rows) };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};
