const mongoose = require('mongoose');

/**
 * Validates that a string is a valid real calendar date in YYYY-MM-DD format.
 *
 * @param {string} val
 * @returns {boolean}
 */
const isValidIsoDate = (val) => {
  if (typeof val !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(val)) return false;
  const [year, month, day] = val.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

/**
 * Pricing Rule Sub-schema
 *
 * DATE SEMANTICS AND CONVENTION:
 * - Uses date-only strings formatted as 'YYYY-MM-DD' to prevent timezone shifts across systems.
 * - Interval semantics: Half-open interval [startDate, endDate) where:
 *   - `startDate` is INCLUSIVE (the rule applies starting on this night's stay).
 *   - `endDate` is EXCLUSIVE (the rule stops applying on this date, e.g. the checkout day).
 *   Example: A weekend rule for Friday & Saturday nights of 2026-11-06 to 2026-11-08
 *   has startDate: '2026-11-06' and endDate: '2026-11-08'.
 */
const pricingRuleSchema = new mongoose.Schema(
  {
    ruleName: {
      type: String,
      trim: true,
      default: ''
    },
    startDate: {
      type: String,
      required: [true, 'Pricing rule startDate is required'],
      validate: {
        validator: isValidIsoDate,
        message: 'Pricing rule startDate must be a valid calendar date in YYYY-MM-DD format'
      }
    },
    endDate: {
      type: String,
      required: [true, 'Pricing rule endDate is required'],
      validate: [
        {
          validator: isValidIsoDate,
          message: 'Pricing rule endDate must be a valid calendar date in YYYY-MM-DD format'
        },
        {
          validator: function (value) {
            if (!this.startDate || !value) return true;
            return value > this.startDate;
          },
          message: 'Pricing rule endDate must be strictly after startDate'
        }
      ]
    },
    price: {
      type: Number,
      required: [true, 'Pricing rule price is required'],
      min: [0, 'Pricing rule price cannot be negative']
    }
  },
  { _id: false }
);

/**
 * Room Schema
 *
 * Represents an individual physical room.
 *
 * ARCHITECTURAL DECISIONS:
 * 1. Physical Room Document: Every room has its own document with an assigned room number.
 * 2. Scoped Room Uniqueness: Room numbers are unique per hotel, not globally across hotels.
 * 3. Dynamic Availability: There is NO permanent `isAvailable` boolean.
 *    Availability is always dynamically calculated from requested dates and existing bookings
 *    in the Booking Service to eliminate stale-state bugs.
 */
const roomSchema = new mongoose.Schema(
  {
    hotel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hotel',
      required: [true, 'Hotel reference is required'],
      index: true
    },
    roomNumber: {
      type: String,
      required: [true, 'Room number is required'],
      trim: true
    },
    roomType: {
      type: String,
      required: [true, 'Room type is required'],
      enum: {
        values: ['single', 'double', 'suite'],
        message: 'Room type must be single, double, or suite'
      }
    },
    description: {
      type: String,
      trim: true,
      default: ''
    },
    photos: {
      type: [String],
      default: []
    },
    basePrice: {
      type: Number,
      required: [true, 'Base price is required'],
      min: [0, 'Base price cannot be negative']
    },
    pricingRules: {
      type: [pricingRuleSchema],
      default: []
    },
    capacity: {
      type: Number,
      required: [true, 'Room capacity is required'],
      min: [1, 'Room capacity must be at least 1 guest']
    },
    status: {
      type: String,
      enum: {
        values: ['active', 'maintenance', 'inactive'],
        message: 'Status must be active, maintenance, or inactive'
      },
      default: 'active',
      required: true
    }
  },
  {
    timestamps: true
  }
);

// Enforce that room numbers are unique within a single hotel property
roomSchema.index({ hotel: 1, roomNumber: 1 }, { unique: true });
roomSchema.index({ hotel: 1, roomType: 1, status: 1 });

const Room = mongoose.model('Room', roomSchema);

module.exports = Room;
