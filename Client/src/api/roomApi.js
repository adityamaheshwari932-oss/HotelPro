/**
 * Room Management & Administration API Client for HotelPro.
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
 * Retrieves all rooms across active, maintenance, and inactive statuses (Admin only).
 * Calls GET /api/rooms/admin
 *
 * @param {object} [params] - { page, limit, status, roomType, search, hotel, minPrice, maxPrice }
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export const getAdminRooms = async (params = {}, options = {}) => {
  return await apiClient.get(resolveUrl('/rooms/admin', options), {
    ...options,
    params
  });
};

/**
 * Creates a new room (Admin only).
 * Calls POST /api/rooms
 *
 * @param {object} roomData - { hotel, roomNumber, roomType, capacity, basePrice, description, photos, status }
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export const createRoom = async (roomData, options = {}) => {
  if (!roomData || typeof roomData !== 'object') {
    throw new Error('Room data payload is required.');
  }
  return await apiClient.post(resolveUrl('/rooms', options), roomData, options);
};

/**
 * Updates an existing room's details (Admin only).
 * Calls PATCH /api/rooms/:id
 *
 * @param {string} id - Room ObjectId
 * @param {object} updateData - Permitted update fields
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export const updateRoom = async (id, updateData, options = {}) => {
  if (!id) throw new Error('Room ID is required.');
  if (!updateData || typeof updateData !== 'object') {
    throw new Error('Update data payload is required.');
  }
  return await apiClient.patch(resolveUrl(`/rooms/${id}`, options), updateData, options);
};

/**
 * Updates a room's operational status (Admin only).
 * Calls PATCH /api/rooms/:id/status
 *
 * @param {string} id - Room ObjectId
 * @param {string} status - 'active' | 'maintenance' | 'inactive'
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export const updateRoomStatus = async (id, status, options = {}) => {
  if (!id) throw new Error('Room ID is required.');
  if (!status) throw new Error('Operational status is required.');
  return await apiClient.patch(resolveUrl(`/rooms/${id}/status`, options), { status }, options);
};

/**
 * Retrieves active hotel properties for room assignment.
 * Calls GET /api/hotels
 *
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export const getHotels = async (options = {}) => {
  return await apiClient.get(resolveUrl('/hotels', options), options);
};

/**
 * Retrieves single room details by ID.
 * Calls GET /api/rooms/:id
 *
 * @param {string} id
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export const getRoomById = async (id, options = {}) => {
  if (!id) throw new Error('Room ID is required.');
  return await apiClient.get(resolveUrl(`/rooms/${id}`, options), options);
};

/**
 * Public room search with availability and pricing.
 * Calls GET /api/rooms/search
 *
 * @param {object} params
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export const searchRooms = async (params = {}, options = {}) => {
  return await apiClient.get(resolveUrl('/rooms/search', options), {
    ...options,
    params
  });
};

export default {
  getAdminRooms,
  createRoom,
  updateRoom,
  updateRoomStatus,
  getHotels,
  getRoomById,
  searchRooms
};
