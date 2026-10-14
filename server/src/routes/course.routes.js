import { Router } from 'express';
import { authenticateJWT, optionalAuth } from '../middleware/auth.middleware.js';
import { authorizeRoles } from '../middleware/role.middleware.js';
import {
  createCourse,
  getInstructorCourses,
  getPublishedCourses,
  getCourseDetails,
  publishCourse,
} from '../controllers/course.controller.js';

const router = Router();
const instructorOnly = [authenticateJWT, authorizeRoles('instructor', 'admin')];

// Guards are applied per route (not with router.use), so guests and students
// can still reach the public routes and nested /courses/:id/... routers (S0b).

// Public
router.get('/', getPublishedCourses);

// Instructor / admin (must be declared before '/:courseId')
router.get('/instructor/me', ...instructorOnly, getInstructorCourses);
router.post('/', ...instructorOnly, createCourse);

// Public course page; a logged-in user additionally gets media URLs when entitled
router.get('/:courseId', optionalAuth, getCourseDetails);
router.patch('/:courseId/publish', ...instructorOnly, publishCourse); // owner check inside updateCourseStatusInDb

export default router;
