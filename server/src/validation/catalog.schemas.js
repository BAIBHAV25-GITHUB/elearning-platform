import { z } from 'zod';
import { idField, trimmedText, dateField, intInRange, nonEmptyPatch } from './common.js';

const CAPACITY_MSG = 'maxCapacity must be an integer BETWEEN 1 AND 30';
const BATCH_NAME_MSG = 'batchName is required (max 100 characters)';
const DATES_MSG = 'startDate and endDate must be YYYY-MM-DD';

// ---- batches -------------------------------------------------------------------------------------------------
export const createBatchSchema = z
  .object({
    batchName: trimmedText(BATCH_NAME_MSG, 100),
    startDate: dateField(DATES_MSG),
    endDate: dateField(DATES_MSG),
    maxCapacity: intInRange(
      (issue) => (issue.input === undefined ? 'All batch parameters are required' : CAPACITY_MSG),
      1,
      30
    ),
  })
  .refine((b) => b.startDate < b.endDate, { error: 'startDate must be earlier than endDate', path: ['startDate'] });

export const updateBatchSchema = nonEmptyPatch(
  z.object({
    batchName: trimmedText(BATCH_NAME_MSG, 100).optional(),
    startDate: dateField('startDate must be YYYY-MM-DD').optional(),
    endDate: dateField('endDate must be YYYY-MM-DD').optional(),
    maxCapacity: intInRange(CAPACITY_MSG, 1, 30).optional(),
    status: z.enum(['open', 'closed'], { error: "status must be 'open' or 'closed'" }).optional(),
  })
);

// ---- modules -------------------------------------------------------------------------------------------------
const TITLE_MSG = 'Module title is required (max 200 characters)';

export const createModuleSchema = z.object({
  title: trimmedText(TITLE_MSG, 200),
  // a non-text description was always ignored on create, keep that
  description: z.unknown().optional().transform((v) => (typeof v === 'string' ? v : null)),
  // optional: the repository assigns MAX + 1 when it is missing
  sequenceNo: z
    .union([z.null(), z.literal(''), intInRange('Sequence number must be a positive integer', 1, 32767)])
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
});

export const updateModuleSchema = nonEmptyPatch(
  z.object({
    title: trimmedText(TITLE_MSG, 200).optional(),
    description: z
      .union([z.string(), z.null()], { error: 'Description must be text' })
      .optional()
      .transform((v) => (v === undefined ? undefined : v?.trim() ? v : null)),
  })
);

export const reorderModulesSchema = z.object({
  moduleIds: z
    .array(z.unknown(), { error: 'moduleIds must be a list of module ids' })
    .min(1, 'moduleIds must be a list of module ids')
    .max(1000, 'moduleIds must be a list of module ids')
    .transform((ids) => ids.map((id) => (typeof id === 'number' || typeof id === 'string' ? idOrNull(id) : null)))
    .refine((ids) => ids.every(Boolean) && new Set(ids).size === ids.length, {
      error: 'moduleIds must be unique, valid module ids',
    }),
});

function idOrNull(v) {
  const r = idField().safeParse(v);
  return r.success ? r.data : null;
}

// ---- comments ------------------------------------------------------------------------------------------------
export const postCommentSchema = z.object({
  content: z
    .string({ error: 'Comment must be 1-2000 characters.' })
    .refine((v) => v.trim().length > 0 && v.length <= 2000, { error: 'Comment must be 1-2000 characters.' })
    .transform((v) => v.trim()),
  parentCommentId: z
    .union([z.null(), z.literal(''), idField('Invalid parentCommentId.')], { error: 'Invalid parentCommentId.' })
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
});

// ---- payments ------------------------------------------------------------------------------------------------
export const createOrderSchema = z.object({
  enrollmentId: idField('A valid enrollmentId is required'),
});

const gatewayString = z.string({ error: 'razorpayOrderId, razorpayPaymentId and razorpaySignature are required' })
  .min(1, 'razorpayOrderId, razorpayPaymentId and razorpaySignature are required');

export const verifyPaymentSchema = z.object({
  razorpayOrderId: gatewayString,
  razorpayPaymentId: gatewayString,
  razorpaySignature: gatewayString,
});
