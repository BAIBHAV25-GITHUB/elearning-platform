import { insertAuditLog } from '../repositories/audit.repository.js';
import { logger } from '../utils/logger.js';

// Only these body fields are ever written to the audit log (X15). Anything not
// listed (passwords, tokens, free text...) is dropped.
const LOGGED_FIELDS = {
  courses: ['courseName', 'title', 'price', 'status', 'thumbnailUrl'],
  enrollments: ['courseId', 'batchId'],
  users: [],
};

/**
 * For PATCH / status changes: remember how the logged fields looked BEFORE the change, limited to the fields the
 * request touches (so old and new values line up in the audit viewer). Call it before running the update.
 */
export const auditOldCourse = (res, existing, body) => {
  if (!existing) return;
  // same keys as newValues (those present in the request body), so the audit viewer can show old -> new
  const row = { title: existing.title, courseName: existing.title, price: existing.price, status: existing.status, thumbnailUrl: existing.thumbnail_url };
  const old = {};
  for (const k of LOGGED_FIELDS.courses) if (body?.[k] !== undefined) old[k] = row[k];
  if (Object.keys(old).length) res.locals.auditOld = old;
};

const pick = (body, keys) => {
  if (!body || typeof body !== 'object' || !keys?.length) return null;
  const out = {};
  for (const k of keys) if (body[k] !== undefined) out[k] = body[k];
  return Object.keys(out).length ? out : null;
};

export const auditMiddleware = (tableName) => {
  return (req, res, next) => {
    const originalJson = res.json;

    res.json = function (body) {
      // Only record audit log if response status indicates success (2xx)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const userId = req.user ? req.user.id : null;
        const action = `${req.method}_${tableName.toUpperCase()}`;
        const entityId =
          req.params.id ?? req.params.courseId ?? body?.course?.course_id ?? body?.enrollmentId ?? null;

        // req.ip honours app.set('trust proxy', ...) instead of trusting any x-forwarded-for header
        insertAuditLog({
          userId,
          action,
          tableName,
          entityId,
          // controllers that know the previous state put it on res.locals.auditOld (see auditOldCourse)
          oldValues: res.locals?.auditOld ?? null,
          newValues: pick(req.body, LOGGED_FIELDS[tableName]),
          ipAddress: req.ip,
        }).catch((err) => logger.error('Audit logging failed:', err));
      }

      return originalJson.call(this, body);
    };

    next();
  };
};
