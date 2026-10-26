const { verifyToken } = require('../config/jwt');
const { User } = require('../models');
const { AppError } = require('./error.middleware');

/**
 * Authentication Middleware: `protect`
 *
 * Verifies bearer token from Authorization header, validates signature and expiration,
 * and loads the corresponding active user from MongoDB.
 */
const protect = async (req, res, next) => {
  try {
    let token = null;

    // Extract Bearer token from Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    if (!token) {
      return next(
        new AppError('You are not authenticated. Please provide a Bearer token.', 401)
      );
    }

    // Verify token using JWT helper
    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return next(new AppError('Your authentication token has expired. Please log in again.', 401));
      }
      return next(new AppError('Invalid authentication token.', 401));
    }

    // Load user from database using subject claim (user ID)
    const currentUser = await User.findById(decoded.sub);
    if (!currentUser) {
      return next(
        new AppError('The user belonging to this token no longer exists.', 401)
      );
    }

    // Verify account is active
    if (currentUser.status !== 'active') {
      return next(
        new AppError('Your account is currently inactive or suspended. Access denied.', 403)
      );
    }

    // Attach authenticated user to request
    req.user = currentUser;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Authorization Middleware: `restrictTo`
 *
 * Enforces role-based access control (RBAC).
 * Rejects requests if authenticated user's role is not within the authorized roles.
 *
 * @param {...string} roles - e.g. 'admin'
 */
const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(
        new AppError('You do not have permission to perform this action.', 403)
      );
    }
    next();
  };
};

module.exports = {
  protect,
  restrictTo
};
