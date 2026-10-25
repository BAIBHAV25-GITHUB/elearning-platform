// server/src/routes/announcement.routes.js
import express from 'express';
import { createAnnouncement } from '../controllers/announcement.controller.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';
import { authorizeRoles } from '../middleware/role.middleware.js';
import { requireCourseOwner } from '../middleware/courseAccess.middleware.js';

const router = express.Router();
router.post(
  '/courses/:id/announcements',
  authenticateJWT,
  authorizeRoles('instructor', 'admin'),
  requireCourseOwner('id'),
  createAnnouncement
);

export default router;
