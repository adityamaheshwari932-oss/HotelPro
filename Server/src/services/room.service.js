const mongoose = require('mongoose');
const { Room, Hotel, Booking } = require('../models');
const { AppError } = require('../middleware/error.middleware');
const {
  validateObjectId,
  validateStayDates,
  parsePagination
} = require('../validators/room.validator');
const { calculateStayPrice } = require('./pricing.service');

const VALID_ROOM_TYPES = ['single', 'double', 'suite'];
const VALID_ROOM_STATUSES = ['active', 'maintenance', 'inactive'];

/**
 * Creates a new physical room document.
 *
 * Requirements:
 * - Caller must be an authenticated Admin.
 * - Hotel must exist in database and be active.
 * - Room number must be unique within the given hotel.
 *
 * @param {object} roomData
 * @returns {Promise<object>} Created room document
 */
const createRoom = async (roomData) => {
  const {
    hotel,
    roomNumber,
    roomType,
    description,
    photos,
    basePrice,
    pricingRules,
    capacity,
    status
  } = roomData;

  validateObjectId(hotel, 'hotel');

  // Verify hotel exists and is active
  const hotelDoc = await Hotel.findById(hotel);
  if (!hotelDoc) {
    throw new AppError(`Hotel not found with ID ${hotel}`, 404);
  }

  if (hotelDoc.status !== 'active' || hotelDoc.isActive === false) {
    throw new AppError('Cannot create rooms for an inactive hotel property', 400);
  }

  if (!roomNumber || typeof roomNumber !== 'string' || roomNumber.trim().length === 0) {
    throw new AppError('Room number is required', 400);
  }

  const normalizedRoomNumber = roomNumber.trim();

  if (!VALID_ROOM_TYPES.includes(roomType)) {
    throw new AppError('Room type must be single, double, or suite', 400);
  }

  if (typeof basePrice !== 'number' || !Number.isFinite(basePrice) || basePrice < 0) {
    throw new AppError('Base price must be a finite non-negative number', 400);
  }

  if (typeof capacity !== 'number' || !Number.isInteger(capacity) || capacity < 1) {
    throw new AppError('Capacity must be an integer of at least 1 guest', 400);
  }

  if (status && !VALID_ROOM_STATUSES.includes(status)) {
    throw new AppError('Status must be active, maintenance, or inactive', 400);
  }

  // Respect per-hotel unique room-number constraint
  const existingRoom = await Room.findOne({
    hotel,
    roomNumber: normalizedRoomNumber
  });

  if (existingRoom) {
    throw new AppError(
      `Room number "${normalizedRoomNumber}" already exists in this hotel property`,
      409
    );
  }

  try {
    const room = await Room.create({
      hotel,
      roomNumber: normalizedRoomNumber,
      roomType,
      description: description ? description.trim() : '',
      photos: Array.isArray(photos) ? photos : [],
      basePrice,
      pricingRules: Array.isArray(pricingRules) ? pricingRules : [],
      capacity,
      status: status || 'active'
    });

    return await room.populate('hotel', 'name address contact');
  } catch (err) {
    if (err.code === 11000) {
      throw new AppError(
        `Room number "${normalizedRoomNumber}" already exists in this hotel property`,
        409
      );
    }
    throw err;
  }
};

/**
 * Retrieves a room by its MongoDB ObjectId.
 *
 * @param {string} id
 * @returns {Promise<object>} Room document with populated hotel information
 */
const getRoomById = async (id) => {
  validateObjectId(id, 'room');

  const room = await Room.findById(id)
    .select('-__v')
    .populate('hotel', 'name address contact status');
  if (!room) {
    throw new AppError('Room not found', 404);
  }

  return room;
};

/**
 * Updates permitted fields on an existing room document.
 *
 * Permitted update fields:
 * - roomNumber (checked for per-hotel uniqueness)
 * - roomType
 * - description
 * - photos
 * - basePrice
 * - pricingRules
 * - capacity
 * - status
 *
 * Prohibited fields (ignored/protected): _id, hotel, createdAt, updatedAt, __v.
 *
 * @param {string} id
 * @param {object} updateData
 * @returns {Promise<object>} Updated room document
 */
