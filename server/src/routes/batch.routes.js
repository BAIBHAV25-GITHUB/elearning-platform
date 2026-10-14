import express from 'express';
import { createBatch, getBatchesByCourse } from '../controllers/batch.controller.js';
import { authenticateJWT, optionalAuth } from '../middleware/auth.middleware.js';
import { authorizeRoles } from '../middleware/role.middleware.js';
import { requireCourseOwner } from '../middleware/courseAccess.middleware.js';

const router = express.Router({ mergeParams: true });

// authorizeRoles takes separate arguments, not an array (S0c)
router.post('/', authenticateJWT, authorizeRoles('instructor', 'admin'), requireCourseOwner(), createBatch);
router.get('/', optionalAuth, getBatchesByCourse);

export default router;
