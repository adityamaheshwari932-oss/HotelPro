const crypto = require('crypto');
const { Payment, Booking, WebhookEvent } = require('../models');
const { getPaymentProvider } = require('./payment');
const { withCheckoutLock } = require('../utils/checkoutLock');
const { withPaymentLock } = require('../utils/paymentLock');
const { isBookingHoldExpired } = require('./booking.service');
const { AppError } = require('../middleware/error.middleware');
const {
  validateCheckoutSessionInput,
  validateRefundInput,
  validateMockSimulationInput
} = require('../validators/payment.validator');
const { validateObjectId, parsePagination } = require('../validators/room.validator');

const DEFAULT_WEBHOOK_STALE_TIMEOUT_MS = 15000; // 15 seconds
const DEFAULT_WEBHOOK_POLL_INTERVAL_MS = 75; // 75 ms
const DEFAULT_WEBHOOK_MAX_POLL_ATTEMPTS = 20; // 20 attempts (~1.5s total)

/**
 * Initializes a payment checkout session for a pending reservation.
 *
 * WORKFLOW & SAFETY GUARANTEES:
 * 1. Authentication & Ownership: Customer identity is derived exclusively from authenticatedUser._id.
 *    A customer can only checkout for their own booking.
 * 2. Eligibility: The reservation must exist and be in 'pending' status.
 *    Cancelled, confirmed, checked_in, or checked_out bookings are rejected.
 * 3. Idempotency & Duplicate Prevention: If a completed payment already exists for this booking, rejects with 409.
 *    If an active pending payment session already exists for this booking, reuses the existing active session.
 * 4. Zero-Trust Pricing: Amount and currency are derived exclusively from the booking's immutable price snapshot.
 *    Client-supplied amounts, currencies, discounts, or statuses are ignored.
 * 5. Lifecycle Separation: Creating a checkout intent initializes a payment attempt with status 'pending'.
 *    It does NOT mark the payment completed and does NOT confirm the booking.
 *
 * @param {object} payload - { bookingId, provider, simulation }
 * @param {object} authenticatedUser - req.user
 * @returns {Promise<object>} Initialized checkout session data
 */
const createCheckoutSession = async (payload, authenticatedUser) => {
  if (!authenticatedUser || !authenticatedUser._id) {
    throw new AppError('Authentication is required to initiate checkout', 401);
  }

  // 1. Validate structural inputs
  const { bookingId, provider: requestedProvider, simulation } = validateCheckoutSessionInput(payload);

  // 2. Load Booking from database
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw new AppError('Booking not found', 404);
  }

  // 3. Enforce strict ownership: Customer can only checkout their own booking
  const bookingUserId = (booking.user?._id || booking.user)?.toString();
  if (bookingUserId !== authenticatedUser._id.toString()) {
    throw new AppError('You do not have permission to checkout for this booking', 403);
  }

  // 4. Validate Booking state eligibility
  if (booking.status === 'confirmed') {
    throw new AppError('This booking is already confirmed and paid', 400);
  }

  if (booking.status === 'cancelled') {
    throw new AppError('Cannot initiate checkout for a cancelled reservation', 400);
  }

  if (['checked_in', 'checked_out'].includes(booking.status)) {
    throw new AppError(
      `Cannot initiate checkout for a reservation with status "${booking.status}"`,
      400
    );
  }

  if (booking.status !== 'pending') {
    throw new AppError(
      `Only reservations in "pending" status are eligible for checkout (current status: "${booking.status}")`,
      400
    );
  }

  // Check if reservation hold has expired (15-minute deadline)
  if (isBookingHoldExpired(booking)) {
    throw new AppError('Reservation hold has expired. Please create a new booking.', 400);
  }

  // 5. Guard against overwriting an existing completed payment
  const existingCompleted = await Payment.findOne({
    booking: booking._id,
    status: 'completed'
  });
  if (existingCompleted) {
    throw new AppError('A completed payment already exists for this booking', 409);
  }

  // Execute checkout-session creation within atomic per-booking lock
  return await withCheckoutLock(booking._id, async () => {
    // Re-verify booking status and hold expiration under the lock
    const lockedBooking = await Booking.findById(booking._id);
    if (!lockedBooking) {
      throw new AppError('Booking not found', 404);
    }
    if (lockedBooking.status === 'confirmed') {
      throw new AppError('This booking is already confirmed and paid', 400);
    }
    if (lockedBooking.status === 'cancelled' || isBookingHoldExpired(lockedBooking)) {
      throw new AppError('Reservation hold has expired. Please create a new booking.', 400);
    }
    if (lockedBooking.status !== 'pending') {
      throw new AppError(
        `Only reservations in "pending" status are eligible for checkout (current status: "${lockedBooking.status}")`,
        400
      );
    }

    // Re-check completed payment under the lock
    const lockedCompleted = await Payment.findOne({
      booking: booking._id,
      status: 'completed'
    });
    if (lockedCompleted) {
      throw new AppError('A completed payment already exists for this booking', 409);
    }

    // 6. Active Session Deduplication: Reuse existing pending session if one already exists
    const existingPending = await Payment.findOne({
      booking: booking._id,
      status: 'pending'
    });
    if (existingPending) {
      const clientSecret = existingPending.metadata?.get('clientSecret') || '';
      return {
        paymentId: existingPending._id,
        bookingId: booking._id,
        transactionId: existingPending.transactionId,
        clientSecret,
        amount: existingPending.amount,
        currency: existingPending.currency,
        status: existingPending.status, // 'pending'
        provider: existingPending.provider,
        reusedExistingSession: true
      };
    }

    // 7. Derive trusted amount and currency from server-side price snapshot
    const amount = booking.totalAmount;
    const currency = (booking.currency || 'USD').toUpperCase();

    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      throw new AppError('Booking has an invalid total amount for payment processing', 500);
    }

    // 8. Select Payment Provider Adapter
    const provider = getPaymentProvider(requestedProvider);

    // 9. Call Provider through standard contract
    const intentResult = await provider.createIntent({
      amount,
      currency,
      bookingId: booking._id.toString(),
      customerEmail: authenticatedUser.email,
      simulation
    });

    if (!intentResult || !intentResult.success) {
      const errorMsg = intentResult?.errorMessage || 'Payment provider failed to initialize checkout intent';
      throw new AppError(errorMsg, 400);
    }

    // 10. Post-Intent Fencing Revalidation (Fix for FINDING-6.4-1):
    // Re-verify that the booking still exists, remains in 'pending' status, and its hold has not expired
    // while the external provider network call was in progress.
    const reloadedBooking = await Booking.findById(booking._id);
    const isInvalidBooking =
      !reloadedBooking ||
      reloadedBooking.status !== 'pending' ||
      isBookingHoldExpired(reloadedBooking);

    if (isInvalidBooking) {
      // Determine appropriate error reason and HTTP status code
      let errorMessage = 'Reservation hold has expired. Please create a new booking.';
      let statusCode = 400;

      if (!reloadedBooking) {
        errorMessage = 'Booking not found';
        statusCode = 404;
      } else if (reloadedBooking.status === 'cancelled') {
        const isExpired =
          reloadedBooking.cancellation?.reason?.includes('expired') ||
          isBookingHoldExpired(reloadedBooking);
        errorMessage = isExpired
          ? 'Reservation hold has expired. Please create a new booking.'
          : 'Cannot initiate checkout for a cancelled reservation';
        statusCode = 400;
      } else if (isBookingHoldExpired(reloadedBooking)) {
        errorMessage = 'Reservation hold has expired. Please create a new booking.';
        statusCode = 400;
      } else if (reloadedBooking.status !== 'pending') {
        errorMessage = `Cannot initiate checkout for a reservation with status "${reloadedBooking.status}"`;
        statusCode = 400;
      }

      // Safe handling of external payment intent
      let intentCancelled = false;
      if (typeof provider.cancelIntent === 'function') {
        try {
          const cancelResult = await provider.cancelIntent({
            transactionId: intentResult.transactionId,
            reason: errorMessage,
            simulation
          });
          intentCancelled = !!(cancelResult && cancelResult.success && cancelResult.status === 'cancelled');
        } catch (cancelErr) {
          console.error(
            `[PaymentService] Provider intent cancellation failed for transaction "${intentResult.transactionId}": ${cancelErr.message}`
          );
        }
      }

      if (!intentCancelled) {
        console.warn(
          `[PaymentService] Uncancelled payment intent "${intentResult.transactionId}" exists at provider "${provider.name}" for invalid/expired booking "${booking._id}". Preserving for reconciliation.`
        );
      }

      // Do NOT persist a Payment record and do NOT return a client secret
      throw new AppError(errorMessage, statusCode);
    }

    // 11. Persist Payment Record in MongoDB with status 'pending'
    // Defend against concurrent duplicate key race at database level
    let payment;
    try {
      payment = await Payment.create({
        booking: booking._id,
        amount,
        currency,
        provider: provider.name,
        status: 'pending', // Intentionally pending; payment collection occurs upon verified outcome
        transactionId: intentResult.transactionId,
        paymentMethod: intentResult.paymentMethod || { methodType: 'card' },
        metadata: new Map([
          ['clientSecret', intentResult.clientSecret || ''],
          ['bookingId', booking._id.toString()]
        ])
      });
    } catch (err) {
      // Check if duplicate key error occurred on the pending payment unique index
      const isDuplicatePending =
        err.code === 11000 &&
        (err.message.includes('unique_pending_booking_payment') ||
          err.message.includes('booking') ||
          (err.keyPattern && err.keyPattern.booking));

      if (isDuplicatePending) {
        // Retrieve and return the winning pending session
        const winningPending = await Payment.findOne({
          booking: booking._id,
          status: 'pending'
        });
        if (winningPending) {
          const clientSecret = winningPending.metadata?.get('clientSecret') || '';
          return {
            paymentId: winningPending._id,
            bookingId: booking._id,
            transactionId: winningPending.transactionId,
            clientSecret,
            amount: winningPending.amount,
            currency: winningPending.currency,
            status: winningPending.status,
            provider: winningPending.provider,
            reusedExistingSession: true
          };
        }
      }

      // If persistence failed with a non-duplicate error, attempt to cancel intent
      if (typeof provider.cancelIntent === 'function') {
        try {
          await provider.cancelIntent({
            transactionId: intentResult.transactionId,
            reason: 'Local payment persistence failure'
          });
        } catch (cancelErr) {
          console.error(
            `[PaymentService] Failed to cancel provider intent after local persistence error: ${cancelErr.message}`
          );
        }
      }
      throw err;
    }

    // 11. Return minimal safe checkout response
    return {
      paymentId: payment._id,
      bookingId: booking._id,
      transactionId: payment.transactionId,
      clientSecret: intentResult.clientSecret,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      provider: payment.provider,
      reusedExistingSession: false
    };
  });
};

