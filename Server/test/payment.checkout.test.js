require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const app = require('../app');
const { Hotel, Room, Booking, Payment, User } = require('../src/models');
const { signToken } = require('../src/config/jwt');

describe('Stage 6.2: Payment Service & Checkout-Session Creation Tests', () => {
  const ISOLATED_TEST_DB_URI = 'mongodb://127.0.0.1:27017/hotelpro_payment_checkout_isolation';
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

  let pendingBookingA;
  let confirmedBooking;
  let cancelledBooking;
  let checkedOutBooking;
  let checkedInBooking;

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

    // Clean test collections
    await Hotel.deleteMany({});
    await Room.deleteMany({});
    await Booking.deleteMany({});
    await Payment.deleteMany({});
    await User.deleteMany({});

    // Seed test users
    adminUser = await User.create({
      name: 'System Admin',
      email: 'admin.checkout@hotelpro.com',
      passwordHash: '$2a$12$e8YQzabcdef1234567890',
      role: 'admin',
      status: 'active'
    });
    adminToken = signToken({ sub: adminUser._id.toString(), role: 'admin' });

    customerA = await User.create({
      name: 'Alice Traveler',
      email: 'alice.checkout@hotelpro.com',
      passwordHash: '$2a$12$e8YQzabcdef1234567890',
      role: 'customer',
      status: 'active'
    });
    customerAToken = signToken({ sub: customerA._id.toString(), role: 'customer' });

    customerB = await User.create({
      name: 'Bob Voyager',
      email: 'bob.checkout@hotelpro.com',
      passwordHash: '$2a$12$e8YQzabcdef1234567890',
      role: 'customer',
      status: 'active'
    });
    customerBToken = signToken({ sub: customerB._id.toString(), role: 'customer' });

    // Seed hotel and room
    testHotel = await Hotel.create({
      name: 'Oceanview Paradise Resort',
      address: { street: '123 Coastal Hwy', city: 'Santa Monica', country: 'USA' },
      contact: { phone: '+13105550199', email: 'stay@oceanview.com' },
      status: 'active',
      isActive: true
    });

    testRoom = await Room.create({
      hotel: testHotel._id,
      roomNumber: '301',
      roomType: 'suite',
      basePrice: 200,
      capacity: 3,
      status: 'active'
    });

    // Seed bookings in different states
    // 1. Pending booking for Customer A (eligible for checkout)
    pendingBookingA = await Booking.create({
      hotel: testHotel._id,
      room: testRoom._id,
      user: customerA._id,
      checkInDate: new Date('2027-08-01T00:00:00.000Z'),
      checkOutDate: new Date('2027-08-04T00:00:00.000Z'),
      guestInfo: { name: 'Alice Traveler', email: 'alice.checkout@hotelpro.com' },
      guestCount: 2,
      priceSnapshot: {
        baseNightlyRate: 200,
        nightlyBreakdown: [
          { date: '2027-08-01', rate: 200 },
          { date: '2027-08-02', rate: 200 },
          { date: '2027-08-03', rate: 200 }
        ],
        totalRoomRate: 600,
        taxes: 0,
        fees: 0
      },
      totalAmount: 600,
      currency: 'USD',
      status: 'pending'
    });

    // 2. Confirmed booking for Customer A (already paid)
    confirmedBooking = await Booking.create({
      hotel: testHotel._id,
      room: testRoom._id,
      user: customerA._id,
      checkInDate: new Date('2027-08-10T00:00:00.000Z'),
      checkOutDate: new Date('2027-08-12T00:00:00.000Z'),
      guestInfo: { name: 'Alice Traveler', email: 'alice.checkout@hotelpro.com' },
      guestCount: 1,
      priceSnapshot: {
        baseNightlyRate: 200,
        nightlyBreakdown: [
          { date: '2027-08-10', rate: 200 },
          { date: '2027-08-11', rate: 200 }
        ],
        totalRoomRate: 400,
        taxes: 0,
        fees: 0
      },
      totalAmount: 400,
      currency: 'USD',
      status: 'confirmed'
    });

    // 3. Cancelled booking for Customer A
    cancelledBooking = await Booking.create({
      hotel: testHotel._id,
      room: testRoom._id,
      user: customerA._id,
      checkInDate: new Date('2027-08-15T00:00:00.000Z'),
      checkOutDate: new Date('2027-08-17T00:00:00.000Z'),
      guestInfo: { name: 'Alice Traveler', email: 'alice.checkout@hotelpro.com' },
      guestCount: 1,
      priceSnapshot: {
        baseNightlyRate: 200,
        nightlyBreakdown: [
          { date: '2027-08-15', rate: 200 },
          { date: '2027-08-16', rate: 200 }
        ],
        totalRoomRate: 400,
        taxes: 0,
        fees: 0
      },
      totalAmount: 400,
      currency: 'USD',
      status: 'cancelled',
      cancellation: { cancelledAt: new Date(), reason: 'Cancelled by customer' }
    });

    // 4. Checked-in booking for Customer A
    checkedInBooking = await Booking.create({
      hotel: testHotel._id,
      room: testRoom._id,
      user: customerA._id,
      checkInDate: new Date('2027-08-20T00:00:00.000Z'),
      checkOutDate: new Date('2027-08-22T00:00:00.000Z'),
      guestInfo: { name: 'Alice Traveler', email: 'alice.checkout@hotelpro.com' },
      guestCount: 1,
      priceSnapshot: {
        baseNightlyRate: 200,
        nightlyBreakdown: [
          { date: '2027-08-20', rate: 200 },
          { date: '2027-08-21', rate: 200 }
        ],
        totalRoomRate: 400,
        taxes: 0,
        fees: 0
      },
      totalAmount: 400,
      currency: 'USD',
      status: 'checked_in'
    });

    // 5. Checked-out booking for Customer A
    checkedOutBooking = await Booking.create({
      hotel: testHotel._id,
      room: testRoom._id,
      user: customerA._id,
      checkInDate: new Date('2027-08-25T00:00:00.000Z'),
      checkOutDate: new Date('2027-08-27T00:00:00.000Z'),
      guestInfo: { name: 'Alice Traveler', email: 'alice.checkout@hotelpro.com' },
      guestCount: 1,
      priceSnapshot: {
        baseNightlyRate: 200,
        nightlyBreakdown: [
          { date: '2027-08-25', rate: 200 },
          { date: '2027-08-26', rate: 200 }
        ],
        totalRoomRate: 400,
        taxes: 0,
        fees: 0
      },
      totalAmount: 400,
      currency: 'USD',
      status: 'checked_out'
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

  // ==========================================
  // 1. Authentication and Ownership Tests
  // ==========================================
  describe('Authentication and Ownership Safeguards', () => {
    test('unauthenticated request is rejected with 401 Unauthorized', async () => {
      const res = await fetch(`${baseUrl}/api/payments/checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: pendingBookingA._id.toString() })
      });

      assert.strictEqual(res.status, 401);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.match(body.message, /not authenticated/i);
    });

    test('missing booking identifier is rejected with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/payments/checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({})
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.match(body.message, /Booking ID is required/i);
    });

    test('malformed booking identifier is rejected with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/payments/checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ bookingId: 'not-a-valid-object-id' })
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.match(body.message, /Invalid booking format/i);
    });

    test('nonexistent booking identifier returns 404 Not Found', async () => {
      const nonexistentId = new mongoose.Types.ObjectId().toString();
      const res = await fetch(`${baseUrl}/api/payments/checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ bookingId: nonexistentId })
      });

      assert.strictEqual(res.status, 404);
      const body = await res.json();
      assert.match(body.message, /Booking not found/i);
    });

    test('customer CANNOT initiate checkout for another customer booking (403 Forbidden)', async () => {
      // Customer B attempts to checkout Customer A's booking
      const res = await fetch(`${baseUrl}/api/payments/checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerBToken}`
        },
        body: JSON.stringify({ bookingId: pendingBookingA._id.toString() })
      });

      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.match(body.message, /permission to checkout/i);
    });

    test('administrator without ownership CANNOT checkout for arbitrary customer booking (403 Forbidden)', async () => {
      // Admin attempts to checkout on behalf of customer A without ownership
      const res = await fetch(`${baseUrl}/api/payments/checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ bookingId: pendingBookingA._id.toString() })
      });

      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.match(body.message, /permission to checkout/i);
    });
  });

  // ==========================================
  // 2. Booking Eligibility Tests
  // ==========================================
  describe('Booking Eligibility Requirements', () => {
    test('rejected when booking is already confirmed (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/payments/checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ bookingId: confirmedBooking._id.toString() })
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.match(body.message, /already confirmed and paid/i);
    });

    test('rejected when booking is cancelled (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/payments/checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ bookingId: cancelledBooking._id.toString() })
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.match(body.message, /cancelled reservation/i);
    });

    test('rejected when booking is checked_in (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/payments/checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ bookingId: checkedInBooking._id.toString() })
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.match(body.message, /status "checked_in"/i);
    });

    test('rejected when booking is checked_out (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/payments/checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ bookingId: checkedOutBooking._id.toString() })
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.match(body.message, /status "checked_out"/i);
    });
  });

  // ==========================================
  // 3. Payment Integrity & Checkout Workflow
  // ==========================================
  describe('Checkout Workflow & Financial Integrity', () => {
    test('successfully initializes checkout session for eligible pending booking', async () => {
      const res = await fetch(`${baseUrl}/api/payments/checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({
          bookingId: pendingBookingA._id.toString(),
          provider: 'mock'
        })
      });

      assert.strictEqual(res.status, 201);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.ok(body.data.checkoutSession);

      const session = body.data.checkoutSession;
      assert.strictEqual(session.bookingId, pendingBookingA._id.toString());
      assert.strictEqual(session.amount, 600); // Server-side derived from booking.totalAmount
      assert.strictEqual(session.currency, 'USD');
      assert.strictEqual(session.status, 'pending'); // Intentionally pending (intent created)
      assert.strictEqual(session.provider, 'mock');
      assert.ok(session.transactionId.startsWith('mock_pi_'));
      assert.ok(session.clientSecret.startsWith('mock_sec_'));

      // Verify MongoDB Payment document
      const paymentDoc = await Payment.findById(session.paymentId);
      assert.ok(paymentDoc);
      assert.strictEqual(paymentDoc.status, 'pending');
      assert.strictEqual(paymentDoc.amount, 600);
      assert.strictEqual(paymentDoc.currency, 'USD');
      assert.strictEqual(paymentDoc.booking.toString(), pendingBookingA._id.toString());

      // Booking status must REMAIN pending! (Creating intent does NOT confirm booking)
      const bookingDoc = await Booking.findById(pendingBookingA._id);
      assert.strictEqual(bookingDoc.status, 'pending');
    });

    test('zero-trust pricing: client-supplied amount and currency are completely ignored', async () => {
      // Create new pending booking for Customer B with totalAmount = 350 USD
      const bookingB = await Booking.create({
        hotel: testHotel._id,
        room: testRoom._id,
        user: customerB._id,
        checkInDate: new Date('2027-09-01T00:00:00.000Z'),
        checkOutDate: new Date('2027-09-03T00:00:00.000Z'),
        guestInfo: { name: 'Bob Voyager', email: 'bob.checkout@hotelpro.com' },
        guestCount: 1,
        priceSnapshot: {
          baseNightlyRate: 175,
          nightlyBreakdown: [
            { date: '2027-09-01', rate: 175 },
            { date: '2027-09-02', rate: 175 }
          ],
          totalRoomRate: 350,
          taxes: 0,
          fees: 0
        },
        totalAmount: 350,
        currency: 'USD',
        status: 'pending'
      });

      // Attacker attempts to pay 1 USD instead of 350 USD, and currency EUR
      const res = await fetch(`${baseUrl}/api/payments/checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerBToken}`
        },
        body: JSON.stringify({
          bookingId: bookingB._id.toString(),
          amount: 1.00, // Spoofed amount
          currency: 'EUR', // Spoofed currency
          status: 'completed' // Spoofed status
        })
      });

      assert.strictEqual(res.status, 201);
      const body = await res.json();
      const session = body.data.checkoutSession;

      // Server derived values MUST prevail
      assert.strictEqual(session.amount, 350);
      assert.strictEqual(session.currency, 'USD');
      assert.strictEqual(session.status, 'pending');

      const paymentDoc = await Payment.findById(session.paymentId);
      assert.strictEqual(paymentDoc.amount, 350);
      assert.strictEqual(paymentDoc.currency, 'USD');
      assert.strictEqual(paymentDoc.status, 'pending');
    });

    test('session deduplication: repeated checkout requests return existing active pending session', async () => {
      // Second request for pendingBookingA (already has a pending payment from earlier test)
      const res = await fetch(`${baseUrl}/api/payments/checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({
          bookingId: pendingBookingA._id.toString()
        })
      });

      assert.strictEqual(res.status, 201);
      const body = await res.json();
      assert.strictEqual(body.data.checkoutSession.reusedExistingSession, true);

      // Verify that no second Payment document was created
      const paymentsCount = await Payment.countDocuments({ booking: pendingBookingA._id });
      assert.strictEqual(paymentsCount, 1);
    });

    test('fails safely if provider returns intent failure', async () => {
      // Create new pending booking
      const b = await Booking.create({
        hotel: testHotel._id,
        room: testRoom._id,
        user: customerB._id,
        checkInDate: new Date('2027-09-10T00:00:00.000Z'),
        checkOutDate: new Date('2027-09-12T00:00:00.000Z'),
        guestInfo: { name: 'Bob Voyager', email: 'bob.checkout@hotelpro.com' },
        guestCount: 1,
        priceSnapshot: {
          baseNightlyRate: 100,
          nightlyBreakdown: [{ date: '2027-09-10', rate: 100 }, { date: '2027-09-11', rate: 100 }],
          totalRoomRate: 200,
          taxes: 0,
          fees: 0
        },
        totalAmount: 200,
        currency: 'USD',
        status: 'pending'
      });

      const res = await fetch(`${baseUrl}/api/payments/checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerBToken}`
        },
        body: JSON.stringify({
          bookingId: b._id.toString(),
          simulation: { shouldFail: true, failureReason: 'Simulated gateway network failure' }
        })
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.match(body.message, /Simulated gateway network failure/i);

      // Ensure no Payment document was persisted with false success
      const count = await Payment.countDocuments({ booking: b._id });
      assert.strictEqual(count, 0);
    });

    test('rejects raw card credentials submitted in request body (PCI Guardrail)', async () => {
      const res = await fetch(`${baseUrl}/api/payments/checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({
          bookingId: pendingBookingA._id.toString(),
          cardNumber: '4111222233334444',
          cvv: '123'
        })
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.match(body.message, /Security Violation: Passing raw payment credentials/i);
    });

    test('customer can retrieve their payment details by ID', async () => {
      const existingPayment = await Payment.findOne({ booking: pendingBookingA._id });
      assert.ok(existingPayment);

      const res = await fetch(`${baseUrl}/api/payments/${existingPayment._id}`, {
        headers: { Authorization: `Bearer ${customerAToken}` }
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.payment._id, existingPayment._id.toString());
      assert.strictEqual(body.data.payment.amount, existingPayment.amount);
      assert.strictEqual(body.data.payment.status, 'pending');
    });

    test('customer CANNOT retrieve another customer payment details (403 Forbidden)', async () => {
      const paymentA = await Payment.findOne({ booking: pendingBookingA._id });
      assert.ok(paymentA);

      // Customer B attempts to retrieve Customer A's payment
      const res = await fetch(`${baseUrl}/api/payments/${paymentA._id}`, {
        headers: { Authorization: `Bearer ${customerBToken}` }
      });

      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.match(body.message, /permission to view this payment/i);
    });
  });

  // ==========================================
  // 4. Stage 6.2.1: Concurrency Hardening & Failure Recovery Tests
  // ==========================================
  describe('Stage 6.2.1: Concurrency Hardening & Failure Recovery', () => {
    test('two concurrent checkout requests for the same booking serialize safely and produce exactly one Payment document', async () => {
      // Create a fresh pending booking for Customer A
      const concurrentBooking = await Booking.create({
        hotel: testHotel._id,
        room: testRoom._id,
        user: customerA._id,
        checkInDate: new Date('2027-10-01T00:00:00.000Z'),
        checkOutDate: new Date('2027-10-03T00:00:00.000Z'),
        guestInfo: { name: 'Alice Traveler', email: 'alice.checkout@hotelpro.com' },
        guestCount: 1,
        priceSnapshot: {
          baseNightlyRate: 150,
          nightlyBreakdown: [{ date: '2027-10-01', rate: 150 }, { date: '2027-10-02', rate: 150 }],
          totalRoomRate: 300,
          taxes: 0,
          fees: 0
        },
        totalAmount: 300,
        currency: 'USD',
        status: 'pending'
      });

      // Fire two concurrent checkout requests simultaneously via Promise.all
      const [res1, res2] = await Promise.all([
        fetch(`${baseUrl}/api/payments/checkout-session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customerAToken}`
          },
          body: JSON.stringify({ bookingId: concurrentBooking._id.toString() })
        }),
        fetch(`${baseUrl}/api/payments/checkout-session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customerAToken}`
          },
          body: JSON.stringify({ bookingId: concurrentBooking._id.toString() })
        })
      ]);

      // Both callers must receive a successful response (200 or 201), neither receives 500
      assert.ok([200, 201].includes(res1.status), `res1 status was ${res1.status}`);
      assert.ok([200, 201].includes(res2.status), `res2 status was ${res2.status}`);

      const body1 = await res1.json();
      const body2 = await res2.json();

      assert.strictEqual(body1.success, true);
      assert.strictEqual(body2.success, true);

      const session1 = body1.data.checkoutSession;
      const session2 = body2.data.checkoutSession;

      // Both callers must receive identical, consistent payment credentials
      assert.strictEqual(session1.paymentId, session2.paymentId);
      assert.strictEqual(session1.transactionId, session2.transactionId);
      assert.strictEqual(session1.amount, 300);
      assert.strictEqual(session2.amount, 300);
      assert.strictEqual(session1.currency, 'USD');
      assert.strictEqual(session2.currency, 'USD');

      // Exactly one caller created the session and the other reused it
      const reuseCount = [session1.reusedExistingSession, session2.reusedExistingSession].filter(Boolean).length;
      assert.strictEqual(reuseCount, 1, 'Exactly one response must report reusedExistingSession: true');

      // Database verification: Exactly ONE Payment document was persisted in MongoDB
      const paymentDocs = await Payment.find({ booking: concurrentBooking._id });
      assert.strictEqual(paymentDocs.length, 1, 'Expected exactly 1 Payment document in MongoDB');
      assert.strictEqual(paymentDocs[0].status, 'pending');
    });

    test('database partial unique index enforces at most one pending payment per booking directly in MongoDB', async () => {
      const dummyBookingId = new mongoose.Types.ObjectId();

      // First pending payment succeeds
      const firstPayment = await Payment.create({
        booking: dummyBookingId,
        amount: 100,
        currency: 'USD',
        provider: 'mock',
        status: 'pending',
        transactionId: 'mock_tx_idx_1'
      });
      assert.ok(firstPayment);

      // Second pending payment for the same booking must be rejected by unique index (E11000)
      let duplicateError = null;
      try {
        await Payment.create({
          booking: dummyBookingId,
          amount: 100,
          currency: 'USD',
          provider: 'mock',
          status: 'pending',
          transactionId: 'mock_tx_idx_2'
        });
      } catch (err) {
        duplicateError = err;
      }

      assert.ok(duplicateError, 'Expected duplicate key error on second pending payment');
      assert.strictEqual(duplicateError.code, 11000);

      // A payment in 'failed' status for the same booking is ALLOWED (enables retry lifecycle)
      const failedPayment = await Payment.create({
        booking: dummyBookingId,
        amount: 100,
        currency: 'USD',
        provider: 'mock',
        status: 'failed',
        transactionId: 'mock_tx_idx_failed'
      });
      assert.ok(failedPayment);
    });

    test('concurrent checkout requests for DIFFERENT bookings execute in parallel without serialization delay', async () => {
      // Create Booking for Customer A
      const bookingX = await Booking.create({
        hotel: testHotel._id,
        room: testRoom._id,
        user: customerA._id,
        checkInDate: new Date('2027-10-10T00:00:00.000Z'),
        checkOutDate: new Date('2027-10-12T00:00:00.000Z'),
        guestInfo: { name: 'Alice Traveler', email: 'alice.checkout@hotelpro.com' },
        guestCount: 1,
        priceSnapshot: {
          baseNightlyRate: 120,
          nightlyBreakdown: [{ date: '2027-10-10', rate: 120 }, { date: '2027-10-11', rate: 120 }],
          totalRoomRate: 240,
          taxes: 0,
          fees: 0
        },
        totalAmount: 240,
        currency: 'USD',
        status: 'pending'
      });

      // Create Booking for Customer B
      const bookingY = await Booking.create({
        hotel: testHotel._id,
        room: testRoom._id,
        user: customerB._id,
        checkInDate: new Date('2027-10-15T00:00:00.000Z'),
        checkOutDate: new Date('2027-10-17T00:00:00.000Z'),
        guestInfo: { name: 'Bob Voyager', email: 'bob.checkout@hotelpro.com' },
        guestCount: 1,
        priceSnapshot: {
          baseNightlyRate: 140,
          nightlyBreakdown: [{ date: '2027-10-15', rate: 140 }, { date: '2027-10-16', rate: 140 }],
          totalRoomRate: 280,
          taxes: 0,
          fees: 0
        },
        totalAmount: 280,
        currency: 'USD',
        status: 'pending'
      });

      // Execute concurrent requests for both distinct bookings simultaneously
      const [resX, resY] = await Promise.all([
        fetch(`${baseUrl}/api/payments/checkout-session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customerAToken}`
          },
          body: JSON.stringify({ bookingId: bookingX._id.toString() })
        }),
        fetch(`${baseUrl}/api/payments/checkout-session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customerBToken}`
          },
          body: JSON.stringify({ bookingId: bookingY._id.toString() })
        })
      ]);

      assert.strictEqual(resX.status, 201);
      assert.strictEqual(resY.status, 201);

      const bodyX = await resX.json();
      const bodyY = await resY.json();

      assert.notStrictEqual(bodyX.data.checkoutSession.paymentId, bodyY.data.checkoutSession.paymentId);
      assert.notStrictEqual(bodyX.data.checkoutSession.transactionId, bodyY.data.checkoutSession.transactionId);
      assert.strictEqual(bodyX.data.checkoutSession.amount, 240);
      assert.strictEqual(bodyY.data.checkoutSession.amount, 280);
    });

    test('checkout is rejected if a completed payment already exists even if booking is pending (409 Conflict)', async () => {
      // Pending booking with pre-existing completed payment
      const bookingWithPaid = await Booking.create({
        hotel: testHotel._id,
        room: testRoom._id,
        user: customerA._id,
        checkInDate: new Date('2027-11-01T00:00:00.000Z'),
        checkOutDate: new Date('2027-11-03T00:00:00.000Z'),
        guestInfo: { name: 'Alice Traveler', email: 'alice.checkout@hotelpro.com' },
        guestCount: 1,
        priceSnapshot: {
          baseNightlyRate: 100,
          nightlyBreakdown: [{ date: '2027-11-01', rate: 100 }, { date: '2027-11-02', rate: 100 }],
          totalRoomRate: 200,
          taxes: 0,
          fees: 0
        },
        totalAmount: 200,
        currency: 'USD',
        status: 'pending'
      });

      // Existing completed payment in database
      await Payment.create({
        booking: bookingWithPaid._id,
        amount: 200,
        currency: 'USD',
        provider: 'mock',
        status: 'completed',
        transactionId: 'mock_tx_preexisting_completed'
      });

      const res = await fetch(`${baseUrl}/api/payments/checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ bookingId: bookingWithPaid._id.toString() })
      });

      assert.strictEqual(res.status, 409);
      const body = await res.json();
      assert.match(body.message, /completed payment already exists/i);
    });

    test('failed payment allows legitimate retry and initializes a new pending payment', async () => {
      const retryBooking = await Booking.create({
        hotel: testHotel._id,
        room: testRoom._id,
        user: customerA._id,
        checkInDate: new Date('2027-11-10T00:00:00.000Z'),
        checkOutDate: new Date('2027-11-12T00:00:00.000Z'),
        guestInfo: { name: 'Alice Traveler', email: 'alice.checkout@hotelpro.com' },
        guestCount: 1,
        priceSnapshot: {
          baseNightlyRate: 110,
          nightlyBreakdown: [{ date: '2027-11-10', rate: 110 }, { date: '2027-11-11', rate: 110 }],
          totalRoomRate: 220,
          taxes: 0,
          fees: 0
        },
        totalAmount: 220,
        currency: 'USD',
        status: 'pending'
      });

      // Simulate a previously failed payment
      await Payment.create({
        booking: retryBooking._id,
        amount: 220,
        currency: 'USD',
        provider: 'mock',
        status: 'failed',
        transactionId: 'mock_tx_earlier_failed'
      });

      // Customer retries checkout session
      const res = await fetch(`${baseUrl}/api/payments/checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ bookingId: retryBooking._id.toString() })
      });

      assert.strictEqual(res.status, 201);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.checkoutSession.status, 'pending');

      // Total payments for this booking should be 2 (1 failed, 1 pending)
      const allPayments = await Payment.find({ booking: retryBooking._id });
      assert.strictEqual(allPayments.length, 2);
      const statuses = allPayments.map((p) => p.status).sort();
      assert.deepStrictEqual(statuses, ['failed', 'pending']);
    });
  });

  describe('Stage 6.4.3: Post-Intent Expiration and Cancellation Safeguards (FINDING-6.4-1)', () => {
    const { getPaymentProvider } = require('../src/services/payment');
    const { expireBookingHolds } = require('../src/services/booking.service');

    test('Test A — Hold expires during provider call: rejected, no payment persisted, no clientSecret returned', async () => {
      const mockProvider = getPaymentProvider('mock');
      const originalCreateIntent = mockProvider.createIntent.bind(mockProvider);

      const expBooking = await Booking.create({
        hotel: testHotel._id,
        room: testRoom._id,
        user: customerA._id,
        checkInDate: new Date('2028-02-10T00:00:00.000Z'),
        checkOutDate: new Date('2028-02-12T00:00:00.000Z'),
        guestInfo: { name: 'Alice Traveler', email: 'alice.checkout@hotelpro.com' },
        guestCount: 2,
        priceSnapshot: {
          baseNightlyRate: 150,
          nightlyBreakdown: [{ date: '2028-02-10', rate: 150 }, { date: '2028-02-11', rate: 150 }],
          totalRoomRate: 300,
          taxes: 0,
          fees: 0
        },
        totalAmount: 300,
        currency: 'USD',
        status: 'pending',
        holdExpiresAt: new Date(Date.now() + 10 * 60 * 1000) // Valid initially
      });

      let intentCreatedPromiseResolve;
      const intentCreatedPromise = new Promise((resolve) => {
        intentCreatedPromiseResolve = resolve;
      });

      let continueProviderResolve;
      const continueProviderPromise = new Promise((resolve) => {
        continueProviderResolve = resolve;
      });

      // Wrap mockProvider.createIntent to pause deterministically after intent creation
      mockProvider.createIntent = async function (params) {
        const result = await originalCreateIntent(params);
        intentCreatedPromiseResolve();
        await continueProviderPromise;
        return result;
      };

      try {
        // Initiate checkout request (runs asynchronously)
        const checkoutPromise = fetch(`${baseUrl}/api/payments/checkout-session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customerAToken}`
          },
          body: JSON.stringify({ bookingId: expBooking._id.toString() })
        });

        // Wait until provider intent is generated
        await intentCreatedPromise;

        // While provider is paused, fast-forward holdExpiresAt to the past and run expiration worker
        await Booking.collection.updateOne(
          { _id: expBooking._id },
          { $set: { holdExpiresAt: new Date(Date.now() - 60000) } }
        );
        const sweepResult = await expireBookingHolds({ now: new Date() });
        assert.strictEqual(sweepResult.expired, 1);

        const checkBooking = await Booking.findById(expBooking._id);
        assert.strictEqual(checkBooking.status, 'cancelled');

        // Resume provider
        continueProviderResolve();

        // Await checkout response
        const res = await checkoutPromise;
        const body = await res.json();

        assert.strictEqual(res.status, 400);
        assert.strictEqual(body.success, false);
        assert.match(body.message, /Reservation hold has expired/i);
        assert.strictEqual(body.data?.checkoutSession?.clientSecret, undefined);

        // Verify NO Payment document was persisted in MongoDB for this booking
        const paymentCount = await Payment.countDocuments({ booking: expBooking._id });
        assert.strictEqual(paymentCount, 0, 'No payment record should be persisted for an expired hold');
      } finally {
        mockProvider.createIntent = originalCreateIntent;
      }
    });

    test('Test B — Booking cancelled during provider call: rejected and no payment session returned', async () => {
      const mockProvider = getPaymentProvider('mock');
      const originalCreateIntent = mockProvider.createIntent.bind(mockProvider);

      const cancelBookingDoc = await Booking.create({
        hotel: testHotel._id,
        room: testRoom._id,
        user: customerA._id,
        checkInDate: new Date('2028-02-15T00:00:00.000Z'),
        checkOutDate: new Date('2028-02-17T00:00:00.000Z'),
        guestInfo: { name: 'Alice Traveler', email: 'alice.checkout@hotelpro.com' },
        guestCount: 2,
        priceSnapshot: {
          baseNightlyRate: 150,
          nightlyBreakdown: [{ date: '2028-02-15', rate: 150 }, { date: '2028-02-16', rate: 150 }],
          totalRoomRate: 300,
          taxes: 0,
          fees: 0
        },
        totalAmount: 300,
        currency: 'USD',
        status: 'pending',
        holdExpiresAt: new Date(Date.now() + 15 * 60 * 1000)
      });

      let intentCreatedPromiseResolve;
      const intentCreatedPromise = new Promise((resolve) => {
        intentCreatedPromiseResolve = resolve;
      });

      let continueProviderResolve;
      const continueProviderPromise = new Promise((resolve) => {
        continueProviderResolve = resolve;
      });

      mockProvider.createIntent = async function (params) {
        const result = await originalCreateIntent(params);
        intentCreatedPromiseResolve();
        await continueProviderPromise;
        return result;
      };

      try {
        const checkoutPromise = fetch(`${baseUrl}/api/payments/checkout-session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customerAToken}`
          },
          body: JSON.stringify({ bookingId: cancelBookingDoc._id.toString() })
        });

        await intentCreatedPromise;

        // Cancel the booking while provider call is paused
        await Booking.collection.updateOne(
          { _id: cancelBookingDoc._id },
          {
            $set: {
              status: 'cancelled',
              'cancellation.cancelledAt': new Date(),
              'cancellation.reason': 'Cancelled by customer'
            }
          }
        );

        continueProviderResolve();

        const res = await checkoutPromise;
        const body = await res.json();

        assert.strictEqual(res.status, 400);
        assert.strictEqual(body.success, false);
        assert.match(body.message, /Cannot initiate checkout for a cancelled reservation/i);

        const paymentCount = await Payment.countDocuments({ booking: cancelBookingDoc._id });
        assert.strictEqual(paymentCount, 0, 'No payment record should be created when booking was cancelled');
      } finally {
        mockProvider.createIntent = originalCreateIntent;
      }
    });

    test('Test C — Normal checkout remains successful throughout provider intent creation', async () => {
      const normalBooking = await Booking.create({
        hotel: testHotel._id,
        room: testRoom._id,
        user: customerA._id,
        checkInDate: new Date('2028-03-01T00:00:00.000Z'),
        checkOutDate: new Date('2028-03-03T00:00:00.000Z'),
        guestInfo: { name: 'Alice Traveler', email: 'alice.checkout@hotelpro.com' },
        guestCount: 2,
        priceSnapshot: {
          baseNightlyRate: 150,
          nightlyBreakdown: [{ date: '2028-03-01', rate: 150 }, { date: '2028-03-02', rate: 150 }],
          totalRoomRate: 300,
          taxes: 0,
          fees: 0
        },
        totalAmount: 300,
        currency: 'USD',
        status: 'pending',
        holdExpiresAt: new Date(Date.now() + 15 * 60 * 1000)
      });

      const res = await fetch(`${baseUrl}/api/payments/checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ bookingId: normalBooking._id.toString() })
      });

      assert.strictEqual(res.status, 201);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.ok(body.data.checkoutSession.clientSecret);
      assert.strictEqual(body.data.checkoutSession.status, 'pending');

      const payment = await Payment.findOne({ booking: normalBooking._id });
      assert.ok(payment);
      assert.strictEqual(payment.status, 'pending');
      assert.strictEqual(payment.amount, 300);
    });

    test('Test D — Provider cancellation failure: checkout still fails safely without exposing secrets', async () => {
      const mockProvider = getPaymentProvider('mock');
      const originalCreateIntent = mockProvider.createIntent.bind(mockProvider);
      const originalCancelIntent = mockProvider.cancelIntent.bind(mockProvider);

      const cancelFailBooking = await Booking.create({
        hotel: testHotel._id,
        room: testRoom._id,
        user: customerA._id,
        checkInDate: new Date('2028-03-10T00:00:00.000Z'),
        checkOutDate: new Date('2028-03-12T00:00:00.000Z'),
        guestInfo: { name: 'Alice Traveler', email: 'alice.checkout@hotelpro.com' },
        guestCount: 2,
        priceSnapshot: {
          baseNightlyRate: 150,
          nightlyBreakdown: [{ date: '2028-03-10', rate: 150 }, { date: '2028-03-11', rate: 150 }],
          totalRoomRate: 300,
          taxes: 0,
          fees: 0
        },
        totalAmount: 300,
        currency: 'USD',
        status: 'pending',
        holdExpiresAt: new Date(Date.now() + 15 * 60 * 1000)
      });

      let intentCreatedPromiseResolve;
      const intentCreatedPromise = new Promise((resolve) => {
        intentCreatedPromiseResolve = resolve;
      });

      let continueProviderResolve;
      const continueProviderPromise = new Promise((resolve) => {
        continueProviderResolve = resolve;
      });

      mockProvider.createIntent = async function (params) {
        const result = await originalCreateIntent(params);
        intentCreatedPromiseResolve();
        await continueProviderPromise;
        return result;
      };

      // Simulate provider cancelIntent failure
      let cancelAttempted = false;
      mockProvider.cancelIntent = async function (params) {
        cancelAttempted = true;
        throw new Error('Simulated gateway cancellation network failure');
      };

      try {
        const checkoutPromise = fetch(`${baseUrl}/api/payments/checkout-session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customerAToken}`
          },
          body: JSON.stringify({ bookingId: cancelFailBooking._id.toString() })
        });

        await intentCreatedPromise;

        // Cancel booking while paused
        await Booking.collection.updateOne(
          { _id: cancelFailBooking._id },
          { $set: { status: 'cancelled' } }
        );

        continueProviderResolve();

        const res = await checkoutPromise;
        const body = await res.json();

        assert.strictEqual(res.status, 400);
        assert.strictEqual(body.success, false);
        assert.strictEqual(cancelAttempted, true, 'cancelIntent should have been invoked');
        assert.strictEqual(body.data?.checkoutSession?.clientSecret, undefined);

        const paymentCount = await Payment.countDocuments({ booking: cancelFailBooking._id });
        assert.strictEqual(paymentCount, 0, 'No payment record should be created when cancelIntent fails');
      } finally {
        mockProvider.createIntent = originalCreateIntent;
        mockProvider.cancelIntent = originalCancelIntent;
      }
    });
  });
});
