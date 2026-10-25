import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware.js';
import { authorizeRoles } from '../middleware/role.middleware.js';
import {
  listUsers,
  updateUserStatus,
  deleteUser,
  updateUserRole,
  reviewInstructor,
  reassignCourse,
  listPayments,
  refundPayment,
  getOverview,
  listCourses,
  updateCourseStatus,
  listAuditLogs,
} from '../controllers/admin.controller.js';

const router = Router();

// Everything under /admin is admin-only.
router.use(authenticateJWT, authorizeRoles('admin'));

router.get('/overview', getOverview);
router.get('/users', listUsers);
router.patch('/users/:userId/status', updateUserStatus);
router.patch('/users/:userId/role', updateUserRole);
router.patch('/users/:userId/instructor-status', reviewInstructor);
router.delete('/users/:userId', deleteUser);

router.get('/courses', listCourses);
router.patch('/courses/:courseId/status', updateCourseStatus);
router.patch('/courses/:courseId/instructor', reassignCourse);
router.get('/payments', listPayments);
router.post('/payments/:paymentId/refund', refundPayment);
router.get('/audit-logs', listAuditLogs);

export default router;
