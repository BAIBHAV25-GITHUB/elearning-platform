import express from 'express';
import { postComment, getModuleComments } from '../controllers/comment.controller.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { pagingQuerySchema } from '../validation/paging.schemas.js';
import { postCommentSchema } from '../validation/catalog.schemas.js';

const router = express.Router();

router.post('/modules/:id/comments', authenticateJWT, validate(postCommentSchema), postComment);
router.get('/modules/:id/comments', authenticateJWT, validate(pagingQuerySchema, 'query'), getModuleComments);

export default router;