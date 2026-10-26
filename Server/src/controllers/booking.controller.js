const bookingService = require('../services/booking.service');

/**
 * Creates a new booking reservation.
 *
 * Route: POST /api/bookings
 * Access: Protected (Customer / Admin)
 */
const createBooking = async (req, res, next) => {
  try {
    const booking = await bookingService.createBooking(req.body, req.user);

    res.status(201).json({
      success: true,
      message: 'Booking reservation created successfully',
      data: {
        booking
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Retrieves the authenticated customer's own bookings with pagination.
 *
 * Route: GET /api/bookings/my
 * Access: Protected (Customer / Admin)
 */
const getMyBookings = async (req, res, next) => {
  try {
    const result = await bookingService.getMyBookings(req.user._id, req.query);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Retrieves a booking by ID (only owner or Admin).
 *
 * Route: GET /api/bookings/:id
 * Access: Protected (Owner / Admin)
 */
const getBookingById = async (req, res, next) => {
  try {
    const booking = await bookingService.getBookingById(req.params.id, req.user);

    res.status(200).json({
      success: true,
      data: {
        booking
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Cancels a booking according to cancellation policy.
 *
 * Route: PATCH /api/bookings/:id/cancel
 * Access: Protected (Owner / Admin)
 */
const cancelBooking = async (req, res, next) => {
  try {
    const reason = req.body ? req.body.reason : '';
    const booking = await bookingService.cancelBooking(req.params.id, req.user, reason);

    res.status(200).json({
      success: true,
      message: 'Booking cancelled successfully',
      data: {
        booking
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Lists all bookings with filters and pagination (Admin only).
 *
 * Route: GET /api/bookings
 * Access: Protected (Admin)
 */
const listBookings = async (req, res, next) => {
  try {
    const result = await bookingService.listAllBookings(req.query);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Updates a booking's status enforcing permitted lifecycle transitions (Admin only).
 *
 * Route: PATCH /api/bookings/:id/status
 * Access: Protected (Admin)
 */
const updateBookingStatus = async (req, res, next) => {
  try {
    const { status, reason } = req.body || {};
    const booking = await bookingService.updateBookingStatus(
      req.params.id,
      status,
      reason,
      req.user
    );

    res.status(200).json({
      success: true,
      message: 'Booking status updated successfully',
      data: {
        booking
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createBooking,
  getMyBookings,
  getBookingById,
  cancelBooking,
  listBookings,
  updateBookingStatus
};
