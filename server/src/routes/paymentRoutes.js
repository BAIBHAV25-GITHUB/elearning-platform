import { Router } from 'express';
import { createOrder, verifyPayment } from '../controllers/paymentController.js';
// import { authenticateToken } from '../middleware/auth.middleware.js';

const router = Router();

// router.post('/create-order', authenticateToken, createOrder);
// router.post('/verify', authenticateToken, verifyPayment);

export default router;