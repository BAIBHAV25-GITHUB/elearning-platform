import { Router } from 'express';
import { authenticateJWT, optionalAuth } from '../middleware/auth.middleware.js';
import { authorizeRoles, requireApprovedInstructor, requireApprovedToPublish } from '../middleware/role.middleware.js';
import { requireCourseOwner } from '../middleware/courseAccess.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { pagingQuerySchema } from '../validation/paging.schemas.js';
import {
  createCourse,
  getInstructorCourses,
  getPublishedCourses,
  getCourseDetails,
  publishCourse,
  setCourseStatus,
  updateCourse,
  deleteCourse,
  getManagedCourse,
} from '../controllers/course.controller.js';

const router = Router();
const instructorOnly = [authenticateJWT, authorizeRoles('instructor', 'admin')];

// Guards are applied per route (not with router.use), so guests and students
// can still reach the public routes and nested /courses/:id/... routers (S0b).

// Public
router.get('/', validate(pagingQuerySchema, 'query'), getPublishedCourses);

// Instructor / admin (must be declared before '/:courseId')
router.get('/instructor/me', ...instructorOnly, getInstructorCourses);
router.post('/', ...instructorOnly, requireApprovedInstructor, createCourse);
router.get('/:courseId/manage', ...instructorOnly, requireCourseOwner(), getManagedCourse);

// Public course page; a logged-in user additionally gets media URLs when entitled
router.get('/:courseId', optionalAuth, getCourseDetails);
// ownership + business rules are enforced inside fn_update_course / fn_set_course_status
router.patch('/:courseId', ...instructorOnly, updateCourse);
router.patch('/:courseId/status', ...instructorOnly, requireApprovedToPublish, setCourseStatus);
router.delete('/:courseId', ...instructorOnly, deleteCourse);
router.patch('/:courseId/publish', ...instructorOnly, requireApprovedInstructor, publishCourse);

export default router;
