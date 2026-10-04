import express from 'express';
import { createBatch, getBatchesByCourse } from '../controllers/batch.controller.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';
import { authorizeRoles } from '../middleware/role.middleware.js';

const router = express.Router({ mergeParams: true });

router.post('/', authenticateJWT, authorizeRoles(['instructor', 'admin']), createBatch);
router.get('/', getBatchesByCourse);

export default router;