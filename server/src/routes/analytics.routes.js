import express from 'express';
import { getAnalyticsSummary, getAnalyticsTimeline } from '../controllers/analytics.controller.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';
import { authorizeRoles } from '../middleware/role.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { timelineQuerySchema } from '../validation/analytics.schemas.js';

const router = express.Router();

// Instructors (own courses only) and Admins (everything)
router.get('/overview', authenticateJWT, authorizeRoles('instructor', 'admin'), getAnalyticsSummary);
router.get('/timeline', authenticateJWT, authorizeRoles('instructor', 'admin'), validate(timelineQuerySchema, 'query'), getAnalyticsTimeline);

export default router;
