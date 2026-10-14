import { query } from '../config/db.js';

// start_date / end_date are DATE columns; config/db.js returns them as
// 'YYYY-MM-DD' strings (no timezone shifting).
const BATCH_COLUMNS = `batch_id, course_id, batch_name, start_date, end_date,
                       max_capacity, current_capacity, status, created_at`;

export const createBatchInDb = async ({ courseId, batchName, startDate, endDate, maxCapacity }) => {
  const sql = `
    INSERT INTO batches (course_id, batch_name, start_date, end_date, max_capacity, current_capacity, status)
    VALUES ($1, $2, $3, $4, $5, 0, 'open')
    RETURNING ${BATCH_COLUMNS}
  `;
  const { rows } = await query(sql, [courseId, batchName, startDate, endDate, maxCapacity]);
  return rows[0];
};

/** onlyOpen = true: only batches students can still join (status 'open'). */
export const getBatchesByCourseFromDb = async (courseId, { onlyOpen = false } = {}) => {
  const sql = `
    SELECT ${BATCH_COLUMNS}
    FROM batches
    WHERE course_id = $1
      AND (NOT $2::boolean OR status = 'open')
    ORDER BY start_date ASC
  `;
  const { rows } = await query(sql, [courseId, onlyOpen]);
  return rows;
};

/** Marks batches whose end_date has passed as 'closed' (F12). Returns how many changed. */
export const closeEndedBatchesInDb = async () => {
  const { rows } = await query(`SELECT fn_close_ended_batches() AS closed`);
  return rows[0].closed;
};
