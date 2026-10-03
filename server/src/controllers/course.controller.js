import * as courseRepo from '../repositories/course.repository.js';

export const createCourse = async (req, res) => {
  try {
    const { courseName, description, price } = req.body;
    const instructorId = req.user.id;

    // Validation guardrail
    if (price === undefined || Number(price) < 0) {
      return res.status(400).json({ message: 'Price must be a number greater than or equal to 0' });
    }

    if (!courseName || !courseName.trim()) {
      return res.status(400).json({ message: 'Course name is required' });
    }

    const course = await courseRepo.createCourseInDb({
      courseName,
      description,
      price: Number(price),
      instructorId,
    });

    return res.status(201).json({ success: true, course });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error creating course' });
  }
};

export const getInstructorCourses = async (req, res) => {
  try {
    const instructorId = req.user.id;
    const courses = await courseRepo.findCoursesByInstructorId(instructorId);
    return res.status(200).json({ success: true, courses });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error fetching courses' });
  }
};

export const getPublishedCourses = async (req, res) => {
  try {
    const courses = await courseRepo.getPublishedCoursesFromDb();
    return res.status(200).json({ success: true, courses });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Error fetching course catalog' });
  }
};

export const getCourseDetails = async (req, res) => {
  try {
    const { courseId } = req.params;
    const course = await courseRepo.getPublishedCourseDetailsFromDb(courseId);
    
    if (!course) {
      return res.status(404).json({ message: 'Course not found or is not published yet' });
    }

    return res.status(200).json({ success: true, course });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Error fetching course details' });
  }
};