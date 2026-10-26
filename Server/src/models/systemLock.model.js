const mongoose = require('mongoose');

/**
 * SystemLock Schema
 *
 * Provides atomic, distributed lock primitives for critical one-time system events
 * such as the initial administrator initialization. Uses MongoDB's unique primary key (_id)
 * to guarantee that concurrent attempts fail atomically at the database level.
 */
const systemLockSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true
    },
    initializedAt: {
      type: Date,
      default: Date.now
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({})
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

const SystemLock = mongoose.model('SystemLock', systemLockSchema);

module.exports = SystemLock;
