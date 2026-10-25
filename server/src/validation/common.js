import { z } from 'zod';
import { toId } from '../utils/errors.js';

/** Positive 32-bit integer id, sent as a number or a digit string. */
export const idField = (message = 'A valid id is required') =>
  z
    .union([z.number(), z.string()], { error: message })
    .transform((v) => toId(v))
    .refine((v) => v !== null, { error: message })
    .transform((v) => /** @type {number} */ (v));

/** Non-empty text (after trimming) of at most `max` characters; the trimmed value is what the controller gets. */
export const trimmedText = (message, max) =>
  z
    .string({ error: message })
    .refine((v) => v.trim().length > 0 && v.length <= max, { error: message })
    .transform((v) => v.trim());

/** YYYY-MM-DD (shape only; fn_* / CHECK constraints reject impossible calendar dates). */
export const dateField = (message) => z.string({ error: message }).regex(/^\d{4}-\d{2}-\d{2}$/, { error: message });

/** Whole number sent as a number or numeric string, within [min, max]. */
export const intInRange = (message, min, max) =>
  z
    .union([z.number(), z.string()], { error: message })
    .transform((v) => (typeof v === 'string' && v.trim() === '' ? NaN : Number(v)))
    .refine((n) => Number.isInteger(n) && n >= min && n <= max, { error: message });

/** An object must contain at least one key (PATCH bodies). */
export const nonEmptyPatch = (schema, message = 'Nothing to update') =>
  schema.refine((o) => Object.values(o).some((v) => v !== undefined), { error: message });
