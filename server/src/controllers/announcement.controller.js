import { createAnnouncementInDb, notifyEnrolledStudentsForCourse } from '../repositories/announcement.repository.js';

export const createAnnouncement = async (req, res) => {
  try {
    const courseId = req.params.id;
    const { title, content } = req.body;

    if (!title || !content) {
      return res.status(400).json({ message: 'Title and content are required.' });
    }

    const announcement = await createAnnouncementInDb(courseId, title, content);
    await notifyEnrolledStudentsForCourse(courseId, `New Announcement: ${title}`);

    return res.status(201).json({ success: true, announcement });
  } catch (error) {
    console.error('Error creating announcement:', error);
    return res.status(500).json({ message: error.message || 'Failed to create announcement.' });
  }
};