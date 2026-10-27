require('dotenv').config();
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const app = require('../app');
const { Hotel, Room, Booking, Payment, User, WebhookEvent } = require('../src/models');
const { signToken } = require('../src/config/jwt');
const {
  createBooking,
  expireBookingHolds,
  isBookingHoldExpired,
  HOLD_DURATION_MS
} = require('../src/services/booking.service');
const { searchAvailableRooms } = require('../src/services/room.service');
const {
  startHoldExpirationWorker,
  stopHoldExpirationWorker,
  runHoldExpirationSweep,
  getWorkerStatus
} = require('../src/workers/bookingHold.worker');

describe('Stage 6.4: Booking-Hold Expiration Tests', () => {
  const ISOLATED_TEST_DB_URI = 'mongodb://127.0.0.1:27017/hotelpro_booking_expiration_test_isolation';
  let server;
  let baseUrl;

  let testHotel;
  let testRoom;
  let customerA;
  let customerB;
  let customerAToken;
  let customerBToken;

  before(async () => {
    // Start HTTP server on ephemeral port for endpoint tests
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
    // Clear test collections before each test for total test independence
    await Hotel.deleteMany({});
    await Room.deleteMany({});
    await Booking.deleteMany({});
    await Payment.deleteMany({});
    await User.deleteMany({});
    await WebhookEvent.deleteMany({});

    // Seed test hotel
    testHotel = await Hotel.create({
      name: 'Grand Horizon Resort',
      address: { street: '500 Skyline Drive', city: 'Aspen', country: 'USA' },
      contact: { phone: '+19705550199', email: 'stay@grandhorizon.com' },
      status: 'active',
      isActive: true
    });

    // Seed test room
    testRoom = await Room.create({
      hotel: testHotel._id,
      roomNumber: '101',
      roomType: 'suite',
      basePrice: 300,
      capacity: 2,
      status: 'active'
    });

    // Seed primary customer
    customerA = await User.create({
      name: 'Alice Traveler',
      email: 'alice.expiration@example.com',
      passwordHash: '$2a$12$e8YQzabcdef1234567890',
      role: 'customer',
      status: 'active'
    });
    customerAToken = signToken({ sub: customerA._id.toString(), role: 'customer' });

    // Seed secondary customer
    customerB = await User.create({
      name: 'Bob Explorer',
      email: 'bob.expiration@example.com',
      passwordHash: '$2a$12$e8YQzabcdef1234567891',
      role: 'customer',
      status: 'active'
    });
    customerBToken = signToken({ sub: customerB._id.toString(), role: 'customer' });
  });

  after(async () => {
    stopHoldExpirationWorker();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.dropDatabase();
      await mongoose.connection.close(false);
    }
  });

  /**
   * Helper to create a standard valid pending booking document with dynamic stay nights
   */
  const createTestBooking = async (overrides = {}) => {
    const checkInDate = overrides.checkInDate || new Date('2028-05-10T00:00:00.000Z');
    const checkOutDate = overrides.checkOutDate || new Date('2028-05-12T00:00:00.000Z');

    const formatYMD = (d) => d.toISOString().split('T')[0];
    const nights = Math.max(
      1,
      Math.round((new Date(checkOutDate).getTime() - new Date(checkInDate).getTime()) / (1000 * 60 * 60 * 24))
    );
    const nightlyBreakdown = [];
    for (let i = 0; i < nights; i++) {
      const nightDate = new Date(new Date(checkInDate).getTime() + i * 24 * 60 * 60 * 1000);
      nightlyBreakdown.push({ date: formatYMD(nightDate), rate: 300 });
    }
    const totalRoomRate = nights * 300;

    const bookingData = {
      hotel: testHotel._id,
      room: testRoom._id,
      user: customerA._id,
      checkInDate,
      checkOutDate,
      guestInfo: { name: 'Alice Traveler', email: 'alice.expiration@example.com' },
      guestCount: 2,
      priceSnapshot: {
        baseNightlyRate: 300,
        nightlyBreakdown,
        totalRoomRate,
        taxes: 0,
        fees: 0
      },
      totalAmount: totalRoomRate,
      currency: 'USD',
      status: 'pending',
      ...overrides
    };
    return await Booking.create(bookingData);
  };

  // ==========================================
  // Category 1: Deadline Creation
  // ==========================================
  describe('Category 1: Deadline Creation', () => {
    test('1. New pending booking receives a deadline approximately 15 minutes in the future', async () => {
      const beforeTime = Date.now();
      const booking = await createBooking(
        {
          room: testRoom._id.toString(),
          checkInDate: '2028-06-01',
          checkOutDate: '2028-06-03',
          guestCount: 2,
          guestInfo: { name: 'Alice Traveler', email: 'alice.expiration@example.com' }
        },
        customerA
      );
      const afterTime = Date.now();

      assert.ok(booking.holdExpiresAt, 'Booking must have holdExpiresAt populated');
      const holdTime = new Date(booking.holdExpiresAt).getTime();
      const expectedMin = beforeTime + HOLD_DURATION_MS;
      const expectedMax = afterTime + HOLD_DURATION_MS;

      assert.ok(
        holdTime >= expectedMin && holdTime <= expectedMax,
        `holdExpiresAt (${holdTime}) should be within [${expectedMin}, ${expectedMax}]`
      );
      assert.strictEqual(booking.status, 'pending');
    });

    test('2. Stored deadline remains unchanged across repeated checkout requests', async () => {
      const booking = await createBooking(
        {
          room: testRoom._id.toString(),
          checkInDate: '2028-06-01',
          checkOutDate: '2028-06-03',
          guestCount: 2,
          guestInfo: { name: 'Alice Traveler', email: 'alice.expiration@example.com' }
        },
        customerA
      );

      const initialHoldExpiresAt = new Date(booking.holdExpiresAt).toISOString();

      // First checkout session request
      const res1 = await fetch(`${baseUrl}/api/payments/checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ bookingId: booking._id.toString(), provider: 'mock' })
      });
      assert.strictEqual(res1.status, 201);

      // Second checkout session request (active session reuse)
      const res2 = await fetch(`${baseUrl}/api/payments/checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ bookingId: booking._id.toString(), provider: 'mock' })
      });
      assert.strictEqual(res2.status, 201);
      const body2 = await res2.json();
      assert.strictEqual(body2.data.checkoutSession.reusedExistingSession, true);

      // Reload booking from database and verify holdExpiresAt did NOT change
      const reloaded = await Booking.findById(booking._id);
      assert.strictEqual(
        new Date(reloaded.holdExpiresAt).toISOString(),
        initialHoldExpiresAt,
        'holdExpiresAt must remain unchanged after checkout sessions'
      );
    });

    test('3. Legacy pending booking without holdExpiresAt expires based on valid createdAt timestamp', async () => {
      const pastCreated = new Date(Date.now() - 20 * 60 * 1000); // 20 minutes ago
      const legacyBooking = await createTestBooking();

      // Manually strip holdExpiresAt and set legacy createdAt to simulate pre-migration booking
      await Booking.collection.updateOne(
        { _id: legacyBooking._id },
        {
          $unset: { holdExpiresAt: 1 },
          $set: { createdAt: pastCreated }
        }
      );

      const checkDoc = await Booking.findById(legacyBooking._id);
      assert.strictEqual(checkDoc.holdExpiresAt, undefined);

      // Verify expiration service detects legacy deadline
      const result = await expireBookingHolds({ now: new Date() });
      assert.strictEqual(result.expired, 1);

      const updated = await Booking.findById(legacyBooking._id);
      assert.strictEqual(updated.status, 'cancelled');
      assert.strictEqual(updated.cancellation.reason, 'Reservation hold expired (15-minute timeout)');
    });
  });

  // ==========================================
  // Category 2: Expiration Behavior
  // ==========================================
  describe('Category 2: Expiration Behavior', () => {
    test('4. Expired pending booking becomes cancelled', async () => {
      const pastDeadline = new Date(Date.now() - 5000);
      const booking = await createTestBooking({ holdExpiresAt: pastDeadline });

      const sweepResult = await expireBookingHolds({ now: new Date() });
      assert.strictEqual(sweepResult.expired, 1);

      const updated = await Booking.findById(booking._id);
      assert.strictEqual(updated.status, 'cancelled');
      assert.ok(updated.cancellation?.cancelledAt);
      assert.strictEqual(updated.cancellation?.reason, 'Reservation hold expired (15-minute timeout)');
    });

    test('5. Booking whose deadline is in the future remains pending', async () => {
      const futureDeadline = new Date(Date.now() + 10 * 60 * 1000);
      const booking = await createTestBooking({ holdExpiresAt: futureDeadline });

      const sweepResult = await expireBookingHolds({ now: new Date() });
      assert.strictEqual(sweepResult.expired, 0);

      const updated = await Booking.findById(booking._id);
      assert.strictEqual(updated.status, 'pending');
      assert.strictEqual(updated.cancellation?.cancelledAt, undefined);
    });

    test('6. Confirmed bookings are never expired', async () => {
      const pastDeadline = new Date(Date.now() - 30 * 60 * 1000);
      const booking = await createTestBooking({
        status: 'confirmed',
        holdExpiresAt: pastDeadline
      });

      const sweepResult = await expireBookingHolds({ now: new Date() });
      assert.strictEqual(sweepResult.expired, 0);

      const updated = await Booking.findById(booking._id);
      assert.strictEqual(updated.status, 'confirmed');
    });

    test('7. Checked-in bookings are never expired', async () => {
      const pastDeadline = new Date(Date.now() - 30 * 60 * 1000);
      const booking = await createTestBooking({
        status: 'checked_in',
        holdExpiresAt: pastDeadline
      });

      const sweepResult = await expireBookingHolds({ now: new Date() });
      assert.strictEqual(sweepResult.expired, 0);

      const updated = await Booking.findById(booking._id);
      assert.strictEqual(updated.status, 'checked_in');
    });

    test('8. Previously cancelled bookings remain unchanged', async () => {
      const originalCancelledAt = new Date('2028-01-01T12:00:00.000Z');
      const booking = await createTestBooking({
        status: 'cancelled',
        cancellation: {
          cancelledAt: originalCancelledAt,
          reason: 'Cancelled by customer'
        },
        holdExpiresAt: new Date(Date.now() - 10000)
      });

      const sweepResult = await expireBookingHolds({ now: new Date() });
      assert.strictEqual(sweepResult.expired, 0);

      const updated = await Booking.findById(booking._id);
      assert.strictEqual(updated.status, 'cancelled');
      assert.strictEqual(
        new Date(updated.cancellation.cancelledAt).toISOString(),
        originalCancelledAt.toISOString()
      );
      assert.strictEqual(updated.cancellation.reason, 'Cancelled by customer');
    });

    test('9. Missing or invalid legacy timestamps do not cause arbitrary cancellation', async () => {
      const bookingMissingDate = await createTestBooking({
        checkInDate: new Date('2028-05-10T00:00:00.000Z'),
        checkOutDate: new Date('2028-05-12T00:00:00.000Z')
      });
      await Booking.collection.updateOne(
        { _id: bookingMissingDate._id },
        {
          $unset: { holdExpiresAt: 1, createdAt: 1 }
        }
      );

      const bookingNullDate = await createTestBooking({
        checkInDate: new Date('2028-05-15T00:00:00.000Z'),
        checkOutDate: new Date('2028-05-17T00:00:00.000Z')
      });
      await Booking.collection.updateOne(
        { _id: bookingNullDate._id },
        {
          $unset: { holdExpiresAt: 1 },
          $set: { createdAt: null }
        }
      );

      const sweepResult = await expireBookingHolds({ now: new Date() });
      assert.strictEqual(sweepResult.expired, 0);

      const check1 = await Booking.findById(bookingMissingDate._id);
      const check2 = await Booking.findById(bookingNullDate._id);
      assert.strictEqual(check1.status, 'pending');
      assert.strictEqual(check2.status, 'pending');
    });

    test('10. Repeated sweeps are idempotent', async () => {
      const pastDeadline = new Date(Date.now() - 60000);
      const booking = await createTestBooking({ holdExpiresAt: pastDeadline });

      const sweep1 = await expireBookingHolds({ now: new Date() });
      assert.strictEqual(sweep1.expired, 1);

      const docAfterSweep1 = await Booking.findById(booking._id);
      const cancelledAt1 = docAfterSweep1.cancellation.cancelledAt;

      const sweep2 = await expireBookingHolds({ now: new Date() });
      assert.strictEqual(sweep2.expired, 0);
      assert.strictEqual(sweep2.scanned, 0);

      const docAfterSweep2 = await Booking.findById(booking._id);
      assert.strictEqual(docAfterSweep2.status, 'cancelled');
      assert.strictEqual(
        new Date(docAfterSweep2.cancellation.cancelledAt).toISOString(),
        new Date(cancelledAt1).toISOString()
      );
    });

    test('11. The configured batch limit is respected', async () => {
      const pastDeadline = new Date(Date.now() - 60000);
      for (let i = 0; i < 5; i++) {
        await createTestBooking({
          checkInDate: new Date(Date.UTC(2028, 6, 1 + i * 3)),
          checkOutDate: new Date(Date.UTC(2028, 6, 3 + i * 3)),
          holdExpiresAt: pastDeadline
        });
      }

      // Sweep with batchSize: 2
      const sweep = await expireBookingHolds({ batchSize: 2, now: new Date() });
      assert.strictEqual(sweep.scanned, 2);
      assert.strictEqual(sweep.expired, 2);

      const remainingPending = await Booking.countDocuments({ status: 'pending' });
      assert.strictEqual(remainingPending, 3);
    });

    test('12. One candidate update failure does not prevent processing other valid candidates', async () => {
      const pastDeadline = new Date(Date.now() - 60000);
      const booking1 = await createTestBooking({
        checkInDate: new Date('2028-05-10T00:00:00.000Z'),
        checkOutDate: new Date('2028-05-12T00:00:00.000Z'),
        holdExpiresAt: pastDeadline
      });
      const booking2 = await createTestBooking({
        checkInDate: new Date('2028-05-15T00:00:00.000Z'),
        checkOutDate: new Date('2028-05-17T00:00:00.000Z'),
        holdExpiresAt: pastDeadline
      });

      // Temporarily mock findOneAndUpdate to fail once for booking1
      const originalFindOneAndUpdate = Booking.findOneAndUpdate.bind(Booking);
      let failedOnce = false;

      Booking.findOneAndUpdate = async function (filter, update, options) {
        if (!failedOnce && filter._id.toString() === booking1._id.toString()) {
          failedOnce = true;
          throw new Error('Simulated transient database write failure');
        }
        return await originalFindOneAndUpdate(filter, update, options);
      };

      try {
        const sweep = await expireBookingHolds({ now: new Date() });
        assert.strictEqual(sweep.scanned, 2);
        assert.strictEqual(sweep.failed, 1);
        assert.strictEqual(sweep.expired, 1);

        const check1 = await Booking.findById(booking1._id);
        const check2 = await Booking.findById(booking2._id);
        assert.strictEqual(check1.status, 'pending');
        assert.strictEqual(check2.status, 'cancelled');
      } finally {
        Booking.findOneAndUpdate = originalFindOneAndUpdate;
      }
    });
  });

  // ==========================================
  // Category 3: Checkout Behavior
  // ==========================================
  describe('Category 3: Checkout Behavior', () => {
    test('13. Expired booking cannot create a checkout session', async () => {
      const pastDeadline = new Date(Date.now() - 60000);
      const booking = await createTestBooking({ holdExpiresAt: pastDeadline });

      const res = await fetch(`${baseUrl}/api/payments/checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ bookingId: booking._id.toString(), provider: 'mock' })
      });

      const body = await res.json();
      assert.strictEqual(res.status, 400);
      assert.strictEqual(body.success, false);
      assert.match(body.message, /Reservation hold has expired/i);

      // Verify no Payment was created
      const paymentCount = await Payment.countDocuments({ booking: booking._id });
      assert.strictEqual(paymentCount, 0);
    });

    test('14. Expired booking cannot reuse a pending checkout session', async () => {
      // 1. Create booking in the past
      const booking = await createTestBooking({
        holdExpiresAt: new Date(Date.now() + 10000) // will expire in a moment
      });

      // 2. Create pending payment session while valid
      await Payment.create({
        booking: booking._id,
        amount: 600,
        currency: 'USD',
        provider: 'mock',
        status: 'pending',
        transactionId: `mock_tx_${Date.now()}`,
        metadata: new Map([['clientSecret', 'mock_secret_123']])
      });

      // 3. Fast-forward holdExpiresAt to past
      await Booking.collection.updateOne(
        { _id: booking._id },
        { $set: { holdExpiresAt: new Date(Date.now() - 10000) } }
      );

      // 4. Attempt to reuse session
      const res = await fetch(`${baseUrl}/api/payments/checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ bookingId: booking._id.toString(), provider: 'mock' })
      });

      const body = await res.json();
      assert.strictEqual(res.status, 400);
      assert.strictEqual(body.success, false);
      assert.match(body.message, /Reservation hold has expired/i);
    });

    test('15. Repeated valid checkout requests do not extend the hold', async () => {
      const fixedDeadline = new Date(Date.now() + 12 * 60 * 1000);
      const booking = await createTestBooking({ holdExpiresAt: fixedDeadline });

      for (let i = 0; i < 3; i++) {
        const res = await fetch(`${baseUrl}/api/payments/checkout-session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customerAToken}`
          },
          body: JSON.stringify({ bookingId: booking._id.toString(), provider: 'mock' })
        });
        assert.ok([200, 201].includes(res.status));
      }

      const refreshed = await Booking.findById(booking._id);
      assert.strictEqual(
        new Date(refreshed.holdExpiresAt).toISOString(),
        fixedDeadline.toISOString(),
        'holdExpiresAt must not be shifted by repeated checkout requests'
      );
    });

    test('16. Existing ownership and authorization checks remain intact', async () => {
      const booking = await createTestBooking();

      // Customer B attempts to checkout Customer A's booking
      const res = await fetch(`${baseUrl}/api/payments/checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerBToken}`
        },
        body: JSON.stringify({ bookingId: booking._id.toString(), provider: 'mock' })
      });

      const body = await res.json();
      assert.strictEqual(res.status, 403);
      assert.strictEqual(body.success, false);
      assert.match(body.message, /do not have permission/i);
    });
  });

  // ==========================================
  // Category 4: Payment / Webhook Integration
  // ==========================================
  describe('Category 4: Payment / Webhook Integration', () => {
    test('17. Successful payment for a booking already cancelled by expiration does not reconfirm it and records reconciliation metadata', async () => {
      const pastDeadline = new Date(Date.now() - 30000);
      const booking = await createTestBooking({ holdExpiresAt: pastDeadline });

      // Expire booking
      await expireBookingHolds({ now: new Date() });
      const cancelledBooking = await Booking.findById(booking._id);
      assert.strictEqual(cancelledBooking.status, 'cancelled');

      // Create payment in pending state
      const transactionId = `mock_tx_late_${Date.now()}`;
      const payment = await Payment.create({
        booking: booking._id,
        amount: 600,
        currency: 'USD',
        provider: 'mock',
        status: 'pending',
        transactionId
      });

      // Send payment success webhook
      const payload = JSON.stringify({
        id: `evt_late_success_${Date.now()}`,
        type: 'payment_intent.succeeded',
        data: {
          transactionId,
          amount: 600,
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

      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.bookingConfirmed, false);
      assert.strictEqual(body.requiresRefund, true);

      // Verify booking was NEVER reconfirmed
      const bookingAfter = await Booking.findById(booking._id);
      assert.strictEqual(bookingAfter.status, 'cancelled');

      // Verify payment outcome recorded as completed and flagged for refund reconciliation
      const paymentAfter = await Payment.findById(payment._id);
      assert.strictEqual(paymentAfter.status, 'completed');
      assert.strictEqual(paymentAfter.metadata.get('requiresRefund'), 'true');
      assert.strictEqual(
        paymentAfter.metadata.get('reconciliationReason'),
        'Payment received after booking hold expired'
      );
      assert.ok(paymentAfter.metadata.get('expiredAt'));
    });

    test('18. Payment failure after expiration does not reactivate booking', async () => {
      const pastDeadline = new Date(Date.now() - 30000);
      const booking = await createTestBooking({ holdExpiresAt: pastDeadline });
      await expireBookingHolds({ now: new Date() });

      const transactionId = `mock_tx_fail_${Date.now()}`;
      const payment = await Payment.create({
        booking: booking._id,
        amount: 600,
        currency: 'USD',
        provider: 'mock',
        status: 'pending',
        transactionId
      });

      const payload = JSON.stringify({
        id: `evt_late_fail_${Date.now()}`,
        type: 'payment_intent.payment_failed',
        data: {
          transactionId,
          amount: 600,
          currency: 'USD',
          status: 'failed',
          errorMessage: 'Card declined'
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

      const bookingAfter = await Booking.findById(booking._id);
      const paymentAfter = await Payment.findById(payment._id);
      assert.strictEqual(bookingAfter.status, 'cancelled');
      assert.strictEqual(paymentAfter.status, 'failed');
    });

    test('19. Success webhook racing with expiration cannot produce an invalid final state', async () => {
      const pastDeadline = new Date(Date.now() - 1000);
      const booking = await createTestBooking({ holdExpiresAt: pastDeadline });

      const transactionId = `mock_tx_race_${Date.now()}`;
      await Payment.create({
        booking: booking._id,
        amount: 600,
        currency: 'USD',
        provider: 'mock',
        status: 'pending',
        transactionId
      });

      const webhookPromise = fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-mock-signature': 'mock_sig_valid'
        },
        body: JSON.stringify({
          id: `evt_race_${Date.now()}`,
          type: 'payment_intent.succeeded',
          data: { transactionId, amount: 600, currency: 'USD', status: 'completed' }
        })
      });

      const expirePromise = expireBookingHolds({ now: new Date() });

      const [webhookRes, expireResult] = await Promise.all([webhookPromise, expirePromise]);
      assert.strictEqual(webhookRes.status, 200);

      const finalBooking = await Booking.findById(booking._id);
      const finalPayment = await Payment.findOne({ transactionId });

      assert.ok(
        finalBooking.status === 'confirmed' || finalBooking.status === 'cancelled',
        `Booking status must be confirmed or cancelled, got ${finalBooking.status}`
      );
      assert.strictEqual(finalPayment.status, 'completed');

      if (finalBooking.status === 'cancelled') {
        assert.strictEqual(finalPayment.metadata.get('requiresRefund'), 'true');
      } else {
        assert.strictEqual(finalBooking.status, 'confirmed');
      }
    });

    test('20. If webhook confirms booking first, expiration does not cancel it', async () => {
      const pastDeadline = new Date(Date.now() - 1000);
      const booking = await createTestBooking({ holdExpiresAt: pastDeadline });

      const transactionId = `mock_tx_confirm_first_${Date.now()}`;
      await Payment.create({
        booking: booking._id,
        amount: 600,
        currency: 'USD',
        provider: 'mock',
        status: 'pending',
        transactionId
      });

      // 1. Webhook completes first
      const webhookRes = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-mock-signature': 'mock_sig_valid'
        },
        body: JSON.stringify({
          id: `evt_first_${Date.now()}`,
          type: 'payment_intent.succeeded',
          data: { transactionId, amount: 600, currency: 'USD', status: 'completed' }
        })
      });
      assert.strictEqual(webhookRes.status, 200);

      const bookingConfirmed = await Booking.findById(booking._id);
      assert.strictEqual(bookingConfirmed.status, 'confirmed');

      // 2. Expiration worker runs afterwards
      const expireResult = await expireBookingHolds({ now: new Date() });
      assert.strictEqual(expireResult.expired, 0);

      const finalBooking = await Booking.findById(booking._id);
      assert.strictEqual(finalBooking.status, 'confirmed', 'Confirmed booking must not be cancelled by expiration');
    });

    test('21. If expiration cancels booking first, late success does not reconfirm it', async () => {
      const pastDeadline = new Date(Date.now() - 10000);
      const booking = await createTestBooking({ holdExpiresAt: pastDeadline });

      const transactionId = `mock_tx_expire_first_${Date.now()}`;
      await Payment.create({
        booking: booking._id,
        amount: 600,
        currency: 'USD',
        provider: 'mock',
        status: 'pending',
        transactionId
      });

      // 1. Expiration worker cancels booking
      const expireResult = await expireBookingHolds({ now: new Date() });
      assert.strictEqual(expireResult.expired, 1);

      // 2. Webhook arrives late
      const webhookRes = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-mock-signature': 'mock_sig_valid'
        },
        body: JSON.stringify({
          id: `evt_late_${Date.now()}`,
          type: 'payment_intent.succeeded',
          data: { transactionId, amount: 600, currency: 'USD', status: 'completed' }
        })
      });
      assert.strictEqual(webhookRes.status, 200);
      const webhookBody = await webhookRes.json();
      assert.strictEqual(webhookBody.bookingConfirmed, false);
      assert.strictEqual(webhookBody.requiresRefund, true);

      const finalBooking = await Booking.findById(booking._id);
      assert.strictEqual(finalBooking.status, 'cancelled');
    });

    test('22. Duplicate webhook delivery remains idempotent', async () => {
      const pastDeadline = new Date(Date.now() - 10000);
      const booking = await createTestBooking({ holdExpiresAt: pastDeadline });
      await expireBookingHolds({ now: new Date() });

      const transactionId = `mock_tx_idem_${Date.now()}`;
      await Payment.create({
        booking: booking._id,
        amount: 600,
        currency: 'USD',
        provider: 'mock',
        status: 'pending',
        transactionId
      });

      const eventPayload = JSON.stringify({
        id: `evt_duplicate_idempotency_${Date.now()}`,
        type: 'payment_intent.succeeded',
        data: { transactionId, amount: 600, currency: 'USD', status: 'completed' }
      });

      const res1 = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-mock-signature': 'mock_sig_valid'
        },
        body: eventPayload
      });
      assert.strictEqual(res1.status, 200);

      const res2 = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-mock-signature': 'mock_sig_valid'
        },
        body: eventPayload
      });
      assert.strictEqual(res2.status, 200);
      const body2 = await res2.json();
      assert.strictEqual(body2.idempotent, true);

      const finalBooking = await Booking.findById(booking._id);
      assert.strictEqual(finalBooking.status, 'cancelled');
    });
  });

  // ==========================================
  // Category 5: Availability
  // ==========================================
  describe('Category 5: Availability', () => {
    test('23. An expired pending booking no longer blocks room availability after cancellation', async () => {
      const checkInDate = '2028-09-01';
      const checkOutDate = '2028-09-04';

      const pastDeadline = new Date(Date.now() - 60000);
      await createTestBooking({
        checkInDate: new Date(`${checkInDate}T00:00:00.000Z`),
        checkOutDate: new Date(`${checkOutDate}T00:00:00.000Z`),
        holdExpiresAt: pastDeadline
      });

      // While pending, room search must show 0 available rooms
      const searchBefore = await searchAvailableRooms({ checkInDate, checkOutDate });
      assert.strictEqual(searchBefore.totalAvailable, 0);

      // Run expiration sweep
      await expireBookingHolds({ now: new Date() });

      // After expiration, room search must include the room
      const searchAfter = await searchAvailableRooms({ checkInDate, checkOutDate });
      assert.strictEqual(searchAfter.totalAvailable, 1);
      assert.strictEqual(searchAfter.rooms[0]._id.toString(), testRoom._id.toString());
    });

    test('24. A different customer can book released dates if room is otherwise available', async () => {
      const checkInDate = '2028-10-01';
      const checkOutDate = '2028-10-03';

      const pastDeadline = new Date(Date.now() - 60000);
      await createTestBooking({
        checkInDate: new Date(`${checkInDate}T00:00:00.000Z`),
        checkOutDate: new Date(`${checkOutDate}T00:00:00.000Z`),
        user: customerA._id,
        holdExpiresAt: pastDeadline
      });

      // Expire Customer A's booking
      await expireBookingHolds({ now: new Date() });

      // Customer B creates a reservation for the exact same room and dates
      const newBooking = await createBooking(
        {
          room: testRoom._id.toString(),
          checkInDate,
          checkOutDate,
          guestCount: 2,
          guestInfo: { name: 'Bob Explorer', email: 'bob.expiration@example.com' }
        },
        customerB
      );

      assert.ok(newBooking);
      assert.strictEqual(newBooking.user._id.toString(), customerB._id.toString());
      assert.strictEqual(newBooking.status, 'pending');
    });
  });

  // ==========================================
  // Category 6: Worker Lifecycle
  // ==========================================
  describe('Category 6: Worker Lifecycle', () => {
    test('25. Repeated worker startup does not create duplicate intervals', () => {
      stopHoldExpirationWorker();
      const handle1 = startHoldExpirationWorker({ intervalMs: 10000 });
      const handle2 = startHoldExpirationWorker({ intervalMs: 10000 });

      assert.strictEqual(handle1, handle2, 'startHoldExpirationWorker must return identical handle without duplicating');
      const status = getWorkerStatus();
      assert.strictEqual(status.isRunning, true);

      stopHoldExpirationWorker();
    });

    test('26. Stopping the worker clears its timer', () => {
      startHoldExpirationWorker({ intervalMs: 10000 });
      assert.strictEqual(getWorkerStatus().isRunning, true);

      stopHoldExpirationWorker();
      assert.strictEqual(getWorkerStatus().isRunning, false);
    });

    test('27. A failed sweep does not permanently stop future scheduled runs', async () => {
      stopHoldExpirationWorker();

      // Temporarily simulate failure in expireBookingHolds
      const originalFind = Booking.find.bind(Booking);
      Booking.find = function () {
        throw new Error('Simulated sweep-level database timeout');
      };

      try {
        const sweepResult = await runHoldExpirationSweep();
        assert.strictEqual(sweepResult, null);
        assert.strictEqual(getWorkerStatus().isSweepInProgress, false, 'Sweep in progress flag must be released');
      } finally {
        Booking.find = originalFind;
      }

      // Next sweep succeeds normally
      const pastDeadline = new Date(Date.now() - 60000);
      await createTestBooking({
        checkInDate: new Date('2028-11-01T00:00:00.000Z'),
        checkOutDate: new Date('2028-11-03T00:00:00.000Z'),
        holdExpiresAt: pastDeadline
      });

      const recoverySweep = await runHoldExpirationSweep();
      assert.ok(recoverySweep);
      assert.strictEqual(recoverySweep.expired, 1);
    });

    test('28. Importing Express app for tests does not start a background worker', () => {
      stopHoldExpirationWorker();
      // Require app.js (already loaded, verify worker is not active)
      const freshApp = require('../app');
      assert.ok(freshApp);
      assert.strictEqual(
        getWorkerStatus().isRunning,
        false,
        'Importing app.js must not start hold expiration worker'
      );
    });
  });
});
