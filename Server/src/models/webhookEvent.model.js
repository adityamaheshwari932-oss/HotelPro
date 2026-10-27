const mongoose = require('mongoose');

/**
 * WebhookEvent Schema
 *
 * Provides durable idempotency tracking for incoming payment gateway webhook events.
 * Guarantees that repeated deliveries of the same event ID from a provider are not processed multiple times,
 * preventing duplicate state transitions, double booking confirmations, or multiple refund attempts.
 */
const webhookEventSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      required: [true, 'Provider name is required'],
      trim: true,
      lowercase: true
    },
    eventId: {
      type: String,
      required: [true, 'Provider eventId is required'],
      trim: true
    },
    eventType: {
      type: String,
      required: [true, 'Event type is required'],
      trim: true
    },
    transactionId: {
      type: String,
      trim: true,
      default: ''
    },
    status: {
      type: String,
      enum: {
        values: ['processing', 'completed', 'failed'],
        message: 'Invalid webhook event status'
      },
      default: 'processing',
      required: true
    },
    processedAt: {
      type: Date
    },
    error: {
      type: String,
      default: ''
    },
    lockToken: {
      type: String,
      default: null,
      trim: true
    },
    lockedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Compound unique index guaranteeing durable event idempotency per provider
webhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true, name: 'unique_provider_event' });

const WebhookEvent = mongoose.model('WebhookEvent', webhookEventSchema);

module.exports = WebhookEvent;
