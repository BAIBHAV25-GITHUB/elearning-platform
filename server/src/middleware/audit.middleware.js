import { insertAuditLog } from '../repositories/audit.repository.js';

export const auditMiddleware = (tableName) => {
  return (req, res, next) => {
    const originalJson = res.json;

    res.json = function (body) {
      // Only record audit log if response status indicates success (2xx)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const userId = req.user ? (req.user.user_id || req.user.id) : null;
        const action = `${req.method}_${tableName.toUpperCase()}`;
        const entityId = req.params.id || body?.id || body?.course_id || body?.enrollment_id || null;
        const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

        // Perform async audit insert without blocking standard HTTP response
        insertAuditLog({
          userId,
          action,
          tableName,
          entityId,
          oldValues: null,
          newValues: req.body || null,
          ipAddress
        }).catch((err) => console.error('Audit logging failed:', err));
      }

      return originalJson.call(this, body);
    };

    next();
  };
};