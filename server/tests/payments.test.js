import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { api, bearer, query, uid, registerStudent, createCourse, enroll, signedWebhook } from './helpers.js';

const webhook = ({ raw, signature }) =>
  api.post('/api/v1/payments/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', signature ?? '').send(raw);

/** A student with a PENDING enrollment in a paid course and a pending Razorpay order for it. */
const pendingPayment = async () => {
  const student = await registerStudent();
  const course = await createCourse({ price: 1500 });
  const e = await enroll(student.token, course);
  const orderId = `order_${uid()}`;
  const { rows } = await query(
    `INSERT INTO payments (enrollment_id, amount, status, gateway, gateway_order_id)
     VALUES ($1, 1500, 'pending', 'razorpay', $2) RETURNING payment_id`,
    [e.body.enrollmentId, orderId]
  );
  return { student, enrollmentId: e.body.enrollmentId, paymentId: rows[0].payment_id, orderId };
};

const captured = (orderId, paymentId = `pay_${uid()}`) => ({
  event: 'payment.captured',
  payload: { payment: { entity: { id: paymentId, order_id: orderId, method: 'upi' } } },
});

describe('Razorpay webhook', () => {
  it('rejects a request with no signature', async () => {
    const res = await webhook({ raw: JSON.stringify(captured('order_x')), signature: '' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects a wrong signature and changes nothing', async () => {
    const p = await pendingPayment();
    const forged = signedWebhook(captured(p.orderId), 'some-other-secret');
    expect((await webhook(forged)).status).toBe(400);
    const { rows } = await query('SELECT status FROM payments WHERE payment_id = $1', [p.paymentId]);
    expect(rows[0].status).toBe('pending');
  });

  it('rejects a body that was altered after signing', async () => {
    const p = await pendingPayment();
    const signed = signedWebhook(captured(p.orderId));
    const tampered = { raw: signed.raw.replace('upi', 'card'), signature: signed.signature };
    expect((await webhook(tampered)).status).toBe(400);
  });

  it('confirms a pending payment and activates the enrollment', async () => {
    const p = await pendingPayment();
    const res = await webhook(signedWebhook(captured(p.orderId, 'pay_abc123')));
    expect(res.status).toBe(200);

    const pay = (await query('SELECT status, transaction_id, payment_method FROM payments WHERE payment_id = $1', [p.paymentId])).rows[0];
    expect(pay).toMatchObject({ status: 'success', transaction_id: 'pay_abc123', payment_method: 'upi' });
    const enr = (await query('SELECT status FROM enrollments WHERE enrollment_id = $1', [p.enrollmentId])).rows[0];
    expect(enr.status).toBe('active');
  });

  it('is idempotent: Razorpay retries do not duplicate anything', async () => {
    const p = await pendingPayment();
    const signed = signedWebhook(captured(p.orderId, 'pay_once'));
    expect((await webhook(signed)).status).toBe(200);
    expect((await webhook(signed)).status).toBe(200);
    expect((await webhook(signed)).status).toBe(200);

    const ok = await query("SELECT count(*)::int AS n FROM payments WHERE enrollment_id = $1 AND status = 'success'", [p.enrollmentId]);
    expect(ok.rows[0].n).toBe(1);
    // only the first confirmation is audited
    const audit = await query("SELECT count(*)::int AS n FROM audit_logs WHERE table_name = 'payments' AND record_id = $1", [p.paymentId]);
    expect(audit.rows[0].n).toBe(1);
  });

  it('answers 200 for an unknown order (so Razorpay stops retrying) and creates nothing', async () => {
    const before = (await query("SELECT count(*)::int AS n FROM payments WHERE status = 'success'")).rows[0].n;
    expect((await webhook(signedWebhook(captured('order_unknown')))).status).toBe(200);
    const after = (await query("SELECT count(*)::int AS n FROM payments WHERE status = 'success'")).rows[0].n;
    expect(after).toBe(before);
  });

  it('flags money captured for a dropped enrollment as "needs refund" instead of failing', async () => {
    const p = await pendingPayment();
    await api.post(`/api/v1/enrollments/${p.enrollmentId}/drop`).set(bearer(p.student.token)).send({});
    expect((await webhook(signedWebhook(captured(p.orderId, 'pay_late')))).status).toBe(200);
    const { rows } = await query('SELECT status, needs_refund FROM payments WHERE payment_id = $1', [p.paymentId]);
    expect(rows[0].needs_refund).toBe(true);
    expect(rows[0].status).not.toBe('success');
  });
});

describe('POST /payments/verify (browser callback)', () => {
  const sign = (orderId, paymentId, secret = process.env.RAZORPAY_KEY_SECRET) =>
    crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');

  it('requires all three fields', async () => {
    const s = await registerStudent();
    const res = await api.post('/api/v1/payments/verify').set(bearer(s.token)).send({ razorpayOrderId: 'o' });
    expect(res.status).toBe(400);
  });

  it('rejects a forged signature', async () => {
    const p = await pendingPayment();
    const res = await api.post('/api/v1/payments/verify').set(bearer(p.student.token)).send({
      razorpayOrderId: p.orderId,
      razorpayPaymentId: 'pay_x',
      razorpaySignature: sign(p.orderId, 'pay_x', 'wrong'),
    });
    expect(res.status).toBe(400);
  });

  it("a student cannot confirm someone else's order (404, order ids can't be probed)", async () => {
    const p = await pendingPayment();
    const other = await registerStudent();
    const res = await api.post('/api/v1/payments/verify').set(bearer(other.token)).send({
      razorpayOrderId: p.orderId,
      razorpayPaymentId: 'pay_y',
      razorpaySignature: sign(p.orderId, 'pay_y'),
    });
    expect(res.status).toBe(404);
  });
});
