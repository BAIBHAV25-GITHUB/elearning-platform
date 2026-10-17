import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { register, login, me } from '../controllers/auth.controller.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { registerSchema, loginSchema } from '../validation/auth.schemas.js';
import { env } from '../config/env.js';

const router = Router();

// brute-force protection on the credential endpoints only (/me runs on every page load)
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.authRateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts, please try again later.' },
});

router.post('/register', credentialLimiter, validate(registerSchema), register);
router.post('/login', credentialLimiter, validate(loginSchema), login);
router.get('/me', authenticateJWT, me);

export default router;
