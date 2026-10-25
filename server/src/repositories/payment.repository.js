import { query } from '../config/db.js';

// payments.gateway_order_id  = Razorpay ORDER id (order_xxx), used for lookups
// payments.transaction_id    = Razorpay PAYMENT id (pay_xxx), set on confirmation
// payments.status            = pending | success | failed | refunded

const PAYMENT_METHODS = new Set(['card', 'upi', 'netbanking', 'wallet', 'free']);

export const getEnrollmentPaymentDetailsFromDb = async (enrollmentId) => {
  const sql = `
    SELECT e.enrollment_id, e.student_id, e.course_id, e.status AS enrollment_status,
           c.price, c.title AS course_title
    FROM enrollments e
    JOIN courses c ON e.course_id = c.course_id
    WHERE e.enrollment_id = $1
  `;
  const { rows } = await query(sql, [enrollmentId]);
  return rows[0];
};

/**
 * Ownership + state check and the amount to charge, straight from the DB
 * (never trust the client). Throws P0002 if the enrollment is not the
 * student's, P0001 if it is not pending.
 * Returns { enrollment_id, course_id, title, amount }.
 */
export const beginPaymentInDb = async (enrollmentId, studentId) => {
  const { rows } = await query('SELECT * FROM fn_begin_payment($1, $2)', [enrollmentId, studentId]);
  return rows[0];
};

/** Stores a new pending payment attempt for a Razorpay order. */
export const createPaymentRecordInDb = async ({ enrollmentId, razorpayOrderId, amount, currency = 'INR' }) => {
  const sql = `
    INSERT INTO payments (enrollment_id, gateway_order_id, gateway, amount, currency, status)
    VALUES ($1, $2, 'razorpay', $3, $4, 'pending')
    RETURNING payment_id, enrollment_id, gateway_order_id, amount, currency, status, created_at
  `;
  const { rows } = await query(sql, [enrollmentId, razorpayOrderId, amount, currency]);
  return rows[0];
};

/** Lookup by Razorpay order id. student_id is included for ownership checks. */
export const getPaymentByOrderIdFromDb = async (razorpayOrderId) => {
  const sql = `
    SELECT p.payment_id, p.enrollment_id, e.student_id,
           p.gateway_order_id, p.transaction_id, p.amount, p.currency, p.status
    FROM payments p
    JOIN enrollments e ON e.enrollment_id = p.enrollment_id
    WHERE p.gateway_order_id = $1
  `;
  const { rows } = await query(sql, [razorpayOrderId]);
  return rows[0];
};

/**
 * Idempotent: confirming an already successful payment is a no-op.
 * `method` is Razorpay's payment method; values outside the DB enum
 * (emi, paylater, ...) are stored as 'card'.
 */
export const confirmPaymentInDb = async (paymentId, gatewayPaymentId, gateway = 'razorpay', method = 'card') => {
  const dbMethod = PAYMENT_METHODS.has(method) ? method : 'card';
  const sql = `SELECT fn_confirm_payment($1, $2, $3, $4::payment_method_enum)`;
  await query(sql, [paymentId, gatewayPaymentId, gateway, dbMethod]);
  return true;
};

/** Admin payment list (fn_list_payments). Returns { payments, total }. */
export const listPayments = async ({ search = null, status = null, needsRefund = null, limit = 20, offset = 0 }) => {
  const { rows } = await query('SELECT * FROM fn_list_payments($1, $2::payment_status_enum, $3, $4, $5)', [
    search,
    status,
    needsRefund,
    limit,
    offset,
  ]);
  const total = rows.length ? Number(rows[0].total_count) : 0;
  return { payments: rows.map(({ total_count, ...p }) => p), total };
};

/** Webhook: money was captured but the enrollment is dead; remember it so an admin can refund it. */
export const flagPaymentForRefund = async (paymentId, gatewayPaymentId) => {
  await query('SELECT fn_flag_payment_for_refund($1, $2)', [paymentId, gatewayPaymentId]);
};

/** Validates a refund (admin, rules in SQL) and returns { payment_id, amount, transaction_id, ... }. */
export const getRefundTarget = async (adminId, paymentId) => {
  const { rows } = await query('SELECT * FROM fn_get_refund_target($1, $2)', [adminId, paymentId]);
  return rows[0];
};

/** Records an accepted refund: payment refunded, enrollment dropped, student notified. */
export const markPaymentRefunded = async (adminId, paymentId, refundId, reason) => {
  const { rows } = await query('SELECT * FROM fn_mark_payment_refunded($1, $2, $3, $4)', [adminId, paymentId, refundId, reason]);
  return rows[0];
};