const updateRoom = async (id, updateData = {}) => {
  validateObjectId(id, 'room');

  const room = await Room.findById(id);
  if (!room) {
    throw new AppError('Room not found', 404);
  }

  // Handle room number update with uniqueness check
  if (updateData.roomNumber !== undefined) {
    if (typeof updateData.roomNumber !== 'string' || updateData.roomNumber.trim().length === 0) {
      throw new AppError('Room number cannot be empty', 400);
    }
    const normalized = updateData.roomNumber.trim();
    if (normalized !== room.roomNumber) {
      const duplicate = await Room.findOne({
        hotel: room.hotel,
        roomNumber: normalized,
        _id: { $ne: id }
      });
      if (duplicate) {
        throw new AppError(
          `Room number "${normalized}" already exists in this hotel property`,
          409
        );
      }
      room.roomNumber = normalized;
    }
  }

  if (updateData.roomType !== undefined) {
    if (!VALID_ROOM_TYPES.includes(updateData.roomType)) {
      throw new AppError('Room type must be single, double, or suite', 400);
    }
    room.roomType = updateData.roomType;
  }

  if (updateData.description !== undefined) {
    room.description = String(updateData.description).trim();
  }

  if (updateData.photos !== undefined) {
    if (!Array.isArray(updateData.photos)) {
      throw new AppError('Photos must be an array of image strings', 400);
    }
    room.photos = updateData.photos;
  }

  if (updateData.basePrice !== undefined) {
    if (typeof updateData.basePrice !== 'number' || !Number.isFinite(updateData.basePrice) || updateData.basePrice < 0) {
      throw new AppError('Base price must be a finite non-negative number', 400);
    }
    room.basePrice = updateData.basePrice;
  }

  if (updateData.capacity !== undefined) {
    if (typeof updateData.capacity !== 'number' || !Number.isInteger(updateData.capacity) || updateData.capacity < 1) {
      throw new AppError('Capacity must be an integer of at least 1 guest', 400);
    }
    room.capacity = updateData.capacity;
  }

  if (updateData.status !== undefined) {
    if (!VALID_ROOM_STATUSES.includes(updateData.status)) {
      throw new AppError('Status must be active, maintenance, or inactive', 400);
    }
    room.status = updateData.status;
  }

  if (updateData.pricingRules !== undefined) {
    if (!Array.isArray(updateData.pricingRules)) {
      throw new AppError('Pricing rules must be an array', 400);
    }
    room.pricingRules = updateData.pricingRules;
  }

  try {
    await room.save();
    return await room.populate('hotel', 'name address contact');
  } catch (err) {
    if (err.code === 11000) {
      throw new AppError('Room number already exists in this hotel property', 409);
    }
    throw err;
  }
};

/**
 * Updates operational status of a room ('active', 'maintenance', 'inactive').
 *
 * @param {string} id
 * @param {string} newStatus
 * @returns {Promise<object>} Updated room
 */
const updateRoomStatus = async (id, newStatus) => {
  validateObjectId(id, 'room');

  if (!VALID_ROOM_STATUSES.includes(newStatus)) {
    throw new AppError('Status must be active, maintenance, or inactive', 400);
  }

  const room = await Room.findById(id);
  if (!room) {
    throw new AppError('Room not found', 404);
  }

  room.status = newStatus;
  await room.save();
  return await room.populate('hotel', 'name address contact');
};

/**
 * Lists rooms with pagination and filters.
 *
 * Public callers receive only 'active' rooms by default.
 * Admin callers can filter by any operational status.
 *
 * @param {object} query
 * @param {object} [user] - Current authenticated user (if any)
 * @returns {Promise<object>} { rooms, pagination }
 */
const listRooms = async (query = {}, user = null) => {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};

  // Hotel filter
  if (query.hotel) {
    validateObjectId(query.hotel, 'hotel');
    filter.hotel = query.hotel;
  }

  // Room type filter
  if (query.roomType) {
    if (!VALID_ROOM_TYPES.includes(query.roomType)) {
      throw new AppError('Invalid roomType filter. Allowed: single, double, suite', 400);
    }
    filter.roomType = query.roomType;
  }

  // Capacity filter (minimum guest capacity)
  if (query.capacity !== undefined) {
    const minCap = parseInt(query.capacity, 10);
    if (isNaN(minCap) || minCap < 1) {
      throw new AppError('Capacity filter must be a positive integer', 400);
    }
    filter.capacity = { $gte: minCap };
  }

  // Price filters (applied to basePrice for general listing)
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    filter.basePrice = {};
    if (query.minPrice !== undefined) {
      const minP = parseFloat(query.minPrice);
      if (isNaN(minP) || minP < 0) throw new AppError('minPrice must be a non-negative number', 400);
      filter.basePrice.$gte = minP;
    }
    if (query.maxPrice !== undefined) {
      const maxP = parseFloat(query.maxPrice);
      if (isNaN(maxP) || maxP < 0) throw new AppError('maxPrice must be a non-negative number', 400);
      filter.basePrice.$lte = maxP;
    }
  }

  // Operational status filtering:
  // Non-admin callers can ONLY view active rooms. Inactive or maintenance rooms are never bookable.
  if (user && user.role === 'admin' && query.status) {
    if (!VALID_ROOM_STATUSES.includes(query.status)) {
      throw new AppError('Invalid status filter. Allowed: active, maintenance, inactive', 400);
    }
    filter.status = query.status;
  } else {
    filter.status = 'active';
  }

  const [rooms, total] = await Promise.all([
    Room.find(filter)
      .select('-__v')
      .skip(skip)
      .limit(limit)
      .populate('hotel', 'name address')
      .sort({ createdAt: -1 })
      .lean(),
    Room.countDocuments(filter)
  ]);

  return {
    rooms,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  };
};

