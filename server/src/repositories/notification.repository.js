import { query } from '../config/db.js';
import { listRows } from '../utils/pagination.js';

export const getNotificationsByUserId = async (userId, paging) => {
  const sql = `
    SELECT notification_id, user_id, title, message, type, is_read, created_at
    FROM notifications
    WHERE user_id = $1
    ORDER BY is_read ASC, created_at DESC, notification_id DESC
  `;
  return listRows(sql, [userId], paging);
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
