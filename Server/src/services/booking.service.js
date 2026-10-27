const { Booking, Room, Hotel, Payment } = require('../models');
const { calculateStayPrice } = require('./pricing.service');
const { withRoomLock } = require('../utils/roomLock');
const { AppError } = require('../middleware/error.middleware');
const {
  validateBookingCreation,
  validateBookingStatusUpdate,
  validateObjectId,
  parsePagination,
  VALID_BOOKING_STATUSES
} = require('../validators/booking.validator');

/**
 * Valid lifecycle transitions for bookings:
 * - 'pending' -> 'confirmed', 'cancelled'
 * - 'confirmed' -> 'checked_in', 'cancelled'
 * - 'checked_in' -> 'checked_out'
 * - 'checked_out' -> terminal (no transitions)
 * - 'cancelled' -> terminal (no transitions)
 */
const ALLOWED_STATUS_TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['checked_in', 'cancelled'],
  checked_in: ['checked_out'],
  checked_out: [],
  cancelled: []
};

const HOLD_DURATION_MS = 15 * 60 * 1000; // 15 minutes in milliseconds

/**
 * Evaluates whether a booking's reservation hold deadline has expired.
 *
 * Rules:
 * - If holdExpiresAt is set (Date): expired if now >= holdExpiresAt.
 * - If holdExpiresAt is explicitly null: does not expire arbitrarily (returns false).
 * - If holdExpiresAt is genuinely absent (undefined): falls back to legacy deadline createdAt + 15m.
 * - If createdAt is missing or invalid: does not expire arbitrarily (returns false).
 *
 * @param {object} booking - Booking document or plain object
 * @param {Date} [now=new Date()] - Evaluation time
 * @returns {boolean}
 */
const isBookingHoldExpired = (booking, now = new Date()) => {
  if (!booking) return false;
  const evalMs = (now instanceof Date && !isNaN(now.getTime())) ? now.getTime() : Date.now();

  if (booking.holdExpiresAt !== undefined) {
    if (booking.holdExpiresAt === null) {
      return false;
    }
    const holdMs = new Date(booking.holdExpiresAt).getTime();
    if (!isNaN(holdMs)) {
      return evalMs >= holdMs;
    }
    return false;
  }

  // Legacy fallback: holdExpiresAt is undefined
  if (booking.createdAt) {
    const createdMs = new Date(booking.createdAt).getTime();
    if (!isNaN(createdMs)) {
      const legacyDeadlineMs = createdMs + HOLD_DURATION_MS;
      return evalMs >= legacyDeadlineMs;
    }
  }

  return false;
};

/**
 * Creates a new booking reservation with strict double-booking prevention.
 *
 * CONCURRENCY & DOUBLE-BOOKING PREVENTION STRATEGY:
 * 1. Executes within `withRoomLock(roomId)` which uses MongoDB's atomic primary key (_id)
 *    uniqueness in the `systemlocks` collection.
 * 2. This guarantees serialization of concurrent reservation attempts targeting the SAME physical room.
 * 3. Concurrent requests targeting DIFFERENT physical rooms run independently in parallel.
 * 4. Under the per-room lock:
 *    - Verifies room exists and is in 'active' operational status.
 *    - Verifies guest count does not exceed room capacity.
 *    - Verifies associated hotel exists and is active.
 *    - Queries for overlapping bookings:
 *        checkInDate < requestedCheckOut AND checkOutDate > requestedCheckIn
 *      where status is in ['confirmed', 'checked_in', 'pending'].
 *    - If an overlap exists, rejects with 409 Conflict.
 * 5. Freezes agreed price snapshot:
 *    - Nightly breakdown from date-specific pricing rules.
 *    - Total room rate.
 *    - Room price changes made subsequent to booking will NOT affect this record.
 * 6. Guarantees lock release in `finally` block even upon unhandled database or network errors.
 *
 * @param {object} bookingData
 * @param {object} authenticatedUser - req.user (Customer or Admin)
 * @returns {Promise<object>} Created booking document
 */
