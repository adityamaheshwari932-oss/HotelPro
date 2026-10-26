const bcrypt = require('bcryptjs');
const { User, SystemLock } = require('../models');
const { signToken } = require('../config/jwt');
const { AppError } = require('../middleware/error.middleware');

const BCRYPT_SALT_ROUNDS = 12;
const MIN_SETUP_SECRET_LENGTH = 32;

/**
 * Validates password against the documented security policy:
 * - Minimum 8 characters
 * - At least one uppercase letter (A-Z)
 * - At least one lowercase letter (a-z)
 * - At least one numeric digit (0-9)
 * - At least one special symbol (!@#$%^&*...)
 *
 * @param {string} password
 * @throws {AppError} if password fails policy
 */
const validatePasswordPolicy = (password) => {
  if (!password || typeof password !== 'string') {
    throw new AppError('Password is required and must be a string.', 400);
  }

  if (password.length < 8) {
    throw new AppError('Password must be at least 8 characters long.', 400);
  }

  if (!/[A-Z]/.test(password)) {
    throw new AppError('Password must contain at least one uppercase letter.', 400);
  }

  if (!/[a-z]/.test(password)) {
    throw new AppError('Password must contain at least one lowercase letter.', 400);
  }

  if (!/[0-9]/.test(password)) {
    throw new AppError('Password must contain at least one number.', 400);
  }

  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    throw new AppError('Password must contain at least one special character.', 400);
  }
};

/**
 * Normalizes email by trimming and converting to lowercase.
 *
 * @param {string} email
 * @returns {string}
 */
const normalizeEmail = (email) => {
  if (!email || typeof email !== 'string') {
    throw new AppError('Email is required and must be a string.', 400);
  }
  return email.trim().toLowerCase();
};

/**
 * Registers a new public customer account.
 *
 * SECURITY ENFORCEMENT:
 * - Public registration ALWAYS sets role = 'customer'. Any client-supplied role is ignored.
 * - Password is validated against password policy and hashed with bcryptjs before persisting.
 * - Password hashes are never returned or logged.
 *
 * @param {object} params
 * @param {string} params.name
 * @param {string} params.email
 * @param {string} params.password
 * @param {string} [params.phone]
 * @returns {Promise<object>} Sanitized customer record
 */
const registerCustomer = async ({ name, email, password, phone }) => {
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    throw new AppError('Name is required and must be at least 2 characters long.', 400);
  }

  const normalizedEmail = normalizeEmail(email);
  validatePasswordPolicy(password);

  // Check if email is already in use
  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) {
    throw new AppError('A user with that email address already exists.', 409);
  }

  // Hash password with bcryptjs
  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  try {
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      phone: phone ? phone.trim() : '',
      role: 'customer', // Strictly enforced: public registration can never assign admin
      status: 'active'
    });

    return {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      status: user.status,
      createdAt: user.createdAt
    };
  } catch (err) {
    if (err.code === 11000) {
      throw new AppError('A user with that email address already exists.', 409);
    }
    throw err;
  }
};

/**
 * Authenticates user credentials and issues a signed JWT.
 *
 * SECURITY ENFORCEMENT:
 * - Generic 401 error returned for both non-existent emails and wrong passwords
 *   to eliminate email enumeration vulnerabilities.
 * - Inactive or suspended accounts are rejected with 403.
 * - Token contains only minimal claims: user ID (sub) and role.
 *
 * @param {object} params
 * @param {string} params.email
 * @param {string} params.password
 * @returns {Promise<object>} Token and sanitized user summary
 */
const loginUser = async ({ email, password }) => {
  if (!email || !password) {
    throw new AppError('Please provide both email and password.', 400);
  }

  const normalizedEmail = normalizeEmail(email);

  // Explicitly select passwordHash since it is excluded by default
  const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash');
  if (!user) {
    throw new AppError('Invalid email or password.', 401);
  }

  // Verify account status
  if (user.status !== 'active') {
    throw new AppError(
      'Your account is currently inactive or suspended. Please contact hotel administration.',
      403
    );
  }

  // Verify password with bcryptjs
  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
  if (!isPasswordValid) {
    throw new AppError('Invalid email or password.', 401);
  }

  // Generate short-lived JWT token
  const token = signToken({
    sub: user._id.toString(),
    role: user.role
  });

  return {
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role
    }
  };
};

