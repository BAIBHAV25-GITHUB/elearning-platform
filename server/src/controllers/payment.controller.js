import {
  razorpay,
  isPaymentConfigured,
  verifyWebhookSignature,
  verifyPaymentSignature,
} from '../integrations/razorpay.js';
import { env } from '../config/env.js';
import {
  beginPaymentInDb,
  createPaymentRecordInDb,
  getPaymentByOrderIdFromDb,
  confirmPaymentInDb,
} from '../repositories/payment.repository.js';
import { handleError, toId } from '../utils/errors.js';

export const createOrder = async (req, res) => {
  try {
    const enrollmentId = toId(req.body?.enrollmentId);
    if (!enrollmentId) {
      return res.status(400).json({ message: 'A valid enrollmentId is required' });
    }
    if (!isPaymentConfigured()) {
      return res.status(503).json({ message: 'Payments are not configured on this server' });
    }

    // Ownership + "must be pending" + the price all come from the DB (X4):
    // P0002 -> 404 (not yours / not found), P0001 -> 400 (already active, dropped...)
    const enrollment = await beginPaymentInDb(enrollmentId, req.user.id);

    const amountInPaise = Math.round(Number(enrollment.amount) * 100);
    if (!(amountInPaise > 0)) {
      return res.status(400).json({ message: 'This course is free, no payment is required' });
    }

    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `rcpt_enr_${enrollmentId}_${Date.now()}`,
      notes: {
        enrollmentId: String(enrollmentId),
        studentId: String(req.user.id),
        courseId: String(enrollment.course_id),
      },
    });

    await createPaymentRecordInDb({
      enrollmentId,
      razorpayOrderId: order.id,
      amount: enrollment.amount,
      currency: 'INR',
    });

    return res.status(201).json({
      success: true,
      order,
      key_id: env.razorpayKeyId,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * Razorpay webhook. Mounted in app.js BEFORE express.json() with express.raw(),
 * so req.body is the exact Buffer Razorpay signed (S0d).
 */
export const handleWebhook = async (req, res) => {
  try {
    const webhookSecret = env.razorpayWebhookSecret;
    if (!webhookSecret) {
      // never accept unsigned webhooks (X3)
      console.error('Razorpay webhook received but RAZORPAY_WEBHOOK_SECRET is not set - rejecting');
      return res.status(503).json({ message: 'Webhook not configured' });
    }

    const signature = req.headers['x-razorpay-signature'];
    if (!Buffer.isBuffer(req.body) || !verifyWebhookSignature(req.body, signature, webhookSecret)) {
      return res.status(400).json({ message: 'Invalid webhook signature' });
    }

    let event;
    try {
      event = JSON.parse(req.body.toString('utf8'));
    } catch {
      return res.status(400).json({ message: 'Malformed webhook body' });
    }

    if (event.event === 'payment.captured' || event.event === 'order.paid') {
      const paymentEntity = event.payload?.payment?.entity;
      if (paymentEntity?.order_id && paymentEntity?.id) {
        const dbPayment = await getPaymentByOrderIdFromDb(paymentEntity.order_id);
        if (dbPayment && dbPayment.status !== 'success') {
          try {
            await confirmPaymentInDb(dbPayment.payment_id, paymentEntity.id, 'razorpay', paymentEntity.method);
          } catch (err) {
            if (err.code === 'P0001') {
              // money was captured but the enrollment was dropped / expired: needs a manual refund.
              // Answer 200 so Razorpay stops retrying an event that can never succeed.
              console.error(`MANUAL REFUND NEEDED: payment ${paymentEntity.id} for order ${paymentEntity.order_id}: ${err.message}`);
            } else {
              throw err;
            }
          }
        }
      }
    }

    return res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('Error processing Razorpay webhook:', error);
    return res.status(500).json({ message: 'Webhook handler failed' });
  }
};

export const verifyPayment = async (req, res) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body ?? {};
    if ([razorpayOrderId, razorpayPaymentId, razorpaySignature].some((v) => typeof v !== 'string' || !v)) {
      return res.status(400).json({ message: 'razorpayOrderId, razorpayPaymentId and razorpaySignature are required' });
    }

    if (!verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature })) {
      return res.status(400).json({ message: 'Invalid payment signature verification' });
    }

    const dbPayment = await getPaymentByOrderIdFromDb(razorpayOrderId);
    // 404 (not 403) when the payment belongs to someone else, so order ids can't be probed (X5)
    if (!dbPayment || dbPayment.student_id !== req.user.id) {
      return res.status(404).json({ message: 'Associated payment record not found' });
    }

    if (dbPayment.status !== 'success') {
      // the signature already proves the payment; the method is only informational
      let method = 'card';
      try {
        method = (await razorpay.payments.fetch(razorpayPaymentId)).method || 'card';
      } catch {
        /* keep the default */
      }
      await confirmPaymentInDb(dbPayment.payment_id, razorpayPaymentId, 'razorpay', method);
    }

    return res.status(200).json({
      success: true,
      message: 'Payment verified and enrollment activated successfully',
    });
  } catch (error) {
    return handleError(res, error);
  }
};
