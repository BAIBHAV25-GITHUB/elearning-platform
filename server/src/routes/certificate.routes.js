import express from 'express';
import { getMyCertificates } from '../controllers/certificate.controller.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';

const router = express.Router();

router.get('/my-certificates', authenticateJWT, getMyCertificates);

export default router;