const createBooking = async (bookingData, authenticatedUser) => {
  if (!authenticatedUser || !authenticatedUser._id) {
    throw new AppError('Authenticated user is required to create a booking', 401);
  }

  // Validate structural input
  validateBookingCreation(bookingData);

  const { room: roomId, checkInDate, checkOutDate, guestCount, guestInfo } = bookingData;
  const parsedGuestCount = parseInt(guestCount, 10);

  // Execute critical reservation path within atomic per-room distributed lock
  return await withRoomLock(roomId, async ({ assertLockHeld } = {}) => {
    // 1. Fetch Room and populate Hotel
    const room = await Room.findById(roomId).populate('hotel');
    if (!room) {
      throw new AppError('Room not found', 404);
    }

    // 2. Validate room operational status (maintenance and inactive rooms cannot be booked)
    if (room.status !== 'active') {
      throw new AppError(
        `Room is not available for reservation (operational status: ${room.status})`,
        400
      );
    }

    // 3. Validate room capacity
    if (parsedGuestCount > room.capacity) {
      throw new AppError(
        `Guest count (${parsedGuestCount}) exceeds maximum room capacity (${room.capacity})`,
        400
      );
    }

    // 4. Validate hotel property active state
    if (!room.hotel || room.hotel.status !== 'active' || room.hotel.isActive === false) {
      throw new AppError('The hotel property for this room is currently inactive or not found', 400);
    }

    // 5. Convert stay dates to UTC boundary timestamps
    const requestedCheckIn = new Date(`${checkInDate}T00:00:00.000Z`);
    const requestedCheckOut = new Date(`${checkOutDate}T00:00:00.000Z`);

    // 6. Check for overlapping reservations on this room
    // Overlap condition: existingCheckIn < requestedCheckOut AND existingCheckOut > requestedCheckIn
    const blockingStatuses = ['confirmed', 'checked_in', 'pending'];
    const conflictingBooking = await Booking.findOne({
      room: room._id,
      status: { $in: blockingStatuses },
      checkInDate: { $lt: requestedCheckOut },
      checkOutDate: { $gt: requestedCheckIn }
    });

    if (conflictingBooking) {
      throw new AppError(
        'The requested room is no longer available for the selected dates.',
        409
      );
    }

    // 7. Calculate date-specific nightly rates and total stay price
    const pricing = calculateStayPrice(room, checkInDate, checkOutDate);

    // 8. Freeze price snapshot
    const priceSnapshot = {
      baseNightlyRate: pricing.baseNightlyPrice,
      nightlyBreakdown: pricing.nightlyBreakdown.map((item) => ({
        date: item.date,
        rate: item.rate
      })),
      totalRoomRate: pricing.totalRoomPrice,
      taxes: 0,
      fees: 0
    };

    // 9. Assemble guest info (fallback to authenticated user profile if fields omitted)
    const normalizedGuestInfo = {
      name: (guestInfo && guestInfo.name) ? guestInfo.name.trim() : authenticatedUser.name,
      email: (guestInfo && guestInfo.email) ? guestInfo.email.trim().toLowerCase() : authenticatedUser.email,
      phone: (guestInfo && guestInfo.phone) ? guestInfo.phone.trim() : (authenticatedUser.phone || '')
    };

    if (!normalizedGuestInfo.name) {
      throw new AppError('Guest primary name is required', 400);
    }
    if (!normalizedGuestInfo.email || !/^\S+@\S+\.\S+$/.test(normalizedGuestInfo.email)) {
      throw new AppError('Please provide a valid guest email address', 400);
    }

    // 10. Fencing verification: confirm this request still owns the active lock token before writing
    if (typeof assertLockHeld === 'function') {
      await assertLockHeld();
    }

    // 11. Persist booking under database-enforced unique invariant
    // Calculate hold expiration deadline (15 minutes from creation)
    const holdExpiresAt = new Date(Date.now() + HOLD_DURATION_MS);

    let newBooking;
    try {
      newBooking = await Booking.create({
        hotel: room.hotel._id,
        room: room._id,
        user: authenticatedUser._id,
        checkInDate: requestedCheckIn,
        checkOutDate: requestedCheckOut,
        guestInfo: normalizedGuestInfo,
        guestCount: parsedGuestCount,
        priceSnapshot,
        totalAmount: pricing.totalRoomPrice,
        currency: pricing.currency || 'USD',
        status: 'pending',
        holdExpiresAt
      });
    } catch (err) {
      if (err.code === 11000) {
        throw new AppError(
          'The requested room is no longer available for the selected dates.',
          409
        );
      }
      throw err;
    }

    return await Booking.findById(newBooking._id)
      .select('-__v')
      .populate('room', 'roomNumber roomType basePrice capacity')
      .populate('hotel', 'name address contact')
      .populate('user', 'name email role');
  });
};

/**
 * Retrieves a paginated list of bookings belonging to the authenticated customer.
 *
 * @param {string} userId - Authenticated customer's ObjectId
 * @param {object} query - Query parameters (page, limit, status)
 * @returns {Promise<object>} { bookings, pagination }
 */
