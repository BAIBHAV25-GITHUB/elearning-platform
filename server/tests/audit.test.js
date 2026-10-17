import { describe, it, expect, beforeAll } from 'vitest';
import { api, bearer, login, query, SEED, createCourse } from './helpers.js';

let john;
beforeAll(async () => {
  john = await login(SEED.john);
});

// the audit row is written after the response is sent, so wait for it
const auditRows = async (courseId, action = 'UPDATE') => {
  for (let i = 0; i < 40; i++) {
    const { rows } = await query(
      `SELECT old_values, new_values, user_id FROM audit_logs
        WHERE table_name = 'courses' AND record_id = $1 AND action_type = $2::audit_action_enum
        ORDER BY log_id`,
      [courseId, action]
    );
    if (rows.length) return rows;
    await new Promise((r) => setTimeout(r, 50));
  }
  return [];
};

describe('audit log keeps the old values of course edits', () => {
  it('PATCH /courses/:id logs old and new title / price', async () => {
    const c = await createCourse({ price: 100, status: 'draft' });
    const before = (await query('SELECT title FROM courses WHERE course_id = $1', [c.courseId])).rows[0].title;

    const res = await api
      .patch(`/api/v1/courses/${c.courseId}`)
      .set(bearer(john))
      .send({ title: 'Audited new title', price: 250 });
    expect(res.status).toBe(200);

    const [row] = await auditRows(c.courseId);
    expect(row.old_values).toEqual({ title: before, price: '100.00' });
    expect(row.new_values).toEqual({ title: 'Audited new title', price: 250 });
  });

  it('only the fields that were sent are in old_values', async () => {
    const c = await createCourse({ price: 100, status: 'draft' });
    await api.patch(`/api/v1/courses/${c.courseId}`).set(bearer(john)).send({ price: 120 });
    const [row] = await auditRows(c.courseId);
    expect(row.old_values).toEqual({ price: '100.00' });
    expect(row.new_values).toEqual({ price: 120 });
  });

  it('status changes log old and new status', async () => {
    const c = await createCourse({ status: 'published' });
    const res = await api.patch(`/api/v1/courses/${c.courseId}/status`).set(bearer(john)).send({ status: 'archived' });
    expect(res.status).toBe(200);
    const [row] = await auditRows(c.courseId);
    expect(row.old_values).toEqual({ status: 'published' });
    expect(row.new_values).toEqual({ status: 'archived' });
  });

  it('a rejected edit writes no audit row', async () => {
    const c = await createCourse({ status: 'draft' });
    const res = await api.patch(`/api/v1/courses/${c.courseId}`).set(bearer(john)).send({ price: -1 });
    expect(res.status).toBe(400);
    await new Promise((r) => setTimeout(r, 300));
    const { rows } = await query(`SELECT 1 FROM audit_logs WHERE table_name = 'courses' AND record_id = $1`, [c.courseId]);
    expect(rows).toHaveLength(0);
  });
});
