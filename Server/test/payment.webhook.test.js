require('dotenv').config();
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const app = require('../app');
const { Hotel, Room, Booking, Payment, User, WebhookEvent } = require('../src/models');
const { signToken } = require('../src/config/jwt');
const { getPaymentProvider } = require('../src/services/payment');

describe('Stage 6.3: Payment Webhook Processing Tests', () => {
  const ISOLATED_TEST_DB_URI = 'mongodb://127.0.0.1:27017/hotelpro_payment_webhook_isolation';
  let server;
  let baseUrl;

  let testHotel;
  let testRoom;
  let customerUser;
  let customerToken;

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

    // Initialize all schemas and indexes
    await Hotel.init();
    await Room.init();
    await Booking.init();
    await Payment.init();
    await User.init();
    await WebhookEvent.init();
  });

  beforeEach(async () => {
    // Clean test collections before each test to guarantee fresh state
    await Hotel.deleteMany({});
    await Room.deleteMany({});
    await Booking.deleteMany({});
    await Payment.deleteMany({});
    await User.deleteMany({});
    await WebhookEvent.deleteMany({});
    getPaymentProvider('mock').clearWebhookHooks();

    // Seed test customer
    customerUser = await User.create({
      name: 'Alice Traveler',
      email: 'alice.webhook@hotelpro.com',
      passwordHash: '$2a$12$e8YQzabcdef1234567890',
      role: 'customer',
      status: 'active'
    });
    customerToken = signToken({ sub: customerUser._id.toString(), role: 'customer' });

    // Seed test hotel
    testHotel = await Hotel.create({
      name: 'Laguna Beach Resort',
      address: { street: '100 Ocean Blvd', city: 'Laguna Beach', country: 'USA' },
      contact: { phone: '+19495550100', email: 'stay@lagunabeach.com' },
      status: 'active',
      isActive: true
    });

    // Seed test room
    testRoom = await Room.create({
      hotel: testHotel._id,
      roomNumber: '401',
      roomType: 'suite',
      basePrice: 250,
      capacity: 2,
      status: 'active'
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.dropDatabase();
      await mongoose.connection.close(false);
    }
  });

  // Helper to create a standard pending booking and payment record
  const createPendingBookingAndPayment = async (customTotal = 500, customCurrency = 'USD') => {
    const booking = await Booking.create({
      hotel: testHotel._id,
      room: testRoom._id,
      user: customerUser._id,
      checkInDate: new Date('2027-12-01T00:00:00.000Z'),
      checkOutDate: new Date('2027-12-03T00:00:00.000Z'),
      guestInfo: { name: 'Alice Traveler', email: 'alice.webhook@hotelpro.com' },
      guestCount: 2,
      priceSnapshot: {
        baseNightlyRate: 250,
        nightlyBreakdown: [
          { date: '2027-12-01', rate: 250 },
          { date: '2027-12-02', rate: 250 }
        ],
        totalRoomRate: customTotal,
        taxes: 0,
        fees: 0
      },
      totalAmount: customTotal,
      currency: customCurrency,
      status: 'pending'
    });

    const transactionId = `mock_pi_test_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const payment = await Payment.create({
      booking: booking._id,
      amount: customTotal,
      currency: customCurrency,
      provider: 'mock',
      status: 'pending',
      transactionId,
      paymentMethod: { methodType: 'card', cardBrand: 'MockVisa', cardLast4: '4242' },
      metadata: new Map([['bookingId', booking._id.toString()]])
    });

    return { booking, payment, transactionId };
  };

  // ==========================================
  // 1. Signature Verification & Body Handling
  // ==========================================
  describe('Signature Verification & Body Handling', () => {
    test('1. valid mock-provider signature processes successfully', async () => {
      const { booking, payment, transactionId } = await createPendingBookingAndPayment(500, 'USD');

      const payload = JSON.stringify({
        id: `evt_sig_valid_${Date.now()}`,
        type: 'payment_intent.succeeded',
        data: {
          transactionId,
          amount: 500,
          currency: 'USD',
          status: 'completed'
        }
      });

      const res = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-mock-signature': 'mock_sig_valid'
        },
        body: payload
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.bookingConfirmed, true);

      // Verify payment was updated to completed
      const updatedPayment = await Payment.findById(payment._id);
      assert.strictEqual(updatedPayment.status, 'completed');

      // Verify booking was updated to confirmed
      const updatedBooking = await Booking.findById(booking._id);
      assert.strictEqual(updatedBooking.status, 'confirmed');
    });

    test('2. invalid signature is rejected without state changes (400 Bad Request)', async () => {
      const { booking, payment, transactionId } = await createPendingBookingAndPayment(500, 'USD');

      const payload = JSON.stringify({
        id: `evt_sig_invalid_${Date.now()}`,
        type: 'payment_intent.succeeded',
        data: {
          transactionId,
          amount: 500,
          currency: 'USD',
          status: 'completed'
        }
      });

      const res = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-mock-signature': 'invalid_signature'
        },
        body: payload
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.match(body.message, /invalid mock webhook signature/i);

      // Verify NO state changes occurred
      const unchangedPayment = await Payment.findById(payment._id);
      assert.strictEqual(unchangedPayment.status, 'pending');

      const unchangedBooking = await Booking.findById(booking._id);
      assert.strictEqual(unchangedBooking.status, 'pending');

      // Verify no WebhookEvent was marked completed
      const eventsCount = await WebhookEvent.countDocuments();
      assert.strictEqual(eventsCount, 0);
    });

    test('3. malformed payload is rejected with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-mock-signature': 'mock_sig_valid'
        },
        body: 'invalid-json-body-{{{}}'
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.success, false);
    });

    test('4. unsupported event type is acknowledged safely without state changes', async () => {
      const { booking, payment, transactionId } = await createPendingBookingAndPayment(500, 'USD');

      const payload = JSON.stringify({
        id: `evt_unsupported_${Date.now()}`,
        type: 'customer.subscription.created',
        data: {
          transactionId
        }
      });

      const res = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-mock-signature': 'mock_sig_valid'
        },
        body: payload
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.ignored, true);
      assert.match(body.message, /acknowledged without state changes/i);

      // Verify payment and booking remain untouched
      const unchangedPayment = await Payment.findById(payment._id);
      assert.strictEqual(unchangedPayment.status, 'pending');

      const unchangedBooking = await Booking.findById(booking._id);
      assert.strictEqual(unchangedBooking.status, 'pending');
    });
  });

  // ==========================================
  // 2. Successful Payment & Booking Confirmation
  // ==========================================
  describe('Successful Payment & Booking Confirmation', () => {
    test('5. successful payment updates Payment and confirms an eligible booking', async () => {
      const { booking, payment, transactionId } = await createPendingBookingAndPayment(300, 'USD');

      const res = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-mock-signature': 'mock_sig_valid'
        },
        body: JSON.stringify({
          id: `evt_succ_${Date.now()}`,
          type: 'payment_intent.succeeded',
          data: {
            transactionId,
            amount: 300,
            currency: 'USD',
            status: 'completed'
          }
        })
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.bookingConfirmed, true);

      const dbPayment = await Payment.findById(payment._id);
      assert.strictEqual(dbPayment.status, 'completed');

      const dbBooking = await Booking.findById(booking._id);
      assert.strictEqual(dbBooking.status, 'confirmed');
    });

    test('6. duplicate delivery of the same event does not repeat business effects (Idempotency)', async () => {
      const { booking, payment, transactionId } = await createPendingBookingAndPayment(300, 'USD');

      const eventId = `evt_idempotent_${Date.now()}`;
      const payload = JSON.stringify({
        id: eventId,
        type: 'payment_intent.succeeded',
        data: {
          transactionId,
          amount: 300,
          currency: 'USD',
          status: 'completed'
        }
      });

      // Delivery 1
      const res1 = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mock-signature': 'mock_sig_valid' },
        body: payload
      });
      assert.strictEqual(res1.status, 200);
      const body1 = await res1.json();
      assert.strictEqual(body1.bookingConfirmed, true);

      // Delivery 2 (Identical event ID)
      const res2 = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mock-signature': 'mock_sig_valid' },
        body: payload
      });
      assert.strictEqual(res2.status, 200);
      const body2 = await res2.json();
      assert.strictEqual(body2.success, true);
      assert.strictEqual(body2.idempotent, true);
      assert.match(body2.message, /already processed/i);

      // Verify exactly ONE WebhookEvent was saved
      const events = await WebhookEvent.find({ eventId });
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].status, 'completed');
    });

    test('7. concurrent delivery of the same event executes safely without race condition', async () => {
      const { booking, payment, transactionId } = await createPendingBookingAndPayment(450, 'USD');

      const eventId = `evt_concurrent_${Date.now()}`;
      const payload = JSON.stringify({
        id: eventId,
        type: 'payment_intent.succeeded',
        data: {
          transactionId,
          amount: 450,
          currency: 'USD',
          status: 'completed'
        }
      });

      // Fire two concurrent deliveries simultaneously
      const [res1, res2] = await Promise.all([
        fetch(`${baseUrl}/api/payments/webhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-mock-signature': 'mock_sig_valid' },
          body: payload
        }),
        fetch(`${baseUrl}/api/payments/webhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-mock-signature': 'mock_sig_valid' },
          body: payload
        })
      ]);

      assert.strictEqual(res1.status, 200);
      assert.strictEqual(res2.status, 200);

      const body1 = await res1.json();
      const body2 = await res2.json();
      assert.strictEqual(body1.success, true);
      assert.strictEqual(body2.success, true);

      // Verify payment and booking were completed cleanly
      const dbPayment = await Payment.findById(payment._id);
      assert.strictEqual(dbPayment.status, 'completed');

      const dbBooking = await Booking.findById(booking._id);
      assert.strictEqual(dbBooking.status, 'confirmed');

      // Exactly ONE WebhookEvent record exists
      const eventCount = await WebhookEvent.countDocuments({ eventId });
      assert.strictEqual(eventCount, 1);
    });
  });

  // ==========================================
  // 3. Validation & Invariant Enforcement
  // ==========================================
  describe('Amount, Currency & Identity Safeguards', () => {
    test('8. amount mismatch is rejected with 400 Bad Request and does not modify state', async () => {
      const { booking, payment, transactionId } = await createPendingBookingAndPayment(500, 'USD');

      const res = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mock-signature': 'mock_sig_valid' },
        body: JSON.stringify({
          id: `evt_amount_mismatch_${Date.now()}`,
          type: 'payment_intent.succeeded',
          data: {
            transactionId,
            amount: 1.00, // Spoofed amount!
            currency: 'USD',
            status: 'completed'
          }
        })
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.match(body.message, /amount mismatch/i);

      // Payment and booking remain pending
      const unchangedPayment = await Payment.findById(payment._id);
      assert.strictEqual(unchangedPayment.status, 'pending');

      const unchangedBooking = await Booking.findById(booking._id);
      assert.strictEqual(unchangedBooking.status, 'pending');
    });

    test('9. currency mismatch is rejected with 400 Bad Request and does not modify state', async () => {
      const { booking, payment, transactionId } = await createPendingBookingAndPayment(500, 'USD');

      const res = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mock-signature': 'mock_sig_valid' },
        body: JSON.stringify({
          id: `evt_curr_mismatch_${Date.now()}`,
          type: 'payment_intent.succeeded',
          data: {
            transactionId,
            amount: 500,
            currency: 'EUR', // Mismatched currency!
            status: 'completed'
          }
        })
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.match(body.message, /currency mismatch/i);

      const unchangedPayment = await Payment.findById(payment._id);
      assert.strictEqual(unchangedPayment.status, 'pending');
    });

    test('10. unknown transaction identifier returns safe 404 response without crashing or creating documents', async () => {
      const res = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mock-signature': 'mock_sig_valid' },
        body: JSON.stringify({
          id: `evt_unknown_tx_${Date.now()}`,
          type: 'payment_intent.succeeded',
          data: {
            transactionId: 'mock_tx_nonexistent_99999',
            amount: 100,
            currency: 'USD',
            status: 'completed'
          }
        })
      });

      assert.strictEqual(res.status, 404);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.unmapped, true);
      assert.match(body.message, /Payment record not found for provider transaction/i);

      // Verify no phantom Payment was created
      const paymentsCount = await Payment.countDocuments({ transactionId: 'mock_tx_nonexistent_99999' });
      assert.strictEqual(paymentsCount, 0);
    });
  });

  // ==========================================
  // 4. Edge Cases, Races & State Model Rules
  // ==========================================
  describe('Edge Cases, Cancellation Races & State Safety', () => {
    test('11. cancelled booking receiving a late successful payment flags for refund and does NOT confirm booking', async () => {
      const { booking, payment, transactionId } = await createPendingBookingAndPayment(400, 'USD');

      // Customer or admin cancels the booking before payment completes
      booking.status = 'cancelled';
      booking.cancellation = { cancelledAt: new Date(), reason: 'Cancelled by guest before payment' };
      await booking.save();

      // Later, gateway webhook arrives with success
      const res = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mock-signature': 'mock_sig_valid' },
        body: JSON.stringify({
          id: `evt_cancelled_late_${Date.now()}`,
          type: 'payment_intent.succeeded',
          data: {
            transactionId,
            amount: 400,
            currency: 'USD',
            status: 'completed'
          }
        })
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.bookingConfirmed, false);
      assert.strictEqual(body.requiresRefund, true);

      // Booking status must REMAIN cancelled! (Never transition cancelled back to confirmed)
      const dbBooking = await Booking.findById(booking._id);
      assert.strictEqual(dbBooking.status, 'cancelled');

      // Payment document records completed status and explicit refund reconciliation metadata
      const dbPayment = await Payment.findById(payment._id);
      assert.strictEqual(dbPayment.status, 'completed');
      assert.strictEqual(dbPayment.metadata.get('requiresRefund'), 'true');
      assert.match(dbPayment.metadata.get('reconciliationReason'), /Payment received after booking was cancelled/i);
    });

    test('12. payment already completed ignores duplicate success events safely', async () => {
      const { booking, payment, transactionId } = await createPendingBookingAndPayment(300, 'USD');

      // Pre-set payment as completed and booking as confirmed
      payment.status = 'completed';
      await payment.save();
      booking.status = 'confirmed';
      await booking.save();

      const res = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mock-signature': 'mock_sig_valid' },
        body: JSON.stringify({
          id: `evt_already_completed_${Date.now()}`,
          type: 'payment_intent.succeeded',
          data: {
            transactionId,
            amount: 300,
            currency: 'USD',
            status: 'completed'
          }
        })
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.paymentAlreadyCompleted, true);

      // Verify no mutations or errors occurred
      const dbPayment = await Payment.findById(payment._id);
      assert.strictEqual(dbPayment.status, 'completed');
    });

    test('13. failed payment receiving a success-like event is rejected (400 Bad Request)', async () => {
      const { booking, payment, transactionId } = await createPendingBookingAndPayment(250, 'USD');

      // Mark payment as failed previously
      payment.status = 'failed';
      payment.metadata.set('failureReason', 'Card was previously declined');
      await payment.save();

      // Later, unexpected success event arrives
      const res = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mock-signature': 'mock_sig_valid' },
        body: JSON.stringify({
          id: `evt_failed_later_success_${Date.now()}`,
          type: 'payment_intent.succeeded',
          data: {
            transactionId,
            amount: 250,
            currency: 'USD',
            status: 'completed'
          }
        })
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.match(body.message, /Cannot transition a failed payment to completed/i);

      // Payment remains in failed status
      const dbPayment = await Payment.findById(payment._id);
      assert.strictEqual(dbPayment.status, 'failed');
    });

    test('14. booking update failure after payment persistence and subsequent recovery', async () => {
      const { booking, payment, transactionId } = await createPendingBookingAndPayment(350, 'USD');

      // Step A: Payment was persisted as 'completed', but booking was temporarily left 'pending'
      // (Simulating transient failure during the second document update)
      payment.status = 'completed';
      await payment.save();
      assert.strictEqual(booking.status, 'pending');

      // Step B: Gateway delivers retry event
      const res = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mock-signature': 'mock_sig_valid' },
        body: JSON.stringify({
          id: `evt_retry_recovery_${Date.now()}`,
          type: 'payment_intent.succeeded',
          data: {
            transactionId,
            amount: 350,
            currency: 'USD',
            status: 'completed'
          }
        })
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);

      // Verify the recovery confirmed the booking!
      const dbBooking = await Booking.findById(booking._id);
      assert.strictEqual(dbBooking.status, 'confirmed');
    });

    test('15. two different events targeting the same payment are handled safely', async () => {
      const { booking, payment, transactionId } = await createPendingBookingAndPayment(200, 'USD');

      // Event 1: payment_intent.succeeded
      const res1 = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mock-signature': 'mock_sig_valid' },
        body: JSON.stringify({
          id: `evt_diff_1_${Date.now()}`,
          type: 'payment_intent.succeeded',
          data: {
            transactionId,
            amount: 200,
            currency: 'USD',
            status: 'completed'
          }
        })
      });

      assert.strictEqual(res1.status, 200);
      const body1 = await res1.json();
      assert.strictEqual(body1.bookingConfirmed, true);

      // Event 2: A different event ID (e.g. charge.updated) targeting the same transaction
      const res2 = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mock-signature': 'mock_sig_valid' },
        body: JSON.stringify({
          id: `evt_diff_2_${Date.now()}`,
          type: 'payment_intent.succeeded',
          data: {
            transactionId,
            amount: 200,
            currency: 'USD',
            status: 'completed'
          }
        })
      });

      assert.strictEqual(res2.status, 200);
      const body2 = await res2.json();
      assert.strictEqual(body2.success, true);
      assert.strictEqual(body2.paymentAlreadyCompleted, true);

      // Both events recorded independently in WebhookEvent
      const count = await WebhookEvent.countDocuments({ transactionId });
      assert.strictEqual(count, 2);
    });
  });

  // ==========================================
  // 5. Authentication & Route Isolation Tests
  // ==========================================
  describe('Authentication & Route Isolation', () => {
    test('16. webhook requests do NOT require customer JWT authentication', async () => {
      const { payment, transactionId } = await createPendingBookingAndPayment(100, 'USD');

      // Webhook request without Authorization header
      const res = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-mock-signature': 'mock_sig_valid'
          // NO Authorization header!
        },
        body: JSON.stringify({
          id: `evt_no_jwt_${Date.now()}`,
          type: 'payment_intent.succeeded',
          data: { transactionId, amount: 100, currency: 'USD', status: 'completed' }
        })
      });

      // Must NOT return 401 Unauthorized
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
    });

    test('17. ordinary payment routes still enforce their existing authentication and ownership rules', async () => {
      // 1. Unauthenticated checkout session is rejected with 401
      const resCheckout = await fetch(`${baseUrl}/api/payments/checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: new mongoose.Types.ObjectId().toString() })
      });
      assert.strictEqual(resCheckout.status, 401);

      // 2. Unauthenticated payment lookup is rejected with 401
      const resLookup = await fetch(`${baseUrl}/api/payments/${new mongoose.Types.ObjectId()}`);
      assert.strictEqual(resLookup.status, 401);
    });
  });

  // ==========================================
  // 6. Stage 6.4.4: Completed-Payment Webhook Retry & Reconciliation (FINDING-6.4-2)
  // ==========================================
  describe('Stage 6.4.4: Completed-Payment Webhook Retry & Reconciliation (FINDING-6.4-2)', () => {
    test('Test A — Completed payment, cancelled booking, missing refund flag', async () => {
      const { booking, payment, transactionId } = await createPendingBookingAndPayment(500, 'USD');

      // 1. Simulate failure scenario: booking was cancelled by the hold worker
      booking.status = 'cancelled';
      booking.cancellation = {
        cancelledAt: new Date(),
        reason: 'Reservation hold expired (15-minute timeout)'
      };
      await booking.save();

      // 2. Payment was completed, but lacks the requiresRefund flag and reconciliation reason
      payment.status = 'completed';
      payment.metadata = new Map([
        ['bookingId', booking._id.toString()],
        ['clientSecret', 'mock_secret_test_a']
      ]);
      await payment.save();

      // 3. Deliver a valid retry event through the actual webhook-processing path
      const retryEventId = `evt_retry_a_${Date.now()}`;
      const res = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-mock-signature': 'mock_sig_valid'
        },
        body: JSON.stringify({
          id: retryEventId,
          type: 'payment_intent.succeeded',
          data: {
            transactionId,
            amount: 500,
            currency: 'USD',
            status: 'completed'
          }
        })
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.bookingConfirmed, false);
      assert.strictEqual(body.requiresRefund, true);

      // Assert that the Payment remains completed
      const dbPayment = await Payment.findById(payment._id);
      assert.strictEqual(dbPayment.status, 'completed');

      // Assert that requiresRefund is persisted as 'true'
      assert.strictEqual(dbPayment.metadata.get('requiresRefund'), 'true');

      // Assert that a meaningful reconciliation reason is persisted
      const reason = dbPayment.metadata.get('reconciliationReason');
      assert.ok(reason, 'Reconciliation reason must be present');
      assert.match(reason, /(cancelled|expired)/i);

      // Assert that the booking remains cancelled
      const dbBooking = await Booking.findById(booking._id);
      assert.strictEqual(dbBooking.status, 'cancelled');
    });

    test('Test B — Completed payment, cancelled booking, existing metadata', async () => {
      const { booking, payment, transactionId } = await createPendingBookingAndPayment(500, 'USD');

      booking.status = 'cancelled';
      booking.cancellation = {
        cancelledAt: new Date(),
        reason: 'Cancelled by customer'
      };
      await booking.save();

      // Start with unrelated metadata already present
      payment.status = 'completed';
      payment.metadata = new Map([
        ['bookingId', booking._id.toString()],
        ['clientSecret', 'sec_keep_this_secret'],
        ['customTag', 'vip_loyalty_tier_gold'],
        ['bookingChannel', 'mobile_partner_app']
      ]);
      await payment.save();

      // Retry the event
      const retryEventId = `evt_retry_b_${Date.now()}`;
      const res = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-mock-signature': 'mock_sig_valid'
        },
        body: JSON.stringify({
          id: retryEventId,
          type: 'payment_intent.succeeded',
          data: {
            transactionId,
            amount: 500,
            currency: 'USD',
            status: 'completed'
          }
        })
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);

      // Verify the refund flag and reason are correct and unrelated metadata is preserved
      const dbPayment = await Payment.findById(payment._id);
      assert.strictEqual(dbPayment.status, 'completed');
      assert.strictEqual(dbPayment.metadata.get('requiresRefund'), 'true');
      assert.match(dbPayment.metadata.get('reconciliationReason'), /(cancelled|expired)/i);

      // Unrelated metadata preserved intact
      assert.strictEqual(dbPayment.metadata.get('clientSecret'), 'sec_keep_this_secret');
      assert.strictEqual(dbPayment.metadata.get('customTag'), 'vip_loyalty_tier_gold');
      assert.strictEqual(dbPayment.metadata.get('bookingChannel'), 'mobile_partner_app');
      assert.strictEqual(dbPayment.metadata.get('bookingId'), booking._id.toString());

      // Booking remains cancelled
      const dbBooking = await Booking.findById(booking._id);
      assert.strictEqual(dbBooking.status, 'cancelled');
    });

    test('Test C — Completed payment, confirmed booking', async () => {
      const { booking, payment, transactionId } = await createPendingBookingAndPayment(500, 'USD');

      // Pre-set as confirmed booking and completed payment
      booking.status = 'confirmed';
      await booking.save();

      payment.status = 'completed';
      payment.metadata = new Map([
        ['bookingId', booking._id.toString()],
        ['clientSecret', 'sec_confirmed_secret']
      ]);
      await payment.save();

      // Retry a valid success event
      const retryEventId = `evt_retry_c_${Date.now()}`;
      const res = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-mock-signature': 'mock_sig_valid'
        },
        body: JSON.stringify({
          id: retryEventId,
          type: 'payment_intent.succeeded',
          data: {
            transactionId,
            amount: 500,
            currency: 'USD',
            status: 'completed'
          }
        })
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.bookingConfirmed, true);

      // Verify the booking remains confirmed and the payment is not incorrectly flagged for a refund
      const dbBooking = await Booking.findById(booking._id);
      assert.strictEqual(dbBooking.status, 'confirmed');

      const dbPayment = await Payment.findById(payment._id);
      assert.strictEqual(dbPayment.status, 'completed');
      assert.notStrictEqual(dbPayment.metadata.get('requiresRefund'), 'true');
      assert.strictEqual(dbPayment.metadata.get('reconciliationReason'), undefined);
    });

    test('Test D — Completed payment, still-pending valid booking', async () => {
      // Part 1: Booking is pending and hold remains valid -> safe recovery confirms booking
      const { booking: booking1, payment: payment1, transactionId: tx1 } = await createPendingBookingAndPayment(500, 'USD');

      // Booking has future holdExpiresAt
      booking1.holdExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes in future
      await booking1.save();

      payment1.status = 'completed';
      await payment1.save();

      const res1 = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mock-signature': 'mock_sig_valid' },
        body: JSON.stringify({
          id: `evt_retry_d1_${Date.now()}`,
          type: 'payment_intent.succeeded',
          data: { transactionId: tx1, amount: 500, currency: 'USD', status: 'completed' }
        })
      });

      assert.strictEqual(res1.status, 200);
      const body1 = await res1.json();
      assert.strictEqual(body1.success, true);
      assert.strictEqual(body1.bookingConfirmed, true);

      // Verify pending booking was confirmed by the retry
      const dbBooking1 = await Booking.findById(booking1._id);
      assert.strictEqual(dbBooking1.status, 'confirmed');

      const dbPayment1 = await Payment.findById(payment1._id);
      assert.strictEqual(dbPayment1.status, 'completed');
      assert.notStrictEqual(dbPayment1.metadata.get('requiresRefund'), 'true');

      // Part 2: Booking is pending but hold HAS EXPIRED -> booking is NOT confirmed
      // Create separate booking on non-overlapping dates
      const booking2 = await Booking.create({
        hotel: testHotel._id,
        room: testRoom._id,
        user: customerUser._id,
        checkInDate: new Date('2027-12-10T00:00:00.000Z'),
        checkOutDate: new Date('2027-12-12T00:00:00.000Z'),
        guestInfo: { name: 'Alice Traveler', email: 'alice.webhook@hotelpro.com' },
        guestCount: 2,
        priceSnapshot: {
          baseNightlyRate: 250,
          nightlyBreakdown: [
            { date: '2027-12-10', rate: 250 },
            { date: '2027-12-11', rate: 250 }
          ],
          totalRoomRate: 500,
          taxes: 0,
          fees: 0
        },
        totalAmount: 500,
        currency: 'USD',
        status: 'pending',
        holdExpiresAt: new Date(Date.now() - 60 * 1000) // Expired 1 minute ago!
      });

      const tx2 = `mock_pi_test_d2_${Date.now()}`;
      const payment2 = await Payment.create({
        booking: booking2._id,
        amount: 500,
        currency: 'USD',
        provider: 'mock',
        status: 'completed',
        transactionId: tx2,
        metadata: new Map([['bookingId', booking2._id.toString()]])
      });

      const res2 = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mock-signature': 'mock_sig_valid' },
        body: JSON.stringify({
          id: `evt_retry_d2_${Date.now()}`,
          type: 'payment_intent.succeeded',
          data: { transactionId: tx2, amount: 500, currency: 'USD', status: 'completed' }
        })
      });

      assert.strictEqual(res2.status, 200);
      const body2 = await res2.json();
      assert.strictEqual(body2.success, true);
      assert.strictEqual(body2.bookingConfirmed, false);
      assert.strictEqual(body2.requiresRefund, true);

      // Ensure the booking was NOT confirmed and transitioned to cancelled
      const dbBooking2 = await Booking.findById(booking2._id);
      assert.notStrictEqual(dbBooking2.status, 'confirmed');
      assert.strictEqual(dbBooking2.status, 'cancelled');

      // Ensure payment is flagged for refund
      const dbPayment2 = await Payment.findById(payment2._id);
      assert.strictEqual(dbPayment2.status, 'completed');
      assert.strictEqual(dbPayment2.metadata.get('requiresRefund'), 'true');
      assert.match(dbPayment2.metadata.get('reconciliationReason'), /(expired|cancelled)/i);
    });

    test('Test E — Idempotent retry', async () => {
      const { booking, payment, transactionId } = await createPendingBookingAndPayment(500, 'USD');

      booking.status = 'cancelled';
      booking.cancellation = {
        cancelledAt: new Date(),
        reason: 'Reservation hold expired'
      };
      await booking.save();

      payment.status = 'completed';
      payment.metadata = new Map([
        ['bookingId', booking._id.toString()],
        ['initialKey', 'keep_safe']
      ]);
      await payment.save();

      // Deliver the same event repeatedly (3 deliveries with the same event ID)
      const sameEventId = `evt_same_${Date.now()}`;
      const samePayload = JSON.stringify({
        id: sameEventId,
        type: 'payment_intent.succeeded',
        data: {
          transactionId,
          amount: 500,
          currency: 'USD',
          status: 'completed'
        }
      });

      for (let i = 0; i < 3; i++) {
        const res = await fetch(`${baseUrl}/api/payments/webhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-mock-signature': 'mock_sig_valid' },
          body: samePayload
        });
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.strictEqual(body.success, true);
      }

      // Deliver 2 additional retry deliveries with DIFFERENT event IDs targeting the same payment
      for (let i = 0; i < 2; i++) {
        const res = await fetch(`${baseUrl}/api/payments/webhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-mock-signature': 'mock_sig_valid' },
          body: JSON.stringify({
            id: `evt_different_${Date.now()}_${i}`,
            type: 'payment_intent.succeeded',
            data: {
              transactionId,
              amount: 500,
              currency: 'USD',
              status: 'completed'
            }
          })
        });
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.strictEqual(body.success, true);
      }

      // Verify repeated deliveries do not corrupt payment metadata, change terminal booking states, or create duplicate financial records
      const dbPayment = await Payment.findById(payment._id);
      assert.strictEqual(dbPayment.status, 'completed');
      assert.strictEqual(dbPayment.metadata.get('requiresRefund'), 'true');
      assert.match(dbPayment.metadata.get('reconciliationReason'), /(cancelled|expired)/i);
      assert.strictEqual(dbPayment.metadata.get('initialKey'), 'keep_safe');

      const dbBooking = await Booking.findById(booking._id);
      assert.strictEqual(dbBooking.status, 'cancelled');

      // Exactly ONE Payment document exists for this transaction
      const paymentCount = await Payment.countDocuments({ transactionId });
      assert.strictEqual(paymentCount, 1);
    });
  });

  // ==========================================
  // 7. Stage 6.4.5: Stale WebhookEvent Lease Recovery & Ownership Fencing (FINDING-6.4-3)
  // ==========================================
  describe('Stage 6.4.5: Stale WebhookEvent Lease Recovery & Ownership Fencing (FINDING-6.4-3)', () => {
    test('Test A — Stale event recovery', async () => {
      const { booking, payment, transactionId } = await createPendingBookingAndPayment(500, 'USD');
      const eventId = `evt_stale_rec_${Date.now()}`;

      // Create a WebhookEvent in 'processing' status with an old timestamp (30 seconds in the past)
      const staleLockedAt = new Date(Date.now() - 30000);
      await WebhookEvent.create({
        provider: 'mock',
        eventId,
        eventType: 'payment_intent.succeeded',
        transactionId,
        status: 'processing',
        lockToken: 'stale-token-111',
        lockedAt: staleLockedAt
      });

      // Deliver the same valid event again through the actual webhook HTTP path
      const res = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mock-signature': 'mock_sig_valid' },
        body: JSON.stringify({
          id: eventId,
          type: 'payment_intent.succeeded',
          data: {
            transactionId,
            amount: 500,
            currency: 'USD',
            status: 'completed'
          }
        })
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.bookingConfirmed, true);

      // Verify the stale event was reclaimed and marked completed with a new lockToken
      const dbEvent = await WebhookEvent.findOne({ eventId });
      assert.strictEqual(dbEvent.status, 'completed');
      assert.notStrictEqual(dbEvent.lockToken, 'stale-token-111');
      assert.ok(dbEvent.processedAt);

      // Verify payment and booking were completed/confirmed
      const dbPayment = await Payment.findById(payment._id);
      assert.strictEqual(dbPayment.status, 'completed');

      const dbBooking = await Booking.findById(booking._id);
      assert.strictEqual(dbBooking.status, 'confirmed');
    });

    test('Test B — Fresh event is not reclaimed', async () => {
      const { booking, payment, transactionId } = await createPendingBookingAndPayment(500, 'USD');
      const eventId = `evt_fresh_lock_${Date.now()}`;

      // Create a fresh WebhookEvent currently in 'processing' status
      await WebhookEvent.create({
        provider: 'mock',
        eventId,
        eventType: 'payment_intent.succeeded',
        transactionId,
        status: 'processing',
        lockToken: 'fresh-token-original',
        lockedAt: new Date()
      });

      // Deliver a concurrent duplicate through the webhook endpoint
      // Using x-max-poll-attempts: 2 so the test doesn't wait unnecessarily
      const res = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-mock-signature': 'mock_sig_valid',
          'x-max-poll-attempts': '2',
          'x-stale-timeout-ms': '15000'
        },
        body: JSON.stringify({
          id: eventId,
          type: 'payment_intent.succeeded',
          data: {
            transactionId,
            amount: 500,
            currency: 'USD',
            status: 'completed'
          }
        })
      });

      // Concurrent duplicate rejected with 409 Conflict
      assert.strictEqual(res.status, 409);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.match(body.message, /currently being processed by another worker/i);

      // Verify the duplicate did NOT steal ownership or execute independently
      const dbEvent = await WebhookEvent.findOne({ eventId });
      assert.strictEqual(dbEvent.status, 'processing');
      assert.strictEqual(dbEvent.lockToken, 'fresh-token-original');

      // Payment and booking remain pending
      const dbPayment = await Payment.findById(payment._id);
      assert.strictEqual(dbPayment.status, 'pending');

      const dbBooking = await Booking.findById(booking._id);
      assert.strictEqual(dbBooking.status, 'pending');
    });

    test('Test C — Old handler cannot overwrite new ownership', async () => {
      const mockProvider = getPaymentProvider('mock');
      const { booking, payment, transactionId } = await createPendingBookingAndPayment(500, 'USD');
      const eventId = `evt_fencing_${Date.now()}`;

      let pauseResolve;
      const pausePromise = new Promise((resolve) => {
        pauseResolve = resolve;
      });

      // Register hook to pause Handler 1 in the middle of executeWebhookBusinessLogic
      mockProvider.setWebhookHook(eventId, async () => {
        await pausePromise;
      });

      // Start Handler 1 (without awaiting)
      const handler1Promise = fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mock-signature': 'mock_sig_valid' },
        body: JSON.stringify({
          id: eventId,
          type: 'payment_intent.succeeded',
          data: { transactionId, amount: 500, currency: 'USD', status: 'completed' }
        })
      });

      // Wait until Handler 1 has claimed the event and entered processing
      let initialEvent = null;
      for (let i = 0; i < 30; i++) {
        initialEvent = await WebhookEvent.findOne({ eventId });
        if (initialEvent && initialEvent.status === 'processing') break;
        await new Promise((r) => setTimeout(r, 25));
      }
      assert.ok(initialEvent, 'Handler 1 must have created WebhookEvent');
      const token1 = initialEvent.lockToken;
      assert.ok(token1, 'Handler 1 must have acquired a lockToken');

      // Make Handler 1's lease stale by rewinding lockedAt to 30s ago
      await WebhookEvent.updateOne(
        { _id: initialEvent._id },
        { $set: { lockedAt: new Date(Date.now() - 30000) } }
      );

      // Clear the hook so Handler 2 does not pause
      mockProvider.clearWebhookHooks();

      // Handler 2 delivers the retry event and reclaims ownership
      const res2 = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mock-signature': 'mock_sig_valid' },
        body: JSON.stringify({
          id: eventId,
          type: 'payment_intent.succeeded',
          data: { transactionId, amount: 500, currency: 'USD', status: 'completed' }
        })
      });

      assert.strictEqual(res2.status, 200);
      const body2 = await res2.json();
      assert.strictEqual(body2.success, true);

      // Verify Handler 2 completed the event with a new token
      const eventAfterH2 = await WebhookEvent.findOne({ eventId });
      assert.strictEqual(eventAfterH2.status, 'completed');
      const token2 = eventAfterH2.lockToken;
      assert.notStrictEqual(token2, token1, 'Handler 2 must have acquired a new lockToken');

      // Now resume Handler 1
      pauseResolve();
      const res1 = await handler1Promise;
      assert.strictEqual(res1.status, 200);

      // Verify Handler 1's completion update was fenced out and did NOT overwrite Handler 2's token
      const finalEvent = await WebhookEvent.findOne({ eventId });
      assert.strictEqual(finalEvent.status, 'completed');
      assert.strictEqual(finalEvent.lockToken, token2, 'Handler 2 lockToken must remain intact');
    });

    test('Test D — Crash after claim', async () => {
      const { booking, payment, transactionId } = await createPendingBookingAndPayment(500, 'USD');
      const eventId = `evt_crash_claim_${Date.now()}`;

      // Simulate a previous attempt that crashed after acquiring the claim
      const crashedLockToken = 'crashed-worker-token';
      await WebhookEvent.create({
        provider: 'mock',
        eventId,
        eventType: 'payment_intent.succeeded',
        transactionId,
        status: 'processing',
        lockToken: crashedLockToken,
        lockedAt: new Date(Date.now() - 25000) // 25 seconds ago (stale)
      });

      // Retry after lease becomes stale
      const res = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mock-signature': 'mock_sig_valid' },
        body: JSON.stringify({
          id: eventId,
          type: 'payment_intent.succeeded',
          data: {
            transactionId,
            amount: 500,
            currency: 'USD',
            status: 'completed'
          }
        })
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.bookingConfirmed, true);

      // Verify event recovered to completed without manual deletion
      const dbEvent = await WebhookEvent.findOne({ eventId });
      assert.strictEqual(dbEvent.status, 'completed');
      assert.notStrictEqual(dbEvent.lockToken, crashedLockToken);

      const dbPayment = await Payment.findById(payment._id);
      assert.strictEqual(dbPayment.status, 'completed');

      const dbBooking = await Booking.findById(booking._id);
      assert.strictEqual(dbBooking.status, 'confirmed');
    });

    test('Test E — Duplicate after successful completion', async () => {
      const { booking, payment, transactionId } = await createPendingBookingAndPayment(500, 'USD');
      const eventId = `evt_completed_dup_${Date.now()}`;

      // Complete the event initially
      const res1 = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mock-signature': 'mock_sig_valid' },
        body: JSON.stringify({
          id: eventId,
          type: 'payment_intent.succeeded',
          data: {
            transactionId,
            amount: 500,
            currency: 'USD',
            status: 'completed'
          }
        })
      });
      assert.strictEqual(res1.status, 200);

      const eventAfter1 = await WebhookEvent.findOne({ eventId });
      assert.strictEqual(eventAfter1.status, 'completed');

      // Deliver the same event again after completion
      const res2 = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mock-signature': 'mock_sig_valid' },
        body: JSON.stringify({
          id: eventId,
          type: 'payment_intent.succeeded',
          data: {
            transactionId,
            amount: 500,
            currency: 'USD',
            status: 'completed'
          }
        })
      });

      assert.strictEqual(res2.status, 200);
      const body2 = await res2.json();
      assert.strictEqual(body2.success, true);
      assert.strictEqual(body2.idempotent, true);
      assert.match(body2.message, /already processed/i);

      // Verify exactly ONE payment document exists
      const paymentCount = await Payment.countDocuments({ transactionId });
      assert.strictEqual(paymentCount, 1);

      const dbBooking = await Booking.findById(booking._id);
      assert.strictEqual(dbBooking.status, 'confirmed');
    });

    test('Test F — Failure behavior', async () => {
      const mockProvider = getPaymentProvider('mock');
      const { booking, payment, transactionId } = await createPendingBookingAndPayment(500, 'USD');
      const eventId = `evt_inject_fail_${Date.now()}`;

      // Inject controlled processing failure
      mockProvider.setWebhookHook(eventId, () => {
        throw new Error('Simulated gateway transient failure');
      });

      // Delivery 1 fails
      const res1 = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mock-signature': 'mock_sig_valid' },
        body: JSON.stringify({
          id: eventId,
          type: 'payment_intent.succeeded',
          data: { transactionId, amount: 500, currency: 'USD', status: 'completed' }
        })
      });

      assert.strictEqual(res1.status, 500);

      // Verify event was marked 'failed' and NOT 'completed'
      const dbEvent1 = await WebhookEvent.findOne({ eventId });
      assert.strictEqual(dbEvent1.status, 'failed');
      assert.match(dbEvent1.error, /Simulated gateway transient failure/i);

      // Clear the failure hook
      mockProvider.clearWebhookHooks();

      // Delivery 2 retries the failed event
      const res2 = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mock-signature': 'mock_sig_valid' },
        body: JSON.stringify({
          id: eventId,
          type: 'payment_intent.succeeded',
          data: { transactionId, amount: 500, currency: 'USD', status: 'completed' }
        })
      });

      assert.strictEqual(res2.status, 200);
      const body2 = await res2.json();
      assert.strictEqual(body2.success, true);

      // Verify the event recovered from 'failed' to 'completed'
      const dbEvent2 = await WebhookEvent.findOne({ eventId });
      assert.strictEqual(dbEvent2.status, 'completed');
      assert.strictEqual(dbEvent2.error, '');

      // Verify business records are completed/confirmed
      const dbPayment = await Payment.findById(payment._id);
      assert.strictEqual(dbPayment.status, 'completed');

      const dbBooking = await Booking.findById(booking._id);
      assert.strictEqual(dbBooking.status, 'confirmed');
    });
  });
});

