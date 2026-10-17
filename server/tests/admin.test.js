import { describe, it, expect } from 'vitest';
import { api, bearer, query, uid, SEED, PASSWORD, login, registerStudent, createCourse, enroll } from './helpers.js';

const del = (adminToken, userId) => api.delete(`/api/v1/admin/users/${userId}`).set(bearer(adminToken));

describe('DELETE /admin/users/:id (anonymise)', () => {
  it('erases the person but keeps enrollments and certificates intact', async () => {
    const admin = await login(SEED.admin);
    const s = await registerStudent();
    const c = await createCourse({ contents: [{ type: 'text' }] });
    const e = await enroll(s.token, c);
    await api.post('/api/v1/progress').set(bearer(s.token)).send({ enrollmentId: e.body.enrollmentId, contentId: c.contentIds[0] });
    await query("INSERT INTO notifications (user_id, title, message, type) VALUES ($1, 'Hi', 'hello', 'system')", [s.id]);

    const res = await del(admin, s.id);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const user = (await query('SELECT user_name, email, password, status FROM users WHERE user_id = $1', [s.id])).rows[0];
    expect(user).toMatchObject({ user_name: 'Deleted user', email: `deleted-${s.id}@deleted.invalid`, status: 'inactive' });
    expect(user.password).not.toMatch(/^\$2/);

    expect((await query('SELECT 1 FROM notifications WHERE user_id = $1', [s.id])).rowCount).toBe(0);
    expect((await query('SELECT 1 FROM enrollments WHERE enrollment_id = $1', [e.body.enrollmentId])).rowCount).toBe(1);
    expect((await query('SELECT 1 FROM certificates WHERE enrollment_id = $1', [e.body.enrollmentId])).rowCount).toBe(1);
  });

  it('the old credentials stop working and the e-mail can be registered again', async () => {
    const admin = await login(SEED.admin);
    const s = await registerStudent();
    await del(admin, s.id);

    expect((await api.post('/api/v1/auth/login').send({ email: s.email, password: PASSWORD })).status).toBe(401);
    expect((await api.get('/api/v1/auth/me').set(bearer(s.token))).status).toBe(403);
    const again = await api.post('/api/v1/auth/register').send({ name: 'Back', email: s.email, password: PASSWORD });
    expect(again.status).toBe(201);
  });

  it('writes an audit row without the erased personal data', async () => {
    const admin = await login(SEED.admin);
    const s = await registerStudent();
    await del(admin, s.id);
    const { rows } = await query(
      "SELECT action_type, new_values::text AS nv FROM audit_logs WHERE table_name = 'users' AND record_id = $1 AND action_type = 'DELETE'",
      [s.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].nv).not.toContain(s.email);
  });

  it('refuses to delete yourself, another admin, or an instructor with published courses', async () => {
    const admin = await login(SEED.admin);
    const adminId = (await query('SELECT user_id FROM users WHERE email = $1', [SEED.admin])).rows[0].user_id;
    const johnId = (await query('SELECT user_id FROM users WHERE email = $1', [SEED.john])).rows[0].user_id;

    const self = await del(admin, adminId);
    expect(self.status).toBe(400);
    const instructor = await del(admin, johnId);
    expect(instructor.status).toBe(400);
    expect(instructor.body.message).toMatch(/published courses/);
    expect((await query('SELECT user_name FROM users WHERE user_id = $1', [johnId])).rows[0].user_name).not.toBe('Deleted user');
  });

  it('is admin-only and reports unknown users as 404', async () => {
    const s = await registerStudent();
    const other = await registerStudent();
    expect((await del(s.token, other.id)).status).toBe(403);
    expect((await del(await login(SEED.admin), 999999)).status).toBe(404);
    expect((await del(await login(SEED.admin), 'abc')).status).toBe(400);
  });

  it('cannot be applied twice', async () => {
    const admin = await login(SEED.admin);
    const s = await registerStudent();
    expect((await del(admin, s.id)).status).toBe(200);
    expect((await del(admin, s.id)).status).toBe(400);
  });
});

describe('admin user management is audited', () => {
  it('status changes record before and after', async () => {
    const admin = await login(SEED.admin);
    const s = await registerStudent();
    await api.patch(`/api/v1/admin/users/${s.id}/status`).set(bearer(admin)).send({ status: 'inactive' });
    const { rows } = await query(
      "SELECT old_values, new_values FROM audit_logs WHERE table_name = 'users' AND record_id = $1 AND action_type = 'UPDATE'",
      [s.id]
    );
    expect(rows[0].old_values).toEqual({ status: 'active' });
    expect(rows[0].new_values).toEqual({ status: 'inactive' });
  });
});
