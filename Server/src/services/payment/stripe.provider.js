const Stripe = require('stripe');
const { PaymentProvider, assertNoForbiddenCredentials } = require('./provider.interface');
const { AppError } = require('../../middleware/error.middleware');

// ISO 4217 Zero-decimal currencies in Stripe
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA',
  'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'
]);

// ISO 4217 Three-decimal currencies in Stripe
const THREE_DECIMAL_CURRENCIES = new Set([
  'BHD', 'JOD', 'KWD', 'OMR', 'TND'
]);

/**
 * Converts a major currency unit amount into Stripe's integer minor unit.
 *
 * @param {number} amount
 * @param {string} [currency='USD']
 * @returns {number}
 */
const toStripeAmount = (amount, currency = 'USD') => {
  const curr = String(currency || 'USD').toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(curr)) {
    return Math.round(amount);
  }
  if (THREE_DECIMAL_CURRENCIES.has(curr)) {
    return Math.round(amount * 1000);
  }
  return Math.round(amount * 100);
};

/**
 * Converts Stripe's minor unit back into standard major currency units.
 *
 * @param {number} amount
 * @param {string} [currency='USD']
 * @returns {number}
 */
const fromStripeAmount = (amount, currency = 'USD') => {
  const curr = String(currency || 'USD').toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(curr)) {
    return amount;
  }
  if (THREE_DECIMAL_CURRENCIES.has(curr)) {
    return amount / 1000;
  }
  return amount / 100;
};

/**
 * Stripe Payment Provider Adapter
 *
 * Implements the PaymentProvider abstraction contract for Stripe.
 * Keeps Stripe-specific SDK interactions completely isolated from the rest of the application.
 * Accepts optional client/secret injection for deterministic testing without live credentials.
 */
class StripePaymentProvider extends PaymentProvider {
  /**
   * @param {object} [options]
   * @param {string} [options.secretKey] - Stripe secret API key (defaults to process.env.STRIPE_SECRET_KEY)
   * @param {string} [options.webhookSecret] - Stripe webhook signing secret (defaults to process.env.STRIPE_WEBHOOK_SECRET)
   * @param {object} [options.stripeClient] - Injected Stripe client instance (useful for unit testing/mocking)
   */
  constructor(options = {}) {
    super('stripe');

    const secretKey = options.secretKey !== undefined ? options.secretKey : process.env.STRIPE_SECRET_KEY;
    this.webhookSecret = options.webhookSecret !== undefined ? options.webhookSecret : process.env.STRIPE_WEBHOOK_SECRET;

    if (options.stripeClient) {
      this.stripe = options.stripeClient;
    } else if (options.stripeClient === null) {
      this.stripe = null;
    } else if (secretKey) {
      this.stripe = new Stripe(secretKey, {
        apiVersion: '2025-01-27.acacia'
      });
    } else {
      this.stripe = null;
    }
  }

  /**
   * Asserts that Stripe client is configured before making API requests.
   *
   * @throws {AppError}
   */
  _assertConfigured() {
    if (!this.stripe) {
      throw new AppError(
        'Stripe provider is not configured: missing STRIPE_SECRET_KEY environment variable.',
        500
      );
    }
  }

