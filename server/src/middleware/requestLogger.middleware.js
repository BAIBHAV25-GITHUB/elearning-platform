import crypto from 'node:crypto';
import { logger } from '../utils/logger.js';

// Gives every request an id (honours an incoming X-Request-Id from a proxy), returns it in the response
// header so a user can quote it in a bug report, and writes one access-log line when the response ends.
export const requestLogger = (req, res, next) => {
  const incoming = req.headers['x-request-id'];
  req.id = typeof incoming === 'string' && /^[\w.-]{1,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);

  const start = process.hrtime.bigint();
  res.on('finish', () => {
    if (req.path === '/health') return; // uptime checks would drown the log
    logger.info('request', {
      id: req.id,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms: Math.round(Number(process.hrtime.bigint() - start) / 1e6),
      user: req.user?.id,
    });
  });
  next();
};
