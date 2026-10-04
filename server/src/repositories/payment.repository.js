import { query } from '../config/db.js';

export const getEnrollmentPaymentDetailsFromDb = async (enrollmentId) => {
  const sql = `
    SELECT e.enrollment_id, e.student_id, e.course_id, e.enrollment_status,
           c.price, c.title AS course_title
    FROM enrollments e
    JOIN courses c ON e.course_id = c.course_id
    WHERE e.enrollment_id = $1
  `;
  const { rows } = await query(sql, [enrollmentId]);
  return rows[0];
};

export const createPaymentRecordInDb = async ({ enrollmentId, razorpayOrderId, amount, currency }) => {
  const sql = `
    INSERT INTO payments (enrollment_id, transaction_id, gateway, amount, currency, status)
    VALUES ($1, $2, 'razorpay', $3, $4, 'pending')
    RETURNING payment_id, enrollment_id, transaction_id, amount, currency, status, created_at
  `;
  const values = [enrollmentId, razorpayOrderId, amount, currency];
  const { rows } = await query(sql, values);
  return rows[0];
};

export const getPaymentByOrderIdFromDb = async (razorpayOrderId) => {
  const sql = `
    SELECT payment_id, enrollment_id, transaction_id, amount, currency, status
    FROM payments
    WHERE transaction_id = $1
  `;
  const { rows } = await query(sql, [razorpayOrderId]);
  return rows[0];
};

export const confirmPaymentInDb = async (paymentId, transactionId, gateway = 'razorpay') => {
  const sql = `SELECT fn_confirm_payment($1, $2, $3) AS result`;
  const { rows } = await query(sql, [paymentId, transactionId, gateway]);
  return rows[0]?.result;
};