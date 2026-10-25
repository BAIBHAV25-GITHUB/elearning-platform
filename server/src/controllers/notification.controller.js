import { getNotificationsByUserId, markNotificationReadInDb } from '../repositories/notification.repository.js';
import { handleError, toId } from '../utils/errors.js';
import { pagingFrom, listResponse } from '../utils/pagination.js';

export const getNotifications = async (req, res) => {
  try {
    const paging = pagingFrom(req.valid?.query);
    const result = await getNotificationsByUserId(req.user.id, paging);
    return res.status(200).json(listResponse('notifications', result, paging));
  } catch (error) {
    return handleError(res, error);
  }
};

export const markRead = async (req, res) => {
  try {
    const notificationId = toId(req.params.id);
    if (!notificationId) return res.status(400).json({ success: false, message: 'Invalid notification id.' });

    const updated = await markNotificationReadInDb(notificationId, req.user.id);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Notification not found or unauthorized.' });
    }

    return res.status(200).json({ success: true, notification: updated });
  } catch (error) {
    return handleError(res, error);
  }
};
