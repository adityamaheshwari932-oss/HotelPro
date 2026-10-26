const mongoose = require('mongoose');

/**
 * Nightly Rate Breakdown Sub-schema
 * Captures the daily rate snapshot applied for each individual night of the stay.
 */
const nightlyRateSchema = new mongoose.Schema(
  {
    date: {
      type: String,
      required: [true, 'Rate date is required'],
      match: [/^\d{4}-\d{2}-\d{2}$/, 'Rate date must be in YYYY-MM-DD format']
    },
    rate: {
      type: Number,
      required: [true, 'Nightly rate is required'],
      min: [0, 'Nightly rate cannot be negative']
    }
  },
  { _id: false }
);

/**
 * Price Snapshot Sub-schema
 *
 * ARCHITECTURAL DECISION:
 * Preserves the exact price, rates, taxes, and fees agreed upon at booking time.
 * Even if room base prices or future pricing rules are updated, existing bookings
 * retain their historical and contractually binding rate.
 */
const priceSnapshotSchema = new mongoose.Schema(
  {
    baseNightlyRate: {
      type: Number,
      required: [true, 'Snapshot baseNightlyRate is required'],
      min: [0, 'baseNightlyRate cannot be negative']
    },
    nightlyBreakdown: {
      type: [nightlyRateSchema],
      default: []
    },
    totalRoomRate: {
      type: Number,
      required: [true, 'totalRoomRate is required'],
      min: [0, 'totalRoomRate cannot be negative']
    },
    taxes: {
      type: Number,
      default: 0,
      min: [0, 'Taxes cannot be negative']
    },
    fees: {
      type: Number,
      default: 0,
      min: [0, 'Fees cannot be negative']
    }
  },
  { _id: false }
);

/**
 * Booking Schema
 *
 * BOOKING STATUS LIFECYCLE:
 * - 'pending': Initial state upon reservation request, pending payment confirmation.
 * - 'confirmed': Payment received / booking confirmed; dates are reserved.
 * - 'checked_in': Guest has arrived and checked in.
 * - 'checked_out': Guest has completed their stay.
 * - 'cancelled': Reservation cancelled prior to or during stay.
 *
 * CONCURRENCY NOTICE:
 * Schema validation guarantees structural integrity (e.g. checkOutDate > checkInDate).
 * However, schema validation alone CANNOT prevent concurrent double bookings of the same room.
 * Overlapping date collision checking and race condition prevention MUST be executed in the
 * Booking Service layer using atomic operations or MongoDB ACID transactions.
 */
const bookingSchema = new mongoose.Schema(
  {
    hotel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hotel',
      required: [true, 'Hotel reference is required'],
      index: true
    },
    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Room',
      required: [true, 'Room reference is required'],
      index: true
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
      index: true
    },
    checkInDate: {
      type: Date,
      required: [true, 'Check-in date is required']
    },
    checkOutDate: {
      type: Date,
      required: [true, 'Check-out date is required'],
      validate: {
        validator: function (val) {
          if (!this.checkInDate || !val) return true;
          return new Date(val).getTime() > new Date(this.checkInDate).getTime();
        },
        message: 'Check-out date must be strictly after check-in date'
      }
    },
    guestInfo: {
      name: {
        type: String,
        required: [true, 'Guest primary name is required'],
        trim: true
      },
      email: {
        type: String,
        required: [true, 'Guest email is required'],
        trim: true,
        lowercase: true,
        match: [/^\S+@\S+\.\S+$/, 'Please provide a valid guest email address']
      },
      phone: {
        type: String,
        trim: true,
        default: ''
      }
    },
    guestCount: {
      type: Number,
      required: [true, 'Guest count is required'],
      min: [1, 'Guest count must be at least 1 guest']
    },
    priceSnapshot: {
      type: priceSnapshotSchema,
      required: [true, 'Price snapshot is required']
    },
    totalAmount: {
      type: Number,
      required: [true, 'Total amount is required'],
      min: [0, 'Total amount cannot be negative']
    },
    currency: {
      type: String,
      required: [true, 'Currency is required'],
      uppercase: true,
      default: 'USD',
      trim: true,
      minlength: 3,
      maxlength: 3
    },
    status: {
      type: String,
      enum: {
        values: ['pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled'],
        message: 'Invalid booking status'
      },
      default: 'pending',
      required: true,
      index: true
    },
    cancellation: {
      cancelledAt: {
        type: Date
      },
      reason: {
        type: String,
        trim: true,
        default: ''
      }
    }
  },
  {
    timestamps: true
  }
);

// Compound indexes for fast availability queries and user booking history
bookingSchema.index({ room: 1, checkInDate: 1, checkOutDate: 1 });
bookingSchema.index({ user: 1, createdAt: -1 });
bookingSchema.index({ hotel: 1, status: 1 });

const Booking = mongoose.model('Booking', bookingSchema);

module.exports = Booking;
