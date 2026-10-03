import * as paymentService from '../services/paymentService.js';

export const createOrder = async (req, res, next) => {
  try {
    const { courseId } = req.body;
    const order = await paymentService.createRazorpayOrder(req.user.id, courseId);
    res.status(200).json({ order, key_id: process.env.RAZORPAY_KEY_ID });
  } catch (error) {
    next(error);
  }
};

export const verifyPayment = async (req, res, next) => {
  try {
    const { courseId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
    const result = await paymentService.verifyPaymentSignature({
      userId: req.user.id,
      courseId,
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};