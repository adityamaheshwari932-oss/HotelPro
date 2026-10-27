/**
 * Booking & Administrative Management API Client for HotelPro Frontend.
 */

import { apiClient } from './client.js';

const resolveUrl = (path, options) => {
  if (options && options.baseUrl) {
    const base = String(options.baseUrl).replace(/\/+$/, '');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${base}${cleanPath}`;
  }
  return path;
};

/**
 * Retrieves authenticated customer's bookings with pagination and optional filters.
 * Calls GET /api/bookings/my
 *
 * @param {object} [params] - { page, limit, status, timeFilter }
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export const getMyBookings = async (params = {}, options = {}) => {
  return await apiClient.get(resolveUrl('/bookings/my', options), {
    ...options,
    params
  });
};

/**
 * Retrieves an individual booking by ID (Owner or Admin).
 * Calls GET /api/bookings/:id
 *
 * @param {string} bookingId
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export const getBookingDetails = async (bookingId, options = {}) => {
  if (!bookingId) {
    throw new Error('Booking ID is required.');
  }
  return await apiClient.get(resolveUrl(`/bookings/${bookingId}`, options), options);
};

/**
 * Cancels a booking reservation (Owner or Admin).
 * Calls PATCH /api/bookings/:id/cancel
 *
 * @param {string} bookingId
 * @param {string} [reason]
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export const cancelBooking = async (bookingId, reason = '', options = {}) => {
  if (!bookingId) {
    throw new Error('Booking ID is required.');
  }
  return await apiClient.patch(
    resolveUrl(`/bookings/${bookingId}/cancel`, options),
    { reason },
    options
  );
};

/**
 * Retrieves all bookings across the system with pagination and search (Admin only).
 * Calls GET /api/bookings
 *
 * @param {object} [params] - { page, limit, status, search, hotel, room, user }
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export const getAdminBookings = async (params = {}, options = {}) => {
  return await apiClient.get(resolveUrl('/bookings', options), {
    ...options,
    params
  });
};

/**
 * Updates a booking's status enforcing allowed state transitions (Admin only).
 * Calls PATCH /api/bookings/:id/status
 *
 * @param {string} bookingId
 * @param {object} payload - { status, reason }
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export const updateAdminBookingStatus = async (bookingId, payload, options = {}) => {
  if (!bookingId) {
    throw new Error('Booking ID is required.');
  }
  if (!payload || !payload.status) {
    throw new Error('Target status is required.');
  }
  return await apiClient.patch(
    resolveUrl(`/bookings/${bookingId}/status`, options),
    payload,
    options
  );
};

/**
 * Retrieves payment reconciliation anomalies and required refunds (Admin only).
 * Calls GET /api/payments/reconciliation
 *
 * @param {object} [params] - { page, limit, status, provider }
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export const getAdminReconciliations = async (params = {}, options = {}) => {
  return await apiClient.get(resolveUrl('/payments/reconciliation', options), {
    ...options,
    params
  });
};

/**
 * Processes an administrative or customer refund (Owner or Admin).
 * Calls POST /api/payments/:id/refund
 *
 * @param {string} paymentId
 * @param {object} payload - { amount?, reason? }
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export const processRefund = async (paymentId, payload = {}, options = {}) => {
  if (!paymentId) {
    throw new Error('Payment ID is required.');
  }
  return await apiClient.post(
    resolveUrl(`/payments/${paymentId}/refund`, options),
    payload,
    options
  );
};

export default {
  getMyBookings,
  getBookingDetails,
  cancelBooking,
  getAdminBookings,
  updateAdminBookingStatus,
  getAdminReconciliations,
  processRefund
};
