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
 * Acquires an atomic distributed lock for a specific room using MongoDB's unique primary key (_id)
 * in the SystemLock collection.
 *
 * CONCURRENCY SAFETY MECHANISM:
 * 1. MongoDB guarantees atomic uniqueness on the `_id` field across all storage engines (WiredTiger).
 * 2. Creating a document with `_id: 'room_lock_' + roomId` guarantees that exactly ONE process/request
 *    can hold the lock for this room at any given time, regardless of deployment topology (standalone or replica set).
 * 3. Concurrent requests for different rooms acquire distinct lock keys and do NOT serialize each other.
 * 4. In case of contention, requests poll with a small backoff and random jitter.
 * 5. In case of unexpected server crashes, locks older than `staleTimeoutMs` are safely reclaimed atomically.
 *
 * @param {string} roomId
 * @param {object} [options]
 * @param {number} [options.timeoutMs=3000] - Maximum time to wait for lock
 * @param {number} [options.staleTimeoutMs=10000] - Duration after which an orphaned lock is considered stale
 * @param {number} [options.pollIntervalMs=40] - Base polling delay between acquisition retries
 * @returns {Promise<string>} The acquired lockKey
 */
const acquireRoomLock = async (roomId, options = {}) => {
  const lockKey = `room_lock_${roomId.toString()}`;
  const timeoutMs = options.timeoutMs || DEFAULT_ACQUIRE_TIMEOUT_MS;
  const staleTimeoutMs = options.staleTimeoutMs || DEFAULT_STALE_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS;

  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      await SystemLock.create({
        _id: lockKey,
        initializedAt: new Date(),
        meta: {
          roomId: roomId.toString(),
          acquiredAt: Date.now()
        }
      });
      return lockKey;
    } catch (err) {
      if (err.code === 11000) {
        // Lock currently held by another request. Check if the existing lock is stale.
        const staleThreshold = new Date(Date.now() - staleTimeoutMs);
        const deletedStale = await SystemLock.findOneAndDelete({
          _id: lockKey,
          initializedAt: { $lt: staleThreshold }
        }).catch(() => null);

        if (deletedStale) {
          // Orphaned lock was safely recovered; retry acquisition immediately
          continue;
        }

        // Wait with small randomized jitter to prevent lock starvation
        const jitter = Math.floor(Math.random() * 25);
        await sleep(pollIntervalMs + jitter);
      } else {
        throw err;
      }
    }
  }

  throw new AppError(
    'The requested room is currently being reserved by another request. Please try again.',
    409
  );
};

/**
 * Releases the distributed lock for a specific room.
 *
 * @param {string} roomId
 * @returns {Promise<void>}
 */
const releaseRoomLock = async (roomId) => {
  const lockKey = `room_lock_${roomId.toString()}`;
  try {
    await SystemLock.deleteOne({ _id: lockKey });
  } catch (err) {
    // Suppress release error to prevent masking primary transaction errors
  }
};

/**
 * Executes a function within the safety of an atomic per-room lock.
 * Guarantees lock release in all scenarios (success, error, or exception).
 *
 * @param {string} roomId
 * @param {Function} action - Async function to run while holding lock
 * @param {object} [options]
 * @returns {Promise<*>} Result of action()
 */
const withRoomLock = async (roomId, action, options = {}) => {
  let lockAcquired = false;
  try {
    await acquireRoomLock(roomId, options);
    lockAcquired = true;
    return await action();
  } finally {
    if (lockAcquired) {
      await releaseRoomLock(roomId);
    }
  }
};

module.exports = {
  acquireRoomLock,
  releaseRoomLock,
  withRoomLock
};
