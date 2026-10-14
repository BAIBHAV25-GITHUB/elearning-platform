import express from 'express';
import { createOrder, verifyPayment } from '../controllers/payment.controller.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';

const router = express.Router();

router.post('/create-order', authenticateJWT, createOrder);
router.post('/verify', authenticateJWT, verifyPayment);
// POST /webhook is registered in app.js, before express.json(), so it receives the raw body (S0d)

export default router;
