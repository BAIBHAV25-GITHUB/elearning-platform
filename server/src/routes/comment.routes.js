import express from 'express';
import { postComment, getModuleComments } from '../controllers/comment.controller.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';

const router = express.Router();

router.post('/modules/:id/comments', authenticateJWT, postComment);
router.get('/modules/:id/comments', authenticateJWT, getModuleComments);

export default router;