const mongoose = require('mongoose');
const User = require('../models/user.model');
const { AppError } = require('../middleware/error.middleware');
const { parsePagination } = require('../validators/room.validator');

/**
 * Lists registered users for administrators with search, filtering and pagination.
 * Excludes sensitive fields (passwordHash, etc.) and returns only safe profile attributes.
 *
 * @param {object} query - { page, limit, search, role, status }
 * @returns {Promise<object>} { users, pagination }
 */
const listUsers = async (query = {}) => {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};

  // Support search by user ID or guest name/email
  if (query.search) {
    const term = String(query.search).trim();
    if (term.length > 100) {
      throw new AppError('Search query cannot exceed 100 characters', 400);
    }
    if (term) {
      if (mongoose.Types.ObjectId.isValid(term) && term.length === 24) {
        filter._id = term;
      } else {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = [
          { name: { $regex: escaped, $options: 'i' } },
          { email: { $regex: escaped, $options: 'i' } }
        ];
      }
    }
  }

  // Role filter: 'customer' | 'admin'
  if (query.role && query.role !== 'all') {
    if (!['customer', 'admin'].includes(query.role)) {
      throw new AppError('Invalid role filter. Allowed: customer, admin', 400);
    }
    filter.role = query.role;
  }

  // Account status filter: 'active' | 'inactive' | 'suspended'
  if (query.status && query.status !== 'all') {
    if (!['active', 'inactive', 'suspended'].includes(query.status)) {
      throw new AppError('Invalid status filter. Allowed: active, inactive, suspended', 400);
    }
    filter.status = query.status;
  }

  const [users, total] = await Promise.all([
    User.find(filter)
      .select('_id name email phone role status createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter)
  ]);

  const totalPages = Math.ceil(total / limit);

  return {
    users,
    pagination: {
      total,
      page,
      limit,
      totalPages
    }
  };
};

module.exports = {
  listUsers
};
