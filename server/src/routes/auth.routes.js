import express from 'express';
import { register, login, getMe } from '../controllers/auth.controller.js';
import { authenticateToken, authorizeRoles } from '../middleware/auth.middleware.js';

const router = express.Router();

// Public endpoints
router.post('/register', register);
router.post('/login', login);

// Authenticated endpoint (Any logged-in user)
router.get('/me', authenticateToken, getMe);

// RBAC Test Endpoint (Instructor or Admin only)
router.get('/instructor-only', authenticateToken, authorizeRoles('Instructor', 'Admin'), (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Authorized! Access granted to instructor dashboard route.',
    user: req.user,
  });
});

export default router;