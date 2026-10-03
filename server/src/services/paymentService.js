import Razorpay from 'razorpay';
import crypto from 'crypto';
import { query } from '../config/db.js';
import * as courseRepo from '../repositories/course.repository.js';

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

export const createRazorpayOrder = async (userId, courseId) => {
  const course = await courseRepo.getCourseById(courseId);
  if (!course) {
    const err = new Error('Course not found');
    err.statusCode = 404;
    throw err;
  }

  const options = {
    amount: Math.round(course.price * 100), // Amount in paise
    currency: 'INR',
    receipt: `receipt_c_${courseId}_u_${userId}_${Date.now()}`,
  };

  const order = await razorpay.orders.create(options);

  await query(
    `INSERT INTO payments (user_id, course_id, razorpay_order_id, amount, status)
     VALUES ($1, $2, $3, $4, 'created')`,
    [userId, courseId, order.id, course.price]
  );

  return order;
};

export const verifyPaymentSignature = async ({ userId, courseId, razorpayOrderId, razorpayPaymentId, razorpaySignature }) => {
  const body = razorpayOrderId + '|' + razorpayPaymentId;
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body.toString())
    .digest('hex');

  if (expectedSignature !== razorpaySignature) {
    await query(`UPDATE payments SET status = 'failed' WHERE razorpay_order_id = $1`, [razorpayOrderId]);
    const err = new Error('Payment verification failed');
    err.statusCode = 400;
    throw err;
  }

  await query(
    `UPDATE payments SET razorpay_payment_id = $1, razorpay_signature = $2, status = 'completed'
     WHERE razorpay_order_id = $3`,
    [razorpayPaymentId, razorpaySignature, razorpayOrderId]
  );

  await courseRepo.enrollUser(userId, courseId);
  return { success: true, message: 'Payment verified and enrolled successfully' };
};