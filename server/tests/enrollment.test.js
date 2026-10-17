import { describe, it, expect } from 'vitest';
import { api, bearer, query, registerStudent, createCourse, enroll } from './helpers.js';

describe('enrollment rules', () => {
  it('a free course activates immediately; a paid one waits for payment', async () => {
    const s = await registerStudent();
    const free = await createCourse({ price: 0 });
    const paid = await createCourse({ price: 999 });

    const a = await enroll(s.token, free);
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ status: 'active', requiresPayment: false });

    const b = await enroll(s.token, paid);
    expect(b.status).toBe(201);
    expect(b.body).toMatchObject({ status: 'pending', requiresPayment: true });
  });

  it('refuses invalid ids with the validation message', async () => {
    const s = await registerStudent();
    const res = await api.post('/api/v1/enrollments').set(bearer(s.token)).send({ courseId: 'x', batchId: 1 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, message: 'Valid courseId and batchId are required' });
  });

  it('cannot enrol twice in the same course', async () => {
    const s = await registerStudent();
    const c = await createCourse();
    expect((await enroll(s.token, c)).status).toBe(201);
    const again = await enroll(s.token, c);
    expect([400, 409]).toContain(again.status);
  });

  it('cannot enrol in a draft course', async () => {
    const s = await registerStudent();
    const draft = await createCourse({ status: 'draft' });
    const res = await enroll(s.token, draft);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('capacity: the last seat is taken -> 409, and a dropped seat can be re-used', async () => {
    const [s1, s2, s3] = [await registerStudent(), await registerStudent(), await registerStudent()];
    const c = await createCourse({ capacity: 2 });

    const first = await enroll(s1.token, c);
    expect((await enroll(s2.token, c)).status).toBe(201);
    const full = await enroll(s3.token, c);
    expect(full.status).toBe(409);
    expect(full.body.success).toBe(false);

    const drop = await api.post(`/api/v1/enrollments/${first.body.enrollmentId}/drop`).set(bearer(s1.token)).send({});
    expect(drop.status).toBe(200);
    expect((await enroll(s3.token, c)).status).toBe(201);

    const { rows } = await query('SELECT current_capacity FROM batches WHERE batch_id = $1', [c.batchId]);
    expect(rows[0].current_capacity).toBe(2);
  });

  it("a student cannot drop someone else's enrollment", async () => {
    const [owner, other] = [await registerStudent(), await registerStudent()];
    const c = await createCourse();
    const e = await enroll(owner.token, c);
    const res = await api.post(`/api/v1/enrollments/${e.body.enrollmentId}/drop`).set(bearer(other.token)).send({});
    expect([403, 404]).toContain(res.status);
    const { rows } = await query('SELECT status FROM enrollments WHERE enrollment_id = $1', [e.body.enrollmentId]);
    expect(rows[0].status).toBe('active');
  });
});

describe('progress: ownership (IDOR)', () => {
  it("cannot read or write another student's progress (404)", async () => {
    const [owner, intruder] = [await registerStudent(), await registerStudent()];
    const c = await createCourse({ contents: [{ type: 'text' }] });
    const e = await enroll(owner.token, c);

    const read = await api.get(`/api/v1/progress/${e.body.enrollmentId}`).set(bearer(intruder.token));
    expect(read.status).toBe(404);

    const write = await api
      .post('/api/v1/progress')
      .set(bearer(intruder.token))
      .send({ enrollmentId: e.body.enrollmentId, contentId: c.contentIds[0], watchDuration: 0 });
    expect(write.status).toBe(404);
    const { rowCount } = await query('SELECT 1 FROM progress WHERE enrollment_id = $1', [e.body.enrollmentId]);
    expect(rowCount).toBe(0);
  });

  it('video progress follows the 80 % rule and is clamped to the real duration', async () => {
    const s = await registerStudent();
    const c = await createCourse({ contents: [{ type: 'video', durationSec: 100 }] });
    const e = await enroll(s.token, c);
    const track = (watchDuration) =>
      api.post('/api/v1/progress').set(bearer(s.token)).send({ enrollmentId: e.body.enrollmentId, contentId: c.contentIds[0], watchDuration });

    expect((await track(50)).body).toMatchObject({ completed: false, watchDuration: 50 });
    expect((await track(80)).body).toMatchObject({ completed: true });
    expect((await track(99999)).body.watchDuration).toBe(100);
    expect((await api.post('/api/v1/progress').set(bearer(s.token)).send({ enrollmentId: e.body.enrollmentId, contentId: c.contentIds[0] })).status).toBe(400);
  });
});
