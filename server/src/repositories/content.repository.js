import db from "../config/db.js";

/**
 * Insert a content row. If sequenceNo is omitted the next free number inside
 * the module (MAX + 1) is used, avoiding uq_content_seq collisions (F10).
 * `type` must be one of video | pdf | text (enum content_type_enum).
 */
export const createContent = async ({
  moduleId,
  title,
  type,
  videoUrl,
  cloudinaryId,
  durationSec,
  sequenceNo,
  status = "ready",
}) => {
  const query = `
    INSERT INTO content (
      module_id,
      title,
      type,
      video_url,
      cloudinary_id,
      duration_sec,
      sequence_no,
      status
    )
    VALUES ($1, $2, $3::content_type_enum, $4, $5, $6,
            COALESCE($7::smallint,
                     (SELECT COALESCE(MAX(sequence_no), 0) + 1
                        FROM content WHERE module_id = $1)),
            $8::content_status_enum)
    RETURNING *;
  `;

  const values = [
    moduleId,
    title,
    type || "video",
    videoUrl,
    cloudinaryId,
    durationSec || 0,
    sequenceNo ?? null,
    status,
  ];

  const { rows } = await db.query(query, values);
  return rows[0];
};

export const getContentByModuleId = async (moduleId) => {
  const query = `
    SELECT * FROM content 
    WHERE module_id = $1 
    ORDER BY sequence_no ASC;
  `;
  const { rows } = await db.query(query, [moduleId]);
  return rows;
};

/**
 * A processed video is ready: store its pieces and flip the row to 'ready' in one transaction.
 * One piece  -> its URL lives on content.video_url (no content_parts rows).
 * Many pieces -> rows in content_parts, content.video_url stays NULL.
 * content.duration_sec is always the TOTAL, so progress works on the whole video.
 */
export const completeVideoContent = async (contentId, parts) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const total = parts.reduce((t, p) => t + p.durationSec, 0);
    if (parts.length === 1) {
      await client.query(
        `UPDATE content SET video_url = $2, cloudinary_id = $3, duration_sec = $4,
                            status = 'ready', error_message = NULL
          WHERE content_id = $1`,
        [contentId, parts[0].url, parts[0].publicId, total]
      );
    } else {
      for (const [i, p] of parts.entries()) {
        await client.query(
          `INSERT INTO content_parts (content_id, part_no, video_url, cloudinary_id, duration_sec)
           VALUES ($1, $2, $3, $4, $5)`,
          [contentId, i + 1, p.url, p.publicId, p.durationSec]
        );
      }
      await client.query(
        `UPDATE content SET duration_sec = $2, status = 'ready', error_message = NULL
          WHERE content_id = $1`,
        [contentId, total]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

export const markContentError = async (contentId, message) => {
  await db.query(
    `UPDATE content SET status = 'error', error_message = $2 WHERE content_id = $1`,
    [contentId, String(message || "Processing failed").slice(0, 500)]
  );
};

/** Jobs only live in memory, so after a restart anything still in progress is dead. */
export const failStuckVideos = async () => {
  const { rowCount } = await db.query(
    `UPDATE content
        SET status = 'error',
            error_message = 'The server restarted while this video was being processed. Please upload it again.'
      WHERE status IN ('uploading', 'processing')`
  );
  return rowCount;
};

/**
 * Delete one content item of a module. Returns null if it does not exist in that module,
 * otherwise { status, type, assets } where assets = the Cloudinary assets to remove afterwards
 * (the video itself, or every piece of a long video; or the PDF).
 * Pieces, student progress rows are removed by ON DELETE CASCADE.
 */
export const deleteContent = async (contentId, moduleId) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT content_id, type, status, cloudinary_id FROM content
        WHERE content_id = $1 AND module_id = $2 FOR UPDATE`,
      [contentId, moduleId]
    );
    if (!found.rowCount) {
      await client.query("ROLLBACK");
      return null;
    }
    const row = found.rows[0];
    if (row.status === "uploading" || row.status === "processing") {
      await client.query("ROLLBACK");
      return { busy: true };
    }
    const parts = await client.query(
      "SELECT cloudinary_id FROM content_parts WHERE content_id = $1",
      [contentId]
    );
    const resourceType = row.type === "video" ? "video" : "raw";
    const assets = [
      ...(row.cloudinary_id ? [row.cloudinary_id] : []),
      ...parts.rows.map((p) => p.cloudinary_id),
    ].map((publicId) => ({ publicId, resourceType }));

    await client.query("DELETE FROM content WHERE content_id = $1", [contentId]);
    await client.query("COMMIT");
    return { type: row.type, assets };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};
