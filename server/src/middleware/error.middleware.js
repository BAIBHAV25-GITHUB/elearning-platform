export const errorHandler = (err, req, res, next) => {
  console.error('Centralized Error Handler:', err);

  let statusCode = res.statusCode !== 200 ? res.statusCode : 500;
  let message = err.message || 'Internal Server Error';

  // Handle PostgreSQL specific errors
  if (err.code) {
    switch (err.code) {
      case '23505': // Unique violation
        statusCode = 409;
        message = 'Duplicate entry conflict.';
        break;
      case '23503': // Foreign key constraint violation
        statusCode = 400;
        message = 'Referenced resource does not exist.';
        break;
      case 'P0001': // Custom PL/pgSQL RAISE EXCEPTION (e.g. Batch Full)
        statusCode = 400;
        message = err.message;
        break;
      default:
        break;
    }
  }

  return res.status(statusCode).json({
    success: false,
    message,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack
  });
};