/**
 * Safely sanitizes metadata for external presentation.
 * Strips clientSecret, provider credentials, tokens, and any sensitive or internal keys.
 *
 * @param {Map|object} metadata
 * @returns {object} Cleaned metadata object
 */
const sanitizeMetadata = (metadata) => {
  if (!metadata) return {};
  let entries;
  if (metadata instanceof Map) {
    entries = Array.from(metadata.entries());
  } else if (typeof metadata === 'object') {
    entries = Object.entries(metadata);
  } else {
    return {};
  }
  const safe = {};
  const sensitiveRegex = /secret|key|token|auth|credential|password|hash|private/i;
  for (const [k, v] of entries) {
    if (!k.startsWith('_') && !sensitiveRegex.test(k)) {
      safe[k] = v;
    }
  }
  return safe;
};

/**
 * Retrieves a single payment document by ID with ownership enforcement.
 *
 * @param {string} paymentId
 * @param {object} authenticatedUser
 * @returns {Promise<object>} Payment document populated with booking
 */
const getPaymentById = async (paymentId, authenticatedUser) => {
  if (!authenticatedUser || !authenticatedUser._id) {
    throw new AppError('Authentication is required to view payment information', 401);
  }

  validateObjectId(paymentId, 'payment');

  const payment = await Payment.findById(paymentId)
    .select('-__v')
    .populate({
      path: 'booking',
      select: 'hotel room user checkInDate checkOutDate totalAmount status guestInfo priceSnapshot',
      populate: [
        { path: 'room', select: 'roomNumber roomType basePrice' },
        { path: 'hotel', select: 'name address contact' }
      ]
    });

  if (!payment) {
    throw new AppError('Payment record not found', 404);
  }

  // Resilient ownership check
  const bookingUserId = (payment.booking?.user?._id || payment.booking?.user)?.toString();
  const isOwner = bookingUserId && bookingUserId === authenticatedUser._id.toString();
  const isAdmin = authenticatedUser.role === 'admin';

  if (!isOwner && !isAdmin) {
    throw new AppError('You do not have permission to view this payment record', 403);
  }

  const sanitizedMeta = sanitizeMetadata(payment.metadata);

  return {
    _id: payment._id,
    id: payment._id.toString(),
    booking: payment.booking,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    provider: payment.provider,
    transactionId: payment.transactionId || '',
    paymentMethod: {
      methodType: payment.paymentMethod?.methodType || 'card',
      cardBrand: payment.paymentMethod?.cardBrand || '',
      cardLast4: payment.paymentMethod?.cardLast4 || undefined
    },
    refund: payment.refund ? {
      status: payment.refund.status || 'none',
      amount: payment.refund.amount || 0,
      reason: payment.refund.reason || '',
      refundedAt: payment.refund.refundedAt || undefined
    } : undefined,
    refunds: (payment.refunds || []).map((r) => ({
      refundTransactionId: r.refundTransactionId || '',
      amount: r.amount,
      status: r.status,
      reason: r.reason || '',
      requestedAt: r.requestedAt,
      completedAt: r.completedAt
    })),
    metadata: sanitizedMeta,
    reconciliationStatus: sanitizedMeta.reconciliationStatus || (payment.metadata?.get ? payment.metadata.get('reconciliationStatus') : undefined),
    reconciliationReason: sanitizedMeta.reconciliationReason || (payment.metadata?.get ? payment.metadata.get('reconciliationReason') : undefined),
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt
  };
};


