import { z } from 'zod';

export const MAX_TIMELINE_MONTHS = 36;

/** ?months=12 (optional, 1-36). looseObject: other query keys stay untouched. */
export const timelineQuerySchema = z.looseObject({
  months: z
    .union([z.string(), z.number()], { error: `months must be a whole number between 1 and ${MAX_TIMELINE_MONTHS}` })
    .transform((v) => (/^\d+$/.test(String(v).trim()) ? Number(v) : NaN))
    .refine((n) => Number.isSafeInteger(n) && n >= 1 && n <= MAX_TIMELINE_MONTHS, {
      error: `months must be a whole number between 1 and ${MAX_TIMELINE_MONTHS}`,
    })
    .optional(),
});
