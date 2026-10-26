const jwt = require('jsonwebtoken');
const { AppError } = require('../middleware/error.middleware');

const MIN_SECRET_LENGTH = 32;

/**
 * Validates and retrieves the JWT secret from environment configuration.
 * Fails clearly if the secret is missing or insecurely short.
 *
 * @returns {string}
 */
const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new AppError('JWT_SECRET environment variable is not defined.', 500);
  }

  if (secret.length < MIN_SECRET_LENGTH) {
    throw new AppError(
      `JWT_SECRET is insecure. Must be at least ${MIN_SECRET_LENGTH} characters long.`,
      500
    );
  }

  return secret;
};

/**
 * Signs a short-lived JSON Web Token for authenticated users.
 *
 * @param {object} payload - Minimal claims (e.g. { sub: userId, role })
 * @returns {string} Signed JWT
 */
const signToken = (payload) => {
  const secret = getJwtSecret();
  const expiresIn = process.env.JWT_EXPIRES_IN || '15m';

  return jwt.sign(payload, secret, { expiresIn, algorithm: 'HS256' });
};

/**
 * Verifies a JWT and returns the decoded payload.
 *
 * @param {string} token
 * @returns {object} Decoded token payload
 */
const verifyToken = (token) => {
  const secret = getJwtSecret();
  return jwt.verify(token, secret, { algorithms: ['HS256'] });
};

module.exports = {
  getJwtSecret,
  signToken,
  verifyToken,
  MIN_SECRET_LENGTH
};
