import { describe, it, expect } from 'vitest';
import { api } from './helpers.js';

describe('ops endpoints and error envelope', () => {
  it('/health checks the database', async () => {
    const res = await api.get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'OK', database: 'up' });
  });

  it('every response carries a request id, and an incoming one is kept', async () => {
    const generated = await api.get('/health');
    expect(generated.headers['x-request-id']).toMatch(/[0-9a-f-]{36}/);
    const echoed = await api.get('/health').set('X-Request-Id', 'abc-123');
    expect(echoed.headers['x-request-id']).toBe('abc-123');
  });

  it('unknown routes use the { success: false } envelope', async () => {
    const res = await api.get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, message: expect.any(String) });
  });

  it('malformed JSON is a 400 in the same envelope', async () => {
    const res = await api.post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('auth failures use the same envelope as everything else', async () => {
    const missing = await api.get('/api/v1/auth/me');
    const junk = await api.get('/api/v1/auth/me').set('Authorization', 'Bearer junk');
    for (const res of [missing, junk]) {
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ success: false, message: expect.any(String) });
    }
  });
});