  /**
   * Creates a Stripe PaymentIntent for a pending reservation.
   *
   * @param {object} params
   * @param {number} params.amount - Required positive amount in major currency units (e.g. 150.00)
   * @param {string} params.currency - Required 3-letter currency code (e.g. 'USD')
   * @param {string} params.bookingId - Required associated Booking ID
   * @param {string} [params.customerEmail] - Optional customer email
   * @param {object} [params.metadata] - Optional non-sensitive metadata
   * @param {string} [params.idempotencyKey] - Optional idempotency key for network retries
   * @returns {Promise<object>}
   */
  async createIntent(params = {}) {
    assertNoForbiddenCredentials(params);

    if (!params || typeof params !== 'object') {
      throw new AppError('Payment parameters must be an object', 400);
    }

    if (
      typeof params.amount !== 'number' ||
      !Number.isFinite(params.amount) ||
      params.amount <= 0
    ) {
      throw new AppError('Payment amount must be a finite positive number', 400);
    }

    if (
      typeof params.currency !== 'string' ||
      params.currency.trim().length !== 3
    ) {
      throw new AppError('Currency must be a valid 3-letter code (e.g. USD)', 400);
    }
    const currency = params.currency.trim().toUpperCase();

    if (
      !params.bookingId ||
      typeof params.bookingId !== 'string' ||
      params.bookingId.trim().length === 0
    ) {
      throw new AppError('Booking ID is required to create a payment intent', 400);
    }

    this._assertConfigured();

    // Convert amount to integer minor currency units (handles zero-decimal, two-decimal, and three-decimal currencies)
    const amountInMinorUnits = toStripeAmount(params.amount, currency);

    const intentPayload = {
      amount: amountInMinorUnits,
      currency: currency.toLowerCase(),
      metadata: {
        bookingId: params.bookingId,
        ...(params.metadata || {})
      },
      payment_method_types: ['card']
    };

    if (params.customerEmail) {
      intentPayload.receipt_email = params.customerEmail;
    }

    const requestOptions = {};
    if (params.idempotencyKey) {
      requestOptions.idempotencyKey = String(params.idempotencyKey);
    }

    try {
      const intent = await this.stripe.paymentIntents.create(intentPayload, requestOptions);

      return {
        success: true,
        provider: 'stripe',
        transactionId: intent.id,
        status: 'pending',
        amount: fromStripeAmount(intent.amount, intent.currency),
        currency: intent.currency.toUpperCase(),
        clientSecret: intent.client_secret,
        paymentMethod: {
          methodType: 'card'
        },
        rawResponse: intent
      };
    } catch (err) {
      return {
        success: false,
        provider: 'stripe',
        transactionId: err.raw?.payment_intent?.id || '',
        status: 'failed',
        amount: params.amount,
        currency,
        errorMessage: err.message || 'Stripe failed to create payment intent',
        rawResponse: err.raw || null
      };
    }
  }

