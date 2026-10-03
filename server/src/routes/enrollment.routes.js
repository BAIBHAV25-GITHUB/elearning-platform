import express from 'express';
import { enrollStudent, dropEnrollment, getMyEnrollments } from '../controllers/enrollment.controller.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';

const router = express.Router();

router.post('/', authenticateJWT, enrollStudent);
router.post('/:id/drop', authenticateJWT, dropEnrollment);
router.get('/me', authenticateJWT, getMyEnrollments);

export default router;