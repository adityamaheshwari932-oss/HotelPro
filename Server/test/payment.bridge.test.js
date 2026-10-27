require('dotenv').config();
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const app = require('../app');
const { Hotel, Room, Booking, Payment, User, WebhookEvent } = require('../src/models');
const { signToken } = require('../src/config/jwt');
const { expireBookingHolds } = require('../src/services/booking.service');

describe('Stage 10.2: Payment Backend Bridge Tests', () => {
  const ISOLATED_TEST_DB_URI = 'mongodb://127.0.0.1:27017/hotelpro_payment_bridge_test';
  let server;
  let baseUrl;

  let testHotel;
  let testRoom;

  let customerA;
  let customerB;
  let adminUser;
  let customerAToken;
  let customerBToken;
  let adminToken;

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
    // Reset collections before each test for fresh state
    await Hotel.deleteMany({});
    await Room.deleteMany({});
    await Booking.deleteMany({});
    await Payment.deleteMany({});
    await User.deleteMany({});
    await WebhookEvent.deleteMany({});

    // Seed test users
    adminUser = await User.create({
      name: 'System Admin',
      email: 'admin.bridge@hotelpro.com',
      passwordHash: '$2a$12$e8YQzabcdef1234567890',
      role: 'admin',
      status: 'active'
    });
    adminToken = signToken({ sub: adminUser._id.toString(), role: 'admin' });

    customerA = await User.create({
      name: 'Alice Traveler',
      email: 'alice.bridge@hotelpro.com',
      passwordHash: '$2a$12$e8YQzabcdef1234567890',
      role: 'customer',
      status: 'active'
    });
    customerAToken = signToken({ sub: customerA._id.toString(), role: 'customer' });

    customerB = await User.create({
      name: 'Bob Traveler',
      email: 'bob.bridge@hotelpro.com',
      passwordHash: '$2a$12$e8YQzabcdef1234567890',
      role: 'customer',
      status: 'active'
    });
    customerBToken = signToken({ sub: customerB._id.toString(), role: 'customer' });

    // Seed test hotel & room
    testHotel = await Hotel.create({
      name: 'Azure Cove Resort',
      address: { street: '500 Ocean Ave', city: 'Carmel', country: 'USA' },
      contact: { phone: '+18315550100', email: 'stay@azurecove.com' },
      status: 'active',
      isActive: true
    });

    testRoom = await Room.create({
      hotel: testHotel._id,
      roomNumber: '301',
      roomType: 'suite',
      basePrice: 200,
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

  // Helper to create a standard pending booking for a given user
  const createBooking = async (user, status = 'pending', holdExpiresAt = null) => {
    const expiresAt = holdExpiresAt !== null
      ? holdExpiresAt
      : new Date(Date.now() + 15 * 60 * 1000); // 15 mins in future

    return await Booking.create({
      hotel: testHotel._id,
      room: testRoom._id,
      user: user._id,
      checkInDate: new Date('2027-10-01T00:00:00.000Z'),
      checkOutDate: new Date('2027-10-03T00:00:00.000Z'),
      guestInfo: { name: user.name, email: user.email },
      guestCount: 2,
      priceSnapshot: {
        baseNightlyRate: 200,
        nightlyBreakdown: [
          { date: '2027-10-01', rate: 200 },
          { date: '2027-10-02', rate: 200 }
        ],
        totalRoomRate: 400,
        taxes: 0,
        fees: 0
      },
      totalAmount: 400,
      currency: 'USD',
      status,
      holdExpiresAt: expiresAt
    });
  };

  // Helper to create a payment document
  const createPaymentRecord = async (booking, status = 'pending', overrides = {}) => {
    const txnId = overrides.transactionId || `mock_pi_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    return await Payment.create({
      booking: booking._id,
      amount: booking.totalAmount,
      currency: booking.currency,
      provider: overrides.provider || 'mock',
      status,
      transactionId: txnId,
      paymentMethod: {
        methodType: 'card',
        cardBrand: 'MockVisa',
        cardLast4: '4242'
      },
      metadata: new Map([
        ['clientSecret', overrides.clientSecret || 'mock_sec_test_secret_123'],
        ['internalLockToken', 'secret-lock-uuid'],
        ['bookingId', booking._id.toString()]
      ]),
      ...overrides
    });
  };

  // =========================================================================
  // 1. GET /api/bookings/:id/payment - Booking Payment Lookup Tests
  // =========================================================================
  describe('GET /api/bookings/:id/payment (Booking Payment Lookup)', () => {
    test('1.1 authorized booking owner can retrieve payment information', async () => {
      const booking = await createBooking(customerA);
      const payment = await createPaymentRecord(booking, 'pending');

      const res = await fetch(`${baseUrl}/api/bookings/${booking._id}/payment`, {
        headers: { Authorization: `Bearer ${customerAToken}` }
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.bookingId, booking._id.toString());
      assert.strictEqual(body.data.hasPayment, true);
      assert.strictEqual(body.data.hasActivePendingSession, true);
      assert.strictEqual(body.data.totalAttempts, 1);

      const returnedPayment = body.data.payment;
      assert.strictEqual(returnedPayment._id, payment._id.toString());
      assert.strictEqual(returnedPayment.status, 'pending');
      assert.strictEqual(returnedPayment.amount, 400);
      assert.strictEqual(returnedPayment.currency, 'USD');
      assert.strictEqual(returnedPayment.provider, 'mock');
      assert.strictEqual(returnedPayment.transactionId, payment.transactionId);
      assert.strictEqual(returnedPayment.paymentMethod.cardBrand, 'MockVisa');
      assert.strictEqual(returnedPayment.paymentMethod.cardLast4, '4242');
    });

    test('1.2 sensitive provider fields (clientSecret, internal metadata) are never exposed', async () => {
      const booking = await createBooking(customerA);
      await createPaymentRecord(booking, 'pending', { clientSecret: 'super-sensitive-secret' });

      const res = await fetch(`${baseUrl}/api/bookings/${booking._id}/payment`, {
        headers: { Authorization: `Bearer ${customerAToken}` }
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      const returnedPayment = body.data.payment;

      // Assert sensitive properties are undefined or absent
      assert.strictEqual(returnedPayment.clientSecret, undefined);
      assert.strictEqual(returnedPayment.metadata, undefined);
      assert.strictEqual(returnedPayment.rawResponse, undefined);
      assert.strictEqual(returnedPayment.__v, undefined);
    });

    test('1.3 another customer receives 403 Forbidden', async () => {
      const booking = await createBooking(customerA);
      await createPaymentRecord(booking, 'pending');

      const res = await fetch(`${baseUrl}/api/bookings/${booking._id}/payment`, {
        headers: { Authorization: `Bearer ${customerBToken}` }
      });

      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.match(body.message, /permission/i);
    });

    test('1.4 unauthenticated request receives 401 Unauthorized', async () => {
      const booking = await createBooking(customerA);
      await createPaymentRecord(booking, 'pending');

      const res = await fetch(`${baseUrl}/api/bookings/${booking._id}/payment`);
      assert.strictEqual(res.status, 401);
    });

    test('1.5 missing booking returns 404 Not Found', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();

      const res = await fetch(`${baseUrl}/api/bookings/${nonExistentId}/payment`, {
        headers: { Authorization: `Bearer ${customerAToken}` }
      });

      assert.strictEqual(res.status, 404);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.match(body.message, /booking not found/i);
    });

    test('1.6 malformed booking ID returns 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/bookings/invalid-booking-id/payment`, {
        headers: { Authorization: `Bearer ${customerAToken}` }
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.match(body.message, /invalid booking/i);
    });

    test('1.7 booking with no payment returns documented empty response', async () => {
      const booking = await createBooking(customerA);

      const res = await fetch(`${baseUrl}/api/bookings/${booking._id}/payment`, {
        headers: { Authorization: `Bearer ${customerAToken}` }
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.bookingId, booking._id.toString());
      assert.strictEqual(body.data.hasPayment, false);
      assert.strictEqual(body.data.hasActivePendingSession, false);
      assert.strictEqual(body.data.payment, null);
      assert.strictEqual(body.data.totalAttempts, 0);
    });

    test('1.8 administrator can retrieve payment info for any customer booking', async () => {
      const booking = await createBooking(customerA);
      const payment = await createPaymentRecord(booking, 'completed');

      const res = await fetch(`${baseUrl}/api/bookings/${booking._id}/payment`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.payment._id, payment._id.toString());
      assert.strictEqual(body.data.payment.status, 'completed');
    });

    test('1.9 multiple payment attempts returns settled payment when completed', async () => {
      const booking = await createBooking(customerA);
      // Older attempt failed
      const failedPayment = await createPaymentRecord(booking, 'failed', {
        createdAt: new Date(Date.now() - 60000)
      });
      // Newer attempt completed
      const completedPayment = await createPaymentRecord(booking, 'completed', {
        createdAt: new Date()
      });

      const res = await fetch(`${baseUrl}/api/bookings/${booking._id}/payment`, {
        headers: { Authorization: `Bearer ${customerAToken}` }
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.data.hasPayment, true);
      assert.strictEqual(body.data.totalAttempts, 2);
      assert.strictEqual(body.data.payment._id, completedPayment._id.toString());
      assert.strictEqual(body.data.payment.status, 'completed');
    });

    test('1.10 reading payment endpoint does not alter booking status', async () => {
      const booking = await createBooking(customerA, 'pending');
      await createPaymentRecord(booking, 'pending');

      await fetch(`${baseUrl}/api/bookings/${booking._id}/payment`, {
        headers: { Authorization: `Bearer ${customerAToken}` }
      });

      const refreshed = await Booking.findById(booking._id);
      assert.strictEqual(refreshed.status, 'pending');
    });
  });

  // =========================================================================
  // 2. POST /api/payments/:id/simulate-mock - Safe Mock Payment Simulation Tests
  // =========================================================================
  describe('POST /api/payments/:id/simulate-mock (Safe Mock Simulation)', () => {
    test('2.1 mock simulation success transitions payment to completed and booking to confirmed', async () => {
      const booking = await createBooking(customerA, 'pending');
      const payment = await createPaymentRecord(booking, 'pending');

      const res = await fetch(`${baseUrl}/api/payments/${payment._id}/simulate-mock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ outcome: 'success' })
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.status, 'completed');
      assert.strictEqual(body.data.bookingStatus, 'confirmed');
      assert.strictEqual(body.data.isConfirmed, true);
      assert.strictEqual(body.data.requiresRefund, false);

      // Verify directly in MongoDB
      const updatedPayment = await Payment.findById(payment._id);
      assert.strictEqual(updatedPayment.status, 'completed');

      const updatedBooking = await Booking.findById(booking._id);
      assert.strictEqual(updatedBooking.status, 'confirmed');
    });

    test('2.2 mock simulation failure transitions payment to failed and leaves booking pending', async () => {
      const booking = await createBooking(customerA, 'pending');
      const payment = await createPaymentRecord(booking, 'pending');

      const res = await fetch(`${baseUrl}/api/payments/${payment._id}/simulate-mock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({
          outcome: 'failure',
          failureReason: 'Card limit exceeded'
        })
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.status, 'failed');
      assert.strictEqual(body.data.bookingStatus, 'pending');
      assert.strictEqual(body.data.isConfirmed, false);

      const updatedPayment = await Payment.findById(payment._id);
      assert.strictEqual(updatedPayment.status, 'failed');
      assert.strictEqual(updatedPayment.metadata.get('failureReason'), 'Card limit exceeded');

      const updatedBooking = await Booking.findById(booking._id);
      assert.strictEqual(updatedBooking.status, 'pending');
    });

    test('2.3 unauthenticated simulation request is rejected with 401', async () => {
      const booking = await createBooking(customerA);
      const payment = await createPaymentRecord(booking, 'pending');

      const res = await fetch(`${baseUrl}/api/payments/${payment._id}/simulate-mock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome: 'success' })
      });

      assert.strictEqual(res.status, 401);
    });

    test('2.4 another customer cannot simulate payment (403 Forbidden)', async () => {
      const booking = await createBooking(customerA);
      const payment = await createPaymentRecord(booking, 'pending');

      const res = await fetch(`${baseUrl}/api/payments/${payment._id}/simulate-mock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerBToken}`
        },
        body: JSON.stringify({ outcome: 'success' })
      });

      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.match(body.message, /permission/i);
    });

    test('2.5 admin can simulate payment on behalf of customer', async () => {
      const booking = await createBooking(customerA);
      const payment = await createPaymentRecord(booking, 'pending');

      const res = await fetch(`${baseUrl}/api/payments/${payment._id}/simulate-mock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ outcome: 'success' })
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.data.status, 'completed');
      assert.strictEqual(body.data.isConfirmed, true);
    });

    test('2.6 invalid simulation outcome is rejected with 400', async () => {
      const booking = await createBooking(customerA);
      const payment = await createPaymentRecord(booking, 'pending');

      const res = await fetch(`${baseUrl}/api/payments/${payment._id}/simulate-mock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ outcome: 'arbitrary_bypass' })
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.match(body.message, /invalid simulation outcome/i);
    });

    test('2.7 simulation payload containing forbidden card credentials is rejected (PCI Guardrail)', async () => {
      const booking = await createBooking(customerA);
      const payment = await createPaymentRecord(booking, 'pending');

      const res = await fetch(`${baseUrl}/api/payments/${payment._id}/simulate-mock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({
          outcome: 'success',
          cardNumber: '4242424242424242',
          cvv: '123'
        })
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.match(body.message, /security violation/i);
    });

    test('2.8 simulation is rejected when active provider is not mock', async () => {
      const originalProvider = process.env.PAYMENT_PROVIDER;
      try {
        process.env.PAYMENT_PROVIDER = 'stripe';

        const booking = await createBooking(customerA);
        const payment = await createPaymentRecord(booking, 'pending');

        const res = await fetch(`${baseUrl}/api/payments/${payment._id}/simulate-mock`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customerAToken}`
          },
          body: JSON.stringify({ outcome: 'success' })
        });

        assert.strictEqual(res.status, 400);
        const body = await res.json();
        assert.strictEqual(body.success, false);
        assert.match(body.message, /active payment provider/i);
      } finally {
        process.env.PAYMENT_PROVIDER = originalProvider || 'mock';
      }
    });

    test('2.9 simulation is rejected if payment itself is not a mock payment', async () => {
      const booking = await createBooking(customerA);
      const payment = await createPaymentRecord(booking, 'pending', { provider: 'stripe' });

      const res = await fetch(`${baseUrl}/api/payments/${payment._id}/simulate-mock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ outcome: 'success' })
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.match(body.message, /mock payments/i);
    });

    test('2.10 repeated simulation requests do not create duplicate processing (idempotency)', async () => {
      const booking = await createBooking(customerA);
      const payment = await createPaymentRecord(booking, 'pending');

      // First call
      const res1 = await fetch(`${baseUrl}/api/payments/${payment._id}/simulate-mock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ outcome: 'success' })
      });
      assert.strictEqual(res1.status, 200);
      const body1 = await res1.json();
      assert.strictEqual(body1.data.status, 'completed');
      assert.strictEqual(body1.data.isConfirmed, true);

      // Second call: repeated request
      const res2 = await fetch(`${baseUrl}/api/payments/${payment._id}/simulate-mock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ outcome: 'success' })
      });
      assert.strictEqual(res2.status, 200);
      const body2 = await res2.json();
      assert.strictEqual(body2.data.status, 'completed');
      assert.strictEqual(body2.data.isConfirmed, true);
      assert.strictEqual(body2.data.idempotent, true);

      // Verify no duplicate WebhookEvent records
      const eventCount = await WebhookEvent.countDocuments({
        provider: 'mock',
        eventId: `evt_sim_${payment._id}_success`
      });
      assert.strictEqual(eventCount, 1);
    });

    test('2.11 expired booking hold is NOT confirmed and is flagged for refund reconciliation', async () => {
      // Create booking whose hold expired in the past
      const expiredTime = new Date(Date.now() - 30000);
      const booking = await createBooking(customerA, 'pending', expiredTime);
      const payment = await createPaymentRecord(booking, 'pending');

      // Worker runs and expires the hold
      await expireBookingHolds({ now: new Date() });

      const res = await fetch(`${baseUrl}/api/payments/${payment._id}/simulate-mock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ outcome: 'success' })
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.status, 'completed');
      assert.strictEqual(body.data.bookingStatus, 'cancelled');
      assert.strictEqual(body.data.isConfirmed, false);
      assert.strictEqual(body.data.requiresRefund, true);
      assert.match(body.data.reconciliationReason, /hold expired/i);

      // Verify database state: Booking is cancelled, NOT confirmed!
      const refreshedBooking = await Booking.findById(booking._id);
      assert.strictEqual(refreshedBooking.status, 'cancelled');

      const refreshedPayment = await Payment.findById(payment._id);
      assert.strictEqual(refreshedPayment.status, 'completed');
      assert.strictEqual(refreshedPayment.metadata.get('requiresRefund'), 'true');
    });

    test('2.12 already cancelled booking is NOT confirmed and is flagged for refund reconciliation', async () => {
      const booking = await createBooking(customerA, 'cancelled');
      booking.cancellation = {
        cancelledAt: new Date(),
        reason: 'Cancelled by customer'
      };
      await booking.save();

      const payment = await createPaymentRecord(booking, 'pending');

      const res = await fetch(`${baseUrl}/api/payments/${payment._id}/simulate-mock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ outcome: 'success' })
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.data.status, 'completed');
      assert.strictEqual(body.data.bookingStatus, 'cancelled');
      assert.strictEqual(body.data.isConfirmed, false);
      assert.strictEqual(body.data.requiresRefund, true);

      const refreshedBooking = await Booking.findById(booking._id);
      assert.strictEqual(refreshedBooking.status, 'cancelled');
    });

    test('2.13 cannot transition a completed payment to failed', async () => {
      const booking = await createBooking(customerA, 'pending');
      const payment = await createPaymentRecord(booking, 'pending');

      // Complete payment first
      await fetch(`${baseUrl}/api/payments/${payment._id}/simulate-mock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ outcome: 'success' })
      });

      // Attempt to mark as failed
      const res = await fetch(`${baseUrl}/api/payments/${payment._id}/simulate-mock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ outcome: 'failure' })
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.match(body.message, /cannot mark a completed payment as failed/i);
    });
  });
});
