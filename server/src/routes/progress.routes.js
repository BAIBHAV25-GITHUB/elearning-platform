import express from 'express';
import { trackProgress, getStudentProgress } from '../controllers/progress.controller.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { trackProgressSchema } from '../validation/learning.schemas.js';

const router = express.Router();

router.post('/', authenticateJWT, validate(trackProgressSchema), trackProgress);
router.get('/:enrollmentId', authenticateJWT, getStudentProgress);

export default router;