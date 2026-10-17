import { describe, it, expect } from 'vitest';
import { api, bearer, query, SEED, login, registerStudent, createCourse } from './helpers.js';

const timeline = async (token, qs = '') => api.get(`/api/v1/analytics/timeline${qs}`).set(bearer(token));
const overviewRevenue = async (token) => {
  const res = await api.get('/api/v1/analytics/overview').set(bearer(token));
  return res.body.data.courseRevenue.reduce((s, r) => s + Number(r.total_revenue), 0);
};
const thisMonth = (res) => res.body.data.months.at(-1);

/** Active enrollment (or a dropped one) for a fresh student, straight in the database. */
const addEnrollment = async ({ courseId, batchId }, status = 'active') => {
  const student = await registerStudent();
  const { rows } = await query(
    `INSERT INTO enrollments (student_id, course_id, batch_id, status)
     VALUES ($1, $2, $3, $4::enrollment_status_enum) RETURNING enrollment_id`,
    [student.id, courseId, batchId, status]
  );
  return rows[0].enrollment_id;
};
const addPayment = (enrollmentId, amount, status) =>
  query(
    `INSERT INTO payments (enrollment_id, amount, status, payment_method, gateway, paid_at)
     VALUES ($1, $2, $3::payment_status_enum, 'upi', 'razorpay', now())`,
    [enrollmentId, amount, status]
  );

describe('GET /analytics/timeline', () => {
  it('needs a login and an instructor or admin role', async () => {
    expect((await api.get('/api/v1/analytics/timeline')).status).toBe(401);
    const student = await registerStudent();
    const res = await timeline(student.token);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('returns one row per month, oldest first, with zeros for empty months', async () => {
    const john = await login(SEED.john);
    const res = await timeline(john, '?months=3');
    expect(res.status).toBe(200);
    const months = res.body.data.months;
    expect(months).toHaveLength(3);
    expect(months.map((m) => m.month)).toEqual([...months.map((m) => m.month)].sort());
    expect(months.at(-1).month).toMatch(/^\d{4}-\d{2}$/);
    for (const m of months) {
      expect(Number(m.net_revenue)).toBeCloseTo(Number(m.gross_revenue) - Number(m.refunded));
      expect(Number.isInteger(m.enrollments)).toBe(true);
    }
    expect((await timeline(john)).body.data.months).toHaveLength(12); // default window
  });

  it('rejects a bad months value', async () => {
    const john = await login(SEED.john);
    for (const bad of ['0', '37', 'abc', '-1', '1.5']) {
      const res = await timeline(john, `?months=${bad}`);
      expect(res.status, `months=${bad}`).toBe(400);
      expect(res.body.message).toMatch(/months/);
    }
  });

  it('subtracts refunds, leaves dropped enrollments out and scopes by owner', async () => {
    const [john, sarah, admin] = await Promise.all([login(SEED.john), login(SEED.sarah), login(SEED.admin)]);
    const before = {
      john: thisMonth(await timeline(john)),
      sarah: thisMonth(await timeline(sarah)),
      admin: thisMonth(await timeline(admin)),
    };
    const johnRevenueBefore = await overviewRevenue(john);

    const course = await createCourse({ instructor: SEED.john, price: 1000 });
    await addPayment(await addEnrollment(course), 1000, 'success');
    await addPayment(await addEnrollment(course), 500, 'success');
    // a refund flips the payment to 'refunded' and then drops the enrollment (a trigger forbids paying for a dropped one)
    const refundedEnrollment = await addEnrollment(course);
    await addPayment(refundedEnrollment, 300, 'refunded');
    await query(`UPDATE enrollments SET status = 'dropped' WHERE enrollment_id = $1`, [refundedEnrollment]);
    await addPayment(await addEnrollment(course, 'pending'), 700, 'pending'); // not money yet
    await addPayment(await addEnrollment(course, 'pending'), 200, 'failed');

    const after = {
      john: thisMonth(await timeline(john)),
      sarah: thisMonth(await timeline(sarah)),
      admin: thisMonth(await timeline(admin)),
    };
    const delta = (key) => ({
      gross: Number(after[key].gross_revenue) - Number(before[key].gross_revenue),
      refunded: Number(after[key].refunded) - Number(before[key].refunded),
      net: Number(after[key].net_revenue) - Number(before[key].net_revenue),
      enrollments: after[key].enrollments - before[key].enrollments,
    });

    // 1000 + 500 collected, 300 refunded: gross 1800, net 1500; active + pending enrollments count, the dropped one does not
    expect(delta('john')).toEqual({ gross: 1800, refunded: 300, net: 1500, enrollments: 4 });
    expect(delta('admin')).toEqual({ gross: 1800, refunded: 300, net: 1500, enrollments: 4 });
    expect(delta('sarah')).toEqual({ gross: 0, refunded: 0, net: 0, enrollments: 0 });

    // the monthly net agrees with the course revenue view the overview endpoint serves
    expect((await overviewRevenue(john)) - johnRevenueBefore).toBe(1500);
  });
});
