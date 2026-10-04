import { razorpay, verifyWebhookSignature, verifyPaymentSignature } from '../integrations/razorpay.js';
import {
  getEnrollmentPaymentDetailsFromDb,
  createPaymentRecordInDb,
  getPaymentByOrderIdFromDb,
  confirmPaymentInDb
} from '../repositories/payment.repository.js';

export const createOrder = async (req, res) => {
  try {
    const { enrollmentId } = req.body;

    if (!enrollmentId) {
      return res.status(400).json({ message: 'enrollmentId is required' });
    }

    const enrollment = await getEnrollmentPaymentDetailsFromDb(enrollmentId);
    if (!enrollment) {
      return res.status(404).json({ message: 'Enrollment record not found' });
    }

    const amountInPaise = Math.round(Number(enrollment.price) * 100);

    const options = {
      amount: amountInPaise,
      currency: 'INR',
      receipt: `rcpt_enr_${enrollmentId}_${Date.now()}`,
      notes: {
        enrollmentId: String(enrollmentId),
        studentId: String(enrollment.student_id),
        courseId: String(enrollment.course_id)
      }
    };

    const order = await razorpay.orders.create(options);

    await createPaymentRecordInDb({
      enrollmentId,
      razorpayOrderId: order.id,
      amount: enrollment.price,
      currency: 'INR'
    });

    return res.status(201).json({
      success: true,
      order,
      key_id: process.env.RAZORPAY_KEY_ID
    });
  } catch (error) {
    console.error('Error creating Razorpay order:', error);
    return res.status(500).json({ message: error.message || 'Failed to create payment order' });
  }
};

export const handleWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (webhookSecret) {
      const isValid = verifyWebhookSignature(req.rawBody || JSON.stringify(req.body), signature, webhookSecret);
      if (!isValid) {
        return res.status(400).json({ message: 'Invalid webhook signature' });
      }
    }

    const event = req.body;

    if (event.event === 'payment.captured' || event.event === 'order.paid') {
      const paymentEntity = event.payload.payment.entity;
      const razorpayOrderId = paymentEntity.order_id;
      const razorpayPaymentId = paymentEntity.id;

      const dbPayment = await getPaymentByOrderIdFromDb(razorpayOrderId);
      if (dbPayment && dbPayment.status !== 'completed') {
        await confirmPaymentInDb(dbPayment.payment_id, razorpayPaymentId, 'razorpay');
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
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    const isValid = verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature });
    if (!isValid) {
      return res.status(400).json({ message: 'Invalid payment signature verification' });
    }

    const dbPayment = await getPaymentByOrderIdFromDb(razorpayOrderId);
    if (!dbPayment) {
      return res.status(404).json({ message: 'Associated payment record not found' });
    }

    if (dbPayment.status !== 'completed') {
      await confirmPaymentInDb(dbPayment.payment_id, razorpayPaymentId, 'razorpay');
    }

    return res.status(200).json({
      success: true,
      message: 'Payment verified and enrollment activated successfully'
    });
  } catch (error) {
    console.error('Error verifying payment:', error);
    return res.status(500).json({ message: error.message || 'Payment verification failed' });
  }
};