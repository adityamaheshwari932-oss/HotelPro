/**
 * Centralized Payment API Client for HotelPro Frontend.
 *
 * SAFETY & DESIGN GUARANTEES:
 * 1. Relies on the centralized apiClient for authentication, timeouts, and error normalization.
 * 2. Uses backend-authoritative endpoints for all payment and booking state.
 * 3. Never calculates or overrides prices in browser code.
 * 4. Never calls the public payment webhook directly from the frontend.
 * 5. Strictly calls the authenticated simulation endpoint for mock checkout.
 */

import { apiClient } from './client.js';

/**
 * Helper to resolve target URL with optional baseUrl override for testing.
 */
const resolveUrl = (path, options) => {
  if (options && options.baseUrl) {
    const base = String(options.baseUrl).replace(/\/+$/, '');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${base}${cleanPath}`;
  }
  return path;
};

/**
 * Retrieves payment details and active session status for a specific booking.
 * Calls GET /api/bookings/:id/payment
 *
 * @param {string} bookingId
 * @param {object} [options]
 * @returns {Promise<{
 *   success: boolean,
 *   data: {
 *     bookingId: string,
 *     hasPayment: boolean,
 *     hasActivePendingSession: boolean,
 *     payment: object | null,
 *     totalAttempts: number
 *   }
 * }>}
 */
export const getBookingPayment = async (bookingId, options = {}) => {
  if (!bookingId) {
    throw new Error('Booking ID is required to retrieve payment details.');
  }
  return await apiClient.get(resolveUrl(`/bookings/${bookingId}/payment`, options), options);
};

/**
 * Initiates or reuses an existing payment checkout session for a booking.
 * Calls POST /api/payments/checkout-session
 *
 * Expected payload: { bookingId: string, provider?: string, simulation?: string }
 *
 * @param {object} payload
 * @param {string} payload.bookingId
 * @param {string} [payload.provider]
 * @param {string} [payload.simulation]
 * @param {object} [options]
 * @returns {Promise<{
 *   success: boolean,
 *   data: {
 *     checkoutSession: {
 *       paymentId: string,
 *       bookingId: string,
 *       transactionId: string,
 *       clientSecret: string,
 *       amount: number,
 *       currency: string,
 *       status: string,
 *       provider: string,
 *       reusedExistingSession: boolean
 *     }
 *   }
 * }>}
 */
export const createCheckoutSession = async (payload, options = {}) => {
  if (!payload || !payload.bookingId) {
    throw new Error('Booking ID is required to create a checkout session.');
  }
  return await apiClient.post(resolveUrl('/payments/checkout-session', options), payload, options);
};

/**
 * Retrieves an individual payment record by its Payment ID.
 * Calls GET /api/payments/:id
 *
 * @param {string} paymentId
 * @param {object} [options]
 * @returns {Promise<{
 *   success: boolean,
 *   data: {
 *     payment: object
 *   }
 * }>}
 */
export const getPaymentById = async (paymentId, options = {}) => {
  if (!paymentId) {
    throw new Error('Payment ID is required to retrieve payment.');
  }
  return await apiClient.get(resolveUrl(`/payments/${paymentId}`, options), options);
};

/**
 * Simulates a mock payment outcome using the authenticated backend endpoint.
 * Calls POST /api/payments/:id/simulate-mock
 *
 * SAFETY GUARANTEE: Never invokes the public /api/payments/webhook endpoint.
 *
 * @param {string} paymentId
 * @param {object} payload
 * @param {'success' | 'failure'} payload.outcome
 * @param {string} [payload.failureReason]
 * @param {object} [options]
 * @returns {Promise<{
 *   success: boolean,
 *   message: string,
 *   data: {
 *     paymentId: string,
 *     bookingId: string,
 *     transactionId: string,
 *     status: string,
 *     bookingStatus: string,
 *     outcome: string,
 *     isConfirmed: boolean,
 *     requiresRefund: boolean,
 *     reconciliationReason: string | null,
 *     idempotent: boolean
 *   }
 * }>}
 */
export const simulateMockPayment = async (paymentId, payload, options = {}) => {
  if (!paymentId) {
    throw new Error('Payment ID is required to simulate payment.');
  }
  if (!payload || !['success', 'failure'].includes(payload.outcome)) {
    throw new Error('Outcome must be either "success" or "failure".');
  }
  return await apiClient.post(resolveUrl(`/payments/${paymentId}/simulate-mock`, options), payload, options);
};

/**
 * Retrieves authoritative booking details by Booking ID.
 * Calls GET /api/bookings/:id
 *
 * @param {string} bookingId
 * @param {object} [options]
 * @returns {Promise<{
 *   success: boolean,
 *   data: {
 *     booking: object
 *   }
 * }>}
 */
export const getBookingById = async (bookingId, options = {}) => {
  if (!bookingId) {
    throw new Error('Booking ID is required to retrieve booking details.');
  }
  return await apiClient.get(resolveUrl(`/bookings/${bookingId}`, options), options);
};

export default {
  getBookingPayment,
  createCheckoutSession,
  getPaymentById,
  simulateMockPayment,
  getBookingById
};