const getMyBookings = async (userId, query = {}) => {
  validateObjectId(userId, 'user');
  const { page, limit, skip } = parsePagination(query);

  const filter = { user: userId };

  if (query.status) {
    if (!VALID_BOOKING_STATUSES.includes(query.status)) {
      throw new AppError(
        `Invalid status filter. Allowed: ${VALID_BOOKING_STATUSES.join(', ')}`,
        400
      );
    }
    filter.status = query.status;
  }

  const [bookings, total] = await Promise.all([
    Booking.find(filter)
      .select('-__v')
      .populate('room', 'roomNumber roomType basePrice capacity')
      .populate('hotel', 'name address contact')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Booking.countDocuments(filter)
  ]);

  return {
    bookings,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  };
};

/**
 * Retrieves a single booking by ID with ownership enforcement.
 *
 * @param {string} bookingId
 * @param {object} requestingUser - req.user
 * @returns {Promise<object>} Booking document
 */
const getBookingById = async (bookingId, requestingUser) => {
  validateObjectId(bookingId, 'booking');

  const booking = await Booking.findById(bookingId)
    .select('-__v')
    .populate('room', 'roomNumber roomType basePrice capacity photos')
    .populate('hotel', 'name address contact')
    .populate('user', 'name email role');

  if (!booking) {
    throw new AppError('Booking not found', 404);
  }

  // Authorization check: only admin or the booking's owner may view details
  const isOwner = booking.user && booking.user._id.toString() === requestingUser._id.toString();
  const isAdmin = requestingUser.role === 'admin';

  if (!isOwner && !isAdmin) {
    throw new AppError('You do not have permission to access this booking', 403);
  }

  return booking;
};

/**
 * Cancels a booking according to cancellation policy.
 *
 * CANCELLATION POLICY:
 * - Customers may cancel their own bookings while in 'pending' or 'confirmed' status.
 * - Bookings already 'checked_in', 'checked_out', or 'cancelled' cannot be cancelled.
 * - Administrators may cancel bookings within the same allowed states.
 * - Upon cancellation, sets status to 'cancelled' and records cancellation timestamp and reason.
 * - Cancelled bookings immediately cease to block room availability.
 *
 * @param {string} bookingId
 * @param {object} requestingUser - req.user
 * @param {string} [reason] - Reason for cancellation
 * @returns {Promise<object>} Updated booking document
 */
const cancelBooking = async (bookingId, requestingUser, reason = '') => {
  validateObjectId(bookingId, 'booking');

  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw new AppError('Booking not found', 404);
  }

  // Authorization check
  const isOwner = booking.user.toString() === requestingUser._id.toString();
  const isAdmin = requestingUser.role === 'admin';

  if (!isOwner && !isAdmin) {
    throw new AppError('You do not have permission to cancel this booking', 403);
  }

  // Status check: only pending or confirmed can be cancelled
  if (booking.status === 'cancelled') {
    throw new AppError('Booking is already cancelled', 400);
  }

  if (['checked_in', 'checked_out'].includes(booking.status)) {
    throw new AppError(
      `Cannot cancel a booking that has already ${booking.status === 'checked_in' ? 'checked in' : 'checked out'}`,
      400
    );
  }

  // Perform cancellation
  booking.status = 'cancelled';
  booking.cancellation = {
    cancelledAt: new Date(),
    reason: reason ? String(reason).trim() : (isAdmin ? 'Cancelled by administrator' : 'Cancelled by customer')
  };

  await booking.save();

  // Reconcile associated payment if completed
  try {
    const completedPayment = await Payment.findOne({
      booking: booking._id,
      status: 'completed'
    });
    if (completedPayment) {
      completedPayment.metadata.set('requiresRefund', 'true');
      completedPayment.metadata.set('reconciliationStatus', 'refund_eligible');
      completedPayment.metadata.set(
        'reconciliationReason',
        `Booking cancelled by ${isAdmin ? 'administrator' : 'customer'} after payment completion`
      );
      await completedPayment.save();
    }
  } catch (payErr) {
    console.error(
      `[BookingService] Error updating reconciliation on payment for cancelled booking ${booking._id}: ${payErr.message}`
    );
  }

  return await Booking.findById(booking._id)
    .select('-__v')
    .populate('room', 'roomNumber roomType basePrice')
    .populate('hotel', 'name address contact')
    .populate('user', 'name email role');
};

/**
 * Lists all bookings with pagination and filters (Administrator only).
 *
 * @param {object} query
 * @returns {Promise<object>} { bookings, pagination }
 */
const listAllBookings = async (query = {}) => {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};

  if (query.hotel) {
    validateObjectId(query.hotel, 'hotel');
    filter.hotel = query.hotel;
  }

  if (query.room) {
    validateObjectId(query.room, 'room');
    filter.room = query.room;
  }

  if (query.user) {
    validateObjectId(query.user, 'user');
    filter.user = query.user;
  }

  if (query.status) {
    if (!VALID_BOOKING_STATUSES.includes(query.status)) {
      throw new AppError(
        `Invalid status filter. Allowed: ${VALID_BOOKING_STATUSES.join(', ')}`,
        400
      );
    }
    filter.status = query.status;
  }

  const [bookings, total] = await Promise.all([
    Booking.find(filter)
      .select('-__v')
      .populate('room', 'roomNumber roomType basePrice')
      .populate('hotel', 'name address contact')
      .populate('user', 'name email role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Booking.countDocuments(filter)
  ]);

  return {
    bookings,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  };
};