  /**
   * Cancels an open Stripe PaymentIntent.
   *
   * @param {object} params
   * @param {string} params.transactionId - Required Stripe PaymentIntent ID (pi_...)
   * @param {string} [params.reason] - Cancellation reason
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

    this._assertConfigured();

    try {
      const cancelOptions = {};
      if (params.reason) {
        cancelOptions.cancellation_reason = 'abandoned';
      }

      const intent = await this.stripe.paymentIntents.cancel(params.transactionId, cancelOptions);

      return {
        success: true,
        provider: 'stripe',
        transactionId: intent.id,
        status: 'cancelled',
        rawResponse: intent
      };
    } catch (err) {
      return {
        success: false,
        provider: 'stripe',
        transactionId: params.transactionId,
        status: 'failed',
        errorMessage: err.message || 'Stripe failed to cancel payment intent',
        rawResponse: err.raw || null
      };
    }
  }

  /**
   * Issues a full or partial refund for a Stripe transaction.
   *
   * @param {object} params
   * @param {string} params.transactionId - Original Stripe PaymentIntent ID
   * @param {number} params.amount - Refund amount in major currency units
   * @param {number} params.originalAmount - Original completed payment amount
   * @param {string} [params.reason] - Human-readable reason for refund
   * @param {string} [params.idempotencyKey] - Optional idempotency key
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

    if (params.amount > params.originalAmount) {
      throw new AppError('Refund amount cannot exceed original payment amount', 400);
    }

    this._assertConfigured();

    const currency = (params.currency || 'USD').toUpperCase();
    const refundAmountInMinorUnits = toStripeAmount(params.amount, currency);
    const refundPayload = {
      payment_intent: params.transactionId,
      amount: refundAmountInMinorUnits,
      metadata: {
        reason: params.reason || '',
        currency
      }
    };

    const requestOptions = {};
    if (params.idempotencyKey) {
      requestOptions.idempotencyKey = String(params.idempotencyKey);
    }

    try {
      const refund = await this.stripe.refunds.create(refundPayload, requestOptions);
      const isFullRefund = params.amount === params.originalAmount;

      return {
        success: true,
        provider: 'stripe',
        refundTransactionId: refund.id,
        originalTransactionId: params.transactionId,
        amount: fromStripeAmount(refund.amount, refund.currency || currency),
        status: refund.status === 'succeeded' ? 'completed' : refund.status,
        isFullRefund,
        refundedAt: refund.created ? new Date(refund.created * 1000) : new Date(),
        reason: params.reason || (isFullRefund ? 'Full refund' : 'Partial refund'),
        rawResponse: refund
      };
    } catch (err) {
      return {
        success: false,
        provider: 'stripe',
        refundTransactionId: '',
        originalTransactionId: params.transactionId,
        amount: params.amount,
        status: 'failed',
        isFullRefund: false,
        refundedAt: null,
        errorMessage: err.message || 'Stripe failed to process refund',
        rawResponse: err.raw || null
      };
    }
  }

  /**
   * Verifies and decodes an incoming Stripe webhook payload.
   *
   * @param {object} params
   * @param {Buffer|string} params.rawBody - Unmodified raw request body buffer
   * @param {string} [params.signature] - Stripe signature header
   * @param {object} [params.headers] - Request headers containing 'stripe-signature'
   * @returns {Promise<object>}
   */
  async verifyWebhook(params = {}) {
    if (!params || typeof params !== 'object') {
      throw new AppError('Webhook parameters must be an object', 400);
    }

    if (!params.rawBody) {
      throw new AppError('Raw request body is required for Stripe webhook verification', 400);
    }

    const signature =
      params.signature ||
      (params.headers && (params.headers['stripe-signature'] || params.headers['Stripe-Signature']));

    if (!signature) {
      return {
        verified: false,
        errorMessage: 'Missing Stripe signature header'
      };
    }

    const webhookSecret = this.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new AppError(
        'Stripe webhook secret (STRIPE_WEBHOOK_SECRET) is not configured.',
        500
      );
    }

    this._assertConfigured();

    let event;
    try {
      event = this.stripe.webhooks.constructEvent(params.rawBody, signature, webhookSecret);
    } catch (err) {
      return {
        verified: false,
        errorMessage: `Stripe webhook signature verification failed: ${err.message}`
      };
    }

    assertNoForbiddenCredentials(event);

    const eventId = event.id;
    const eventType = event.type;
    const eventObj = event.data?.object || {};

    let transactionId = '';
    let bookingId = eventObj.metadata?.bookingId || undefined;
    let amount = undefined;
    let currency = eventObj.currency ? eventObj.currency.toUpperCase() : undefined;
    let status = 'unknown';
    let failureReason = '';

    if (eventType === 'payment_intent.succeeded') {
      transactionId = eventObj.id;
      amount = eventObj.amount ? fromStripeAmount(eventObj.amount, currency) : undefined;
      status = 'completed';
    } else if (eventType === 'payment_intent.payment_failed') {
      transactionId = eventObj.id;
      amount = eventObj.amount ? fromStripeAmount(eventObj.amount, currency) : undefined;
      status = 'failed';
      failureReason = eventObj.last_payment_error?.message || 'Payment failed';
    } else if (eventType === 'charge.refunded' || eventType === 'charge.refund.updated') {
      transactionId = eventObj.payment_intent || eventObj.id;
      amount = eventObj.amount_refunded !== undefined
        ? fromStripeAmount(eventObj.amount_refunded, currency)
        : (eventObj.amount !== undefined ? fromStripeAmount(eventObj.amount, currency) : undefined);
      status = 'refunded';
    } else {
      transactionId = eventObj.id || '';
    }

    return {
      verified: true,
      provider: 'stripe',
      eventId,
      eventType,
      transactionId,
      bookingId,
      amount,
      currency,
      status,
      failureReason,
      rawEvent: event
    };
  }
}

module.exports = StripePaymentProvider;
