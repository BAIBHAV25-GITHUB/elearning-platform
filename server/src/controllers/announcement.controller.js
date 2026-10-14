import { createAnnouncementInDb } from '../repositories/announcement.repository.js';
import { handleError } from '../utils/errors.js';

export const createAnnouncement = async (req, res) => {
  try {
    const courseId = req.courseId; // set by requireCourseOwner('id')
    const { title, content } = req.body ?? {};

    if (typeof title !== 'string' || !title.trim() || title.length > 200 || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ message: 'Title (max 200 characters) and content are required.' });
    }

    // posts the announcement and notifies enrolled students in one DB call
    const announcement = await createAnnouncementInDb(courseId, title.trim(), content, req.user.id);

    return res.status(201).json({ success: true, announcement });
  } catch (error) {
    return handleError(res, error);
  }
};
