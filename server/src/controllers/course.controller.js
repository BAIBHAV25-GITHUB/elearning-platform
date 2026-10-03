import * as courseRepo from '../repositories/course.repository.js';

/**
 * Day 6 & 10: Create a new course (Instructor)
 */
export const createCourse = async (req, res) => {
  try {
    const { courseName, description, price, thumbnailUrl } = req.body;
    const instructorId = req.user?.id || req.user?.userId || req.user?.user_id;

    if (!instructorId) {
      return res.status(401).json({ message: 'Unauthorized: Instructor ID missing' });
    }

    if (!courseName || !courseName.trim()) {
      return res.status(400).json({ message: 'Course name is required' });
    }

    if (price === undefined || Number(price) < 0) {
      return res.status(400).json({ message: 'Price must be a number greater than or equal to 0' });
    }

    const course = await courseRepo.createCourseInDb({
      courseName: courseName.trim(),
      description,
      price: Number(price),
      thumbnailUrl: thumbnailUrl || null,
      instructorId,
    });

    return res.status(201).json({ success: true, course });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error creating course' });
  }
};

/**
 * Day 7: Fetch all courses created by the logged-in instructor
 */
export const getInstructorCourses = async (req, res) => {
  try {
    const instructorId = req.user?.id || req.user?.userId || req.user?.user_id;
    const courses = await courseRepo.findCoursesByInstructorId(instructorId);
    return res.status(200).json({ success: true, courses });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error fetching courses' });
  }
};

/**
 * Day 9: Public Course Catalog
 */
export const getPublishedCourses = async (req, res) => {
  try {
    const courses = await courseRepo.getPublishedCoursesFromDb();
    return res.status(200).json({ success: true, courses });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Error fetching course catalog' });
  }
};

/**
 * Day 9: Public Single Course Details Page
 */
export const getCourseDetails = async (req, res) => {
  try {
    const courseId = req.params.courseId || req.params.id;
    const course = await courseRepo.getPublishedCourseDetailsFromDb(courseId);

    if (!course) {
      return res.status(404).json({ message: 'Course not found or is not published yet' });
    }

    return res.status(200).json({ success: true, course });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Error fetching course details' });
  }
};

/**
 * Day 6/8: Publish a course so it appears in the student catalog
 */
export const publishCourse = async (req, res) => {
  try {
    const courseId = req.params.courseId || req.params.id;
    const instructorId = req.user?.id || req.user?.userId || req.user?.user_id;

    const publishedCourse = await courseRepo.updateCourseStatusInDb(courseId, instructorId, 'published');
    
    if (!publishedCourse) {
      return res.status(404).json({ message: 'Course not found or unauthorized' });
    }

    return res.status(200).json({ success: true, course: publishedCourse });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Error publishing course' });
  }
};