import { describe, it, expect } from 'vitest';
import { api, bearer, query, registerStudent, createCourse, enroll } from './helpers.js';

const complete = (token, enrollmentId, contentId, extra = {}) =>
  api.post('/api/v1/progress').set(bearer(token)).send({ enrollmentId, contentId, ...extra });

const certCount = async (enrollmentId) =>
  (await query('SELECT count(*)::int AS n FROM certificates WHERE enrollment_id = $1', [enrollmentId])).rows[0].n;

describe('certificate trigger', () => {
  it('is issued only when EVERY lesson is complete', async () => {
    const s = await registerStudent();
    const c = await createCourse({ contents: [{ type: 'text' }, { type: 'text' }] });
    const e = await enroll(s.token, c);
    const id = e.body.enrollmentId;

    await complete(s.token, id, c.contentIds[0]);
    expect(await certCount(id)).toBe(0);

    await complete(s.token, id, c.contentIds[1]);
    expect(await certCount(id)).toBe(1);
    const { rows } = await query('SELECT status FROM enrollments WHERE enrollment_id = $1', [id]);
    expect(rows[0].status).toBe('completed');
  });

  it('is issued for courses that contain PDFs (P0-1 regression)', async () => {
    const s = await registerStudent();
    const c = await createCourse({ contents: [{ type: 'video', durationSec: 60 }, { type: 'pdf' }, { type: 'text' }] });
    const e = await enroll(s.token, c);
    const id = e.body.enrollmentId;

    await complete(s.token, id, c.contentIds[0], { watchDuration: 60 });
    await complete(s.token, id, c.contentIds[1]); // pdf: marked complete by the student, no watch time
    expect(await certCount(id)).toBe(0);
    await complete(s.token, id, c.contentIds[2]);
    expect(await certCount(id)).toBe(1);
  });

  it('is never issued twice, and the student can list it with a public verification code', async () => {
    const s = await registerStudent();
    const c = await createCourse({ contents: [{ type: 'text' }] });
    const e = await enroll(s.token, c);
    await complete(s.token, e.body.enrollmentId, c.contentIds[0]);
    await complete(s.token, e.body.enrollmentId, c.contentIds[0]); // repeat
    expect(await certCount(e.body.enrollmentId)).toBe(1);

    const list = await api.get('/api/v1/certificates/my-certificates').set(bearer(s.token));
    expect(list.status).toBe(200);
    expect(list.body.certificates).toHaveLength(1);
    const code = list.body.certificates[0].verification_code;
    expect(code).toMatch(/^[A-Za-z0-9]{6,16}$/);

    const verify = await api.get(`/api/v1/certificates/verify/${code}`);
    expect(verify.status).toBe(200);
    expect(verify.body.valid).toBe(true);
    expect((await api.get('/api/v1/certificates/verify/NOSUCHCODE1')).status).toBe(404);
  });

  it("another student cannot open someone else's certificate", async () => {
    const [owner, other] = [await registerStudent(), await registerStudent()];
    const c = await createCourse({ contents: [{ type: 'text' }] });
    const e = await enroll(owner.token, c);
    await complete(owner.token, e.body.enrollmentId, c.contentIds[0]);
    const { rows } = await query('SELECT certificate_id FROM certificates WHERE enrollment_id = $1', [e.body.enrollmentId]);

    const res = await api.get(`/api/v1/certificates/${rows[0].certificate_id}`).set(bearer(other.token));
    expect(res.status).toBe(404);
  });
});
