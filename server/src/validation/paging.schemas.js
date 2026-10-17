import { z } from 'zod';
import { MAX_LIMIT } from '../utils/pagination.js';

const positiveInt = (message) =>
  z
    .union([z.string(), z.number()], { error: message })
    .transform((v) => (/^\d+$/.test(String(v).trim()) ? Number(v) : NaN))
    .refine((n) => Number.isSafeInteger(n) && n >= 1, { error: message });

/** ?page=2&limit=20 (both optional). looseObject: other query keys stay untouched. */
export const pagingQuerySchema = z.looseObject({
  page: positiveInt('page must be a positive integer').refine((n) => n <= 1_000_000, { error: 'page is too large' }).optional(),
  limit: positiveInt(`limit must be a whole number between 1 and ${MAX_LIMIT}`)
    .refine((n) => n <= MAX_LIMIT, { error: `limit must be a whole number between 1 and ${MAX_LIMIT}` })
    .optional(),
});
