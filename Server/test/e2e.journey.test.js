require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const app = require('../app');
const { Hotel, Room, Booking, Payment, User, WebhookEvent } = require('../src/models');
const { initializeInitialAdmin } = require('../src/services/auth.service');

describe('Full End-to-End Customer & Administrator Journey Tests', () => {
  const ISOLATED_E2E_DB_URI = 'mongodb://127.0.0.1:27017/hotelpro_e2e_journey_isolation';
  let server;
  let baseUrl;

  let hotel;
  let room1;
  let room2;

  let customerToken = '';
  let customerUser = null;
  let adminToken = '';
  let adminUser = null;

  let testBookingId = '';
  let testPaymentId = '';

  before(async () => {
    // 1. Start HTTP server on ephemeral port
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    });

    // 2. Connect to isolated database
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close(false);
    }
    await mongoose.connect(ISOLATED_E2E_DB_URI);

    // 3. Initialize indexes
    await Hotel.init();
    await Room.init();
    await Booking.init();
    await Payment.init();
    await User.init();
    await WebhookEvent.init();

    // 4. Clean test collections
    await Hotel.deleteMany({});
    await Room.deleteMany({});
    await Booking.deleteMany({});
    await Payment.deleteMany({});
    await User.deleteMany({});
    await WebhookEvent.deleteMany({});

    // 5. Seed initial Hotel & physical rooms
    hotel = await Hotel.create({
      name: 'HotelPro Grand Palace',
      description: 'Luxury hotel located in downtown with panoramic views.',
      address: {
        street: '100 Sunset Boulevard, Suite 500',
        city: 'Los Angeles',
        state: 'CA',
        country: 'USA',
        postalCode: '90028'
      },
      contact: {
        phone: '+1-555-0199',
        email: 'reservations@grandpalace.com'
      },
      status: 'active'
    });

    room1 = await Room.create({
      hotel: hotel._id,
      roomNumber: '101',
      roomType: 'double',
      capacity: 2,
      basePrice: 150,
      description: 'Spacious double room with king bed and balcony.',
      amenities: ['Wi-Fi', 'Balcony', 'AC', 'Mini-bar'],
      status: 'active'
    });

    room2 = await Room.create({
      hotel: hotel._id,
      roomNumber: '102',
      roomType: 'suite',
      capacity: 4,
      basePrice: 280,
      description: 'Executive suite with separate living area.',
      amenities: ['Wi-Fi', 'Balcony', 'AC', 'Kitchenette'],
      status: 'active'
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close(false);
    }
  });

  // -------------------------------------------------------------
  // JOURNEY A: Customer Registration, Authentication & Profile
  // -------------------------------------------------------------
  describe('Journey A: Customer Registration, Authentication & Profile', () => {
    test('1. Customer registers successfully with validation and secure hashing', async () => {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Elena Rostova',
          email: 'elena.rostova@example.com',
          password: 'SecurePassword123!',
          phone: '+1-555-4321'
        })
      });

      const body = await res.json();
      assert.strictEqual(res.status, 201);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.user.email, 'elena.rostova@example.com');
      assert.strictEqual(body.data.user.role, 'customer');
      assert.strictEqual(body.data.user.passwordHash, undefined, 'Password hash must never be returned');

      customerUser = body.data.user;
    });

    test('2. Rejects duplicate registration with 409 Conflict', async () => {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Elena Duplicate',
          email: 'elena.rostova@example.com',
          password: 'SecurePassword123!'
        })
      });

      assert.strictEqual(res.status, 409);
    });

    test('3. Authenticates customer via login and returns signed JWT', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'elena.rostova@example.com',
          password: 'SecurePassword123!'
        })
      });

      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.ok(body.data.token);
      customerToken = body.data.token;
    });

    test('4. Customer retrieves profile and updates permitted details', async () => {
      // GET profile
      const getRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${customerToken}` }
      });
      const getBody = await getRes.json();
      assert.strictEqual(getRes.status, 200);
      assert.strictEqual(getBody.data.user.email, 'elena.rostova@example.com');

      // PATCH profile
      const patchRes = await fetch(`${baseUrl}/api/auth/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken}`
        },
        body: JSON.stringify({
          name: 'Elena Rostova-Smith',
          phone: '+1-555-9876'
        })
      });
      const patchBody = await patchRes.json();
      assert.strictEqual(patchRes.status, 200);
      assert.strictEqual(patchBody.data.user.name, 'Elena Rostova-Smith');
      assert.strictEqual(patchBody.data.user.phone, '+1-555-9876');
    });

    test('5. Rejects privilege escalation attempts (role manipulation)', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken}`
        },
        body: JSON.stringify({
          role: 'admin'
        })
      });

      assert.strictEqual(res.status, 400);
    });
  });

  // -------------------------------------------------------------
  // JOURNEY B: Room Search & Details
  // -------------------------------------------------------------
  describe('Journey B: Room Search & Details', () => {
    test('6. Public search lists available rooms for date range', async () => {
      const checkInDate = '2027-06-10';
      const checkOutDate = '2027-06-13';

      const res = await fetch(
        `${baseUrl}/api/rooms/search?checkInDate=${checkInDate}&checkOutDate=${checkOutDate}&capacity=2`
      );
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.ok(Array.isArray(body.data.rooms));
      assert.strictEqual(body.data.rooms.length, 2);

      const roomDetail = body.data.rooms.find((r) => r.roomNumber === '101');
      assert.ok(roomDetail);
      assert.strictEqual(roomDetail.pricing.nights, 3);
      assert.strictEqual(roomDetail.pricing.totalRoomPrice, 450);
    });

    test('7. Retrieves individual room details by ID', async () => {
      const res = await fetch(`${baseUrl}/api/rooms/${room1._id}`);
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.room.roomNumber, '101');
      assert.strictEqual(body.data.room.hotel.name, 'HotelPro Grand Palace');
    });

    test('8. Rejects invalid search queries (e.g. checkOut <= checkIn)', async () => {
      const res = await fetch(
        `${baseUrl}/api/rooms/search?checkInDate=2027-06-15&checkOutDate=2027-06-10`
      );
      assert.strictEqual(res.status, 400);
    });
  });

  // -------------------------------------------------------------
  // JOURNEY C: Customer Booking Creation & Hold Safeguards
  // -------------------------------------------------------------
  describe('Journey C: Customer Booking Creation & Hold Safeguards', () => {
    test('9. Customer creates a booking and receives 15-minute reservation hold', async () => {
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken}`
        },
        body: JSON.stringify({
          room: room1._id.toString(),
          checkInDate: '2027-06-10',
          checkOutDate: '2027-06-13',
          guestCount: 2,
          guestInfo: {
            name: 'Elena Rostova-Smith',
            email: 'elena.rostova@example.com',
            phone: '+1-555-9876'
          }
        })
      });

      const body = await res.json();
      assert.strictEqual(res.status, 201);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.booking.status, 'pending');
      assert.strictEqual(body.data.booking.totalAmount, 450);
      assert.ok(body.data.booking.holdExpiresAt);

      testBookingId = body.data.booking._id;
    });

    test('10. Prevents concurrent double-booking of same room on overlapping dates', async () => {
      // Second customer registers and logs in
      await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Competing Customer',
          email: 'competing@example.com',
          password: 'Password123!'
        })
      });

      const otherLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'competing@example.com',
          password: 'Password123!'
        })
      });
      const otherLoginBody = await otherLoginRes.json();
      assert.strictEqual(otherLoginRes.status, 200);
      const otherToken = otherLoginBody.data.token;

      const resOverlap = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${otherToken}`
        },
        body: JSON.stringify({
          room: room1._id.toString(),
          checkInDate: '2027-06-11',
          checkOutDate: '2027-06-14',
          guestCount: 1
        })
      });

      assert.strictEqual(resOverlap.status, 409, 'Overlapping booking must be rejected with 409 Conflict');
    });
  });

  // -------------------------------------------------------------
  // JOURNEY D: Mock Payment Checkout, Failure & Success
  // -------------------------------------------------------------
  describe('Journey D: Mock Payment Checkout, Failure & Success', () => {
    test('11. Customer initializes checkout session', async () => {
      const res = await fetch(`${baseUrl}/api/payments/checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken}`
        },
        body: JSON.stringify({
          bookingId: testBookingId,
          provider: 'mock'
        })
      });

      const body = await res.json();
      assert.strictEqual(res.status, 201);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.checkoutSession.amount, 450);
      assert.strictEqual(body.data.checkoutSession.status, 'pending');

      testPaymentId = body.data.checkoutSession.paymentId;
    });

    test('12. Simulates payment failure: booking remains pending and retry is permitted', async () => {
      const res = await fetch(`${baseUrl}/api/payments/${testPaymentId}/simulate-mock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken}`
        },
        body: JSON.stringify({
          outcome: 'failure',
          failureReason: 'Insufficient funds simulation'
        })
      });

      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.data.status, 'failed');
      assert.strictEqual(body.data.bookingStatus, 'pending');

      // Check booking status directly
      const bRes = await fetch(`${baseUrl}/api/bookings/${testBookingId}`, {
        headers: { Authorization: `Bearer ${customerToken}` }
      });
      const bBody = await bRes.json();
      assert.strictEqual(bBody.data.booking.status, 'pending', 'Booking must not be confirmed on failed payment');
    });

    test('13. Customer initiates retry checkout and simulates success', async () => {
      // Re-initialize checkout session for retry
      const retryRes = await fetch(`${baseUrl}/api/payments/checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken}`
        },
        body: JSON.stringify({
          bookingId: testBookingId,
          provider: 'mock'
        })
      });
      const retryBody = await retryRes.json();
      assert.strictEqual(retryRes.status, 201);
      testPaymentId = retryBody.data.checkoutSession.paymentId;

      // Simulate payment success
      const simRes = await fetch(`${baseUrl}/api/payments/${testPaymentId}/simulate-mock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken}`
        },
        body: JSON.stringify({
          outcome: 'success'
        })
      });

      const simBody = await simRes.json();
      assert.strictEqual(simRes.status, 200);
      assert.strictEqual(simBody.data.status, 'completed');
      assert.strictEqual(simBody.data.bookingStatus, 'confirmed');

      // Confirm that the booking is now confirmed in database
      const bRes = await fetch(`${baseUrl}/api/bookings/${testBookingId}`, {
        headers: { Authorization: `Bearer ${customerToken}` }
      });
      const bBody = await bRes.json();
      assert.strictEqual(bBody.data.booking.status, 'confirmed');
    });
  });

  // -------------------------------------------------------------
  // JOURNEY E: History, Receipts & Customer Self-Service Cancellation
  // -------------------------------------------------------------
  describe('Journey E: History, Receipts & Customer Self-Service Cancellation', () => {
    test('14. Customer views booking history with payment status', async () => {
      const res = await fetch(`${baseUrl}/api/bookings/my`, {
        headers: { Authorization: `Bearer ${customerToken}` }
      });
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.ok(body.data.bookings.length >= 1);

      const b = body.data.bookings.find((item) => item._id === testBookingId);
      assert.ok(b);
      assert.strictEqual(b.status, 'confirmed');
      assert.strictEqual(b.payment.status, 'completed');
      assert.strictEqual(b.payment.amount, 450);
    });

    test('15. Customer retrieves payment receipt without secret leakage', async () => {
      const res = await fetch(`${baseUrl}/api/payments/${testPaymentId}`, {
        headers: { Authorization: `Bearer ${customerToken}` }
      });
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.data.payment.status, 'completed');
      assert.strictEqual(body.data.payment.amount, 450);
      assert.strictEqual(body.data.payment.metadata.clientSecret, undefined, 'Receipt must not expose clientSecret');
      assert.strictEqual(body.data.payment.metadata.apiKey, undefined, 'Receipt must not expose apiKey');
    });

    test('16. Customer cancels booking, transitioning status and flagging payment for refund', async () => {
      const res = await fetch(`${baseUrl}/api/bookings/${testBookingId}/cancel`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken}`
        },
        body: JSON.stringify({
          reason: 'Plans changed due to family event'
        })
      });

      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.data.booking.status, 'cancelled');

      // Verify that payment is flagged for refund reconciliation
      const p = await Payment.findById(testPaymentId);
      assert.strictEqual(p.metadata.get('requiresRefund'), 'true');
      assert.strictEqual(p.metadata.get('reconciliationStatus'), 'refund_eligible');
    });
  });

  // -------------------------------------------------------------
  // JOURNEY F: Administrator Setup, Oversight & Refund Processing
  // -------------------------------------------------------------
  describe('Journey F: Administrator Setup, Oversight & Refund Processing', () => {
    test('17. Initializes first administrator and logs in', async () => {
      const adminSecret = process.env.ADMIN_SETUP_SECRET || 'hotelpro_dev_admin_setup_secret_must_be_32_characters_abcde';

      const initialAdmin = await initializeInitialAdmin({
        name: 'General Manager',
        email: 'admin.manager@hotelpro.com',
        password: 'AdminPassword123!',
        setupSecret: adminSecret
      });
      assert.strictEqual(initialAdmin.email, 'admin.manager@hotelpro.com');
      assert.strictEqual(initialAdmin.role, 'admin');

      // Admin login
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'admin.manager@hotelpro.com',
          password: 'AdminPassword123!'
        })
      });
      const loginBody = await loginRes.json();
      assert.strictEqual(loginRes.status, 200);
      adminToken = loginBody.data.token;
      adminUser = loginBody.data.user;
    });

    test('18. Customer is denied access to admin endpoints (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/bookings`, {
        headers: { Authorization: `Bearer ${customerToken}` }
      });
      assert.strictEqual(res.status, 403);

      const resRecon = await fetch(`${baseUrl}/api/payments/reconciliation`, {
        headers: { Authorization: `Bearer ${customerToken}` }
      });
      assert.strictEqual(resRecon.status, 403);
    });

    test('19. Admin inspects reconciliation queue and finds cancelled booking payment', async () => {
      const res = await fetch(`${baseUrl}/api/payments/reconciliation`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);

      const target = body.data.reconciliations.find((r) => r.id === testPaymentId);
      assert.ok(target, 'Flagged payment must appear in reconciliation queue');
      assert.strictEqual(target.requiresRefund, true);
    });

    test('20. Admin executes refund for customer payment, updating balance and state', async () => {
      const res = await fetch(`${baseUrl}/api/payments/${testPaymentId}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          amount: 450,
          reason: 'Customer cancelled booking within policy'
        })
      });

      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.status, 'refunded');
      assert.strictEqual(body.data.totalRefunded, 450);
      assert.strictEqual(body.data.remainingRefundable, 0);

      // Verify payment record in database
      const p = await Payment.findById(testPaymentId);
      assert.strictEqual(p.status, 'refunded');
      assert.strictEqual(p.refund.status, 'completed');
      assert.strictEqual(p.metadata.get('requiresRefund'), 'false');
    });
  });
});
