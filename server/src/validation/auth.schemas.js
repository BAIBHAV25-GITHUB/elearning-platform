import { z } from 'zod';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const registerSchema = z.object({
  name: z
    .string({ error: 'Name is required (max 100 characters)' })
    .trim()
    .min(1, 'Name is required (max 100 characters)')
    .max(100, 'Name is required (max 100 characters)'),
  email: z
    .string({ error: 'A valid email is required' })
    .trim()
    .max(255, 'A valid email is required')
    .regex(EMAIL_RE, 'A valid email is required'),
  password: z
    .string({ error: 'Password must be 8-72 characters' })
    // bcrypt only uses the first 72 bytes of a password
    .refine((p) => p.length >= 8 && Buffer.byteLength(p) <= 72, 'Password must be 8-72 characters'),
  role: z.string({ error: 'Invalid role' }).optional(),
});

export const loginSchema = z.object({
  email: z.string({ error: 'Email and password are required' }).min(1, 'Email and password are required'),
  password: z.string({ error: 'Email and password are required' }).min(1, 'Email and password are required'),
});
