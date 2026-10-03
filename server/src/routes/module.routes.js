import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware.js';
import { authorizeRoles } from '../middleware/role.middleware.js';
import { createModule, getCourseModules } from '../controllers/module.controller.js';

const router = Router({ mergeParams: true });

router.get('/', getCourseModules);
router.post('/', authenticateJWT, authorizeRoles('instructor', 'admin'), createModule);

export default router;