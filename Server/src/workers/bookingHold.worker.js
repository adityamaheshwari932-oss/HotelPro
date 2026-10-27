const { expireBookingHolds } = require('../services/booking.service');

const DEFAULT_POLL_INTERVAL_MS = 30000; // 30 seconds
const DEFAULT_BATCH_SIZE = 50;

let intervalId = null;
let isSweepInProgress = false;

/**
 * Executes a single sweep of expired booking holds with in-process overlap protection.
 *
 * @param {object} [options]
 * @param {number} [options.batchSize=50]
 * @param {Date} [options.now]
 * @returns {Promise<object|null>} Sweep summary or null if already in progress
 */
const runHoldExpirationSweep = async (options = {}) => {
  if (isSweepInProgress) {
    return null;
  }

  isSweepInProgress = true;
  try {
    const result = await expireBookingHolds({
      batchSize: options.batchSize || DEFAULT_BATCH_SIZE,
      now: options.now || new Date()
    });
    return result;
  } catch (err) {
    console.error(`[BookingHoldWorker] Unexpected error during hold expiration sweep: ${err.message}`);
    return null;
  } finally {
    isSweepInProgress = false;
  }
};

/**
 * Starts the periodic booking hold expiration worker.
 * Idempotent: repeated invocations will not create duplicate intervals.
 *
 * @param {object} [options]
 * @param {number} [options.intervalMs=30000] - Polling interval in milliseconds
 * @param {number} [options.batchSize=50] - Maximum bookings to expire per sweep
 * @returns {NodeJS.Timeout|null} Active timer handle
 */
const startHoldExpirationWorker = (options = {}) => {
  if (intervalId !== null) {
    return intervalId;
  }

  const intervalMs = options.intervalMs || DEFAULT_POLL_INTERVAL_MS;
  const batchSize = options.batchSize || DEFAULT_BATCH_SIZE;

  intervalId = setInterval(async () => {
    await runHoldExpirationSweep({ batchSize });
  }, intervalMs);

  // Unreference the timer so it does not keep the Node.js event loop alive unnecessarily
  if (intervalId && typeof intervalId.unref === 'function') {
    intervalId.unref();
  }

  return intervalId;
};

/**
 * Stops the periodic booking hold expiration worker safely.
 * Idempotent: safe to call if worker is not running.
 */
const stopHoldExpirationWorker = () => {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  isSweepInProgress = false;
};

/**
 * Returns current status of the worker (useful for diagnostics and lifecycle tests).
 *
 * @returns {{ isRunning: boolean, isSweepInProgress: boolean }}
 */
const getWorkerStatus = () => ({
  isRunning: intervalId !== null,
  isSweepInProgress
});

module.exports = {
  startHoldExpirationWorker,
  stopHoldExpirationWorker,
  runHoldExpirationSweep,
  getWorkerStatus
};
