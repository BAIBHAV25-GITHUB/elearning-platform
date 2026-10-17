import { describe, it, expect } from 'vitest';
import { registerSchema, loginSchema } from '../src/validation/auth.schemas.js';
import { enrollSchema, trackProgressSchema } from '../src/validation/learning.schemas.js';

// Pure unit tests: the rules live in src/validation/*, so they can be tested without HTTP or a database.
describe('registerSchema', () => {
  const ok = { name: '  Asha  ', email: ' asha@example.com ', password: 'Password123!' };

  it('trims name and email', () => {
    const r = registerSchema.parse(ok);
    expect(r.name).toBe('Asha');
    expect(r.email).toBe('asha@example.com');
  });

  it.each([
    ['missing name', { ...ok, name: undefined }, /Name is required/],
    ['blank name', { ...ok, name: '   ' }, /Name is required/],
    ['name > 100 chars', { ...ok, name: 'a'.repeat(101) }, /Name is required/],
    ['bad email', { ...ok, email: 'nope' }, /valid email/],
    ['password < 8', { ...ok, password: 'short' }, /8-72/],
    ['password > 72 bytes', { ...ok, password: 'é'.repeat(40) }, /8-72/],
    ['role not a string', { ...ok, role: 5 }, /Invalid role/],
  ])('rejects %s', (_label, body, message) => {
    const r = registerSchema.safeParse(body);
    expect(r.success).toBe(false);
    expect(r.error.issues[0].message).toMatch(message);
  });

  it('does not accept the old "userName" field instead of "name"', () => {
    expect(registerSchema.safeParse({ userName: 'Asha', email: ok.email, password: ok.password }).success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('needs both fields as non-empty strings', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
    expect(loginSchema.safeParse({ email: 'a@b.co' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: '', password: 'x' }).success).toBe(false);
  });
});

describe('id fields', () => {
  it('accepts numbers and digit strings', () => {
    expect(enrollSchema.parse({ courseId: '7', batchId: 3 })).toEqual({ courseId: 7, batchId: 3 });
  });
  it.each([0, -1, 1.5, 'abc', '1; DROP TABLE users', null, 2147483648])('rejects %s', (bad) => {
    expect(enrollSchema.safeParse({ courseId: bad, batchId: 1 }).success).toBe(false);
  });
  it('trackProgress needs both ids but leaves watchDuration to the controller', () => {
    expect(trackProgressSchema.safeParse({ enrollmentId: 1, contentId: 2 }).success).toBe(true);
    expect(trackProgressSchema.safeParse({ enrollmentId: 1 }).success).toBe(false);
    // regression: the field must survive validation (z.object used to strip it)
    expect(trackProgressSchema.parse({ enrollmentId: 1, contentId: 2, watchDuration: 42 }).watchDuration).toBe(42);
  });
});
