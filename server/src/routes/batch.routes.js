import express from 'express';
import { createBatch, getBatchesByCourse, updateBatch } from '../controllers/batch.controller.js';
import { authenticateJWT, optionalAuth } from '../middleware/auth.middleware.js';
import { authorizeRoles } from '../middleware/role.middleware.js';
import { requireCourseOwner } from '../middleware/courseAccess.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { createBatchSchema, updateBatchSchema } from '../validation/catalog.schemas.js';

const router = express.Router({ mergeParams: true });

// authorizeRoles takes separate arguments, not an array (S0c)
router.post('/', authenticateJWT, authorizeRoles('instructor', 'admin'), requireCourseOwner(), validate(createBatchSchema), createBatch);
router.get('/', optionalAuth, getBatchesByCourse);
router.patch('/:batchId', authenticateJWT, authorizeRoles('instructor', 'admin'), requireCourseOwner(), validate(updateBatchSchema), updateBatch);

export default router;
