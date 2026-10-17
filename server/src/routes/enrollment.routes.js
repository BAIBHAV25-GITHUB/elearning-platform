import express from 'express';
import { enrollStudent, dropEnrollment, getMyEnrollments } from '../controllers/enrollment.controller.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';
import { authorizeRoles } from '../middleware/role.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { enrollSchema } from '../validation/learning.schemas.js';
import { pagingQuerySchema } from '../validation/paging.schemas.js';

const router = express.Router();

router.post('/', authenticateJWT, authorizeRoles('student'), validate(enrollSchema), enrollStudent);
router.post('/:id/drop', authenticateJWT, dropEnrollment);
router.get('/me', authenticateJWT, validate(pagingQuerySchema, 'query'), getMyEnrollments);

export default router;