/**
 * Updates booking status (Administrator only), strictly enforcing permitted lifecycle transitions.
 *
 * @param {string} bookingId
 * @param {string} newStatus
 * @param {string} [reason]
 * @param {object} adminUser
 * @returns {Promise<object>} Updated booking document
 */
const updateBookingStatus = async (bookingId, newStatus, reason = '', adminUser) => {
  validateObjectId(bookingId, 'booking');
  validateBookingStatusUpdate({ status: newStatus, reason });

  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw new AppError('Booking not found', 404);
  }

  const currentStatus = booking.status;
  const allowed = ALLOWED_STATUS_TRANSITIONS[currentStatus] || [];

  if (!allowed.includes(newStatus)) {
    throw new AppError(
      `Cannot transition booking status from "${currentStatus}" to "${newStatus}". Allowed next states: ${allowed.length ? allowed.join(', ') : 'none (terminal state)'}`,
      400
    );
  }

  booking.status = newStatus;

  if (newStatus === 'cancelled') {
    booking.cancellation = {
      cancelledAt: new Date(),
      reason: reason ? String(reason).trim() : 'Cancelled by administrator'
    };
  }

  await booking.save();

  return await Booking.findById(booking._id)
    .select('-__v')
    .populate('room', 'roomNumber roomType basePrice')
    .populate('hotel', 'name address contact')
    .populate('user', 'name email role');
};

/**
 * Scans and expires pending booking holds that have passed their 15-minute deadline.
 *
 * Atomically transitions qualifying pending bookings to 'cancelled' status using conditional updates.
 * Safe for standalone MongoDB and concurrent execution across multiple worker sweeps.
 *
 * @param {object} [options]
 * @param {number} [options.batchSize=50] - Maximum candidates to sweep (capped at 50)
 * @param {Date} [options.now=new Date()] - Evaluation timestamp
 * @returns {Promise<{ scanned: number, expired: number, skipped: number, failed: number }>}
 */
const expireBookingHolds = async ({ batchSize = 50, now = new Date() } = {}) => {
  const parsedBatchSize = parseInt(batchSize, 10);
  const effectiveBatchSize = (!isNaN(parsedBatchSize) && parsedBatchSize > 0)
    ? Math.min(parsedBatchSize, 50)
    : 50;

  const evaluationTime = (now instanceof Date && !isNaN(now.getTime())) ? now : new Date();
  const legacyThreshold = new Date(evaluationTime.getTime() - HOLD_DURATION_MS);

  // Candidate selection query
  const candidateFilter = {
    status: 'pending',
    $or: [
      { holdExpiresAt: { $type: 'date', $lte: evaluationTime } },
      {
        holdExpiresAt: { $exists: false },
        createdAt: { $type: 'date', $lte: legacyThreshold }
      }
    ]
  };

  const candidates = await Booking.find(candidateFilter)
    .limit(effectiveBatchSize)
    .select('_id holdExpiresAt createdAt status')
    .lean();

  let scanned = candidates.length;
  let expired = 0;
  let skipped = 0;
  let failed = 0;

  for (const candidate of candidates) {
    try {
      const updated = await Booking.findOneAndUpdate(
        {
          _id: candidate._id,
          status: 'pending',
          $or: [
            { holdExpiresAt: { $type: 'date', $lte: evaluationTime } },
            {
              holdExpiresAt: { $exists: false },
              createdAt: { $type: 'date', $lte: legacyThreshold }
            }
          ]
        },
        {
          $set: {
            status: 'cancelled',
            'cancellation.cancelledAt': evaluationTime,
            'cancellation.reason': 'Reservation hold expired (15-minute timeout)'
          }
        },
        { returnDocument: 'after' }
      );

      if (updated) {
        expired += 1;
      } else {
        skipped += 1;
      }
    } catch (err) {
      failed += 1;
      console.error(`[BookingHoldWorker] Failed to expire booking hold for ID ${candidate._id}: ${err.message}`);
    }
  }

  return { scanned, expired, skipped, failed };
};

module.exports = {
  HOLD_DURATION_MS,
  ALLOWED_STATUS_TRANSITIONS,
  isBookingHoldExpired,
  expireBookingHolds,
  createBooking,
  getMyBookings,
  getBookingById,
  cancelBooking,
  listAllBookings,
  updateBookingStatus
};
