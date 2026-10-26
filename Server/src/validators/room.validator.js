const mongoose = require('mongoose');
const { AppError } = require('../middleware/error.middleware');

/**
 * Validates that a string is a valid ISO calendar date in YYYY-MM-DD format.
 *
 * @param {string} val
 * @returns {boolean}
 */
const isValidIsoDate = (val) => {
  if (typeof val !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(val)) return false;
  const [year, month, day] = val.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

/**
 * Validates whether a value is a valid MongoDB ObjectId.
 *
 * @param {string} id
 * @param {string} [fieldName='ID']
 * @throws {AppError} if invalid
 */
const validateObjectId = (id, fieldName = 'ID') => {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(`Invalid ${fieldName} format`, 400);
  }
};

/**
 * Validates check-in and check-out dates for stay searches.
 *
 * @param {string} checkInDate
 * @param {string} checkOutDate
 * @throws {AppError} if dates are missing, malformed, or checkout <= checkin
 */
const validateStayDates = (checkInDate, checkOutDate) => {
  if (!checkInDate || !checkOutDate) {
    throw new AppError('Both checkInDate and checkOutDate are required query parameters (format: YYYY-MM-DD)', 400);
  }

  if (!isValidIsoDate(checkInDate)) {
    throw new AppError('checkInDate must be a valid calendar date formatted as YYYY-MM-DD', 400);
  }

  if (!isValidIsoDate(checkOutDate)) {
    throw new AppError('checkOutDate must be a valid calendar date formatted as YYYY-MM-DD', 400);
  }

  if (checkOutDate <= checkInDate) {
    throw new AppError('checkOutDate must be strictly after checkInDate', 400);
  }

  // Prevent unbounded stay queries (max 180 days)
  const inD = new Date(`${checkInDate}T00:00:00Z`);
  const outD = new Date(`${checkOutDate}T00:00:00Z`);
  const diffDays = Math.round((outD - inD) / (1000 * 60 * 60 * 24));
  if (diffDays > 180) {
    throw new AppError('Requested stay duration cannot exceed 180 days', 400);
  }
};

/**
 * Validates and sanitizes pagination query parameters.
 *
 * @param {object} query
 * @param {number} [defaultLimit=10]
 * @param {number} [maxLimit=50]
 * @returns {{ page: number, limit: number, skip: number }}
 */
const parsePagination = (query = {}, defaultLimit = 10, maxLimit = 50) => {
  let page = parseInt(query.page, 10);
  let limit = parseInt(query.limit, 10);

  if (isNaN(page) || page < 1) page = 1;
  if (isNaN(limit) || limit < 1) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;

  const skip = (page - 1) * limit;

  return { page, limit, skip };
};

/**
 * Sanitizes input to prevent NoSQL query injection by disallowing object values with '$'.
 *
 * @param {*} value
 * @returns {string|number|null}
 */
const sanitizeScalar = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object') return null;
  return value;
};

module.exports = {
  isValidIsoDate,
  validateObjectId,
  validateStayDates,
  parsePagination,
  sanitizeScalar
};
