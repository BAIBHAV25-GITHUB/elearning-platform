import { describe, it, expect } from 'vitest';
import { api, bearer, uid, query, PASSWORD, SEED, login, registerStudent } from './helpers.js';

const register = (body) => api.post('/api/v1/auth/register').send(body);

describe('POST /auth/register', () => {
  it('creates a student and returns a token that works on /auth/me', async () => {
    const email = `new-${uid()}@test.dev`;
    const res = await register({ name: 'New Person', email, password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, user: { name: 'New Person', email, role: 'student' } });
    expect(res.body.user).not.toHaveProperty('password');

    const me = await api.get('/api/v1/auth/me').set(bearer(res.body.token));
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);
  });

  it('rejects invalid input with a readable message in the standard envelope', async () => {
    const res = await register({ name: '', email: 'bad', password: 'x' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, message: expect.any(String) });
    expect(res.body.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('no longer accepts the old "userName" field', async () => {
    const res = await register({ userName: 'Old Client', email: `old-${uid()}@test.dev`, password: PASSWORD });
    expect(res.status).toBe(400);
  });

  it('refuses to self-register as admin', async () => {
    const res = await register({ name: 'Evil', email: `evil-${uid()}@test.dev`, password: PASSWORD, role: 'admin' });
    expect(res.status).toBe(400);
    const row = await query('SELECT 1 FROM users WHERE email LIKE $1', ['evil-%']);
    expect(row.rowCount).toBe(0);
  });

  it('treats e-mail as case-insensitive: a duplicate is refused', async () => {
    const email = `dup-${uid()}@test.dev`;
    expect((await register({ name: 'A', email, password: PASSWORD })).status).toBe(201);
    const again = await register({ name: 'B', email: email.toUpperCase(), password: PASSWORD });
    expect(again.status).toBe(400);
    expect(again.body.success).toBe(false);
  });

  it('new instructors start as "pending"', async () => {
    const res = await register({ name: 'Teach', email: `t-${uid()}@test.dev`, password: PASSWORD, role: 'instructor' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ role: 'instructor', instructorStatus: 'pending' });
  });
});

describe('POST /auth/login', () => {
  it('logs in a seeded user', async () => {
    const res = await api.post('/api/v1/auth/login').send({ email: SEED.admin, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('admin');
    expect(res.body.token).toEqual(expect.any(String));
  });

  it('gives the same 401 for a wrong password and an unknown e-mail', async () => {
    const wrong = await api.post('/api/v1/auth/login').send({ email: SEED.admin, password: 'nope-nope-nope' });
    const unknown = await api.post('/api/v1/auth/login').send({ email: `ghost-${uid()}@test.dev`, password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  it('refuses an inactive account', async () => {
    const s = await registerStudent();
    await query("UPDATE users SET status = 'inactive' WHERE user_id = $1", [s.id]);
    const res = await api.post('/api/v1/auth/login').send({ email: s.email, password: PASSWORD });
    expect(res.status).toBe(403);
  });
});

describe('token checks happen against the database on every request', () => {
  it('a banned user is locked out immediately, even with a valid token', async () => {
    const s = await registerStudent();
    expect((await api.get('/api/v1/auth/me').set(bearer(s.token))).status).toBe(200);

    const admin = await login(SEED.admin);
    const ban = await api.patch(`/api/v1/admin/users/${s.id}/status`).set(bearer(admin)).send({ status: 'banned' });
    expect(ban.status).toBe(200);

    const after = await api.get('/api/v1/auth/me').set(bearer(s.token));
    expect(after.status).toBe(403);
    expect(after.body).toMatchObject({ success: false, code: 'ACCOUNT_DISABLED' });
  });
});
