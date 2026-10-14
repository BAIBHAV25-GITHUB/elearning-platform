import express from 'express';
import { authenticateJWT, optionalAuth } from '../middleware/auth.middleware.js';
import { authorizeRoles } from '../middleware/role.middleware.js';
import { requireCourseOwner } from '../middleware/courseAccess.middleware.js';
import { createModule, getCourseModules } from '../controllers/module.controller.js';
import { addContentToModule } from '../controllers/content.controller.js';
import { uploadSingleFile } from '../middleware/upload.middleware.js';

const router = express.Router({ mergeParams: true });

const owner = [authenticateJWT, authorizeRoles('instructor', 'admin'), requireCourseOwner()];

router.get('/', optionalAuth, getCourseModules);
router.post('/', ...owner, createModule);
// ownership is checked BEFORE the upload middleware so a rejected user never uploads a file
router.post('/:moduleId/content', ...owner, uploadSingleFile, addContentToModule);

export default router;
