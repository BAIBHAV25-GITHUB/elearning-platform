// server/src/routes/notification.routes.js
import express from 'express';
import { getNotifications, markRead } from '../controllers/notification.controller.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { pagingQuerySchema } from '../validation/paging.schemas.js';

const router = express.Router();
router.get('/', authenticateJWT, validate(pagingQuerySchema, 'query'), getNotifications);
router.put('/:id/read', authenticateJWT, markRead);

export default router;