/**
 * Lists rooms for administrators across all operational statuses ('active', 'maintenance', 'inactive').
 * Supports pagination, search by room number, and filters (hotel, roomType, status, capacity, minPrice, maxPrice).
 *
 * @param {object} query
 * @returns {Promise<object>} { rooms, pagination }
 */
const listAdminRooms = async (query = {}) => {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};

  if (query.hotel) {
    validateObjectId(query.hotel, 'hotel');
    filter.hotel = query.hotel;
  }

  if (query.roomType) {
    if (!VALID_ROOM_TYPES.includes(query.roomType)) {
      throw new AppError('Invalid roomType filter. Allowed: single, double, suite', 400);
    }
    filter.roomType = query.roomType;
  }

  // If status is provided and not 'all', filter by it
  if (query.status && query.status !== 'all') {
    if (!VALID_ROOM_STATUSES.includes(query.status)) {
      throw new AppError('Invalid status filter. Allowed: active, maintenance, inactive', 400);
    }
    filter.status = query.status;
  }

  if (query.search) {
    const term = String(query.search).trim();
    if (term.length > 50) {
      throw new AppError('Search query cannot exceed 50 characters', 400);
    }
    if (term) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.roomNumber = { $regex: escaped, $options: 'i' };
    }
  }

  if (query.capacity !== undefined) {
    const minCap = parseInt(query.capacity, 10);
    if (isNaN(minCap) || minCap < 1) {
      throw new AppError('Capacity filter must be a positive integer', 400);
    }
    filter.capacity = { $gte: minCap };
  }

  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    filter.basePrice = {};
    if (query.minPrice !== undefined) {
      const minP = parseFloat(query.minPrice);
      if (isNaN(minP) || minP < 0) throw new AppError('minPrice must be a non-negative number', 400);
      filter.basePrice.$gte = minP;
    }
    if (query.maxPrice !== undefined) {
      const maxP = parseFloat(query.maxPrice);
      if (isNaN(maxP) || maxP < 0) throw new AppError('maxPrice must be a non-negative number', 400);
      filter.basePrice.$lte = maxP;
    }
  }

  const [rooms, total] = await Promise.all([
    Room.find(filter)
      .select('-__v')
      .skip(skip)
      .limit(limit)
      .populate('hotel', 'name address contact status')
      .sort({ roomNumber: 1, createdAt: -1 })
      .lean(),
    Room.countDocuments(filter)
  ]);

  return {
    rooms,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  };
};

/**
 * Searches rooms available for a requested stay with dynamic availability and date-specific pricing.
 *
 * AVAILABILITY POLICY:
 * - Overlap condition: existingCheckIn < requestedCheckOut AND existingCheckOut > requestedCheckIn.
 * - Blocking statuses: 'confirmed', 'checked_in', 'pending'.
 *   Pending bookings block availability to conservatively prevent concurrent double booking attempts.
 * - Non-blocking statuses: 'cancelled' and 'checked_out' never block availability.
 * - Operational status: Rooms under 'maintenance' or 'inactive' are never returned as available.
 *
 * PRICING:
 * - Computes dynamic date-specific pricing using pricingRules and basePrice.
 * - Filters by minPrice/maxPrice apply to the total calculated stay price.
 *
 * @param {object} searchParams
 * @param {string} searchParams.checkInDate - 'YYYY-MM-DD'
 * @param {string} searchParams.checkOutDate - 'YYYY-MM-DD'
 * @param {string} [searchParams.hotel]
 * @param {string} [searchParams.roomType]
 * @param {number} [searchParams.capacity]
 * @param {number} [searchParams.minPrice] - Minimum total stay price
 * @param {number} [searchParams.maxPrice] - Maximum total stay price
 * @returns {Promise<object>} Available rooms with pricing breakdown
 */
