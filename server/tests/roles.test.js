import { describe, it, expect } from 'vitest';
import { api, bearer, SEED, login, registerStudent, registerUser, createCourse } from './helpers.js';

describe('role guards', () => {
  it('guests cannot reach admin, analytics or enrollment routes (401)', async () => {
    for (const [method, url] of [
      ['get', '/api/v1/admin/users'],
      ['get', '/api/v1/analytics/overview'],
      ['post', '/api/v1/enrollments'],
      ['get', '/api/v1/enrollments/me'],
    ]) {
      const res = await api[method](url);
      expect(res.status, `${method} ${url}`).toBe(401);
      expect(res.body.success).toBe(false);
    }
  });

  it('a student is forbidden from instructor and admin features (403)', async () => {
    const s = await registerStudent();
    const { courseId } = await createCourse();
    const checks = [
      api.post('/api/v1/courses').set(bearer(s.token)).send({ courseName: 'x', price: 1 }),
      api.get('/api/v1/analytics/overview').set(bearer(s.token)),
      api.get('/api/v1/admin/users').set(bearer(s.token)),
      api.post(`/api/v1/courses/${courseId}/announcements`).set(bearer(s.token)).send({ title: 'a', content: 'b' }),
      api.post(`/api/v1/courses/${courseId}/modules`).set(bearer(s.token)).send({ title: 'm' }),
    ];
    for (const res of await Promise.all(checks)) {
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    }
  });

  it('an instructor is forbidden from admin routes and from enrolling (403)', async () => {
    const john = await login(SEED.john);
    expect((await api.get('/api/v1/admin/users').set(bearer(john))).status).toBe(403);
    const { courseId, batchId } = await createCourse({ instructor: SEED.sarah });
    const res = await api.post('/api/v1/enrollments').set(bearer(john)).send({ courseId, batchId });
    expect(res.status).toBe(403);
  });

  it('a pending instructor cannot create courses until approved', async () => {
    const t = await registerUser({ role: 'instructor' });
    const res = await api.post('/api/v1/courses').set(bearer(t.token)).send({ courseName: 'Mine', price: 0 });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, code: 'INSTRUCTOR_NOT_APPROVED' });

    const admin = await login(SEED.admin);
    const approve = await api
      .patch(`/api/v1/admin/users/${t.id}/instructor-status`)
      .set(bearer(admin))
      .send({ status: 'approved' });
    expect(approve.status).toBe(200);

    const retry = await api.post('/api/v1/courses').set(bearer(t.token)).send({ courseName: 'Mine', price: 0 });
    expect(retry.status).toBe(201);
  });

  it("an instructor cannot touch another instructor's course", async () => {
    const sarah = await login(SEED.sarah);
    const { courseId } = await createCourse({ instructor: SEED.john });
    const res = await api.post(`/api/v1/courses/${courseId}/modules`).set(bearer(sarah)).send({ title: 'Sneaky' });
    expect([403, 404]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });

  it('draft courses are invisible to guests', async () => {
    const { courseId } = await createCourse({ status: 'draft' });
    const res = await api.get(`/api/v1/courses/${courseId}`);
    expect(res.status).toBe(404);
  });

  it('course details never leak media URLs to guests', async () => {
    const { courseId } = await createCourse({ contents: [{ type: 'pdf' }, { type: 'text' }] });
    const res = await api.get(`/api/v1/courses/${courseId}`);
    expect(res.status).toBe(200);
    const lessons = res.body.course.modules.flatMap((m) => m.contents);
    expect(lessons.length).toBe(2);
    expect(lessons.some((l) => l.video_url || l.text_body)).toBe(false);
  });
});
