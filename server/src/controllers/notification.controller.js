import { getNotificationsByUserId, markNotificationReadInDb } from '../repositories/notification.repository.js';

export const getNotifications = async (req, res) => {
  try {
    const userId = req.user.user_id || req.user.id;
    const notifications = await getNotificationsByUserId(userId);
    return res.status(200).json({ success: true, notifications });
  } catch (error) {
    console.error('Error getting notifications:', error);
    return res.status(500).json({ message: error.message || 'Failed to fetch notifications.' });
  }
};

export const markRead = async (req, res) => {
  try {
    const userId = req.user.user_id || req.user.id;
    const notificationId = req.params.id;

    const updated = await markNotificationReadInDb(notificationId, userId);
    if (!updated) {
      return res.status(404).json({ message: 'Notification not found or unauthorized.' });
    }

    return res.status(200).json({ success: true, notification: updated });
  } catch (error) {
    console.error('Error marking notification read:', error);
    return res.status(500).json({ message: error.message || 'Failed to update notification.' });
  }
};