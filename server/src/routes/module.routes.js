import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware.js';
import { authorizeRoles } from '../middleware/role.middleware.js';
import { createModule, getCourseModules } from '../controllers/module.controller.js';
import { addContentToModule } from '../controllers/content.controller.js';
import { uploadSingleFile } from '../middleware/upload.middleware.js';

const router = Router({ mergeParams: true });

router.get('/', getCourseModules);
router.post('/', authenticateJWT, authorizeRoles('instructor', 'admin'), createModule);
router.post(
  '/:moduleId/content',
  authenticateJWT,
  authorizeRoles('instructor', 'admin'),
  uploadSingleFile,
  addContentToModule
);
export default router;