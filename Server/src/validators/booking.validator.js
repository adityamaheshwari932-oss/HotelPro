const { AppError } = require('../middleware/error.middleware');
const {
  isValidIsoDate,
  validateObjectId,
  validateStayDates,
  parsePagination,
  sanitizeScalar
} = require('./room.validator');

const VALID_BOOKING_STATUSES = ['pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled'];

/**
 * Validates the payload for creating a booking.
 *
 * @param {object} payload
 * @throws {AppError} on validation failure
 */
const validateBookingCreation = (payload = {}) => {
  if (!payload || typeof payload !== 'object') {
    throw new AppError('Booking payload is required', 400);
  }

  // Validate room ObjectId
  validateObjectId(payload.room, 'room');

  // Validate stay dates
  validateStayDates(payload.checkInDate, payload.checkOutDate);

  // Validate guest count
  if (payload.guestCount === undefined || payload.guestCount === null) {
    throw new AppError('Guest count is required', 400);
  }
  const guestCount = parseInt(payload.guestCount, 10);
  if (isNaN(guestCount) || guestCount < 1) {
    throw new AppError('Guest count must be an integer of at least 1 guest', 400);
  }

  // Validate guestInfo if provided
  if (payload.guestInfo !== undefined && payload.guestInfo !== null) {
    if (typeof payload.guestInfo !== 'object' || Array.isArray(payload.guestInfo)) {
      throw new AppError('guestInfo must be an object containing name, email, and optional phone', 400);
    }
    if (payload.guestInfo.name !== undefined) {
      if (typeof payload.guestInfo.name !== 'string' || payload.guestInfo.name.trim().length === 0) {
        throw new AppError('Guest name must be a non-empty string', 400);
      }
    }
    if (payload.guestInfo.email !== undefined) {
      if (
        typeof payload.guestInfo.email !== 'string' ||
        !/^\S+@\S+\.\S+$/.test(payload.guestInfo.email.trim())
      ) {
        throw new AppError('Please provide a valid guest email address', 400);
      }
    }
  }
};

/**
 * Validates the status update payload.
 *
 * @param {object} payload
 * @throws {AppError} on validation failure
 */
const validateBookingStatusUpdate = (payload = {}) => {
  if (!payload || typeof payload !== 'object') {
    throw new AppError('Status update payload is required', 400);
  }

  if (!payload.status || typeof payload.status !== 'string') {
    throw new AppError('Booking status is required', 400);
  }

  const normalized = payload.status.trim();
  if (!VALID_BOOKING_STATUSES.includes(normalized)) {
    throw new AppError(
      `Invalid booking status. Allowed values: ${VALID_BOOKING_STATUSES.join(', ')}`,
      400
    );
  }

  if (payload.reason !== undefined && typeof payload.reason !== 'string') {
    throw new AppError('Reason must be a string', 400);
  }
};

module.exports = {
  VALID_BOOKING_STATUSES,
  validateBookingCreation,
  validateBookingStatusUpdate,
  isValidIsoDate,
  validateObjectId,
  validateStayDates,
  parsePagination,
  sanitizeScalar
};
