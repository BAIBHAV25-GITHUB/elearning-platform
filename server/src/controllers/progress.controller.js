import {
  upsertProgressInDb,
  getContentDurationFromDb,
  getEnrollmentProgressFromDb
} from '../repositories/progress.repository.js';

export const trackProgress = async (req, res) => {
  try {
    const { enrollmentId, contentId, watchDuration } = req.body;

    if (!enrollmentId || !contentId || watchDuration === undefined) {
      return res.status(400).json({ message: 'enrollmentId, contentId, and watchDuration are required.' });
    }

    const content = await getContentDurationFromDb(contentId);
    if (!content) {
      return res.status(404).json({ message: 'Content not found.' });
    }

    const durationSec = content.duration_sec || 0;
    // Enforce 80% rule
    const completed = durationSec > 0 ? watchDuration >= durationSec * 0.8 : true;

    await upsertProgressInDb(
      parseInt(enrollmentId, 10),
      parseInt(contentId, 10),
      Math.round(watchDuration),
      completed
    );

    return res.status(200).json({
      success: true,
      completed,
      watchDuration: Math.round(watchDuration)
    });
  } catch (error) {
    console.error('Error tracking progress:', error);
    return res.status(500).json({ message: error.message || 'Progress tracking failed.' });
  }
};

export const getStudentProgress = async (req, res) => {
  try {
    const { enrollmentId } = req.params;
    const progress = await getEnrollmentProgressFromDb(enrollmentId);
    return res.status(200).json({ success: true, progress });
  } catch (error) {
    console.error('Error fetching progress:', error);
    return res.status(500).json({ message: error.message || 'Failed to fetch progress.' });
  }
};