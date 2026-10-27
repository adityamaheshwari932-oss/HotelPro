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
 * Acquires an atomic distributed lock for a specific room using MongoDB's unique primary key (_id)
 * in the SystemLock collection, returning a unique ownership fencing token.
 *
 * CONCURRENCY & FENCING SAFETY:
 * 1. MongoDB guarantees atomic uniqueness on the `_id` field across all storage engines (WiredTiger).
 * 2. Creating a document with `_id: 'room_lock_' + roomId` guarantees that exactly ONE process/request
 *    can hold the lock for this room at any given time, regardless of deployment topology (standalone or replica set).
 * 3. Every lock acquisition generates a cryptographically unique `lockToken` (UUID).
 * 4. Lock release operations require this `lockToken` to match, strictly preventing an earlier slow/paused
 *    owner from releasing a subsequent owner's lock.
 * 5. Concurrent requests for different rooms acquire distinct lock keys and do NOT serialize each other.
 * 6. In case of unexpected server crashes, locks older than `staleTimeoutMs` are safely reclaimed atomically.
 *
 * @param {string} roomId
 * @param {object} [options]
 * @param {number} [options.timeoutMs=3000] - Maximum time to wait for lock
 * @param {number} [options.staleTimeoutMs=10000] - Duration after which an orphaned lock is considered stale
 * @param {number} [options.pollIntervalMs=40] - Base polling delay between acquisition retries
 * @returns {Promise<{ lockKey: string, lockToken: string }>} The acquired lockKey and ownership token
 */
const acquireRoomLock = async (roomId, options = {}) => {
  const lockKey = `room_lock_${roomId.toString()}`;
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
          roomId: roomId.toString(),
          lockToken,
          acquiredAt: Date.now()
        }
      });
      return { lockKey, lockToken };
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
 * Checks whether the specified lock is currently held by the given ownership token.
 *
 * @param {string} roomId
 * @param {string} lockToken
 * @returns {Promise<boolean>}
 */
const isLockHeld = async (roomId, lockToken) => {
  if (!lockToken) return false;
  const lockKey = `room_lock_${roomId.toString()}`;
  const lock = await SystemLock.findOne({
    _id: lockKey,
    'meta.lockToken': lockToken
  });
  return !!lock;
};

/**
 * Releases the distributed lock for a specific room.
 * Enforces ownership: only deletes the lock if the provided lockToken matches the current lock.
 *
 * @param {string} roomId
 * @param {string} [lockToken] - The ownership token obtained during acquisition
 * @returns {Promise<boolean>} True if the lock was deleted, false otherwise
 */
const releaseRoomLock = async (roomId, lockToken = null) => {
  const lockKey = `room_lock_${roomId.toString()}`;
  try {
    const filter = { _id: lockKey };
    if (lockToken) {
      filter['meta.lockToken'] = lockToken;
    }
    const result = await SystemLock.deleteOne(filter);
    return result.deletedCount > 0;
  } catch (err) {
    // Suppress release error to prevent masking primary transaction errors
    return false;
  }
};

/**
 * Executes a function within the safety of an atomic per-room lock with fencing verification.
 * Guarantees ownership-safe release in all scenarios (success, error, or exception).
 *
 * @param {string} roomId
 * @param {Function} action - Async function receiving `{ lockToken, lockKey, assertLockHeld }`
 * @param {object} [options]
 * @returns {Promise<*>} Result of action()
 */
const withRoomLock = async (roomId, action, options = {}) => {
  let acquiredInfo = null;
  try {
    acquiredInfo = await acquireRoomLock(roomId, options);

    const assertLockHeld = async () => {
      const held = await isLockHeld(roomId, acquiredInfo.lockToken);
      if (!held) {
        throw new AppError(
          'Reservation lock timed out and was reclaimed by another request. Please try again.',
          409
        );
      }
    };

    return await action({
      lockToken: acquiredInfo.lockToken,
      lockKey: acquiredInfo.lockKey,
      assertLockHeld
    });
  } finally {
    if (acquiredInfo && acquiredInfo.lockToken) {
      await releaseRoomLock(roomId, acquiredInfo.lockToken);
    }
  }
};

module.exports = {
  acquireRoomLock,
  isLockHeld,
  releaseRoomLock,
  withRoomLock
};
