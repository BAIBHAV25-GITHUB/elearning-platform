import { logger } from './logger.js';

// Central place that turns any thrown error into a safe HTTP response (X14).
// 4xx messages we control are returned; everything else becomes a generic 500
// and the real error is only logged on the server.

export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** Parses a path/body id. Returns a positive integer or null. */
export const toId = (value) => {
  const n = typeof value === 'number' ? value : /^\d+$/.test(String(value ?? '')) ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n > 0 && n <= 2147483647 ? n : null;
};

export const toHttpError = (err) => {
  if (err?.statusCode && err.statusCode < 500) {
    return { status: err.statusCode, message: err.message };
  }

  // Multer upload errors
  if (err?.name === 'MulterError') {
    return err.code === 'LIMIT_FILE_SIZE'
      ? { status: 413, message: 'File is too large (max 100 MB).' }
      : { status: 400, message: 'Invalid file upload.' };
  }

  // Our SQL functions raise these with messages written for end users.
  // A raw constraint violation carries err.constraint and a message that
  // names tables/indexes, so it never gets passed through.
  switch (err?.code) {
    case 'P0001': // business rule violated
      return { status: /capacity/i.test(err.message) ? 409 : 400, message: err.message };
    case 'P0002': // not found
      return { status: 404, message: err.message };
    case '42501': // not allowed
      return { status: 403, message: err.message };
    case '23505':
      return { status: 409, message: err.constraint ? 'This record already exists.' : err.message };
    case '23503':
      return { status: 400, message: 'Referenced resource does not exist.' };
    case '23514':
    case '23502':
    case '22P02': // invalid input syntax / enum value
    case '22003': // numeric out of range
    case '22001': // value too long
    case '22007': // invalid date
    case '22008':
      return { status: 400, message: 'Invalid input.' };
    default:
      return { status: 500, message: 'Internal server error' };
  }
};

/** Use in controllers: catch (err) { return handleError(res, err); } */
export const handleError = (res, err) => {
  const { status, message } = toHttpError(err);
  if (status >= 500) logger.error('Request failed', { err });
  return res.status(status).json({ success: false, message });
};