/**
 * Executes the controlled one-time Administrator initialization workflow.
 *
 * CONCURRENCY & SECURITY GUARANTEES:
 * 1. Requires a high-entropy ADMIN_SETUP_SECRET from environment configuration.
 * 2. Uses MongoDB's unique index on the SystemLock singleton (_id: 'initial_admin_setup')
 *    to guarantee that concurrent initialization attempts fail atomically at the database level.
 * 3. Permanently locks further initializations once an Admin account exists.
 * 4. Stores the admin password as a bcrypt hash.
 * 5. Never logs or returns the secret or password hash.
 *
 * @param {object} params
 * @param {string} params.name
 * @param {string} params.email
 * @param {string} params.password
 * @param {string} [params.phone]
 * @param {string} params.setupSecret
 * @returns {Promise<object>} Sanitized admin record
 */
const crypto = require('crypto');

/**
 * Timing-safe string comparison to protect against timing attacks.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
const timingSafeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

const initializeInitialAdmin = async ({ name, email, password, phone, setupSecret }) => {
  const configuredSecret = process.env.ADMIN_SETUP_SECRET;

  if (!configuredSecret || configuredSecret.length < MIN_SETUP_SECRET_LENGTH) {
    throw new AppError(
      'ADMIN_SETUP_SECRET is not configured or is insecurely short. Initial setup cannot proceed.',
      500
    );
  }

  if (!setupSecret || !timingSafeEqual(setupSecret, configuredSecret)) {
    throw new AppError('Invalid administrator setup secret.', 401);
  }

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    throw new AppError('Admin name is required and must be at least 2 characters long.', 400);
  }

  const normalizedEmail = normalizeEmail(email);
  validatePasswordPolicy(password);

  // Preliminary check: reject if an admin is already recorded
  const existingAdmin = await User.findOne({ role: 'admin' });
  if (existingAdmin) {
    throw new AppError(
      'An administrator account already exists. One-time initialization is permanently closed.',
      409
    );
  }

  // Atomic database lock: MongoDB primary key uniqueness ensures that only ONE
  // concurrent initialization attempt can ever succeed.
  let lockAcquired = false;
  try {
    await SystemLock.create({
      _id: 'initial_admin_setup',
      meta: { initializedEmail: normalizedEmail },
      initializedAt: new Date()
    });
    lockAcquired = true;
  } catch (err) {
    if (err.code === 11000) {
      // Check if an admin was actually created
      const adminExists = await User.exists({ role: 'admin' });
      if (adminExists) {
        throw new AppError(
          'An administrator account already exists. One-time initialization is permanently closed.',
          409
        );
      }

      // Check if the existing lock is stale (e.g. from an aborted or crashed setup over 60s ago)
      const existingLock = await SystemLock.findById('initial_admin_setup');
      const isStale = existingLock && (Date.now() - new Date(existingLock.initializedAt).getTime() > 60000);

      if (isStale) {
        // Safely recover: remove the orphaned lock and re-attempt atomic acquisition
        await SystemLock.deleteOne({ _id: 'initial_admin_setup' });
        await SystemLock.create({
          _id: 'initial_admin_setup',
          meta: { initializedEmail: normalizedEmail, recoveredAt: new Date() },
          initializedAt: new Date()
        });
        lockAcquired = true;
      } else {
        throw new AppError(
          'An administrator account has already been initialized.',
          409
        );
      }
    } else {
      throw err;
    }
  }

  try {
    // Secondary check under lock
    const secondCheck = await User.findOne({ role: 'admin' });
    if (secondCheck) {
      throw new AppError(
        'An administrator account already exists. One-time initialization is permanently closed.',
        409
      );
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    const admin = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      phone: phone ? phone.trim() : '',
      role: 'admin',
      status: 'active'
    });

    return {
      id: admin._id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      status: admin.status,
      createdAt: admin.createdAt
    };
  } catch (err) {
    // If user creation failed for any reason, release the lock if no admin was created
    if (lockAcquired) {
      const adminExists = await User.exists({ role: 'admin' }).catch(() => null);
      if (!adminExists) {
        await SystemLock.deleteOne({ _id: 'initial_admin_setup' }).catch(() => {});
      }
    }
    if (err.code === 11000) {
      throw new AppError('A user with that email address already exists.', 409);
    }
    throw err;
  }
};

module.exports = {
  validatePasswordPolicy,
  normalizeEmail,
  registerCustomer,
  loginUser,
  initializeInitialAdmin
};
