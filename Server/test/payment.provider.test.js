const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
  PaymentProvider,
  MockPaymentProvider,
  assertNoForbiddenCredentials
} = require('../src/services/payment');

describe('Stage 6.1: Payment Provider Foundation Tests', () => {
  describe('Provider Contract & Interface Constraints', () => {
    test('abstract PaymentProvider cannot be instantiated directly', () => {
      assert.throws(
        () => new PaymentProvider('test'),
        (err) => {
          assert.strictEqual(err.name, 'TypeError');
          assert.match(err.message, /abstract contract and cannot be instantiated directly/i);
          return true;
        }
      );
    });

    test('concrete provider requires a valid provider name string', () => {
      class UnnamedProvider extends PaymentProvider {
        constructor() {
          super('');
        }
      }
      assert.throws(
        () => new UnnamedProvider(),
        (err) => {
          assert.strictEqual(err.name, 'TypeError');
          assert.match(err.message, /valid provider name string/i);
          return true;
        }
      );
    });

    test('unimplemented base methods throw clear error if called directly', async () => {
      class DummyProvider extends PaymentProvider {
        constructor() {
          super('dummy');
        }
      }
      const dummy = new DummyProvider();

      await assert.rejects(
        () => dummy.createIntent({}),
        /Method createIntent\(\) must be implemented by payment provider "dummy"/
      );
      await assert.rejects(
        () => dummy.verifyWebhook({}),
        /Method verifyWebhook\(\) must be implemented by payment provider "dummy"/
      );
      await assert.rejects(
        () => dummy.refund({}),
        /Method refund\(\) must be implemented by payment provider "dummy"/
      );
    });

    test('assertNoForbiddenCredentials rejects raw card numbers, CVVs, and PINs (PCI Guardrail)', () => {
      // Rejects cardNumber
      assert.throws(
        () => assertNoForbiddenCredentials({ cardNumber: '4111111111111111' }),
        /Security Violation: Passing raw payment credentials \(cardNumber\)/
      );

      // Rejects cvv in nested object
      assert.throws(
        () => assertNoForbiddenCredentials({ paymentData: { cvv: '123' } }),
        /Security Violation: Passing raw payment credentials \(cvv\)/
      );

      // Rejects pin
      assert.throws(
        () => assertNoForbiddenCredentials({ pin: '1234' }),
        /Security Violation: Passing raw payment credentials \(pin\)/
      );

      // Rejects pan (Primary Account Number)
      assert.throws(
        () => assertNoForbiddenCredentials({ pan: '4111222233334444' }),
        /Security Violation: Passing raw payment credentials \(pan\)/
      );

      // Allows safe tokenized structures
      assert.doesNotThrow(() => {
        assertNoForbiddenCredentials({
          amount: 150,
          currency: 'USD',
          bookingId: '654321098765432109876543',
          paymentMethod: { methodType: 'card', cardBrand: 'Visa', cardLast4: '4242' }
        });
      });
    });
  });

  describe('MockPaymentProvider - Intent Creation', () => {
    const mockProvider = new MockPaymentProvider();

    test('successfully creates a mock payment intent with structured details', async () => {
      const result = await mockProvider.createIntent({
        amount: 250.75,
        currency: 'USD',
        bookingId: 'booking_test_101',
        customerEmail: 'guest@example.com'
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.provider, 'mock');
      assert.strictEqual(result.status, 'pending');
      assert.strictEqual(result.amount, 250.75);
      assert.strictEqual(result.currency, 'USD');
      assert.ok(result.transactionId.startsWith('mock_pi_'));
      assert.ok(result.clientSecret.startsWith('mock_sec_'));
      assert.strictEqual(result.paymentMethod.cardLast4, '4242');
      assert.strictEqual(result.paymentMethod.cardBrand, 'MockVisa');
      assert.strictEqual(result.rawResponse.mock, true);
    });

    test('generates unique and distinct transaction references across calls', async () => {
      const res1 = await mockProvider.createIntent({
        amount: 100,
        currency: 'USD',
        bookingId: 'booking_1'
      });
      const res2 = await mockProvider.createIntent({
        amount: 100,
        currency: 'USD',
        bookingId: 'booking_2'
      });

      assert.notStrictEqual(res1.transactionId, res2.transactionId);
      assert.notStrictEqual(res1.clientSecret, res2.clientSecret);
    });

    test('supports deterministic custom mockId via simulation option', async () => {
      const res = await mockProvider.createIntent({
        amount: 300,
        currency: 'USD',
        bookingId: 'booking_3',
        simulation: { mockId: 'stable_ref_99' }
      });

      assert.strictEqual(res.transactionId, 'mock_pi_stable_ref_99');
      assert.strictEqual(res.clientSecret, 'mock_sec_stable_ref_99');
    });

    test('simulates deterministic payment failure upon request', async () => {
      const failResult = await mockProvider.createIntent({
        amount: 150,
        currency: 'USD',
        bookingId: 'booking_fail_1',
        simulation: {
          shouldFail: true,
          failureReason: 'Card has expired',
          declineCode: 'expired_card'
        }
      });

      assert.strictEqual(failResult.success, false);
      assert.strictEqual(failResult.status, 'failed');
      assert.strictEqual(failResult.errorMessage, 'Card has expired');
      assert.strictEqual(failResult.rawResponse.declineCode, 'expired_card');
      assert.ok(failResult.transactionId.startsWith('mock_pi_failed_'));
    });

    test('rejects negative or zero amount with 400 Bad Request', async () => {
      await assert.rejects(
        () => mockProvider.createIntent({ amount: 0, currency: 'USD', bookingId: 'b_1' }),
        /Payment amount must be a finite positive number/
      );
      await assert.rejects(
        () => mockProvider.createIntent({ amount: -50, currency: 'USD', bookingId: 'b_1' }),
        /Payment amount must be a finite positive number/
      );
      await assert.rejects(
        () => mockProvider.createIntent({ amount: NaN, currency: 'USD', bookingId: 'b_1' }),
        /Payment amount must be a finite positive number/
      );
    });

    test('rejects missing or invalid currency with 400 Bad Request', async () => {
      await assert.rejects(
        () => mockProvider.createIntent({ amount: 100, currency: 'US', bookingId: 'b_1' }),
        /Currency must be a valid 3-letter code/
      );
      await assert.rejects(
        () => mockProvider.createIntent({ amount: 100, currency: '', bookingId: 'b_1' }),
        /Currency must be a valid 3-letter code/
      );
    });

    test('rejects missing bookingId with 400 Bad Request', async () => {
      await assert.rejects(
        () => mockProvider.createIntent({ amount: 100, currency: 'USD' }),
        /Booking ID is required/
      );
    });

    test('rejects raw card numbers or CVVs passed to createIntent (PCI Protection)', async () => {
      await assert.rejects(
        () =>
          mockProvider.createIntent({
            amount: 100,
            currency: 'USD',
            bookingId: 'b_1',
            cardNumber: '4111222233334444'
          }),
        /Security Violation: Passing raw payment credentials/
      );

      await assert.rejects(
        () =>
          mockProvider.createIntent({
            amount: 100,
            currency: 'USD',
            bookingId: 'b_1',
            metadata: { cvv: '123' }
          }),
        /Security Violation: Passing raw payment credentials/
      );
    });
  });

  describe('MockPaymentProvider - Webhook Verification', () => {
    const mockProvider = new MockPaymentProvider();

    test('successfully verifies and decodes mock webhook with valid signature', async () => {
      const rawPayload = JSON.stringify({
        type: 'payment_intent.succeeded',
        data: {
          transactionId: 'mock_pi_webhook_test',
          bookingId: 'booking_123',
          amount: 200,
          currency: 'USD',
          status: 'completed'
        }
      });

      const result = await mockProvider.verifyWebhook({
        rawBody: Buffer.from(rawPayload),
        signature: 'mock_sig_valid'
      });

      assert.strictEqual(result.verified, true);
      assert.strictEqual(result.eventType, 'payment_intent.succeeded');
      assert.strictEqual(result.transactionId, 'mock_pi_webhook_test');
      assert.strictEqual(result.bookingId, 'booking_123');
      assert.strictEqual(result.amount, 200);
      assert.strictEqual(result.status, 'completed');
    });

    test('rejects invalid webhook signature', async () => {
      const result = await mockProvider.verifyWebhook({
        rawBody: Buffer.from(JSON.stringify({ type: 'payment_intent.succeeded' })),
        signature: 'invalid_signature'
      });

      assert.strictEqual(result.verified, false);
      assert.match(result.errorMessage, /Invalid mock webhook signature/);
    });

    test('rejects malformed JSON body with 400 Bad Request', async () => {
      await assert.rejects(
        () =>
          mockProvider.verifyWebhook({
            rawBody: 'not valid json {{{',
            signature: 'mock_sig_valid'
          }),
        /Malformed webhook body: invalid JSON/
      );
    });

    test('rejects raw card credentials present inside webhook payload (PCI Protection)', async () => {
      const unsafePayload = JSON.stringify({
        type: 'payment_intent.succeeded',
        data: {
          transactionId: 'mock_pi_123',
          cvv: '999'
        }
      });

      await assert.rejects(
        () =>
          mockProvider.verifyWebhook({
            rawBody: Buffer.from(unsafePayload),
            signature: 'mock_sig_valid'
          }),
        /Security Violation: Passing raw payment credentials/
      );
    });
  });

  describe('MockPaymentProvider - Refund Processing', () => {
    const mockProvider = new MockPaymentProvider();

    test('successfully processes full refund simulation', async () => {
      const res = await mockProvider.refund({
        transactionId: 'mock_pi_5000',
        amount: 250,
        originalAmount: 250,
        reason: 'Customer cancelled prior to stay'
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.provider, 'mock');
      assert.strictEqual(res.status, 'completed');
      assert.strictEqual(res.amount, 250);
      assert.strictEqual(res.isFullRefund, true);
      assert.ok(res.refundTransactionId.startsWith('mock_ref_'));
      assert.strictEqual(res.originalTransactionId, 'mock_pi_5000');
      assert.ok(res.refundedAt instanceof Date);
      assert.strictEqual(res.rawResponse.mock, true);
    });

    test('successfully processes partial refund simulation', async () => {
      const res = await mockProvider.refund({
        transactionId: 'mock_pi_5001',
        amount: 100,
        originalAmount: 250,
        reason: 'Late checkout compensation'
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.status, 'completed');
      assert.strictEqual(res.amount, 100);
      assert.strictEqual(res.isFullRefund, false);
      assert.strictEqual(res.reason, 'Late checkout compensation');
    });

    test('rejects refund amount greater than original payment amount with 400 Bad Request', async () => {
      await assert.rejects(
        () =>
          mockProvider.refund({
            transactionId: 'mock_pi_5002',
            amount: 300,
            originalAmount: 250
          }),
        /Refund amount cannot exceed original payment amount/
      );
    });

    test('rejects invalid or non-positive refund amounts', async () => {
      await assert.rejects(
        () =>
          mockProvider.refund({
            transactionId: 'mock_pi_5003',
            amount: 0,
            originalAmount: 250
          }),
        /Refund amount must be a finite positive number/
      );

      await assert.rejects(
        () =>
          mockProvider.refund({
            transactionId: 'mock_pi_5004',
            amount: -50,
            originalAmount: 250
          }),
        /Refund amount must be a finite positive number/
      );
    });

    test('simulates deterministic refund failure upon request', async () => {
      const res = await mockProvider.refund({
        transactionId: 'mock_pi_5005',
        amount: 100,
        originalAmount: 100,
        simulation: {
          shouldFail: true,
          failureReason: 'Banking rail settlement timeout'
        }
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.status, 'failed');
      assert.strictEqual(res.isFullRefund, false);
      assert.strictEqual(res.refundedAt, null);
      assert.strictEqual(res.errorMessage, 'Banking rail settlement timeout');
      assert.ok(res.refundTransactionId.startsWith('mock_ref_failed_'));
    });

    test('rejects sensitive card data passed to refund (PCI Protection)', async () => {
      await assert.rejects(
        () =>
          mockProvider.refund({
            transactionId: 'mock_pi_5006',
            amount: 50,
            originalAmount: 100,
            pin: '1234'
          }),
        /Security Violation: Passing raw payment credentials/
      );
    });
  });
});
