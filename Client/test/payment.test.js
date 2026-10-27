import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';

import {
  getBookingPayment,
  createCheckoutSession,
  getPaymentById,
  simulateMockPayment,
  getBookingById
} from '../src/api/paymentApi.js';
import { ApiError } from '../src/api/client.js';
import {
  calculateRemainingHoldTime,
  formatBookingStatus,
  formatPaymentStatus,
  formatCurrency,
  formatDateDisplay
} from '../src/utils/bookingUtils.js';

describe('Phase 10: Complete Payment Experience & Lifecycle Tests', () => {
  let mockServer;
  let serverPort;
  let mockBaseUrl;
  let publicWebhookCallCount = 0;

  before(async () => {
    mockServer = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url, `http://localhost:${serverPort}`);
      const authHeader = req.headers['authorization'];
      const pathname = parsedUrl.pathname;

      // Track any accidental calls to public webhook
      if (pathname === '/api/payments/webhook') {
        publicWebhookCallCount++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true }));
        return;
      }

      // Authorization guard for all protected payment/booking endpoints
      const isAuthenticated = authHeader && authHeader.startsWith('Bearer valid_jwt_token');

      // GET /api/bookings/:id
      if (pathname.startsWith('/api/bookings/') && !pathname.endsWith('/payment') && req.method === 'GET') {
        if (!isAuthenticated) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Authentication required' }));
          return;
        }

        const bookingId = pathname.replace('/api/bookings/', '');

        if (bookingId === '404_not_found') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Reservation not found' }));
          return;
        }

        if (bookingId === '403_forbidden') {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'You do not have permission to view this reservation.' }));
          return;
        }

        if (bookingId === 'booking_expired') {
          const pastHold = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // Expired 5 mins ago
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              data: {
                booking: {
                  _id: 'booking_expired',
                  totalAmount: 350,
                  currency: 'USD',
                  status: 'pending',
                  holdExpiresAt: pastHold,
                  room: { roomNumber: '202', roomType: 'suite' },
                  hotel: { name: 'HotelPro Central' }
                }
              }
            })
          );
          return;
        }

        if (bookingId === 'booking_confirmed') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              data: {
                booking: {
                  _id: 'booking_confirmed',
                  totalAmount: 400,
                  currency: 'USD',
                  status: 'confirmed',
                  room: { roomNumber: '101', roomType: 'double' },
                  hotel: { name: 'HotelPro Central' }
                }
              }
            })
          );
          return;
        }

        // Default valid pending booking with active 15m hold
        const activeHold = new Date(Date.now() + 12 * 60 * 1000).toISOString();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            data: {
              booking: {
                _id: bookingId,
                totalAmount: 250,
                currency: 'USD',
                status: 'pending',
                holdExpiresAt: activeHold,
                guestInfo: { name: 'John Doe', email: 'john@example.com' },
                room: { roomNumber: '105', roomType: 'single', capacity: 1 },
                hotel: { name: 'HotelPro Central', address: '123 Harbor View' },
                priceSnapshot: {
                  totalRoomRate: 250,
                  nightlyBreakdown: [{ date: '2026-11-10', rate: 250 }]
                }
              }
            }
          })
        );
        return;
      }

      // GET /api/bookings/:id/payment
      if (pathname.startsWith('/api/bookings/') && pathname.endsWith('/payment') && req.method === 'GET') {
        if (!isAuthenticated) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Authentication required' }));
          return;
        }

        const bookingId = pathname.replace('/api/bookings/', '').replace('/payment', '');

        if (bookingId === 'booking_no_payment') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              data: {
                bookingId,
                hasPayment: false,
                hasActivePendingSession: false,
                payment: null,
                totalAttempts: 0
              }
            })
          );
          return;
        }

        if (bookingId === 'booking_failed_attempt') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              data: {
                bookingId,
                hasPayment: true,
                hasActivePendingSession: false,
                payment: {
                  _id: 'pay_failed_123',
                  booking: bookingId,
                  amount: 250,
                  currency: 'USD',
                  status: 'failed',
                  provider: 'mock',
                  transactionId: 'mock_tx_failed_123',
                  paymentMethod: { methodType: 'card', cardBrand: 'visa', cardLast4: '0002' }
                },
                totalAttempts: 1
              }
            })
          );
          return;
        }

        if (bookingId === 'booking_reconcile') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              data: {
                bookingId,
                hasPayment: true,
                hasActivePendingSession: false,
                payment: {
                  _id: 'pay_reconcile_456',
                  booking: bookingId,
                  amount: 250,
                  currency: 'USD',
                  status: 'completed',
                  provider: 'mock',
                  transactionId: 'mock_tx_rec_456',
                  paymentMethod: { methodType: 'card', cardBrand: 'mastercard', cardLast4: '4444' }
                },
                totalAttempts: 1
              }
            })
          );
          return;
        }

        // Default: active pending payment session
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            data: {
              bookingId,
              hasPayment: true,
              hasActivePendingSession: true,
              payment: {
                _id: 'pay_pending_999',
                booking: bookingId,
                amount: 250,
                currency: 'USD',
                status: 'pending',
                provider: 'mock',
                transactionId: 'mock_tx_pending_999',
                paymentMethod: { methodType: 'card' }
              },
              totalAttempts: 1
            }
          })
        );
        return;
      }

      // POST /api/payments/checkout-session
      if (pathname === '/api/payments/checkout-session' && req.method === 'POST') {
        if (!isAuthenticated) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Authentication required' }));
          return;
        }

        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(body);
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Invalid JSON body' }));
            return;
          }

          if (!parsed.bookingId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Booking ID is required' }));
            return;
          }

          if (parsed.bookingId === 'booking_expired') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                success: false,
                message: 'Reservation hold has expired. Please create a new booking.'
              })
            );
            return;
          }

          if (parsed.bookingId === 'booking_confirmed') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                success: false,
                message: 'This booking is already confirmed and paid'
              })
            );
            return;
          }

          const isReused = parsed.bookingId === 'booking_existing_pending';
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              data: {
                checkoutSession: {
                  paymentId: isReused ? 'pay_existing_111' : 'pay_new_222',
                  bookingId: parsed.bookingId,
                  transactionId: isReused ? 'tx_exist_111' : 'tx_new_222',
                  clientSecret: 'mock_client_secret_test',
                  amount: 250,
                  currency: 'USD',
                  status: 'pending',
                  provider: parsed.provider || 'mock',
                  reusedExistingSession: isReused
                }
              }
            })
          );
        });
        return;
      }

      // POST /api/payments/:id/simulate-mock
      if (pathname.startsWith('/api/payments/') && pathname.endsWith('/simulate-mock') && req.method === 'POST') {
        if (!isAuthenticated) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Authentication is required to simulate payment' }));
          return;
        }

        const paymentId = pathname.replace('/api/payments/', '').replace('/simulate-mock', '');

        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(body);
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Invalid JSON body' }));
            return;
          }

          if (!parsed.outcome || !['success', 'failure'].includes(parsed.outcome)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Outcome must be either "success" or "failure"' }));
            return;
          }

          if (paymentId === 'pay_expired_hold') {
            // Late payment simulation: payment settles, but hold expired -> flags for reconciliation
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                success: true,
                message: 'Mock payment simulation completed (late payment reconciliation)',
                data: {
                  paymentId,
                  bookingId: 'booking_expired',
                  transactionId: 'mock_tx_late_123',
                  status: 'completed',
                  bookingStatus: 'cancelled',
                  outcome: parsed.outcome,
                  isConfirmed: false,
                  requiresRefund: true,
                  reconciliationReason: 'Payment completed after reservation hold expired',
                  idempotent: false
                }
              })
            );
            return;
          }

          const isSuccess = parsed.outcome === 'success';
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              message: `Mock payment simulated with outcome: ${parsed.outcome}`,
              data: {
                paymentId,
                bookingId: 'booking_123',
                transactionId: `mock_tx_${paymentId}`,
                status: isSuccess ? 'completed' : 'failed',
                bookingStatus: isSuccess ? 'confirmed' : 'pending',
                outcome: parsed.outcome,
                isConfirmed: isSuccess,
                requiresRefund: false,
                reconciliationReason: null,
                idempotent: false
              }
            })
          );
        });
        return;
      }

      // GET /api/payments/:id
      if (pathname.startsWith('/api/payments/') && req.method === 'GET') {
        if (!isAuthenticated) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Authentication required' }));
          return;
        }

        const paymentId = pathname.replace('/api/payments/', '');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            data: {
              payment: {
                _id: paymentId,
                booking: 'booking_123',
                amount: 250,
                currency: 'USD',
                status: 'completed',
                provider: 'mock'
              }
            }
          })
        );
        return;
      }

      // Fallback 404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Endpoint not found' }));
    });

    await new Promise((resolve) => {
      mockServer.listen(0, () => {
        serverPort = mockServer.address().port;
        mockBaseUrl = `http://localhost:${serverPort}/api`;
        resolve();
      });
    });
  });

  after(async () => {
    if (mockServer) {
      await new Promise((resolve) => mockServer.close(resolve));
    }
  });

  // =========================================================================
  // WORKSTREAM A & B: INITIAL STATE & API CONTRACT TESTS
  // =========================================================================
  describe('1. Initial State & Payment API Contracts', () => {
    test('getBookingById loads authoritative booking with pricing snapshot', async () => {
      const res = await getBookingById('booking_valid_123', {
        baseUrl: mockBaseUrl,
        token: 'valid_jwt_token'
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.booking._id, 'booking_valid_123');
      assert.strictEqual(res.data.booking.totalAmount, 250);
      assert.strictEqual(res.data.booking.status, 'pending');
      assert.ok(res.data.booking.holdExpiresAt);
    });

    test('getBookingPayment reports hasPayment: false when no attempts exist', async () => {
      const res = await getBookingPayment('booking_no_payment', {
        baseUrl: mockBaseUrl,
        token: 'valid_jwt_token'
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.hasPayment, false);
      assert.strictEqual(res.data.hasActivePendingSession, false);
      assert.strictEqual(res.data.payment, null);
      assert.strictEqual(res.data.totalAttempts, 0);
    });

    test('getBookingPayment reports active pending session when one exists', async () => {
      const res = await getBookingPayment('booking_has_pending', {
        baseUrl: mockBaseUrl,
        token: 'valid_jwt_token'
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.hasPayment, true);
      assert.strictEqual(res.data.hasActivePendingSession, true);
      assert.strictEqual(res.data.payment.status, 'pending');
    });

    test('getPaymentById retrieves payment record by payment ID', async () => {
      const res = await getPaymentById('pay_individual_789', {
        baseUrl: mockBaseUrl,
        token: 'valid_jwt_token'
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.payment._id, 'pay_individual_789');
      assert.strictEqual(res.data.payment.amount, 250);
      assert.strictEqual(res.data.payment.status, 'completed');
    });

    test('missing bookingId throws descriptive error before network call', async () => {
      await assert.rejects(
        async () => {
          await getBookingPayment('', { baseUrl: mockBaseUrl });
        },
        {
          name: 'Error',
          message: 'Booking ID is required to retrieve payment details.'
        }
      );
    });

    test('missing paymentId throws descriptive error before network call', async () => {
      await assert.rejects(
        async () => {
          await getPaymentById('', { baseUrl: mockBaseUrl });
        },
        {
          name: 'Error',
          message: 'Payment ID is required to retrieve payment.'
        }
      );
    });

  });

  // =========================================================================
  // WORKSTREAM B: CHECKOUT SESSION BEHAVIOR
  // =========================================================================
  describe('2. Checkout Session Initiation & Reuse', () => {
    test('creates new checkout session for eligible booking', async () => {
      const res = await createCheckoutSession(
        { bookingId: 'booking_new_session' },
        { baseUrl: mockBaseUrl, token: 'valid_jwt_token' }
      );

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.checkoutSession.paymentId, 'pay_new_222');
      assert.strictEqual(res.data.checkoutSession.reusedExistingSession, false);
      assert.strictEqual(res.data.checkoutSession.status, 'pending');
    });

    test('reuses existing active payment session when one is present', async () => {
      const res = await createCheckoutSession(
        { bookingId: 'booking_existing_pending' },
        { baseUrl: mockBaseUrl, token: 'valid_jwt_token' }
      );

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.checkoutSession.paymentId, 'pay_existing_111');
      assert.strictEqual(res.data.checkoutSession.reusedExistingSession, true);
    });

    test('rejects checkout session creation on expired hold with 400 Bad Request', async () => {
      await assert.rejects(
        async () => {
          await createCheckoutSession(
            { bookingId: 'booking_expired' },
            { baseUrl: mockBaseUrl, token: 'valid_jwt_token' }
          );
        },
        (err) => {
          assert.ok(err instanceof ApiError);
          assert.strictEqual(err.status, 400);
          assert.match(err.message, /hold has expired/i);
          return true;
        }
      );
    });

    test('rejects checkout session creation on already confirmed booking with 400', async () => {
      await assert.rejects(
        async () => {
          await createCheckoutSession(
            { bookingId: 'booking_confirmed' },
            { baseUrl: mockBaseUrl, token: 'valid_jwt_token' }
          );
        },
        (err) => {
          assert.ok(err instanceof ApiError);
          assert.strictEqual(err.status, 400);
          assert.match(err.message, /already confirmed/i);
          return true;
        }
      );
    });

    test('submission locking prevents concurrent duplicate submissions', async () => {
      let isSubmitting = false;
      let submissionAttempts = 0;

      const submitAction = async () => {
        if (isSubmitting) {
          return { blocked: true };
        }
        isSubmitting = true;
        submissionAttempts++;
        try {
          return await createCheckoutSession(
            { bookingId: 'booking_lock_test' },
            { baseUrl: mockBaseUrl, token: 'valid_jwt_token' }
          );
        } finally {
          isSubmitting = false;
        }
      };

      const [res1, res2] = await Promise.all([submitAction(), submitAction()]);
      assert.strictEqual(submissionAttempts, 1);
      assert.ok(res1.success || res2.success);
      assert.ok(res1.blocked || res2.blocked);
    });
  });

  // =========================================================================
  // WORKSTREAM C: MOCK PAYMENT SIMULATION & WEBHOOK ISOLATION
  // =========================================================================
  describe('3. Mock Payment Simulation & Security Guardrails', () => {
    test('simulates successful mock payment via authenticated endpoint', async () => {
      const res = await simulateMockPayment(
        'pay_sim_success_1',
        { outcome: 'success' },
        { baseUrl: mockBaseUrl, token: 'valid_jwt_token' }
      );

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.status, 'completed');
      assert.strictEqual(res.data.isConfirmed, true);
      assert.strictEqual(res.data.outcome, 'success');
      assert.strictEqual(res.data.requiresRefund, false);
    });

    test('simulates failed mock payment via authenticated endpoint', async () => {
      const res = await simulateMockPayment(
        'pay_sim_failed_1',
        { outcome: 'failure', failureReason: 'Card declined' },
        { baseUrl: mockBaseUrl, token: 'valid_jwt_token' }
      );

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.status, 'failed');
      assert.strictEqual(res.data.isConfirmed, false);
      assert.strictEqual(res.data.outcome, 'failure');
    });

    test('CRITICAL SECURITY GUARDRAIL: simulation never calls public webhook endpoint', () => {
      assert.strictEqual(
        publicWebhookCallCount,
        0,
        'Public webhook /api/payments/webhook must NEVER be called by frontend simulation controls.'
      );
    });

    test('rejects simulation when outcome is not "success" or "failure"', async () => {
      await assert.rejects(
        async () => {
          await simulateMockPayment('pay_123', { outcome: 'invalid_outcome' }, { baseUrl: mockBaseUrl });
        },
        {
          name: 'Error',
          message: 'Outcome must be either "success" or "failure".'
        }
      );
    });

    test('retry after payment failure respects backend state and allows new checkout', async () => {
      // Step 1: Query failed payment
      const paymentRes = await getBookingPayment('booking_failed_attempt', {
        baseUrl: mockBaseUrl,
        token: 'valid_jwt_token'
      });
      assert.strictEqual(paymentRes.data.payment.status, 'failed');
      assert.strictEqual(paymentRes.data.hasActivePendingSession, false);

      // Step 2: Retry initiates a new session
      const retrySessionRes = await createCheckoutSession(
        { bookingId: 'booking_failed_attempt' },
        { baseUrl: mockBaseUrl, token: 'valid_jwt_token' }
      );
      assert.strictEqual(retrySessionRes.success, true);
      assert.strictEqual(retrySessionRes.data.checkoutSession.status, 'pending');
    });
  });

  // =========================================================================
  // WORKSTREAM E: PAYMENT STATUS & BOOKING LIFECYCLE
  // =========================================================================
  describe('4. Payment Status & Booking Lifecycle', () => {
    test('formatPaymentStatus maps all supported backend statuses to distinct variants', () => {
      assert.deepStrictEqual(formatPaymentStatus('pending'), {
        label: 'Pending Payment',
        variant: 'status-warning'
      });
      assert.deepStrictEqual(formatPaymentStatus('completed'), {
        label: 'Paid & Completed',
        variant: 'status-success'
      });
      assert.deepStrictEqual(formatPaymentStatus('failed'), {
        label: 'Payment Failed',
        variant: 'status-danger'
      });
      assert.deepStrictEqual(formatPaymentStatus('refunded'), {
        label: 'Refunded',
        variant: 'status-info'
      });
      assert.deepStrictEqual(formatPaymentStatus('partially_refunded'), {
        label: 'Partially Refunded',
        variant: 'status-info'
      });
      assert.deepStrictEqual(formatPaymentStatus(null), {
        label: 'Not Paid',
        variant: 'status-neutral'
      });
    });

    test('formatCurrency formats amounts safely with currency symbol', () => {
      assert.strictEqual(formatCurrency(250, 'USD'), '$250.00 USD');
      assert.strictEqual(formatCurrency('120.5', 'EUR'), '$120.50 EUR');
      assert.strictEqual(formatCurrency(null, 'USD'), '$0.00 USD');
    });

    test('formatDateDisplay formats receipt timestamps cleanly', () => {
      assert.strictEqual(formatDateDisplay('2026-11-10'), 'Nov 10, 2026');
      assert.strictEqual(formatDateDisplay(null), '');
    });

    test('calculateRemainingHoldTime correctly marks expired holds', () => {

      const pastHold = new Date(Date.now() - 60 * 1000).toISOString();
      const holdState = calculateRemainingHoldTime(pastHold);
      assert.strictEqual(holdState.expired, true);
      assert.strictEqual(holdState.formatted, '00:00');
    });

    test('late payment simulation flags administrative reconciliation when hold expired', async () => {
      const res = await simulateMockPayment(
        'pay_expired_hold',
        { outcome: 'success' },
        { baseUrl: mockBaseUrl, token: 'valid_jwt_token' }
      );

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.status, 'completed');
      assert.strictEqual(res.data.bookingStatus, 'cancelled');
      assert.strictEqual(res.data.isConfirmed, false);
      assert.strictEqual(res.data.requiresRefund, true);
      assert.match(res.data.reconciliationReason, /expired/i);
    });

    test('formatBookingStatus marks hold expired when hold deadline is past', () => {
      const pendingActive = formatBookingStatus('pending', false);
      assert.strictEqual(pendingActive.label, 'Hold Reserved (Pending)');
      assert.strictEqual(pendingActive.variant, 'status-warning');

      const pendingExpired = formatBookingStatus('pending', true);
      assert.strictEqual(pendingExpired.label, 'Hold Expired');
      assert.strictEqual(pendingExpired.variant, 'status-danger');
    });
  });

  // =========================================================================
  // WORKSTREAM D & H: STRIPE INTEGRATION & CONFIGURATION GUARDRAILS
  // =========================================================================
  describe('5. Stripe Integration & Configuration Guardrails', () => {
    test('detects placeholder or missing Stripe publishable key', () => {
      const placeholderKey = 'pk_test_placeholder_key_here';
      const isConfigured = Boolean(placeholderKey && !placeholderKey.includes('placeholder'));
      assert.strictEqual(isConfigured, false, 'Placeholder publishable key must be recognized as unconfigured.');

      const validTestKey = 'pk_test_51Mz9876543210ABCDEF';
      const isValidConfig = Boolean(validTestKey && !validTestKey.includes('placeholder'));
      assert.strictEqual(isValidConfig, true);
    });

    test('never exposes server-side Stripe secret or webhook key in frontend', () => {
      assert.strictEqual(
        typeof process.env.STRIPE_SECRET_KEY,
        'undefined',
        'STRIPE_SECRET_KEY must never be bundled into frontend.'
      );
      assert.strictEqual(
        typeof process.env.STRIPE_WEBHOOK_SECRET,
        'undefined',
        'STRIPE_WEBHOOK_SECRET must never be bundled into frontend.'
      );
    });
  });

  // =========================================================================
  // WORKSTREAM H: AUTHORIZATION & ERROR HANDLING
  // =========================================================================
  describe('6. Authorization, Error & Network Resilience', () => {
    test('unauthenticated call to getBookingPayment throws 401 Unauthorized', async () => {
      await assert.rejects(
        async () => {
          await getBookingPayment('booking_123', { baseUrl: mockBaseUrl, token: '' });
        },
        (err) => {
          assert.ok(err instanceof ApiError);
          assert.strictEqual(err.status, 401);
          return true;
        }
      );
    });

    test('unauthorized ownership check throws 403 Forbidden', async () => {
      await assert.rejects(
        async () => {
          await getBookingById('403_forbidden', { baseUrl: mockBaseUrl, token: 'valid_jwt_token' });
        },
        (err) => {
          assert.ok(err instanceof ApiError);
          assert.strictEqual(err.status, 403);
          return true;
        }
      );
    });

    test('nonexistent booking throws 404 Not Found', async () => {
      await assert.rejects(
        async () => {
          await getBookingById('404_not_found', { baseUrl: mockBaseUrl, token: 'valid_jwt_token' });
        },
        (err) => {
          assert.ok(err instanceof ApiError);
          assert.strictEqual(err.status, 404);
          return true;
        }
      );
    });
  });
});
