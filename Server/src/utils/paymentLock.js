const crypto = require('crypto');
const { SystemLock } = require('../models');
const { AppError } = require('../middleware/error.middleware');

const DEFAULT_ACQUIRE_TIMEOUT_MS = 4000;
const DEFAULT_STALE_TIMEOUT_MS = 10000;
const DEFAULT_POLL_INTERVAL_MS = 40;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Acquires an atomic distributed lock for a specific payment refund/mutation using
 * MongoDB's unique primary key (_id) in the SystemLock collection.
 *
 * CONCURRENCY & FINANCIAL SAFETY GUARANTEES:
 * 1. Serializes simultaneous refund attempts targeting the SAME physical payment document.
 * 2. Prevents two concurrent refund requests from racing to spend the same remaining refundable balance.
 * 3. Concurrent requests targeting DIFFERENT payments acquire distinct keys and run in parallel.
 * 4. Stale locks (> staleTimeoutMs) are automatically reclaimed.
 *
 * @param {string} paymentId
 * @param {object} [options]
 * @returns {Promise<{ lockKey: string, lockToken: string }>}
 */
const acquirePaymentLock = async (paymentId, options = {}) => {
  const lockKey = `payment_lock_${paymentId.toString()}`;
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
          paymentId: paymentId.toString(),
          lockToken,
          acquiredAt: Date.now()
        }
      });
      return { lockKey, lockToken };
    } catch (err) {
      if (err.code === 11000) {
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
    'A refund operation is currently being processed for this payment. Please try again.',
    409
  );
};

/**
 * Releases the distributed payment lock verifying token ownership.
 *
 * @param {string} paymentId
 * @param {string} lockToken
 * @returns {Promise<boolean>}
 */
const releasePaymentLock = async (paymentId, lockToken = null) => {
  const lockKey = `payment_lock_${paymentId.toString()}`;
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
 * Executes a payment refund/mutation inside an atomic per-payment distributed lock.
 *
 * @param {string} paymentId
 * @param {Function} action - Async callback
 * @param {object} [options]
 * @returns {Promise<*>}
 */
const withPaymentLock = async (paymentId, action, options = {}) => {
  let acquiredInfo = null;
  try {
    acquiredInfo = await acquirePaymentLock(paymentId, options);
    return await action(acquiredInfo);
  } finally {
    if (acquiredInfo && acquiredInfo.lockToken) {
      await releasePaymentLock(paymentId, acquiredInfo.lockToken);
    }
  }
};

module.exports = {
  acquirePaymentLock,
  releasePaymentLock,
  withPaymentLock
};
