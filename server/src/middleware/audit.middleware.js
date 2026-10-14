import { insertAuditLog } from '../repositories/audit.repository.js';

// Only these body fields are ever written to the audit log (X15). Anything not
// listed (passwords, tokens, free text...) is dropped.
const LOGGED_FIELDS = {
  courses: ['courseName', 'title', 'price', 'status'],
  enrollments: ['courseId', 'batchId'],
  users: [],
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
          oldValues: null,
          newValues: pick(req.body, LOGGED_FIELDS[tableName]),
          ipAddress: req.ip,
        }).catch((err) => console.error('Audit logging failed:', err));
      }

      return originalJson.call(this, body);
    };

    next();
  };
};
