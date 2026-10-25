import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  getMyCertificates,
  getCertificate,
  downloadCertificatePdf,
  verifyCertificate,
} from '../controllers/certificate.controller.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';

const router = express.Router();

// the verify endpoint is public: limit it so codes cannot be brute-forced
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { valid: false, message: 'Too many checks, please try again later.' },
});

router.get('/my-certificates', authenticateJWT, getMyCertificates);
router.get('/verify/:code', verifyLimiter, verifyCertificate);
router.get('/:certificateId/pdf', authenticateJWT, downloadCertificatePdf);
router.get('/:certificateId', authenticateJWT, getCertificate);

export default router;
