import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware.js';
import { authorizeRoles } from '../middleware/role.middleware.js';
import { createCourse, getInstructorCourses, getPublishedCourses, getCourseDetails } from '../controllers/course.controller.js';

const router = Router();

// Public Routes (Students & Guests)
router.get('/', getPublishedCourses);
router.get('/:courseId', getCourseDetails);

// Protect all course management routes with Auth & Instructor guardrails
router.use(authenticateJWT, authorizeRoles('instructor', 'admin'));
router.post('/', createCourse);
router.get('/instructor/me', getInstructorCourses);

export default router;