const searchAvailableRooms = async (searchParams = {}) => {
  const { checkInDate, checkOutDate } = searchParams;
  validateStayDates(checkInDate, checkOutDate);

  const requestedCheckIn = new Date(`${checkInDate}T00:00:00.000Z`);
  const requestedCheckOut = new Date(`${checkOutDate}T00:00:00.000Z`);

  // Step 1: Find bookings overlapping requested stay dates
  const blockingStatuses = ['confirmed', 'checked_in', 'pending'];
  const bookingFilter = {
    status: { $in: blockingStatuses },
    checkInDate: { $lt: requestedCheckOut },
    checkOutDate: { $gt: requestedCheckIn }
  };

  if (searchParams.hotel) {
    validateObjectId(searchParams.hotel, 'hotel');
    bookingFilter.hotel = searchParams.hotel;
  }

  const overlappingBookings = await Booking.find(bookingFilter).select('room').lean();
  const unavailableRoomIds = overlappingBookings.map((b) => b.room);

  // Step 2: Query candidate rooms that are active and not in unavailableRoomIds
  const roomFilter = {
    _id: { $nin: unavailableRoomIds },
    status: 'active' // Inactive and maintenance rooms are never bookable
  };

  if (searchParams.hotel) {
    roomFilter.hotel = searchParams.hotel;
  }

  if (searchParams.roomType) {
    if (!VALID_ROOM_TYPES.includes(searchParams.roomType)) {
      throw new AppError('Invalid roomType filter. Allowed: single, double, suite', 400);
    }
    roomFilter.roomType = searchParams.roomType;
  }

  if (searchParams.capacity !== undefined) {
    const minCap = parseInt(searchParams.capacity, 10);
    if (isNaN(minCap) || minCap < 1) {
      throw new AppError('capacity filter must be a positive integer', 400);
    }
    roomFilter.capacity = { $gte: minCap };
  }

  const candidateRooms = await Room.find(roomFilter)
    .select('-__v')
    .populate('hotel', 'name address contact')
    .lean();

  // Step 3: Compute date-specific pricing for each room and apply price filters
  const minPriceFilter = searchParams.minPrice !== undefined ? parseFloat(searchParams.minPrice) : null;
  const maxPriceFilter = searchParams.maxPrice !== undefined ? parseFloat(searchParams.maxPrice) : null;

  if (minPriceFilter !== null && (isNaN(minPriceFilter) || minPriceFilter < 0)) {
    throw new AppError('minPrice must be a non-negative number', 400);
  }
  if (maxPriceFilter !== null && (isNaN(maxPriceFilter) || maxPriceFilter < 0)) {
    throw new AppError('maxPrice must be a non-negative number', 400);
  }

  const availableRooms = [];

  for (const room of candidateRooms) {
    const pricing = calculateStayPrice(room, checkInDate, checkOutDate);

    // Apply stay price filters
    if (minPriceFilter !== null && pricing.totalRoomPrice < minPriceFilter) {
      continue;
    }
    if (maxPriceFilter !== null && pricing.totalRoomPrice > maxPriceFilter) {
      continue;
    }

    availableRooms.push({
      ...room,
      pricing
    });
  }

  const stayNights = Math.round((requestedCheckOut - requestedCheckIn) / (1000 * 60 * 60 * 24));

  return {
    stay: {
      checkInDate,
      checkOutDate,
      nights: stayNights
    },
    totalAvailable: availableRooms.length,
    rooms: availableRooms
  };
};

/**
 * Calculates pricing for a specific room across given dates.
 *
 * @param {string|object} roomOrId - Room ID or Room object
 * @param {string} checkInDate - 'YYYY-MM-DD'
 * @param {string} checkOutDate - 'YYYY-MM-DD'
 * @returns {Promise<object>} Nightly breakdown and total rate
 */
const calculateRoomPrice = async (roomOrId, checkInDate, checkOutDate) => {
  validateStayDates(checkInDate, checkOutDate);

  let room = roomOrId;
  if (typeof roomOrId === 'string' || roomOrId instanceof mongoose.Types.ObjectId) {
    room = await getRoomById(roomOrId);
  }

  return calculateStayPrice(room, checkInDate, checkOutDate);
};

module.exports = {
  createRoom,
  getRoomById,
  updateRoom,
  updateRoomStatus,
  listRooms,
  listAdminRooms,
  searchAvailableRooms,
  calculateRoomPrice
};
