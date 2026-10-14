import Razorpay from 'razorpay';
import crypto from 'crypto';
import { env } from '../config/env.js';

export const razorpay = new Razorpay({
  // placeholders only let the server boot without keys; order creation will fail at Razorpay
  key_id: env.razorpayKeyId || 'rzp_test_dummy_key',
  key_secret: env.razorpayKeySecret || 'dummy_secret',
});

export const isPaymentConfigured = () => Boolean(env.razorpayKeyId && env.razorpayKeySecret);

// constant-time comparison of two hex digests
const safeEqualHex = (expected, actual) => {
  if (typeof actual !== 'string') return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/** rawBody must be the exact bytes Razorpay sent (Buffer). */
export const verifyWebhookSignature = (rawBody, signature, webhookSecret) => {
  if (!webhookSecret || !rawBody) return false;
  const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
};

export const verifyPaymentSignature = ({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) => {
  const secret = env.razorpayKeySecret;
  if (!secret) return false; // never verify against a default secret (anyone could forge it)
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');
  return safeEqualHex(expected, razorpaySignature);
};
