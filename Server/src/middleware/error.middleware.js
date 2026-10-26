/**
 * Custom application operational error class.
 */
class AppError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    if (details) {
      this.details = details;
    }
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 404 Not Found Middleware for unmatched API routes.
 */
const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    status: 'fail',
    message: `Cannot find ${req.method} ${req.originalUrl} on this server`
  });
};

/**
 * Central Error-Handling Middleware
 *
 * Ensures consistent JSON error responses across the application,
 * prevents leaking stack traces or sensitive internal details to clients,
 * and maps Mongoose/JWT errors to standard HTTP status codes.
 */
const errorHandler = (err, req, res, next) => { // eslint-disable-line no-unused-vars
  let statusCode = err.statusCode || 500;
  let message = err.message || 'An unexpected internal error occurred';
  let details = err.details || null;

  // Mongoose Validation Error -> 400 Bad Request
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation failed';
    details = {};
    for (const field of Object.keys(err.errors || {})) {
      details[field] = err.errors[field].message;
    }
  }

  // MongoDB Unique Index Duplicate Key Error -> 409 Conflict
  if (err.code === 11000) {
    statusCode = 409;
    const fields = Object.keys(err.keyPattern || err.keyValue || {});
    const duplicateField = fields.length > 0 ? fields.join(', ') : 'field';
    message = `A record with that ${duplicateField} already exists`;
  }

  // JWT Verification Errors -> 401 Unauthorized
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid authentication token';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Authentication token has expired';
  }

  // Shield unexpected internal 500 errors in production to prevent leaking internals
  if (statusCode >= 500 && !err.isOperational && process.env.NODE_ENV === 'production') {
    message = 'An unexpected internal server error occurred';
  }

  // Log 500-level unexpected failures in non-test environments
  if (statusCode >= 500 && process.env.NODE_ENV !== 'test') {
    console.error(`[Error] 500 Server Error: ${err.message}`);
  }

  res.status(statusCode).json({
    success: false,
    status: `${statusCode}`.startsWith('4') ? 'fail' : 'error',
    message,
    ...(details ? { details } : {})
  });
};

module.exports = {
  AppError,
  notFoundHandler,
  errorHandler
};