/**
 * Processes a full or partial refund for a completed payment.
 *
 * SAFETY & SECURITY GUARANTEES:
 * 1. Only completed or partially refunded payments can be refunded.
 * 2. Cumulative refunds are strictly validated and cannot exceed the captured amount.
 * 3. Strict authorization: Customer can only refund their own payment; Administrator can execute overrides.
 * 4. Stable idempotencyKey deduplication prevents duplicate submissions.
 * 5. Provider call is performed first, and database state transitions are applied only upon confirmed outcome.
 *
 * @param {object} params
 * @param {string} params.paymentId - Target Payment ObjectId
 * @param {number} [params.amount] - Refund amount (defaults to remaining refundable balance)
 * @param {string} [params.reason] - Human-readable reason
 * @param {string} [params.idempotencyKey] - Optional client/service idempotency key
 * @param {object} [params.simulation] - Optional simulation overrides
 * @param {object} authenticatedUser - req.user
 * @returns {Promise<object>} Refund execution result
 */
const processRefund = async (params, authenticatedUser) => {
  if (!authenticatedUser || !authenticatedUser._id) {
    throw new AppError('Authentication is required to issue a refund', 401);
  }

  const { paymentId, amount, reason, idempotencyKey, simulation } = params;
  validateObjectId(paymentId, 'payment');

  return await withPaymentLock(paymentId, async () => {
    const payment = await Payment.findById(paymentId).populate('booking');
    if (!payment) {
      throw new AppError('Payment record not found', 404);
    }

    // Authorization check
    const bookingUserId = (payment.booking?.user?._id || payment.booking?.user)?.toString();
    const isOwner = bookingUserId && bookingUserId === authenticatedUser._id.toString();
    const isAdmin = authenticatedUser.role === 'admin';

    if (!isOwner && !isAdmin) {
      throw new AppError('You do not have permission to refund this payment', 403);
    }

    // 1. Derive stable effective idempotency key (client-supplied or deterministically generated)
    const effectiveIdempotencyKey = idempotencyKey
      ? String(idempotencyKey).trim()
      : `ref_idem_${payment._id}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

    // 2. Idempotency check against existing refund records
    const existing = (payment.refunds || []).find((r) => r.idempotencyKey === effectiveIdempotencyKey);
    if (existing) {
      if (existing.status === 'completed') {
        return {
          success: true,
          idempotent: true,
          paymentId: payment._id,
          refundTransactionId: existing.refundTransactionId,
          amount: existing.amount,
          status: payment.status,
          totalRefunded: payment.refund?.amount || existing.amount,
          remainingRefundable: Math.max(0, Math.round((payment.amount - (payment.refund?.amount || existing.amount)) * 100) / 100),
          isFullRefund: payment.status === 'refunded',
          message: 'Refund was already processed with this idempotency key'
        };
      }
      const pendingAgeMs = existing.requestedAt ? (Date.now() - new Date(existing.requestedAt).getTime()) : 0;
      if (existing.status === 'pending' && pendingAgeMs < 15000) {
        throw new AppError('A refund with this idempotency key is already in progress', 409);
      }
    }

    // 3. State eligibility check (for new or retried non-completed refund requests)
    if (payment.status !== 'completed' && payment.status !== 'partially_refunded') {
      throw new AppError(
        `Cannot refund payment with status "${payment.status}". Only completed or partially refunded payments are eligible.`,
        400
      );
    }

    // 4. Calculate already completed refund amount
    const alreadyRefunded = (payment.refund && typeof payment.refund.amount === 'number')
      ? payment.refund.amount
      : 0;

    // 4. Calculate active pending reservations in database to prevent concurrent over-refunding
    const nowMs = Date.now();
    const activePendingEntries = (payment.refunds || []).filter((r) => {
      if (r.status !== 'pending') return false;
      if (existing && String(r._id) === String(existing._id)) return false; // exclude current retry entry
      const ageMs = r.requestedAt ? (nowMs - new Date(r.requestedAt).getTime()) : 0;
      return ageMs < 60000; // active within last 60 seconds
    });
    const reservedPendingAmount = activePendingEntries.reduce((sum, r) => sum + (r.amount || 0), 0);

    const remainingRefundable = Math.max(
      0,
      Math.round((payment.amount - alreadyRefunded - reservedPendingAmount) * 100) / 100
    );

    if (remainingRefundable <= 0) {
      throw new AppError('Payment has already been fully refunded', 400);
    }

    const refundAmount = (amount !== undefined && amount !== null) ? amount : remainingRefundable;

    if (typeof refundAmount !== 'number' || !Number.isFinite(refundAmount) || refundAmount <= 0) {
      throw new AppError('Refund amount must be a finite positive number', 400);
    }

    if (refundAmount > remainingRefundable) {
      throw new AppError(
        `Refund amount (${refundAmount}) exceeds remaining refundable amount (${remainingRefundable})`,
        400
      );
    }

    // 5. Reserve refund amount in database before calling external provider
    const mongoose = require('mongoose');
    const pendingRefundId = (existing && existing.status !== 'completed') ? existing._id : new mongoose.Types.ObjectId();
    if (existing && existing.status !== 'completed') {
      await Payment.updateOne(
        { _id: payment._id, 'refunds._id': pendingRefundId },
        {
          $set: {
            'refunds.$.requestedAt': new Date(),
            'refunds.$.amount': refundAmount,
            'refunds.$.status': 'pending',
            'refunds.$.reason': reason || '',
            'refunds.$.errorMessage': ''
          }
        }
      );
    } else {
      await Payment.findByIdAndUpdate(payment._id, {
        $push: {
          refunds: {
            _id: pendingRefundId,
            refundTransactionId: '',
            amount: refundAmount,
            status: 'pending',
            reason: reason || '',
            idempotencyKey: effectiveIdempotencyKey,
            requestedAt: new Date()
          }
        }
      });
    }

    // 6. Call provider adapter
    const provider = getPaymentProvider(payment.provider);
    let refundResult;
    try {
      refundResult = await provider.refund({
        transactionId: payment.transactionId,
        amount: refundAmount,
        originalAmount: payment.amount,
        currency: payment.currency,
        reason,
        simulation,
        idempotencyKey: effectiveIdempotencyKey
      });
    } catch (providerErr) {
      await Payment.updateOne(
        { _id: payment._id, 'refunds._id': pendingRefundId },
        {
          $set: {
            'refunds.$.status': 'failed',
            'refunds.$.errorMessage': providerErr.message || 'Payment provider refund call threw an error',
            'metadata.reconciliationStatus': 'refund_failed',
            'metadata.reconciliationReason': providerErr.message || 'Payment provider refund call threw an error'
          }
        }
      );

      throw new AppError(providerErr.message || 'Payment provider failed to process refund', 400);
    }

    if (!refundResult || !refundResult.success) {
      const errMessage = refundResult?.errorMessage || 'Payment provider refund call failed';
      await Payment.updateOne(
        { _id: payment._id, 'refunds._id': pendingRefundId },
        {
          $set: {
            'refunds.$.status': 'failed',
            'refunds.$.errorMessage': errMessage,
            'metadata.reconciliationStatus': 'refund_failed',
            'metadata.reconciliationReason': errMessage
          }
        }
      );

      throw new AppError(errMessage, 400);
    }

    // 7. Provider confirmed refund: execute atomic database update
    const newTotalRefunded = Math.round((alreadyRefunded + refundAmount) * 100) / 100;
    const isFullRefund = newTotalRefunded >= payment.amount;
    const newStatus = isFullRefund ? 'refunded' : 'partially_refunded';
    const refundTxnId = refundResult.refundTransactionId || `ref_${Date.now()}`;
    const completedAt = refundResult.refundedAt || new Date();

    await Payment.findOneAndUpdate(
      {
        _id: payment._id,
        'refunds._id': pendingRefundId
      },
      {
        $set: {
          status: newStatus,
          'refund.status': 'completed',
          'refund.amount': newTotalRefunded,
          'refund.refundTransactionId': refundTxnId,
          'refund.refundedAt': completedAt,
          'refund.reason': reason || (isFullRefund ? 'Full refund' : 'Partial refund'),
          'refunds.$.status': 'completed',
          'refunds.$.refundTransactionId': refundTxnId,
          'refunds.$.completedAt': completedAt,
          'metadata.requiresRefund': isFullRefund ? 'false' : 'true',
          'metadata.reconciliationStatus': isFullRefund ? 'refund_confirmed' : 'partially_refunded'
        }
      },
      { returnDocument: 'after' }
    );

    return {
      success: true,
      idempotent: !!refundResult.idempotent,
      paymentId: payment._id,
      refundTransactionId: refundTxnId,
      amount: refundAmount,
      status: newStatus,
      totalRefunded: newTotalRefunded,
      remainingRefundable: Math.max(0, Math.round((payment.amount - newTotalRefunded) * 100) / 100),
      isFullRefund,
      message: isFullRefund ? 'Payment fully refunded successfully' : 'Partial refund processed successfully'
    };
  });
};

/**
 * Lists payment reconciliation anomalies and refund requirements (Admin only).
 *
 * @param {object} query
 * @param {object} authenticatedUser - req.user
 * @returns {Promise<object>} { reconciliations, pagination }
 */
const listReconciliations = async (query = {}, authenticatedUser) => {
  if (!authenticatedUser || authenticatedUser.role !== 'admin') {
    throw new AppError('Administrative access is required to view reconciliation records', 403);
  }

  const { page, limit, skip } = parsePagination(query);

  const filter = {
    $or: [
      { 'metadata.requiresRefund': 'true' },
      { 'metadata.reconciliationStatus': { $exists: true, $ne: '' } },
      { 'metadata.reconciliationReason': { $exists: true, $ne: '' } }
    ]
  };

  if (query.provider) {
    filter.provider = String(query.provider).toLowerCase();
  }

  if (query.status) {
    filter.status = String(query.status).toLowerCase();
  }

  const [records, total] = await Promise.all([
    Payment.find(filter)
      .select('-__v')
      .populate({
        path: 'booking',
        select: 'hotel room user checkInDate checkOutDate totalAmount status guestInfo'
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Payment.countDocuments(filter)
  ]);

  const sanitizedRecords = records.map((record) => {
    const meta = sanitizeMetadata(record.metadata);
    return {
      _id: record._id,
      id: record._id.toString(),
      booking: record.booking,
      amount: record.amount,
      currency: record.currency,
      status: record.status,
      provider: record.provider,
      transactionId: record.transactionId || '',
      paymentMethod: {
        methodType: record.paymentMethod?.methodType || 'card',
        cardBrand: record.paymentMethod?.cardBrand || '',
        cardLast4: record.paymentMethod?.cardLast4 || undefined
      },
      refund: record.refund ? {
        status: record.refund.status || 'none',
        amount: record.refund.amount || 0,
        reason: record.refund.reason || '',
        refundedAt: record.refund.refundedAt || undefined
      } : undefined,
      metadata: meta,
      reconciliationStatus: meta.reconciliationStatus || undefined,
      reconciliationReason: meta.reconciliationReason || undefined,
      requiresRefund: meta.requiresRefund === 'true',
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  });

  return {
    reconciliations: sanitizedRecords,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  };
};

/**
 * Executes the business logic for a verified payment gateway webhook event.
 *
 * @param {object} params
 * @param {object} params.provider
 * @param {object} params.verification
 * @returns {Promise<object>} Outcome response
 */
const executeWebhookBusinessLogic = async ({ provider, verification }) => {
  const { transactionId, amount, currency, status: outcomeStatus, failureReason } = verification;

  if (!transactionId || typeof transactionId !== 'string') {
    throw new AppError('Transaction ID is required in webhook payload', 400);
  }

  // Trigger simulation hook if registered on provider or in verification
  if (provider && typeof provider.executeWebhookHook === 'function' && verification.eventId) {
    await provider.executeWebhookHook(verification.eventId, { provider, verification });
  }
  if (verification?.simulation?.beforeComplete && typeof verification.simulation.beforeComplete === 'function') {
    await verification.simulation.beforeComplete({ provider, verification });
  }
  if (verification?.simulation?.simulateFailure) {
    throw new AppError('Simulated webhook business logic failure', 500);
  }

  // 1. Find corresponding Payment in MongoDB
  const payment = await Payment.findOne({ transactionId });
  if (!payment) {
    // Unmapped transaction: log operational warning without crashing
    console.warn(
      `[Webhook Warning] Unmapped transactionId "${transactionId}" received for event "${verification.eventId}". No payment document exists.`
    );
    return {
      success: false,
      unmapped: true,
      statusCode: 404,
      message: `Payment record not found for provider transaction ID: ${transactionId}`
    };
  }

  // 2. Verify Provider Identity
  if (payment.provider !== provider.name) {
    throw new AppError(
      `Payment provider mismatch: payment was created with "${payment.provider}", but webhook arrived from "${provider.name}"`,
      400
    );
  }

  // 3. Verify Amount & Currency if supplied by provider
  if (amount !== undefined && amount !== null) {
    if (Number(payment.amount) !== Number(amount)) {
      throw new AppError(
        `Payment amount mismatch: expected ${payment.amount}, received ${amount}`,
        400
      );
    }
  }

  if (currency !== undefined && currency !== null) {
    if (String(payment.currency).toUpperCase() !== String(currency).toUpperCase()) {
      throw new AppError(
        `Payment currency mismatch: expected ${payment.currency}, received ${currency}`,
        400
      );
    }
  }

  // 4. Handle Payment & Booking State Transitions
  if (outcomeStatus === 'failed' || verification.eventType === 'payment_intent.payment_failed') {
    if (payment.status === 'completed') {
      throw new AppError('Cannot mark a completed payment as failed', 400);
    }

    if (payment.status === 'failed') {
      return {
        success: true,
        paymentAlreadyFailed: true,
        message: 'Payment was already marked failed'
      };
    }

    // Transition pending payment to failed
    payment.status = 'failed';
    payment.metadata.set('failureReason', failureReason || 'Simulated payment failure from gateway');
    await payment.save();

    return {
      success: true,
      status: 'failed',
      paymentId: payment._id,
      message: 'Payment marked as failed'
    };
  }

  if (outcomeStatus === 'completed' || verification.eventType === 'payment_intent.succeeded') {
    // Check if previously marked failed
    if (payment.status === 'failed') {
      throw new AppError('Cannot transition a failed payment to completed', 400);
    }

    // Check if payment is already completed
    if (payment.status === 'completed') {
      // 1. Load the latest booking associated with that Payment
      const booking = await Booking.findById(payment.booking);

      // Handle missing booking safely without inventing booking data
      if (!booking) {
        if (payment.metadata?.get('requiresRefund') !== 'true') {
          await Payment.findOneAndUpdate(
            { _id: payment._id, status: 'completed' },
            {
              $set: {
                'metadata.requiresRefund': 'true',
                'metadata.reconciliationReason': 'Associated booking not found in database'
              }
            }
          );
        }
        return {
          success: true,
          paymentAlreadyCompleted: true,
          paymentId: payment._id,
          bookingConfirmed: false,
          requiresRefund: true,
          message: 'Payment was already completed but associated booking record was not found'
        };
      }

      // 2. If booking is still 'pending'
      if (booking.status === 'pending') {
        const isHoldExpired = isBookingHoldExpired(booking);

        if (!isHoldExpired) {
          // Hold remains valid: preserve safe confirmation behavior with conditional database update
          const updatedBooking = await Booking.findOneAndUpdate(
            { _id: booking._id, status: 'pending' },
            { $set: { status: 'confirmed' } },
            { returnDocument: 'after' }
          );

          if (updatedBooking) {
            return {
              success: true,
              paymentAlreadyCompleted: true,
              paymentId: payment._id,
              bookingConfirmed: true,
              requiresRefund: false,
              message: 'Payment was already completed; recovered pending booking to confirmed'
            };
          }

          // If conditional update returned null, booking status was changed concurrently.
          const reloadedBooking = await Booking.findById(booking._id);
          if (reloadedBooking && reloadedBooking.status === 'confirmed') {
            return {
              success: true,
              paymentAlreadyCompleted: true,
              paymentId: payment._id,
              bookingConfirmed: true,
              requiresRefund: false,
              message: 'Payment was already completed; booking confirmed'
            };
          }
        } else {
          // Booking hold has expired: do NOT confirm booking!
          // Conditionally transition the expired pending booking to cancelled if not already transitioned
          await Booking.findOneAndUpdate(
            { _id: booking._id, status: 'pending' },
            {
              $set: {
                status: 'cancelled',
                'cancellation.cancelledAt': new Date(),
                'cancellation.reason': 'Reservation hold expired (15-minute timeout)'
              }
            }
          );
        }
      }

      // Check current booking state
      const currentBooking = (booking.status === 'pending')
        ? await Booking.findById(booking._id)
        : booking;

      // 3. If the booking is 'cancelled', ensure Payment has requiresRefund='true' and a clear reconciliation reason
      if (currentBooking && currentBooking.status === 'cancelled') {
        const isHoldExpired =
          currentBooking.cancellation?.reason?.includes('expired') ||
          isBookingHoldExpired(currentBooking);

        let reconciliationReason = payment.metadata?.get('reconciliationReason');
        if (
          !reconciliationReason ||
          (!reconciliationReason.toLowerCase().includes('cancel') &&
            !reconciliationReason.toLowerCase().includes('expire'))
        ) {
          reconciliationReason = isHoldExpired
            ? 'Payment received after booking hold expired'
            : 'Payment completed for a cancelled booking';
        }

        const updateSet = {
          'metadata.requiresRefund': 'true',
          'metadata.reconciliationStatus': 'refund_eligible',
          'metadata.reconciliationReason': reconciliationReason
        };

        if (currentBooking.cancellation?.cancelledAt && !payment.metadata?.get('expiredAt')) {
          updateSet['metadata.expiredAt'] = new Date(currentBooking.cancellation.cancelledAt).toISOString();
        }

        await Payment.findOneAndUpdate(
          { _id: payment._id, status: 'completed' },
          { $set: updateSet }
        );

        return {
          success: true,
          paymentAlreadyCompleted: true,
          paymentId: payment._id,
          bookingConfirmed: false,
          requiresRefund: true,
          message: 'Payment was already completed for cancelled booking; reconciliation metadata recorded'
        };
      }

      // If booking is confirmed or checked_in/checked_out, return without flagging refund
      return {
        success: true,
        paymentAlreadyCompleted: true,
        paymentId: payment._id,
        bookingConfirmed: currentBooking?.status === 'confirmed',
        requiresRefund: false,
        message: 'Payment was already completed'
      };
    }

    // Payment is in 'pending' status: load booking to evaluate eligibility
    const booking = await Booking.findById(payment.booking);
    if (!booking) {
      payment.status = 'completed';
      payment.metadata.set('reconciliationReason', 'Associated booking not found in database');
      payment.metadata.set('requiresRefund', 'true');
      await payment.save();

      return {
        success: true,
        bookingConfirmed: false,
        requiresRefund: true,
        message: 'Payment completed but associated booking record was not found'
      };
    }

    // If booking was cancelled before payment success: NEVER transition cancelled booking back to confirmed!
    if (booking.status === 'cancelled') {
      payment.status = 'completed';
      const isHoldExpired = booking.cancellation?.reason?.includes('expired') || isBookingHoldExpired(booking);
      payment.metadata.set(
        'reconciliationReason',
        isHoldExpired
          ? 'Payment received after booking hold expired'
          : 'Payment received after booking was cancelled'
      );
      payment.metadata.set('requiresRefund', 'true');
      payment.metadata.set('reconciliationStatus', 'refund_eligible');
      if (booking.cancellation?.cancelledAt) {
        payment.metadata.set('expiredAt', new Date(booking.cancellation.cancelledAt).toISOString());
      }
      await payment.save();

      return {
        success: true,
        bookingConfirmed: false,
        requiresRefund: true,
        paymentId: payment._id,
        message: 'Payment completed for cancelled booking; flagged for refund reconciliation'
      };
    }

    // If booking is already checked_in or checked_out: do not change booking status
    if (['checked_in', 'checked_out'].includes(booking.status)) {
      payment.status = 'completed';
      payment.metadata.set(
        'reconciliationReason',
        `Payment completed while booking in terminal/ineligible status "${booking.status}"`
      );
      await payment.save();

      return {
        success: true,
        bookingConfirmed: false,
        paymentId: payment._id,
        message: `Payment completed; booking is in status "${booking.status}"`
      };
    }

    // If booking is already confirmed
    if (booking.status === 'confirmed') {
      payment.status = 'completed';
      await payment.save();

      return {
        success: true,
        bookingConfirmed: true,
        paymentId: payment._id,
        message: 'Payment completed'
      };
    }

    // Booking is pending: update payment first, then update booking conditionally
    payment.status = 'completed';
    await payment.save();

    // Conditionally confirm booking
    const updatedBooking = await Booking.findOneAndUpdate(
      { _id: booking._id, status: 'pending' },
      { $set: { status: 'confirmed' } },
      { returnDocument: 'after' }
    );

    if (!updatedBooking) {
      // Booking status changed concurrently right as payment was completing
      const latestBooking = await Booking.findById(booking._id);
      if (latestBooking && latestBooking.status === 'cancelled') {
        const isHoldExpired = latestBooking.cancellation?.reason?.includes('expired') || isBookingHoldExpired(latestBooking);
        payment.metadata.set(
          'reconciliationReason',
          isHoldExpired
            ? 'Payment received after booking hold expired'
            : 'Booking was cancelled concurrently during payment confirmation'
        );
        payment.metadata.set('requiresRefund', 'true');
        payment.metadata.set('reconciliationStatus', 'refund_eligible');
        if (latestBooking.cancellation?.cancelledAt) {
          payment.metadata.set('expiredAt', new Date(latestBooking.cancellation.cancelledAt).toISOString());
        }
        await payment.save();

        return {
          success: true,
          bookingConfirmed: false,
          requiresRefund: true,
          paymentId: payment._id,
          message: 'Payment completed; booking was cancelled concurrently'
        };
      }
    }

    return {
      success: true,
      bookingConfirmed: true,
      paymentId: payment._id,
      bookingId: booking._id,
      message: 'Payment completed and booking confirmed successfully'
    };
  }

  if (outcomeStatus === 'refunded' || verification.eventType === 'charge.refunded' || verification.eventType === 'payment_intent.refunded') {
    const rawTxnId = verification.rawEvent?.id || verification.eventId || payment.refund?.refundTransactionId || '';
    const refundAmount = (amount !== undefined && amount !== null)
      ? Number(amount)
      : payment.amount;

    const newTotalRefunded = Math.round(refundAmount * 100) / 100;
    const isFullRefund = newTotalRefunded >= payment.amount;
    const newStatus = isFullRefund ? 'refunded' : 'partially_refunded';

    // Check for duplicate webhook delivery (already refunded to this level and matching transaction)
    const existingRefundMatch = (payment.refunds || []).find(
      (r) => r.refundTransactionId && r.refundTransactionId === rawTxnId && r.status === 'completed'
    );
    if ((payment.status === 'refunded' && isFullRefund) || (existingRefundMatch && payment.refund?.amount >= newTotalRefunded)) {
      return {
        success: true,
        idempotent: true,
        alreadyRefunded: true,
        paymentId: payment._id,
        status: payment.status,
        amountRefunded: payment.refund?.amount || newTotalRefunded,
        message: 'Payment refund webhook event was already reconciled'
      };
    }

    // Reconcile with existing pending refund entry if present
    const pendingMatch = (payment.refunds || []).find(
      (r) => r.status === 'pending' || (r.refundTransactionId && r.refundTransactionId === rawTxnId)
    );

    if (pendingMatch) {
      pendingMatch.status = 'completed';
      pendingMatch.refundTransactionId = rawTxnId || pendingMatch.refundTransactionId || `ref_wh_${Date.now()}`;
      pendingMatch.completedAt = new Date();
      if (!pendingMatch.amount) pendingMatch.amount = refundAmount;
    } else {
      if (!payment.refunds) payment.refunds = [];
      payment.refunds.push({
        refundTransactionId: rawTxnId || `ref_wh_${Date.now()}`,
        amount: refundAmount,
        status: 'completed',
        reason: 'Refund confirmed via gateway webhook',
        requestedAt: new Date(),
        completedAt: new Date()
      });
    }

    payment.status = newStatus;
    if (!payment.refund) payment.refund = {};
    payment.refund.status = 'completed';
    payment.refund.amount = newTotalRefunded;
    payment.refund.refundTransactionId = rawTxnId || payment.refund.refundTransactionId;
    payment.refund.refundedAt = new Date();
    payment.metadata.set('requiresRefund', isFullRefund ? 'false' : 'true');
    payment.metadata.set('reconciliationStatus', isFullRefund ? 'refund_confirmed' : 'partially_refunded');
    await payment.save();

    return {
      success: true,
      status: newStatus,
      paymentId: payment._id,
      amountRefunded: newTotalRefunded,
      isFullRefund,
      message: `Payment updated to status "${newStatus}" via refund webhook`
    };
  }

  throw new AppError(`Unhandled payment outcome status "${outcomeStatus}"`, 400);
};

/**
 * Processes incoming payment gateway webhook events.
 *
 * @param {object} params
 * @param {string} [params.providerName='mock']
 * @param {Buffer|string} params.rawBody
 * @param {string} [params.signature]
 * @param {object} [params.headers]
 * @returns {Promise<object>}
 */
const processWebhook = async ({ providerName = 'mock', rawBody, signature, headers = {}, options = {} }) => {
  const provider = getPaymentProvider(providerName || 'mock');

  if (!rawBody) {
    throw new AppError('Raw webhook body is required for signature verification', 400);
  }

  const verification = await provider.verifyWebhook({ rawBody, signature, headers });
  if (!verification || !verification.verified) {
    throw new AppError(verification?.errorMessage || 'Invalid webhook signature', 400);
  }

  // Supported event types
  const supportedEventTypes = [
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'charge.refunded',
    'payment_intent.refunded'
  ];
  if (!supportedEventTypes.includes(verification.eventType)) {
    return {
      success: true,
      ignored: true,
      message: `Webhook event "${verification.eventType}" acknowledged without state changes`
    };
  }

  const eventId = String(
    verification.eventId ||
      verification.id ||
      `evt_${verification.transactionId || Date.now()}`
  );

  const lockToken = crypto.randomUUID();
  const evaluationTime = (options.now instanceof Date && !isNaN(options.now.getTime()))
    ? options.now
    : new Date();

  // Extract stale timeout and poll settings from options or headers (for testing)
  const headerStaleMs = headers['x-stale-timeout-ms'] ? parseInt(headers['x-stale-timeout-ms'], 10) : null;
  const staleTimeoutMs = (headerStaleMs && headerStaleMs > 0)
    ? headerStaleMs
    : (typeof options.staleTimeoutMs === 'number' && options.staleTimeoutMs > 0)
      ? options.staleTimeoutMs
      : DEFAULT_WEBHOOK_STALE_TIMEOUT_MS;

  const staleThreshold = new Date(evaluationTime.getTime() - staleTimeoutMs);

  const headerPollAttempts = headers['x-max-poll-attempts'] !== undefined ? parseInt(headers['x-max-poll-attempts'], 10) : null;
  const maxPollAttempts = (headerPollAttempts !== null && !isNaN(headerPollAttempts))
    ? headerPollAttempts
    : (typeof options.maxPollAttempts === 'number')
      ? options.maxPollAttempts
      : DEFAULT_WEBHOOK_MAX_POLL_ATTEMPTS;

  const pollIntervalMs = (typeof options.pollIntervalMs === 'number' && options.pollIntervalMs > 0)
    ? options.pollIntervalMs
    : DEFAULT_WEBHOOK_POLL_INTERVAL_MS;

  let eventRecord = null;
  let currentLockToken = lockToken;

  try {
    eventRecord = await WebhookEvent.create({
      provider: provider.name,
      eventId,
      eventType: verification.eventType,
      transactionId: verification.transactionId || '',
      status: 'processing',
      lockToken,
      lockedAt: evaluationTime
    });
  } catch (err) {
    if (err.code === 11000) {
      const existing = await WebhookEvent.findOne({ provider: provider.name, eventId });
      if (!existing) {
        throw err;
      }

      // Case 1: Already completed -> return idempotent duplicate
      if (existing.status === 'completed') {
        return {
          success: true,
          idempotent: true,
          message: 'Webhook event already processed (idempotent duplicate)'
        };
      }

      // Case 2: Previously failed -> atomically reclaim for retry
      if (existing.status === 'failed') {
        const reclaimedFailed = await WebhookEvent.findOneAndUpdate(
          {
            provider: provider.name,
            eventId,
            status: 'failed'
          },
          {
            $set: {
              status: 'processing',
              lockToken,
              lockedAt: evaluationTime,
              error: ''
            }
          },
          { returnDocument: 'after' }
        );

        if (reclaimedFailed) {
          eventRecord = reclaimedFailed;
          currentLockToken = lockToken;
        }
      }

      // Case 3: In 'processing' status - check if stale and atomically reclaim
      if (!eventRecord) {
        const reclaimedStale = await WebhookEvent.findOneAndUpdate(
          {
            provider: provider.name,
            eventId,
            status: 'processing',
            $or: [
              { lockedAt: { $lte: staleThreshold } },
              {
                lockedAt: { $exists: false },
                $or: [
                  { updatedAt: { $lte: staleThreshold } },
                  { createdAt: { $lte: staleThreshold } }
                ]
              }
            ]
          },
          {
            $set: {
              status: 'processing',
              lockToken,
              lockedAt: evaluationTime,
              error: ''
            }
          },
          { returnDocument: 'after' }
        );

        if (reclaimedStale) {
          eventRecord = reclaimedStale;
          currentLockToken = lockToken;
        }
      }

      // If not yet claimed, it is fresh and actively in-flight.
      // Poll briefly to check if concurrent handler finishes.
      if (!eventRecord) {
        for (let i = 0; i < maxPollAttempts; i++) {
          await new Promise((r) => setTimeout(r, pollIntervalMs));
          const refreshed = await WebhookEvent.findOne({ provider: provider.name, eventId });

          if (refreshed && refreshed.status === 'completed') {
            return {
              success: true,
              idempotent: true,
              message: 'Webhook event completed by concurrent handler'
            };
          }

          if (refreshed && refreshed.status === 'failed') {
            const reclaimedFailed = await WebhookEvent.findOneAndUpdate(
              {
                provider: provider.name,
                eventId,
                status: 'failed'
              },
              {
                $set: {
                  status: 'processing',
                  lockToken,
                  lockedAt: new Date(),
                  error: ''
                }
              },
              { returnDocument: 'after' }
            );

            if (reclaimedFailed) {
              eventRecord = reclaimedFailed;
              currentLockToken = lockToken;
              break;
            }
          }

          // Check if it became stale during polling
          const currentCheckThreshold = new Date(Date.now() - staleTimeoutMs);
          const reclaimedDuringPoll = await WebhookEvent.findOneAndUpdate(
            {
              provider: provider.name,
              eventId,
              status: 'processing',
              $or: [
                { lockedAt: { $lte: currentCheckThreshold } },
                {
                  lockedAt: { $exists: false },
                  $or: [
                    { updatedAt: { $lte: currentCheckThreshold } },
                    { createdAt: { $lte: currentCheckThreshold } }
                  ]
                }
              ]
            },
            {
              $set: {
                status: 'processing',
                lockToken,
                lockedAt: new Date(),
                error: ''
              }
            },
            { returnDocument: 'after' }
          );

          if (reclaimedDuringPoll) {
            eventRecord = reclaimedDuringPoll;
            currentLockToken = lockToken;
            break;
          }
        }
      }

      // If still not claimed, the event is actively being processed by another worker.
      // Do NOT return success; throw 409 Conflict so the provider knows processing is still in flight.
      if (!eventRecord) {
        throw new AppError(
          'Webhook event is currently being processed by another worker. Please retry.',
          409
        );
      }
    } else {
      throw err;
    }
  }

  // Heartbeat lease renewal:
  // If executeWebhookBusinessLogic takes substantial time, refresh lockedAt periodically (every 5s)
  // so that another concurrent worker does NOT falsely consider this active handler dead and steal the lease.
  let heartbeatTimer = null;
  if (eventRecord && currentLockToken) {
    heartbeatTimer = setInterval(async () => {
      try {
        await WebhookEvent.updateOne(
          {
            _id: eventRecord._id,
            lockToken: currentLockToken,
            status: 'processing'
          },
          {
            $set: {
              lockedAt: new Date()
            }
          }
        );
      } catch (hbErr) {
        // Silently ignore intermittent heartbeat update errors
      }
    }, 5000);
    if (heartbeatTimer.unref) {
      heartbeatTimer.unref();
    }
  }

  try {
    const outcome = await executeWebhookBusinessLogic({
      provider,
      verification
    });

    // Ownership Fencing on Completion:
    // Only update if current handler still owns the lockToken!
    const completionResult = await WebhookEvent.updateOne(
      {
        _id: eventRecord._id,
        lockToken: currentLockToken,
        status: 'processing'
      },
      {
        $set: {
          status: 'completed',
          processedAt: new Date()
        }
      }
    );

    if (completionResult.matchedCount === 0) {
      console.warn(
        `[WebhookEvent] Ownership lost for event "${eventId}". Completion update fenced out by newer owner.`
      );
    }

    return outcome;
  } catch (error) {
    // Ownership Fencing on Failure:
    // Only mark failed if current handler still owns the lockToken!
    if (eventRecord && currentLockToken) {
      await WebhookEvent.updateOne(
        {
          _id: eventRecord._id,
          lockToken: currentLockToken,
          status: 'processing'
        },
        {
          $set: {
            status: 'failed',
            error: error.message
          }
        }
      );
    }
    throw error;
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
  }
};

/**
 * Retrieves the latest relevant payment attempt and status summary for a booking.
 *
 * SAFETY & AUTHORIZATION GUARANTEES:
 * 1. Requires valid authentication.
 * 2. Strict ownership: User must be booking owner or admin.
 * 3. Read-only: Does NOT alter booking or payment state.
 * 4. Zero Sensitive Leakage: Completely strips internal clientSecret, locks, credentials, and gateway signatures.
 * 5. Deterministic selection: If multiple payments exist, prioritizes settled (completed/refunded),
 *    then active pending, then latest chronological attempt.
 *
 * @param {string} bookingId
 * @param {object} authenticatedUser - req.user
 * @returns {Promise<object>} Payment summary object
 */
const getPaymentByBookingId = async (bookingId, authenticatedUser) => {
  if (!authenticatedUser || !authenticatedUser._id) {
    throw new AppError('Authentication is required to view payment information', 401);
  }

  validateObjectId(bookingId, 'booking');

  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw new AppError('Booking not found', 404);
  }

  // Authorization check: User must be booking owner or an admin
  const bookingUserId = (booking.user?._id || booking.user)?.toString();
  const isOwner = bookingUserId && bookingUserId === authenticatedUser._id.toString();
  const isAdmin = authenticatedUser.role === 'admin';

  if (!isOwner && !isAdmin) {
    throw new AppError('You do not have permission to view payment information for this booking', 403);
  }

  // Query all payments associated with this booking, newest first
  const payments = await Payment.find({ booking: booking._id })
    .sort({ createdAt: -1, _id: -1 })
    .lean();

  if (!payments || payments.length === 0) {
    return {
      bookingId: booking._id,
      hasPayment: false,
      hasActivePendingSession: false,
      payment: null,
      totalAttempts: 0
    };
  }

  // Identify the most relevant payment attempt:
  // 1. Settled payment (completed, refunded, partially_refunded) takes top priority
  // 2. Currently active pending session takes second priority
  // 3. Otherwise, latest chronological attempt (e.g. failed)
  const settledPayment = payments.find((p) =>
    ['completed', 'partially_refunded', 'refunded'].includes(p.status)
  );
  const pendingPayment = payments.find((p) => p.status === 'pending');
  const relevantPayment = settledPayment || pendingPayment || payments[0];

  // Sanitize payment details: strictly exclude metadata (clientSecret), credentials, and internal fields
  const sanitizedPayment = {
    _id: relevantPayment._id,
    booking: relevantPayment.booking,
    amount: relevantPayment.amount,
    currency: relevantPayment.currency,
    status: relevantPayment.status,
    provider: relevantPayment.provider,
    transactionId: relevantPayment.transactionId || '',
    paymentMethod: {
      methodType: relevantPayment.paymentMethod?.methodType || 'card',
      cardBrand: relevantPayment.paymentMethod?.cardBrand || '',
      cardLast4: relevantPayment.paymentMethod?.cardLast4 || undefined
    },
    refund: relevantPayment.refund ? {
      status: relevantPayment.refund.status || 'none',
      amount: relevantPayment.refund.amount || 0,
      reason: relevantPayment.refund.reason || '',
      refundedAt: relevantPayment.refund.refundedAt || undefined
    } : undefined,
    createdAt: relevantPayment.createdAt,
    updatedAt: relevantPayment.updatedAt
  };

  return {
    bookingId: booking._id,
    hasPayment: true,
    hasActivePendingSession: !!pendingPayment,
    payment: sanitizedPayment,
    totalAttempts: payments.length
  };
};

/**
 * Safely simulates a mock payment outcome for local development & testing.
 *
 * SAFETY & SECURITY GUARANTEES:
 * 1. Authentication & Ownership: Caller must own the payment's associated booking or be admin.
 * 2. Active Provider Check: Strictly rejects requests if PAYMENT_PROVIDER !== 'mock'.
 * 3. Payment Provider Check: Strictly rejects requests if payment.provider !== 'mock'.
 * 4. Outcome Allowlist: Accepts strictly 'success' or 'failure'.
 * 5. Reuses Canonical Logic: Delegates directly to `processWebhook` which exercises full
 *    WebhookEvent idempotency, atomic lease locks, hold expiration checks, late payment flagging,
 *    and state transitions. Does NOT directly mutate status or bypass safeguards.
 * 6. Idempotency: Repeated simulation requests return idempotent outcomes without duplicate updates.
 *
 * @param {string} paymentId
 * @param {object} payload - { outcome: 'success' | 'failure', failureReason?: string }
 * @param {object} authenticatedUser - req.user
 * @returns {Promise<object>} Outcome summary
 */
const simulateMockPayment = async (paymentId, payload, authenticatedUser) => {
  if (!authenticatedUser || !authenticatedUser._id) {
    throw new AppError('Authentication is required to simulate payment', 401);
  }

  validateObjectId(paymentId, 'payment');

  // Server-side provider configuration enforcement:
  // Reject when active provider is Stripe or another real provider.
  const configuredProvider = (process.env.PAYMENT_PROVIDER || 'mock').toLowerCase();
  if (configuredProvider !== 'mock') {
    throw new AppError('Mock payment simulation is disabled or unavailable for the active payment provider', 400);
  }

  // Validate simulation outcome against allowlist and block raw credentials
  const { outcome, failureReason } = validateMockSimulationInput(payload);

  // Load target Payment and associated Booking
  const payment = await Payment.findById(paymentId).populate('booking');
  if (!payment) {
    throw new AppError('Payment record not found', 404);
  }

  // Payment-level provider check: payment itself must be mock
  if (payment.provider !== 'mock') {
    throw new AppError('Mock simulation can only be performed on mock payments', 400);
  }

  // Enforce ownership: Caller must own the booking or be admin
  const bookingUserId = (payment.booking?.user?._id || payment.booking?.user)?.toString();
  const isOwner = bookingUserId && bookingUserId === authenticatedUser._id.toString();
  const isAdmin = authenticatedUser.role === 'admin';
  if (!isOwner && !isAdmin) {
    throw new AppError('You do not have permission to simulate payment for this booking', 403);
  }

  if (!payment.transactionId) {
    throw new AppError('Payment record has no associated transaction ID', 400);
  }

  // Construct canonical mock webhook event payload
  const eventType = outcome === 'success' ? 'payment_intent.succeeded' : 'payment_intent.payment_failed';
  const eventPayload = {
    id: `evt_sim_${payment._id}_${outcome}`,
    type: eventType,
    data: {
      transactionId: payment.transactionId,
      bookingId: payment.booking?._id ? payment.booking._id.toString() : payment.booking.toString(),
      amount: payment.amount,
      currency: payment.currency,
      status: outcome === 'success' ? 'completed' : 'failed',
      failureReason: outcome === 'failure' ? failureReason : undefined
    }
  };

  const rawBody = Buffer.from(JSON.stringify(eventPayload), 'utf8');

  // Route through the established, battle-tested webhook processing pipeline.
  // This preserves WebhookEvent lease locking, idempotency deduplication,
  // hold-expiration fencing, late payment reconciliation, and state machines.
  const webhookOutcome = await processWebhook({
    providerName: 'mock',
    rawBody,
    signature: 'mock_sig_valid',
    headers: {
      'x-mock-signature': 'mock_sig_valid',
      'content-type': 'application/json'
    }
  });

  // Reload authoritative records from MongoDB after webhook execution
  const updatedPayment = await Payment.findById(payment._id);
  const updatedBooking = await Booking.findById(payment.booking?._id || payment.booking);

  return {
    paymentId: updatedPayment._id,
    bookingId: updatedBooking ? updatedBooking._id : (payment.booking?._id || payment.booking),
    transactionId: updatedPayment.transactionId,
    status: updatedPayment.status,
    bookingStatus: updatedBooking ? updatedBooking.status : null,
    outcome,
    isConfirmed: updatedBooking ? updatedBooking.status === 'confirmed' : false,
    requiresRefund: updatedPayment.metadata?.get('requiresRefund') === 'true',
    reconciliationReason: updatedPayment.metadata?.get('reconciliationReason') || null,
    idempotent: !!webhookOutcome?.idempotent
  };
};

module.exports = {
  createCheckoutSession,
  getPaymentById,
  getPaymentByBookingId,
  simulateMockPayment,
  processRefund,
  listReconciliations,
  processWebhook,
  DEFAULT_WEBHOOK_STALE_TIMEOUT_MS
};
