import { describe, it, expect } from 'vitest';
import { api, bearer, query, registerStudent, createCourse, enroll } from './helpers.js';

describe('optional pagination (backward compatible)', () => {
  it('GET /courses without page/limit returns the whole list and no pagination block', async () => {
    await createCourse();
    await createCourse();
    const res = await api.get('/api/v1/courses');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.courses)).toBe(true);
    expect(res.body.courses.length).toBeGreaterThanOrEqual(2);
    expect(res.body.pagination).toBeUndefined();
  });

  it('GET /courses?page&limit returns a page, the same "courses" key, and totals', async () => {
    await createCourse();
    await createCourse();
    await createCourse();
    const all = (await api.get('/api/v1/courses')).body.courses;

    const p1 = await api.get('/api/v1/courses?page=1&limit=2');
    expect(p1.status).toBe(200);
    expect(p1.body.courses).toHaveLength(2);
    expect(p1.body.pagination).toEqual({
      page: 1,
      limit: 2,
      total: all.length,
      totalPages: Math.ceil(all.length / 2),
    });

    // pages follow the same order as the full list and never overlap
    const p2 = await api.get('/api/v1/courses?page=2&limit=2');
    expect(p1.body.courses.map((c) => c.course_id)).toEqual(all.slice(0, 2).map((c) => c.course_id));
    expect(p2.body.courses.map((c) => c.course_id)).toEqual(all.slice(2, 4).map((c) => c.course_id));
  });

  it('a page past the end is empty but still reports the total', async () => {
    const res = await api.get('/api/v1/courses?page=9999&limit=10');
    expect(res.status).toBe(200);
    expect(res.body.courses).toEqual([]);
    expect(res.body.pagination.page).toBe(9999);
    expect(res.body.pagination.total).toBeGreaterThan(0);
  });

  it('only limit given -> page 1; only page given -> default limit 20', async () => {
    const a = await api.get('/api/v1/courses?limit=1');
    expect(a.body.pagination).toMatchObject({ page: 1, limit: 1 });
    expect(a.body.courses).toHaveLength(1);
    const b = await api.get('/api/v1/courses?page=1');
    expect(b.body.pagination).toMatchObject({ page: 1, limit: 20 });
  });

  it.each([
    ['page=0', 'page must be a positive integer'],
    ['page=abc', 'page must be a positive integer'],
    ['page=-1', 'page must be a positive integer'],
    ['limit=0', 'limit must be a whole number between 1 and 100'],
    ['limit=101', 'limit must be a whole number between 1 and 100'],
    ['limit=2.5', 'limit must be a whole number between 1 and 100'],
  ])('rejects ?%s with 400', async (qs, message) => {
    const res = await api.get(`/api/v1/courses?${qs}`);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, message });
  });

  it('notifications: plain array without paging, pages with it (own notifications only)', async () => {
    const s = await registerStudent();
    for (let i = 0; i < 5; i++) {
      await query(`INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, 'm')`, [s.id, `n${i}`]);
    }
    const plain = await api.get('/api/v1/notifications').set(bearer(s.token));
    expect(plain.body.notifications).toHaveLength(5);
    expect(plain.body.pagination).toBeUndefined();

    const p = await api.get('/api/v1/notifications?page=3&limit=2').set(bearer(s.token));
    expect(p.status).toBe(200);
    expect(p.body.notifications).toHaveLength(1);
    expect(p.body.pagination).toEqual({ page: 3, limit: 2, total: 5, totalPages: 3 });
  });

  it('my enrollments: paged and unpaged', async () => {
    const s = await registerStudent();
    for (let i = 0; i < 3; i++) await enroll(s.token, await createCourse());
    const plain = await api.get('/api/v1/enrollments/me').set(bearer(s.token));
    expect(plain.body.enrollments).toHaveLength(3);
    expect(plain.body.pagination).toBeUndefined();

    const p = await api.get('/api/v1/enrollments/me?limit=2').set(bearer(s.token));
    expect(p.body.enrollments).toHaveLength(2);
    expect(p.body.pagination).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });
    expect(p.body.enrollments[0]).toHaveProperty('enrollment_status');
  });

  it('comments: pages count top-level comments and every reply stays with its parent', async () => {
    const s = await registerStudent();
    const c = await createCourse();
    expect((await enroll(s.token, c)).status).toBe(201);
    const url = `/api/v1/modules/${c.moduleId}/comments`;
    const ids = [];
    for (const text of ['first', 'second', 'third']) {
      const r = await api.post(url).set(bearer(s.token)).send({ content: text });
      expect(r.status).toBe(201);
      ids.push(r.body.comment.comment_id);
    }
    const reply = await api.post(url).set(bearer(s.token)).send({ content: 'reply', parentCommentId: ids[0] });
    expect(reply.status).toBe(201);

    const plain = await api.get(url).set(bearer(s.token));
    expect(plain.body.comments).toHaveLength(3);
    expect(plain.body.pagination).toBeUndefined();
    expect(plain.body.comments[0].replies).toHaveLength(1);

    const p1 = await api.get(`${url}?page=1&limit=2`).set(bearer(s.token));
    expect(p1.body.comments.map((x) => x.content)).toEqual(['first', 'second']);
    expect(p1.body.comments[0].replies.map((x) => x.content)).toEqual(['reply']);
    expect(p1.body.pagination).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });

    const p2 = await api.get(`${url}?page=2&limit=2`).set(bearer(s.token));
    expect(p2.body.comments.map((x) => x.content)).toEqual(['third']);
  });

  it('paging does not bypass access rules (comments need enrollment)', async () => {
    const outsider = await registerStudent();
    const c = await createCourse();
    const res = await api.get(`/api/v1/modules/${c.moduleId}/comments?page=1&limit=5`).set(bearer(outsider.token));
    expect(res.status).toBe(403);
  });
});
