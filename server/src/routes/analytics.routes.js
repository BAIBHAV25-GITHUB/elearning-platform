import express from 'express';
import { getAnalyticsSummary } from '../controllers/analytics.controller.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';
import { authorizeRoles } from '../middleware/role.middleware.js';

const router = express.Router();

// Instructors (own courses only) and Admins (everything)
router.get('/overview', authenticateJWT, authorizeRoles('instructor', 'admin'), getAnalyticsSummary);

export default router;
