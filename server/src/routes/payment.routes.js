import express from 'express';
import { createOrder, verifyPayment } from '../controllers/payment.controller.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { createOrderSchema, verifyPaymentSchema } from '../validation/catalog.schemas.js';

const router = express.Router();

router.post('/create-order', authenticateJWT, validate(createOrderSchema), createOrder);
router.post('/verify', authenticateJWT, validate(verifyPaymentSchema), verifyPayment);
// POST /webhook is registered in app.js, before express.json(), so it receives the raw body (S0d)

export default router;
