const express = require('express');
const router = express.Router();

const bookingController = require('../controllers/booking.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');

// ==========================================
// Customer & Authenticated Booking Endpoints
// ==========================================

// Create a new booking reservation (Authenticated Customer / Admin)
router.post('/', protect, bookingController.createBooking);

// Retrieve authenticated user's own bookings
// NOTE: Mounted before '/:id' to avoid Express route parameter collisions
router.get('/my', protect, bookingController.getMyBookings);

// Retrieve a single booking (Owner or Admin)
router.get('/:id', protect, bookingController.getBookingById);

// Retrieve latest payment attempt for a booking (Owner or Admin)
router.get('/:id/payment', protect, bookingController.getBookingPayment);

// Request booking cancellation (Owner or Admin)
router.patch('/:id/cancel', protect, bookingController.cancelBooking);

// ==========================================
// Administrator Booking Management Endpoints
// ==========================================

// Paginated booking list with filters (Admin only)
router.get('/', protect, restrictTo('admin'), bookingController.listBookings);

// Authorized status lifecycle management (Admin only)
router.patch('/:id/status', protect, restrictTo('admin'), bookingController.updateBookingStatus);

module.exports = router;
