const mongoose = require('mongoose');

/**
 * Prohibited sensitive payment keys to guarantee PCI-DSS compliance.
 * Raw credit card numbers, Primary Account Numbers (PAN), CVVs, and PINs
 * must NEVER be persisted in our database under any circumstances.
 */
const FORBIDDEN_PAYMENT_KEYS = [
  'cardnumber',
  'card_number',
  'pan',
  'cvv',
  'cvc',
  'securitycode',
  'security_code',
  'pin'
];

/**
 * Payment Schema
 *
 * Keeps financial transaction records independent of booking documents.
 * Stores only safe payment provider identifiers and non-sensitive metadata (e.g. last 4 digits).
 */
const paymentSchema = new mongoose.Schema(
  {
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: [true, 'Booking reference is required'],
      index: true
    },
    amount: {
      type: Number,
      required: [true, 'Payment amount is required'],
      min: [0, 'Payment amount cannot be negative']
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
        values: ['pending', 'completed', 'failed', 'refunded', 'partially_refunded'],
        message: 'Invalid payment status'
      },
      default: 'pending',
      required: true,
      index: true
    },
    provider: {
      type: String,
      enum: {
        values: ['stripe', 'paypal', 'manual', 'mock'],
        message: 'Provider must be stripe, paypal, manual, or mock'
      },
      required: [true, 'Payment provider is required'],
      trim: true
    },
    transactionId: {
      type: String,
      trim: true,
      default: ''
    },
    paymentMethod: {
      methodType: {
        type: String,
        enum: {
          values: ['card', 'bank_transfer', 'wallet', 'cash', 'other'],
          message: 'Invalid payment method type'
        },
        default: 'card'
      },
      cardBrand: {
        type: String,
        trim: true,
        default: ''
      },
      cardLast4: {
        type: String,
        trim: true,
        match: [/^\d{4}$/, 'cardLast4 must be exactly 4 digits'],
        default: undefined
      }
    },
    refund: {
      status: {
        type: String,
        enum: {
          values: ['none', 'pending', 'completed', 'failed'],
          message: 'Invalid refund status'
        },
        default: 'none'
      },
      refundTransactionId: {
        type: String,
        trim: true,
        default: ''
      },
      amount: {
        type: Number,
        min: [0, 'Refund amount cannot be negative'],
        default: 0
      },
      reason: {
        type: String,
        trim: true,
        default: ''
      },
      refundedAt: {
        type: Date
      }
    },
    refunds: [
      {
        refundTransactionId: {
          type: String,
          trim: true,
          default: ''
        },
        amount: {
          type: Number,
          required: true,
          min: [0, 'Refund amount cannot be negative']
        },
        status: {
          type: String,
          enum: ['pending', 'completed', 'failed'],
          default: 'pending'
        },
        reason: {
          type: String,
          trim: true,
          default: ''
        },
        idempotencyKey: {
          type: String,
          trim: true
        },
        requestedAt: {
          type: Date,
          default: Date.now
        },
        completedAt: {
          type: Date
        },
        errorMessage: {
          type: String,
          trim: true,
          default: ''
        }
      }
    ],
    metadata: {
      type: Map,
      of: String,
      default: () => new Map()
    }
  },
  {
    timestamps: true
  }
);

/**
 * Explicit schema paths for forbidden payment credentials.
 * Intercepts any direct attempt to pass raw card numbers or CVVs into the document
 * so they are immediately rejected with a security error instead of being silently ignored.
 */
FORBIDDEN_PAYMENT_KEYS.forEach((forbiddenKey) => {
  paymentSchema.add({
    [forbiddenKey]: {
      type: mongoose.Schema.Types.Mixed,
      validate: {
        validator: () => false,
        message: `Security Violation: Storing raw payment credentials (${forbiddenKey}) is strictly prohibited.`
      }
    }
  });
});

/**
 * PCI-DSS Security Guardrail:
 * Recursively inspects metadata Maps and nested objects before validation and rejects
 * if any raw card numbers, CVVs, or secret payment credentials are found.
 */
paymentSchema.pre('validate', function () {
  const checkDisallowed = (obj) => {
    if (!obj) return null;
    if (obj instanceof Map) {
      for (const key of obj.keys()) {
        if (typeof key === 'string' && FORBIDDEN_PAYMENT_KEYS.includes(key.toLowerCase())) {
          return key;
        }
      }
      return null;
    }
    if (typeof obj !== 'object') return null;
    for (const key of Object.keys(obj)) {
      if (FORBIDDEN_PAYMENT_KEYS.includes(key.toLowerCase())) {
        return key;
      }
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        const found = checkDisallowed(obj[key]);
        if (found) return found;
      }
    }
    return null;
  };

  const rawObject = this.toObject({ depopulate: true });
  const forbiddenKey = checkDisallowed(rawObject);
  if (forbiddenKey) {
    throw new Error(
      `Security Violation: Storing raw payment credentials (${forbiddenKey}) is strictly prohibited.`
    );
  }
});

// Note: indexes for booking and status are declared directly on their fields via index: true
paymentSchema.index({ transactionId: 1 }, { sparse: true });
paymentSchema.index({ 'refunds.idempotencyKey': 1 }, { sparse: true });
paymentSchema.index({ 'metadata.requiresRefund': 1 }, { sparse: true });

// Database-level concurrency safeguard: guarantees at most one pending payment per booking
paymentSchema.index(
  { booking: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'pending' },
    name: 'unique_pending_booking_payment'
  }
);

const Payment = mongoose.model('Payment', paymentSchema);

module.exports = Payment;
