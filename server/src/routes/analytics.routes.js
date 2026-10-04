import express from 'express';
import { getAnalyticsSummary } from '../controllers/analytics.controller.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';

const router = express.Router();

// Protected route for Instructors and Admins
router.get('/overview', authenticateJWT, getAnalyticsSummary);

export default router;