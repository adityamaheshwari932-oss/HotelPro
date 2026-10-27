/**
 * User & Profile API Client for HotelPro Frontend.
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
 * Retrieves the current authenticated user profile.
 * Calls GET /api/auth/me
 *
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export const getProfile = async (options = {}) => {
  return await apiClient.get(resolveUrl('/auth/me', options), options);
};

/**
 * Updates the current authenticated user's name or phone.
 * Calls PATCH /api/auth/me
 *
 * @param {object} payload - { name?, phone? }
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export const updateProfile = async (payload, options = {}) => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Update payload is required.');
  }
  return await apiClient.patch(resolveUrl('/auth/me', options), payload, options);
};

export default {
  getProfile,
  updateProfile
};
