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
            'ready')
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
