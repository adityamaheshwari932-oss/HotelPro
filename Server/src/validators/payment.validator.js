const { AppError } = require('../middleware/error.middleware');
const { validateObjectId } = require('./room.validator');
const { assertNoForbiddenCredentials } = require('../services/payment/provider.interface');

const ALLOWED_PROVIDERS = ['mock', 'stripe', 'manual', 'paypal'];

/**
 * Validates the checkout-session creation payload.
 *
 * @param {object} payload
 * @returns {{ bookingId: string, provider: string, simulation?: object }} Sanitized parameters
 */
const validateCheckoutSessionInput = (payload = {}) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AppError('Checkout session payload must be an object', 400);
  }

  // Intercept and reject any raw card credentials immediately (PCI Guardrail)
  assertNoForbiddenCredentials(payload);

  // Extract bookingId
  const bookingId = payload.bookingId || payload.booking;
  if (!bookingId) {
    throw new AppError('Booking ID is required to initiate checkout', 400);
  }
  validateObjectId(bookingId, 'booking');

  // Provider selection (defaults to 'mock')
  let provider = 'mock';
  if (payload.provider !== undefined && payload.provider !== null) {
    if (typeof payload.provider !== 'string' || !ALLOWED_PROVIDERS.includes(payload.provider.toLowerCase())) {
      throw new AppError(
        `Invalid payment provider. Allowed values: ${ALLOWED_PROVIDERS.join(', ')}`,
        400
      );
    }
    provider = payload.provider.toLowerCase();
  }

  return {
    bookingId: String(bookingId),
    provider,
    simulation: payload.simulation && typeof payload.simulation === 'object' ? payload.simulation : undefined
  };
};

/**
 * Validates input payload for a refund request.
 *
 * @param {object} payload
 * @returns {{ amount?: number, reason?: string, idempotencyKey?: string, simulation?: object }}
 */
const validateRefundInput = (payload = {}) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AppError('Refund payload must be an object', 400);
  }

  // Intercept and reject any raw card credentials immediately (PCI Guardrail)
  assertNoForbiddenCredentials(payload);

  let amount = undefined;
  if (payload.amount !== undefined && payload.amount !== null) {
    if (typeof payload.amount !== 'number' || !Number.isFinite(payload.amount) || payload.amount <= 0) {
      throw new AppError('Refund amount must be a finite positive number', 400);
    }
    amount = Math.round(payload.amount * 100) / 100;
  }

  let reason = '';
  if (payload.reason !== undefined && payload.reason !== null) {
    if (typeof payload.reason !== 'string') {
      throw new AppError('Refund reason must be a string', 400);
    }
    reason = payload.reason.trim();
    if (reason.length > 500) {
      throw new AppError('Refund reason cannot exceed 500 characters', 400);
    }
  }

  let idempotencyKey = undefined;
  if (payload.idempotencyKey !== undefined && payload.idempotencyKey !== null) {
    if (typeof payload.idempotencyKey !== 'string' || payload.idempotencyKey.trim().length === 0) {
      throw new AppError('Idempotency key must be a non-empty string', 400);
    }
    idempotencyKey = payload.idempotencyKey.trim();
    if (idempotencyKey.length > 255) {
      throw new AppError('Idempotency key cannot exceed 255 characters', 400);
    }
  }

  return {
    amount,
    reason,
    idempotencyKey,
    simulation: payload.simulation && typeof payload.simulation === 'object' ? payload.simulation : undefined
  };
};

module.exports = {
  validateCheckoutSessionInput,
  validateRefundInput,
  ALLOWED_PROVIDERS
};
