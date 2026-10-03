import db from '../config/db.js';

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
    INSERT INTO contents (
      module_id, 
      title, 
      type, 
      video_url, 
      cloudinary_id, 
      duration_sec, 
      sequence_no, 
      status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'ready')
    RETURNING *;
  `;

  const values = [
    moduleId,
    title,
    type || 'video',
    videoUrl,
    cloudinaryId,
    durationSec || 0,
    sequenceNo,
  ];

  const { rows } = await db.query(query, values);
  return rows[0];
};

export const getContentByModuleId = async (moduleId) => {
  const query = `
    SELECT * FROM contents 
    WHERE module_id = $1 
    ORDER BY sequence_no ASC;
  `;
  const { rows } = await db.query(query, [moduleId]);
  return rows;
};