import { query } from '../config/db.js';

export const getNotificationsByUserId = async (userId) => {
  const sql = `
    SELECT notification_id, user_id, message, is_read, created_at
    FROM notifications
    WHERE user_id = $1
    ORDER BY is_read ASC, created_at DESC
  `;
  const { rows } = await query(sql, [userId]);
  return rows;
};

export const markNotificationReadInDb = async (notificationId, userId) => {
  const sql = `
    UPDATE notifications
    SET is_read = TRUE
    WHERE notification_id = $1 AND user_id = $2
    RETURNING notification_id, is_read
  `;
  const { rows } = await query(sql, [notificationId, userId]);
  return rows[0];
};