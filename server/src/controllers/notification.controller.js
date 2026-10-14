import { getNotificationsByUserId, markNotificationReadInDb } from '../repositories/notification.repository.js';
import { handleError, toId } from '../utils/errors.js';

export const getNotifications = async (req, res) => {
  try {
    const notifications = await getNotificationsByUserId(req.user.id);
    return res.status(200).json({ success: true, notifications });
  } catch (error) {
    return handleError(res, error);
  }
};

export const markRead = async (req, res) => {
  try {
    const notificationId = toId(req.params.id);
    if (!notificationId) return res.status(400).json({ message: 'Invalid notification id.' });

    const updated = await markNotificationReadInDb(notificationId, req.user.id);
    if (!updated) {
      return res.status(404).json({ message: 'Notification not found or unauthorized.' });
    }

    return res.status(200).json({ success: true, notification: updated });
  } catch (error) {
    return handleError(res, error);
  }
};
