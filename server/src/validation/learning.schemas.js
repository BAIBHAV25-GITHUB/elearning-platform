import { z } from 'zod';
import { idField } from './common.js';

export const enrollSchema = z.object({
  courseId: idField('Valid courseId and batchId are required'),
  batchId: idField('Valid courseId and batchId are required'),
});

// looseObject keeps unknown keys: watchDuration is read by the controller (z.object would silently strip it)
export const trackProgressSchema = z.looseObject({
  enrollmentId: idField('enrollmentId and contentId are required.'),
  contentId: idField('enrollmentId and contentId are required.'),
  // watchDuration is only meaningful (and required) for video lessons, so the controller checks it
});
