// server/src/routes/notification.routes.js
import express from 'express';
import { getNotifications, markRead } from '../controllers/notification.controller.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';

const router = express.Router();
router.get('/', authenticateJWT, getNotifications);
router.put('/:id/read', authenticateJWT, markRead);

export default router;