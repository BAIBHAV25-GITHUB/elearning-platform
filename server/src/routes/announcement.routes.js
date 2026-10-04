// server/src/routes/announcement.routes.js
import express from 'express';
import { createAnnouncement } from '../controllers/announcement.controller.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';

const router = express.Router();
router.post('/courses/:id/announcements', authenticateJWT, createAnnouncement);

export default router;