const { PaymentProvider, assertNoForbiddenCredentials } = require('./provider.interface');
const { AppError } = require('../../middleware/error.middleware');

let idCounter = 1000;

/**
 * Deterministic Mock Payment Provider
 *
 * Simulates real payment gateway interactions locally without network calls, external SDKs,
 * or live credentials. Guarantees deterministic test outcomes for success, card decline,
 * webhooks, and partial/full refunds.
 */
class MockPaymentProvider extends PaymentProvider {
  constructor() {
    super('mock');
    this._idempotencyStore = new Map();
  }

  /**
   * Generates a predictable, distinct mock identifier.
   *
   * @param {string} prefix
   * @param {string} [customId]
   * @returns {string}
   */
  _generateIdentifier(prefix, customId) {
    if (customId && typeof customId === 'string' && customId.trim().length > 0) {
      return `${prefix}_${customId.trim()}`;
    }
    idCounter += 1;
    return `${prefix}_${idCounter}`;
  }

  /**
   * Resets internal counter and idempotency cache (useful for test isolation).
   */
  resetCounter(start = 1000) {
    idCounter = start;
    if (this._idempotencyStore) {
      this._idempotencyStore.clear();
    }
  }

  /**
   * Creates a mock payment intent or simulated checkout session.
   *
   * @param {object} params
   * @param {number} params.amount - Required positive number
   * @param {string} params.currency - Required 3-letter currency code (e.g. 'USD')
   * @param {string} params.bookingId - Required booking reference
   * @param {string} [params.customerEmail] - Customer email
   * @param {object} [params.metadata] - Non-sensitive metadata
   * @param {object} [params.simulation] - Deterministic simulation flags
   * @returns {Promise<object>}
   */
  async createIntent(params = {}) {
    assertNoForbiddenCredentials(params);

    if (!params || typeof params !== 'object') {
      throw new AppError('Payment parameters must be an object', 400);
    }

    // Validate amount
    if (
      typeof params.amount !== 'number' ||
      !Number.isFinite(params.amount) ||
      params.amount <= 0
    ) {
      throw new AppError('Payment amount must be a finite positive number', 400);
    }

    // Validate currency
    if (
      typeof params.currency !== 'string' ||
      params.currency.trim().length !== 3
    ) {
      throw new AppError('Currency must be a valid 3-letter code (e.g. USD)', 400);
    }
    const currency = params.currency.trim().toUpperCase();

    // Validate bookingId
    if (
      !params.bookingId ||
      typeof params.bookingId !== 'string' ||
      params.bookingId.trim().length === 0
    ) {
      throw new AppError('Booking ID is required to create a payment intent', 400);
    }

    const sim = params.simulation || {};

    // Simulate failure if requested
    if (sim.shouldFail === true) {
      const failedTxnId = this._generateIdentifier('mock_pi_failed', sim.mockId);
      return {
        success: false,
        provider: 'mock',
        transactionId: failedTxnId,
        status: 'failed',
        amount: params.amount,
        currency,
        errorMessage: sim.failureReason || 'Simulated card decline: insufficient funds',
        rawResponse: {
          mock: true,
          notice: 'Simulated failure - No real financial transaction occurred',
          declineCode: sim.declineCode || 'card_declined'
        }
      };
    }

    // Support deterministic pause / hook for concurrency testing
    if (sim.delayMs && typeof sim.delayMs === 'number' && sim.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, sim.delayMs));
    }
    if (typeof sim.beforeComplete === 'function') {
      await sim.beforeComplete();
    }

    // Simulate successfully initialized checkout intent
    const txnId = this._generateIdentifier('mock_pi', sim.mockId);
    const clientSec = this._generateIdentifier('mock_sec', sim.mockId);

    return {
      success: true,
      provider: 'mock',
      transactionId: txnId,
      status: 'pending',
      amount: params.amount,
      currency,
      clientSecret: clientSec,
      paymentMethod: {
        methodType: 'card',
        cardBrand: 'MockVisa',
        cardLast4: '4242'
      },
      rawResponse: {
        mock: true,
        notice: 'Simulated payment intent initialized - Awaiting payment confirmation',
        bookingId: params.bookingId
      }
    };
  }

  /**
   * Verifies and decodes a mock webhook payload.
   *
   * @param {object} params
   * @param {Buffer|string} params.rawBody - Raw request body
   * @param {string} [params.signature='mock_sig_valid'] - Webhook signature
   * @returns {Promise<object>}
   */
  async verifyWebhook(params = {}) {
    if (!params || typeof params !== 'object') {
      throw new AppError('Webhook parameters must be an object', 400);
    }

    if (!params.rawBody) {
      throw new AppError('Raw request body is required for webhook verification', 400);
    }

    const signature = params.signature || (params.headers && params.headers['x-mock-signature']);

    // Check for simulated invalid signature
    if (!signature || signature === 'invalid_signature') {
      return {
        verified: false,
        errorMessage: 'Invalid mock webhook signature'
      };
    }

    // Parse payload
    let payload;
    try {
      const rawString = Buffer.isBuffer(params.rawBody)
        ? params.rawBody.toString('utf8')
        : String(params.rawBody);
      payload = JSON.parse(rawString);
    } catch (err) {
      throw new AppError('Malformed webhook body: invalid JSON', 400);
    }

    assertNoForbiddenCredentials(payload);

    const eventId =
      payload.id ||
      payload.eventId ||
      payload.data?.id ||
      payload.data?.eventId ||
      `evt_${payload.data?.transactionId || payload.transactionId || 'mock'}`;

    const eventType = payload.type || 'payment_intent.succeeded';
    const status =
      payload.data?.status ||
      (eventType === 'payment_intent.payment_failed' ? 'failed' : 'completed');

    return {
      verified: true,
      provider: this.name,
      eventId: String(eventId),
      eventType,
      transactionId: payload.data?.transactionId || payload.transactionId || 'mock_pi_webhook',
      bookingId: payload.data?.bookingId || payload.bookingId,
      amount: payload.data?.amount !== undefined ? payload.data.amount : payload.amount,
      currency: payload.data?.currency || payload.currency,
      status,
      failureReason: payload.data?.failureReason || payload.errorMessage,
      simulation: payload.simulation || payload.data?.simulation,
      rawEvent: payload
    };
  }

  /**
   * Registers a deterministic hook for a specific webhook event ID.
   * Useful for testing race conditions, pause/resume, and stale ownership reclamation.
   *
   * @param {string} eventId
   * @param {Function} hookFn
   */
  setWebhookHook(eventId, hookFn) {
    if (!this._webhookHooks) {
      this._webhookHooks = new Map();
    }
    this._webhookHooks.set(eventId, hookFn);
  }

  /**
   * Clears all registered webhook hooks.
   */
  clearWebhookHooks() {
    if (this._webhookHooks) {
      this._webhookHooks.clear();
    }
  }

  /**
   * Executes a registered webhook hook if one exists for the event ID.
   *
   * @param {string} eventId
   * @param {object} [context]
   */
  async executeWebhookHook(eventId, context = {}) {
    if (this._webhookHooks && this._webhookHooks.has(eventId)) {
      const hookFn = this._webhookHooks.get(eventId);
      if (typeof hookFn === 'function') {
        await hookFn(context);
      }
    }
  }

  /**
   * Executes a simulated full or partial refund.
   *
   * @param {object} params
   * @param {string} params.transactionId - Original transaction ID to refund
   * @param {number} params.amount - Refund amount (positive number)
   * @param {number} params.originalAmount - Original payment amount
   * @param {string} [params.reason] - Refund reason
   * @param {object} [params.simulation] - Deterministic simulation flags
   * @returns {Promise<object>}
   */
  async refund(params = {}) {
    assertNoForbiddenCredentials(params);

    if (!params || typeof params !== 'object') {
      throw new AppError('Refund parameters must be an object', 400);
    }

    if (
      !params.transactionId ||
      typeof params.transactionId !== 'string' ||
      params.transactionId.trim().length === 0
    ) {
      throw new AppError('Transaction ID is required for refund', 400);
    }

    if (
      typeof params.amount !== 'number' ||
      !Number.isFinite(params.amount) ||
      params.amount <= 0
    ) {
      throw new AppError('Refund amount must be a finite positive number', 400);
    }

    if (
      typeof params.originalAmount !== 'number' ||
      !Number.isFinite(params.originalAmount) ||
      params.originalAmount <= 0
    ) {
      throw new AppError('Original payment amount must be a finite positive number', 400);
    }

    // Enforce that refund cannot exceed original amount
    if (params.amount > params.originalAmount) {
      throw new AppError('Refund amount cannot exceed original payment amount', 400);
    }

    const sim = params.simulation || {};

    // Simulate provider network timeout or ambiguous error
    if (sim.timeout === true) {
      throw new Error('Payment gateway connection timeout (ETIMEDOUT)');
    }

    // Support provider-level idempotency deduplication
    if (params.idempotencyKey) {
      const cached = this._idempotencyStore.get(String(params.idempotencyKey));
      if (cached) {
        return { ...cached, idempotent: true };
      }
    }

    // Simulate refund failure if requested
    if (sim.shouldFail === true) {
      const failedRefId = this._generateIdentifier('mock_ref_failed', sim.mockId);
      return {
        success: false,
        provider: 'mock',
        refundTransactionId: failedRefId,
        originalTransactionId: params.transactionId,
        amount: params.amount,
        status: 'failed',
        isFullRefund: false,
        refundedAt: null,
        errorMessage: sim.failureReason || 'Simulated refund decline from banking partner',
        rawResponse: {
          mock: true,
          notice: 'Simulated refund failure - No real financial transaction occurred'
        }
      };
    }

    // Simulate refund success
    const refId = this._generateIdentifier('mock_ref', sim.mockId);
    const isFullRefund = params.amount === params.originalAmount;

    const result = {
      success: true,
      provider: 'mock',
      refundTransactionId: refId,
      originalTransactionId: params.transactionId,
      amount: params.amount,
      status: 'completed',
      isFullRefund,
      refundedAt: new Date(),
      reason: params.reason ? String(params.reason).trim() : (isFullRefund ? 'Full refund' : 'Partial refund'),
      rawResponse: {
        mock: true,
        notice: 'Simulated refund succeeded - No real financial transaction occurred'
      }
    };

    if (params.idempotencyKey) {
      this._idempotencyStore.set(String(params.idempotencyKey), result);
    }

    return result;
  }

  /**
   * Cancels a mock payment intent.
   *
   * @param {object} params
   * @param {string} params.transactionId - Required transaction ID to cancel
   * @param {string} [params.reason] - Cancellation reason
   * @param {object} [params.simulation] - Deterministic simulation flags
   * @returns {Promise<object>}
   */
  async cancelIntent(params = {}) {
    assertNoForbiddenCredentials(params);

    if (!params || typeof params !== 'object') {
      throw new AppError('Cancel intent parameters must be an object', 400);
    }

    if (
      !params.transactionId ||
      typeof params.transactionId !== 'string' ||
      params.transactionId.trim().length === 0
    ) {
      throw new AppError('Transaction ID is required to cancel a payment intent', 400);
    }

    const sim = params.simulation || {};

    if (sim.shouldFail === true || sim.cancelFails === true) {
      return {
        success: false,
        provider: 'mock',
        transactionId: params.transactionId,
        status: 'failed',
        errorMessage: sim.failureReason || 'Simulated provider error: failed to cancel intent',
        rawResponse: {
          mock: true,
          notice: 'Simulated cancel intent failure'
        }
      };
    }

    return {
      success: true,
      provider: 'mock',
      transactionId: params.transactionId,
      status: 'cancelled',
      reason: params.reason ? String(params.reason).trim() : 'Reservation hold expired or cancelled',
      cancelledAt: new Date(),
      rawResponse: {
        mock: true,
        notice: 'Simulated payment intent cancelled successfully'
      }
    };
  }
}

module.exports = MockPaymentProvider;
