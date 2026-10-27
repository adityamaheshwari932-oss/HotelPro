const { PaymentProvider, assertNoForbiddenCredentials, FORBIDDEN_CREDENTIAL_KEYS } = require('./provider.interface');
const MockPaymentProvider = require('./mock.provider');
const StripePaymentProvider = require('./stripe.provider');
const { AppError } = require('../../middleware/error.middleware');

let mockInstance = null;
let stripeInstance = null;

/**
 * Centralized provider selector.
 * Returns the configured payment provider adapter.
 *
 * @param {string} [providerName='mock']
 * @param {object} [options] - Optional configuration overrides (e.g. injected client for tests)
 * @returns {PaymentProvider}
 */
const getPaymentProvider = (providerName = 'mock', options = {}) => {
  const normalized = (providerName || 'mock').toLowerCase();

  if (normalized === 'mock') {
    if (!mockInstance) {
      mockInstance = new MockPaymentProvider();
    }
    return mockInstance;
  }

  if (normalized === 'stripe') {
    if (options && Object.keys(options).length > 0) {
      return new StripePaymentProvider(options);
    }
    if (!stripeInstance) {
      stripeInstance = new StripePaymentProvider();
    }
    return stripeInstance;
  }

  throw new AppError(`Payment provider "${providerName}" is not configured or unsupported.`, 400);
};

/**
 * Sets or overrides a provider singleton instance (primarily for test mock injection).
 *
 * @param {string} providerName
 * @param {PaymentProvider|null} instance
 */
const setPaymentProviderInstance = (providerName, instance) => {
  const normalized = (providerName || '').toLowerCase();
  if (normalized === 'mock') {
    mockInstance = instance;
  } else if (normalized === 'stripe') {
    stripeInstance = instance;
  }
};

module.exports = {
  PaymentProvider,
  MockPaymentProvider,
  StripePaymentProvider,
  getPaymentProvider,
  setPaymentProviderInstance,
  assertNoForbiddenCredentials,
  FORBIDDEN_CREDENTIAL_KEYS
};
