import express from 'express';
import { trackProgress, getStudentProgress } from '../controllers/progress.controller.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';

const router = express.Router();

router.post('/', authenticateJWT, trackProgress);
router.get('/:enrollmentId', authenticateJWT, getStudentProgress);

export default router;