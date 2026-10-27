const { AppError } = require('../../middleware/error.middleware');

/**
 * Sensitive payment credential keys that violate PCI-DSS compliance.
 * Raw PANs, card numbers, CVVs, and PINs must NEVER be accepted or processed
 * directly by our backend services.
 */
const FORBIDDEN_CREDENTIAL_KEYS = [
  'cardnumber',
  'card_number',
  'pan',
  'cvv',
  'cvc',
  'securitycode',
  'security_code',
  'pin'
];

/**
 * Validates that an input object contains no raw payment credentials.
 *
 * @param {object} obj
 * @throws {AppError} on PCI security violation
 */
const assertNoForbiddenCredentials = (obj) => {
  if (!obj || typeof obj !== 'object') return;

  const check = (target) => {
    if (!target || typeof target !== 'object') return;
    for (const key of Object.keys(target)) {
      if (FORBIDDEN_CREDENTIAL_KEYS.includes(key.toLowerCase())) {
        throw new AppError(
          `Security Violation: Passing raw payment credentials (${key}) to payment provider is strictly prohibited. Use tokenized payment methods.`,
          400
        );
      }
      if (typeof target[key] === 'object' && target[key] !== null) {
        check(target[key]);
      }
    }
  };

  check(obj);
};

/**
 * Abstract Payment Provider Contract
 *
 * Defines the unified lifecycle contract that all payment gateways (Stripe, Mock, PayPal)
 * must implement. Guarantees uniform interfaces for intent creation, webhook verification,
 * and refund issuance.
 */
class PaymentProvider {
  /**
   * @param {string} providerName - Identifier for the provider (e.g. 'mock', 'stripe')
   */
  constructor(providerName) {
    if (new.target === PaymentProvider) {
      throw new TypeError('PaymentProvider is an abstract contract and cannot be instantiated directly.');
    }
    if (!providerName || typeof providerName !== 'string') {
      throw new TypeError('PaymentProvider requires a valid provider name string.');
    }
    this.name = providerName.toLowerCase();
  }

  /**
   * Creates a payment intent or checkout session.
   *
   * @param {object} params
   * @param {number} params.amount - Required positive amount (major currency units, e.g. 100.50)
   * @param {string} params.currency - Required 3-letter currency code (e.g. 'USD')
   * @param {string} params.bookingId - Required associated Booking ID
   * @param {string} [params.customerEmail] - Optional customer email for receipts
   * @param {object} [params.metadata] - Optional non-sensitive metadata key-value pairs
   * @param {object} [params.simulation] - Optional test simulation parameters
   * @returns {Promise<{
   *   success: boolean,
   *   provider: string,
   *   transactionId: string,
   *   status: 'pending' | 'completed' | 'failed',
   *   amount: number,
   *   currency: string,
   *   clientSecret?: string,
   *   paymentMethod?: { methodType: string, cardBrand?: string, cardLast4?: string },
   *   errorMessage?: string,
   *   rawResponse?: object
   * }>}
   */
  async createIntent(params) {
    throw new Error(`Method createIntent() must be implemented by payment provider "${this.name}".`);
  }

  /**
   * Verifies and decodes an incoming gateway webhook payload.
   *
   * @param {object} params
   * @param {Buffer|string} params.rawBody - Unmodified raw request body buffer
   * @param {string|object} params.signature - Gateway cryptographic signature header
   * @returns {Promise<{
   *   verified: boolean,
   *   eventType: string,
   *   transactionId: string,
   *   bookingId?: string,
   *   amount?: number,
   *   currency?: string,
   *   status?: 'completed' | 'failed' | 'refunded',
   *   errorMessage?: string,
   *   rawEvent?: object
   * }>}
   */
  async verifyWebhook(params) {
    throw new Error(`Method verifyWebhook() must be implemented by payment provider "${this.name}".`);
  }

  /**
   * Issues a full or partial refund for a previously completed transaction.
   *
   * @param {object} params
   * @param {string} params.transactionId - The original transactionId to refund
   * @param {number} params.amount - Refund amount (positive number <= originalAmount)
   * @param {number} params.originalAmount - The original completed payment amount
   * @param {string} [params.reason] - Human-readable reason for refund
   * @param {object} [params.simulation] - Optional test simulation parameters
   * @returns {Promise<{
   *   success: boolean,
   *   provider: string,
   *   refundTransactionId: string,
   *   originalTransactionId: string,
   *   amount: number,
   *   status: 'completed' | 'failed',
   *   isFullRefund: boolean,
   *   refundedAt: Date | null,
   *   reason?: string,
   *   errorMessage?: string,
   *   rawResponse?: object
   * }>}
   */
  async refund(params) {
    throw new Error(`Method refund() must be implemented by payment provider "${this.name}".`);
  }

  /**
   * Cancels a previously created payment intent if supported by the provider.
   *
   * @param {object} params
   * @param {string} params.transactionId - The transaction/intent ID to cancel
   * @param {string} [params.reason] - Cancellation reason
   * @param {object} [params.simulation] - Optional test simulation flags
   * @returns {Promise<{
   *   success: boolean,
   *   provider: string,
   *   transactionId: string,
   *   status: 'cancelled' | 'failed',
   *   errorMessage?: string,
   *   rawResponse?: object
   * }>}
   */
  async cancelIntent(params) {
    throw new Error(`Method cancelIntent() must be implemented by payment provider "${this.name}".`);
  }
}

module.exports = {
  PaymentProvider,
  assertNoForbiddenCredentials,
  FORBIDDEN_CREDENTIAL_KEYS
};
