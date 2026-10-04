import express from 'express';
import { createOrder, handleWebhook, verifyPayment } from '../controllers/payment.controller.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';

const router = express.Router();

router.post('/create-order', authenticateJWT, createOrder);
router.post('/verify', authenticateJWT, verifyPayment);
router.post('/webhook', express.raw({ type: 'application/json' }), handleWebhook);

export default router;