import { env } from '../config/env.js';
import { toHttpError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export const notFoundHandler = (req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
};

export const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  // body-parser errors (malformed JSON, payload too large)
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Malformed JSON body' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'Request body too large' });
  }

  const { status, message } = toHttpError(err);
  if (status >= 500) logger.error('Unhandled error', { id: req.id, method: req.method, path: req.originalUrl, err });

  return res.status(status).json({
    success: false,
    message,
    ...(req.id && status >= 500 ? { requestId: req.id } : {}),
    // stack traces only while developing
    ...(env.isDevelopment && status >= 500 ? { stack: err.stack } : {}),
  });
};
