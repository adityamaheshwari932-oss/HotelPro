const crypto = require('crypto');
const { SystemLock } = require('../models');
const { AppError } = require('../middleware/error.middleware');

const DEFAULT_ACQUIRE_TIMEOUT_MS = 3000;
const DEFAULT_STALE_TIMEOUT_MS = 10000;
const DEFAULT_POLL_INTERVAL_MS = 40;

/**
 * Helper to pause execution for a given number of milliseconds.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Acquires an atomic distributed lock for a specific booking checkout session using MongoDB's
 * unique primary key (_id) in the SystemLock collection.
 *
 * CONCURRENCY GUARANTEES:
 * 1. MongoDB guarantees atomic uniqueness on `_id`. Creating `_id: 'checkout_lock_' + bookingId`
 *    ensures that exactly ONE checkout process executes for a booking at any given instant.
 * 2. Concurrent requests targeting the same booking are serialized: the second request waits for the
 *    first to finish, then safely reuses the active session created by the first request.
 * 3. Concurrent requests targeting DIFFERENT bookings acquire distinct keys and run in parallel.
 * 4. Stale locks (> staleTimeoutMs) are automatically reclaimed to survive unexpected server crashes.
 *
 * @param {string} bookingId
 * @param {object} [options]
 * @param {number} [options.timeoutMs=3000] - Maximum time to wait for lock
 * @param {number} [options.staleTimeoutMs=10000] - Duration after which orphaned lock is stale
 * @param {number} [options.pollIntervalMs=40] - Delay between acquisition attempts
 * @returns {Promise<{ lockKey: string, lockToken: string }>}
 */
const acquireCheckoutLock = async (bookingId, options = {}) => {
  const lockKey = `checkout_lock_${bookingId.toString()}`;
  const timeoutMs = options.timeoutMs || DEFAULT_ACQUIRE_TIMEOUT_MS;
  const staleTimeoutMs = options.staleTimeoutMs || DEFAULT_STALE_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS;

  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const lockToken = crypto.randomUUID();
    try {
      await SystemLock.create({
        _id: lockKey,
        initializedAt: new Date(),
        meta: {
          bookingId: bookingId.toString(),
          lockToken,
          acquiredAt: Date.now()
        }
      });
      return { lockKey, lockToken };
    } catch (err) {
      if (err.code === 11000) {
        // Lock currently held by another request. Check if existing lock is stale.
        const staleThreshold = new Date(Date.now() - staleTimeoutMs);
        const deletedStale = await SystemLock.findOneAndDelete({
          _id: lockKey,
          initializedAt: { $lt: staleThreshold }
        }).catch(() => null);

        if (deletedStale) {
          continue;
        }

        const jitter = Math.floor(Math.random() * 25);
        await sleep(pollIntervalMs + jitter);
      } else {
        throw err;
      }
    }
  }

  throw new AppError(
    'A checkout session is currently being processed for this booking. Please try again.',
    409
  );
};

/**
 * Releases the distributed checkout lock for a booking, verifying token ownership.
 *
 * @param {string} bookingId
 * @param {string} lockToken
 * @returns {Promise<boolean>}
 */
const releaseCheckoutLock = async (bookingId, lockToken = null) => {
  const lockKey = `checkout_lock_${bookingId.toString()}`;
  try {
    const filter = { _id: lockKey };
    if (lockToken) {
      filter['meta.lockToken'] = lockToken;
    }
    const result = await SystemLock.deleteOne(filter);
    return result.deletedCount > 0;
  } catch (err) {
    return false;
  }
};

/**
 * Executes a critical checkout action within the safety of an atomic per-booking lock.
 *
 * @param {string} bookingId
 * @param {Function} action - Async function to execute
 * @param {object} [options]
 * @returns {Promise<*>}
 */
const withCheckoutLock = async (bookingId, action, options = {}) => {
  let acquiredInfo = null;
  try {
    acquiredInfo = await acquireCheckoutLock(bookingId, options);
    return await action(acquiredInfo);
  } finally {
    if (acquiredInfo && acquiredInfo.lockToken) {
      await releaseCheckoutLock(bookingId, acquiredInfo.lockToken);
    }
  }
};

module.exports = {
  acquireCheckoutLock,
  releaseCheckoutLock,
  withCheckoutLock
};
