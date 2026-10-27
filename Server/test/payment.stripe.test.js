require('dotenv').config();
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const app = require('../app');
const { Hotel, Room, Booking, Payment, User, WebhookEvent } = require('../src/models');
const { signToken } = require('../src/config/jwt');
const StripePaymentProvider = require('../src/services/payment/stripe.provider');
const { getPaymentProvider, setPaymentProviderInstance } = require('../src/services/payment');

describe('Stage 6.5: Stripe Payment Provider Unit & Integration Tests', () => {
  const ISOLATED_TEST_DB_URI = 'mongodb://127.0.0.1:27017/hotelpro_payment_stripe_isolation';
  let server;
  let baseUrl;

  let testHotel;
  let testRoom;
  let customerUser;
  let customerToken;

  /**
   * Builds a deterministic in-memory mock Stripe SDK instance.
   */
  const createMockStripeClient = () => {
    return {
      paymentIntents: {
        create: async (payload, options = {}) => {
          if (payload.metadata?.simulateCardError) {
            const err = new Error('Your card was declined.');
            err.type = 'StripeCardError';
            err.code = 'card_declined';
            err.raw = { message: 'Your card was declined.', decline_code: 'generic_decline' };
            throw err;
          }

          return {
            id: `pi_stripe_mock_${Date.now()}`,
            amount: payload.amount,
            currency: payload.currency,
            client_secret: `pi_stripe_mock_${Date.now()}_secret_test123`,
            status: 'requires_payment_method',
            metadata: payload.metadata || {},
            receipt_email: payload.receipt_email || null,
            _options: options
          };
        },
        cancel: async (intentId, options = {}) => {
          if (intentId === 'pi_simulate_cancel_fail') {
            const err = new Error('PaymentIntent cannot be cancelled because its status is succeeded.');
            err.type = 'StripeInvalidRequestError';
            throw err;
          }
          return {
            id: intentId,
            status: 'canceled',
            cancellation_reason: options.cancellation_reason || 'abandoned'
          };
        }
      },
      refunds: {
        create: async (payload, options = {}) => {
          if (payload.metadata?.simulateRefundFail) {
            const err = new Error('Charge has already been refunded or is not refundable.');
            err.type = 'StripeInvalidRequestError';
            throw err;
          }

          return {
            id: `re_stripe_mock_${Date.now()}`,
            amount: payload.amount,
            currency: payload.metadata?.currency || 'usd',
            status: 'succeeded',
            payment_intent: payload.payment_intent,
            created: Math.floor(Date.now() / 1000),
            metadata: payload.metadata || {},
            _options: options
          };
        }
      },
      webhooks: {
        constructEvent: (rawBody, signature, secret) => {
          if (signature === 'invalid_stripe_signature') {
            throw new Error('No signatures found matching the expected signature for payload');
          }

          const rawStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
          const parsed = JSON.parse(rawStr);

          return {
            id: parsed.id || `evt_stripe_${Date.now()}`,
            type: parsed.type || 'payment_intent.succeeded',
            data: {
              object: parsed.data?.object || parsed
            }
          };
        }
      }
    };
  };

  before(async () => {
    // Start HTTP server on ephemeral port
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    });

    // Connect to isolated test database
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close(false);
    }
    await mongoose.connect(ISOLATED_TEST_DB_URI);

    // Initialize indexes
    await Hotel.init();
    await Room.init();
    await Booking.init();
    await Payment.init();
    await User.init();
    await WebhookEvent.init();

    // Clean test collections
    await Hotel.deleteMany({});
    await Room.deleteMany({});
    await Booking.deleteMany({});
    await Payment.deleteMany({});
    await User.deleteMany({});
    await WebhookEvent.deleteMany({});

    customerUser = await User.create({
      name: 'Stripe Tester',
      email: 'stripe.tester@hotelpro.com',
      passwordHash: '$2a$12$e8YQzabcdef1234567890',
      role: 'customer',
      status: 'active'
    });
    customerToken = signToken({ sub: customerUser._id.toString(), role: 'customer' });

    testHotel = await Hotel.create({
      name: 'Stripe Seaside Resort',
      address: { street: '1 Stripe Way', city: 'San Francisco', country: 'USA' },
      contact: { phone: '+1-555-0188', email: 'concierge@stripeseaside.com' },
      status: 'active'
    });

    testRoom = await Room.create({
      hotel: testHotel._id,
      roomNumber: 'ST-201',
      roomType: 'single',
      basePrice: 150,
      capacity: 2,
      status: 'active'
    });
  });

  after(async () => {
    setPaymentProviderInstance('stripe', null);
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.dropDatabase();
      await mongoose.connection.close(false);
    }
  });

  describe('Stripe Provider Adapter - Unit Tests', () => {
    let mockStripeClient;
    let stripeProvider;

    beforeEach(() => {
      mockStripeClient = createMockStripeClient();
      stripeProvider = new StripePaymentProvider({
        stripeClient: mockStripeClient,
        webhookSecret: 'whsec_test_mock_secret_123'
      });
    });

    test('1. throws clear 500 configuration error when instantiated without keys and called', async () => {
      const unconfigured = new StripePaymentProvider({ secretKey: '', stripeClient: null });
      await assert.rejects(
        async () => {
          await unconfigured.createIntent({
            amount: 100,
            currency: 'USD',
            bookingId: '60c72b2f9b1d8b2bad000001'
          });
        },
        /missing STRIPE_SECRET_KEY/i
      );
    });

    test('2. successfully creates Stripe PaymentIntent and converts major currency to integer cents', async () => {
      const result = await stripeProvider.createIntent({
        amount: 150.50,
        currency: 'USD',
        bookingId: '60c72b2f9b1d8b2bad000001',
        customerEmail: 'guest@hotelpro.com',
        idempotencyKey: 'idem_stripe_001'
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.provider, 'stripe');
      assert.ok(result.transactionId.startsWith('pi_stripe_mock_'));
      assert.strictEqual(result.amount, 150.50);
      assert.strictEqual(result.currency, 'USD');
      assert.ok(result.clientSecret.includes('secret_test123'));
      assert.strictEqual(result.rawResponse.amount, 15050); // integer cents
      assert.strictEqual(result.rawResponse._options.idempotencyKey, 'idem_stripe_001');
    });

    test('3. rejects negative, zero, or non-finite payment amounts with 400 Bad Request', async () => {
      await assert.rejects(
        async () => {
          await stripeProvider.createIntent({
            amount: -10,
            currency: 'USD',
            bookingId: '60c72b2f9b1d8b2bad000001'
          });
        },
        /finite positive number/i
      );

      await assert.rejects(
        async () => {
          await stripeProvider.createIntent({
            amount: 0,
            currency: 'USD',
            bookingId: '60c72b2f9b1d8b2bad000001'
          });
        },
        /finite positive number/i
      );
    });

    test('4. rejects invalid currency format with 400 Bad Request', async () => {
      await assert.rejects(
        async () => {
          await stripeProvider.createIntent({
            amount: 100,
            currency: 'INVALID_CURRENCY',
            bookingId: '60c72b2f9b1d8b2bad000001'
          });
        },
        /valid 3-letter code/i
      );
    });

    test('5. rejects missing bookingId with 400 Bad Request', async () => {
      await assert.rejects(
        async () => {
          await stripeProvider.createIntent({
            amount: 100,
            currency: 'USD',
            bookingId: ''
          });
        },
        /Booking ID is required/i
      );
    });

    test('6. PCI Security Guardrail: rejects raw credit card numbers or CVVs passed to createIntent', async () => {
      await assert.rejects(
        async () => {
          await stripeProvider.createIntent({
            amount: 100,
            currency: 'USD',
            bookingId: '60c72b2f9b1d8b2bad000001',
            cardNumber: '4242424242424242',
            cvv: '123'
          });
        },
        /Security Violation/i
      );
    });

    test('7. captures Stripe card decline gracefully without unhandled exception', async () => {
      const result = await stripeProvider.createIntent({
        amount: 100,
        currency: 'USD',
        bookingId: '60c72b2f9b1d8b2bad000001',
        metadata: { simulateCardError: true }
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.status, 'failed');
      assert.match(result.errorMessage, /declined/i);
    });

    test('8. successfully cancels open Stripe PaymentIntent', async () => {
      const result = await stripeProvider.cancelIntent({
        transactionId: 'pi_test_to_cancel_123',
        reason: 'hold_expired'
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status, 'cancelled');
      assert.strictEqual(result.transactionId, 'pi_test_to_cancel_123');
    });

    test('9. handles Stripe PaymentIntent cancellation failure gracefully', async () => {
      const result = await stripeProvider.cancelIntent({
        transactionId: 'pi_simulate_cancel_fail'
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.status, 'failed');
      assert.match(result.errorMessage, /cannot be cancelled/i);
    });

    test('10. processes full and partial refunds with integer cent conversion', async () => {
      // Partial refund: 50.25 out of 100.50
      const partialRes = await stripeProvider.refund({
        transactionId: 'pi_refund_test_456',
        amount: 50.25,
        originalAmount: 100.50,
        reason: 'Partial stay adjustment',
        idempotencyKey: 'idem_stripe_ref_01'
      });

      assert.strictEqual(partialRes.success, true);
      assert.strictEqual(partialRes.status, 'completed');
      assert.strictEqual(partialRes.amount, 50.25);
      assert.strictEqual(partialRes.isFullRefund, false);
      assert.strictEqual(partialRes.rawResponse.amount, 5025); // integer cents
      assert.strictEqual(partialRes.rawResponse._options.idempotencyKey, 'idem_stripe_ref_01');

      // Full refund: 100.50 out of 100.50
      const fullRes = await stripeProvider.refund({
        transactionId: 'pi_refund_test_456',
        amount: 100.50,
        originalAmount: 100.50,
        reason: 'Full cancellation'
      });

      assert.strictEqual(fullRes.success, true);
      assert.strictEqual(fullRes.isFullRefund, true);
      assert.strictEqual(fullRes.amount, 100.50);
      assert.strictEqual(fullRes.rawResponse.amount, 10050);
    });

    test('11. rejects refund amount greater than original payment amount', async () => {
      await assert.rejects(
        async () => {
          await stripeProvider.refund({
            transactionId: 'pi_test_refund_exceed',
            amount: 200,
            originalAmount: 100
          });
        },
        /cannot exceed original payment amount/i
      );
    });

    test('12. verifies Stripe webhook signature and decodes payment_intent.succeeded payload', async () => {
      const payload = {
        id: 'evt_stripe_succ_999',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_stripe_tx_123',
            amount: 15000, // 150.00 USD in cents
            currency: 'usd',
            metadata: { bookingId: '60c72b2f9b1d8b2bad000001' }
          }
        }
      };

      const rawBody = Buffer.from(JSON.stringify(payload));
      const verification = await stripeProvider.verifyWebhook({
        rawBody,
        signature: 'valid_stripe_sig_test'
      });

      assert.strictEqual(verification.verified, true);
      assert.strictEqual(verification.provider, 'stripe');
      assert.strictEqual(verification.eventType, 'payment_intent.succeeded');
      assert.strictEqual(verification.transactionId, 'pi_stripe_tx_123');
      assert.strictEqual(verification.amount, 150.00); // normalized to major units
      assert.strictEqual(verification.currency, 'USD');
      assert.strictEqual(verification.status, 'completed');
    });

    test('13. rejects webhook with invalid Stripe signature', async () => {
      const payload = { id: 'evt_invalid_sig', type: 'payment_intent.succeeded' };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const verification = await stripeProvider.verifyWebhook({
        rawBody,
        signature: 'invalid_stripe_signature'
      });

      assert.strictEqual(verification.verified, false);
      assert.match(verification.errorMessage, /verification failed/i);
    });

    test('13b. correctly handles zero-decimal currencies (JPY) without multiplying by 100', async () => {
      const intentRes = await stripeProvider.createIntent({
        amount: 5000,
        currency: 'JPY',
        bookingId: '60c72b2f9b1d8b2bad000001'
      });
      assert.strictEqual(intentRes.success, true);
      assert.strictEqual(intentRes.amount, 5000);
      assert.strictEqual(intentRes.currency, 'JPY');
      assert.strictEqual(intentRes.rawResponse.amount, 5000); // 1:1 for JPY

      const refundRes = await stripeProvider.refund({
        transactionId: 'pi_jpy_test_123',
        amount: 2500,
        originalAmount: 5000,
        currency: 'JPY'
      });
      assert.strictEqual(refundRes.success, true);
      assert.strictEqual(refundRes.amount, 2500);
      assert.strictEqual(refundRes.rawResponse.amount, 2500); // 1:1 for JPY
    });

    test('13c. correctly handles three-decimal currencies (KWD) by multiplying by 1000', async () => {
      const intentRes = await stripeProvider.createIntent({
        amount: 5.5,
        currency: 'KWD',
        bookingId: '60c72b2f9b1d8b2bad000001'
      });
      assert.strictEqual(intentRes.success, true);
      assert.strictEqual(intentRes.amount, 5.5);
      assert.strictEqual(intentRes.currency, 'KWD');
      assert.strictEqual(intentRes.rawResponse.amount, 5500); // multiplied by 1000
    });
  });

  describe('Stripe Provider - Integration with Checkout & Webhooks', () => {
    let mockStripeClient;
    let stripeProvider;
    let pendingBooking;

    beforeEach(async () => {
      await Booking.deleteMany({});
      await Payment.deleteMany({});
      await WebhookEvent.deleteMany({});

      mockStripeClient = createMockStripeClient();
      stripeProvider = new StripePaymentProvider({
        stripeClient: mockStripeClient,
        webhookSecret: 'whsec_test_mock_secret_123'
      });
      setPaymentProviderInstance('stripe', stripeProvider);

      pendingBooking = await Booking.create({
        hotel: testHotel._id,
        room: testRoom._id,
        user: customerUser._id,
        checkInDate: new Date('2029-05-10T00:00:00.000Z'),
        checkOutDate: new Date('2029-05-12T00:00:00.000Z'),
        guestInfo: { name: 'Stripe Tester', email: 'stripe.tester@hotelpro.com' },
        guestCount: 1,
        priceSnapshot: {
          baseNightlyRate: 150,
          nightlyBreakdown: [{ date: '2029-05-10', rate: 150 }, { date: '2029-05-11', rate: 150 }],
          totalRoomRate: 300,
          taxes: 0,
          fees: 0
        },
        totalAmount: 300,
        currency: 'USD',
        status: 'pending',
        holdExpiresAt: new Date(Date.now() + 15 * 60 * 1000)
      });
    });

    test('14. customer can initiate checkout using provider="stripe"', async () => {
      const res = await fetch(`${baseUrl}/api/payments/checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken}`
        },
        body: JSON.stringify({
          bookingId: pendingBooking._id.toString(),
          provider: 'stripe'
        })
      });
      const body = await res.json();

      assert.strictEqual(res.status, 201);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.checkoutSession.provider, 'stripe');
      assert.ok(body.data.checkoutSession.transactionId.startsWith('pi_stripe_mock_'));
      assert.strictEqual(body.data.checkoutSession.amount, 300);
      assert.strictEqual(body.data.checkoutSession.status, 'pending');

      // Verify MongoDB payment record
      const payment = await Payment.findOne({ booking: pendingBooking._id });
      assert.ok(payment);
      assert.strictEqual(payment.provider, 'stripe');
      assert.strictEqual(payment.status, 'pending');
    });

    test('15. Stripe payment_intent.succeeded webhook confirms booking and completes Payment', async () => {
      // 1. Create pending payment
      const payment = await Payment.create({
        booking: pendingBooking._id,
        amount: 300,
        currency: 'USD',
        provider: 'stripe',
        status: 'pending',
        transactionId: `pi_stripe_webhook_confirm_${Date.now()}`
      });

      // 2. Dispatch simulated Stripe webhook
      const webhookPayload = {
        id: `evt_stripe_confirm_${Date.now()}`,
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: payment.transactionId,
            amount: 30000,
            currency: 'usd',
            metadata: { bookingId: pendingBooking._id.toString() }
          }
        }
      };

      const res = await fetch(`${baseUrl}/api/payments/webhook/stripe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': 'valid_sig_123'
        },
        body: JSON.stringify(webhookPayload)
      });
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.bookingConfirmed, true);

      // Verify database updates
      const updatedPayment = await Payment.findById(payment._id);
      assert.strictEqual(updatedPayment.status, 'completed');

      const updatedBooking = await Booking.findById(pendingBooking._id);
      assert.strictEqual(updatedBooking.status, 'confirmed');

      // Verify WebhookEvent idempotency record
      const webhookEvent = await WebhookEvent.findOne({
        provider: 'stripe',
        eventId: webhookPayload.id
      });
      assert.ok(webhookEvent);
      assert.strictEqual(webhookEvent.status, 'completed');
    });
  });
});
