const mongoose = require('mongoose');

/**
 * Hotel Schema
 *
 * Represents an individual hotel property in the HotelPro system.
 * While HotelPro initially operates for a single property, this model provides
 * the foundational multi-tenant architecture to support multiple hotels in the future.
 */
const hotelSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Hotel name is required'],
      trim: true,
      minlength: [2, 'Hotel name must be at least 2 characters long'],
      maxlength: [120, 'Hotel name cannot exceed 120 characters']
    },
    description: {
      type: String,
      trim: true,
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
      default: ''
    },
    address: {
      street: {
        type: String,
        required: [true, 'Street address is required'],
        trim: true
      },
      city: {
        type: String,
        required: [true, 'City is required'],
        trim: true
      },
      state: {
        type: String,
        trim: true,
        default: ''
      },
      postalCode: {
        type: String,
        trim: true,
        default: ''
      },
      country: {
        type: String,
        required: [true, 'Country is required'],
        trim: true
      }
    },
    contact: {
      phone: {
        type: String,
        required: [true, 'Contact phone number is required'],
        trim: true
      },
      email: {
        type: String,
        required: [true, 'Contact email is required'],
        trim: true,
        lowercase: true,
        match: [/^\S+@\S+\.\S+$/, 'Please provide a valid contact email address']
      },
      website: {
        type: String,
        trim: true,
        default: ''
      }
    },
    status: {
      type: String,
      enum: {
        values: ['active', 'inactive'],
        message: 'Status must be either active or inactive'
      },
      default: 'active',
      index: true
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

hotelSchema.index({ name: 1 });

const Hotel = mongoose.model('Hotel', hotelSchema);

module.exports = Hotel;
