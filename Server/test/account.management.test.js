require('dotenv').config();
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const app = require('../app');
const { Hotel, Room, Booking, Payment, User, WebhookEvent } = require('../src/models');
const { signToken } = require('../src/config/jwt');

describe('Phase 11: Customer Account, Booking Management & Admin Oversight Tests', () => {
  const ISOLATED_TEST_DB_URI = 'mongodb://127.0.0.1:27017/hotelpro_account_management_test';
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

  const createTestBooking = async (user, overrides = {}) => {
    const checkInDate = overrides.checkInDate || new Date(Date.now() + 86400000 * 3);
    const checkOutDate = overrides.checkOutDate || new Date(Date.now() + 86400000 * 5);
    const totalAmount = overrides.totalAmount || 500;

    return await Booking.create({
      hotel: testHotel._id,
      room: testRoom._id,
      user: user._id,
      checkInDate,
      checkOutDate,
      guestInfo: overrides.guestInfo || {
        name: user.name,
        email: user.email,
        phone: user.phone || '+1 555-0000'
      },
      guestCount: 2,
      priceSnapshot: {
        baseNightlyRate: 250,
        nightlyBreakdown: [
          { date: checkInDate.toISOString().slice(0, 10), rate: 250 }
        ],
        totalRoomRate: totalAmount,
        taxes: 0,
        fees: 0
      },
      totalAmount,
      currency: 'USD',
      status: overrides.status || 'confirmed',
      holdExpiresAt: overrides.holdExpiresAt || new Date(Date.now() + 15 * 60 * 1000),
      ...overrides
    });
  };

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
      name: 'System Administrator',
      email: 'admin.phase11@hotelpro.test',
      passwordHash: '$2a$12$e8YQzabcdef1234567890',
      role: 'admin',
      status: 'active'
    });

    customerA = await User.create({
      name: 'Alice Customer',
      email: 'alice.phase11@hotelpro.test',
      passwordHash: '$2a$12$e8YQzabcdef1234567890',
      phone: '+1 555-0101',
      role: 'customer',
      status: 'active'
    });

    customerB = await User.create({
      name: 'Bob Customer',
      email: 'bob.phase11@hotelpro.test',
      passwordHash: '$2a$12$e8YQzabcdef1234567890',
      phone: '+1 555-0202',
      role: 'customer',
      status: 'active'
    });

    // Generate valid tokens
    adminToken = signToken({ sub: adminUser._id.toString(), role: 'admin' });
    customerAToken = signToken({ sub: customerA._id.toString(), role: 'customer' });
    customerBToken = signToken({ sub: customerB._id.toString(), role: 'customer' });

    // Seed test hotel and room
    testHotel = await Hotel.create({
      name: 'HotelPro Grand Suites',
      address: {
        street: '100 Luxury Blvd',
        city: 'Metropolis',
        state: 'NY',
        zipCode: '10001',
        country: 'USA'
      },
      contact: {
        phone: '+1 555-0199',
        email: 'grand@hotelpro.test'
      }
    });

    testRoom = await Room.create({
      hotel: testHotel._id,
      roomNumber: '1101',
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

  // =========================================================================
  // Feature A: Customer Profile Management
  // =========================================================================
  describe('Feature A: Customer Profile Management', () => {
    test('GET /api/auth/me returns authenticated customer profile without password hash', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${customerAToken}` }
      });
      const data = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.data.user.email, 'alice.phase11@hotelpro.test');
      assert.strictEqual(data.data.user.name, 'Alice Customer');
      assert.strictEqual(data.data.user.password, undefined);
      assert.strictEqual(data.data.user.passwordHash, undefined);
    });

    test('GET /api/auth/me rejects unauthenticated request with 401', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`);
      assert.strictEqual(res.status, 401);
    });

    test('PATCH /api/auth/me successfully updates customer name and phone', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({
          name: 'Alice Updated',
          phone: '+1 555-9999'
        })
      });
      const data = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.data.user.name, 'Alice Updated');
      assert.strictEqual(data.data.user.phone, '+1 555-9999');

      // Verify in database
      const userInDb = await User.findById(customerA._id);
      assert.strictEqual(userInDb.name, 'Alice Updated');
      assert.strictEqual(userInDb.phone, '+1 555-9999');
    });

    test('PATCH /api/auth/me rejects privilege escalation attempts (role)', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({
          name: 'Alice Hacker',
          role: 'admin'
        })
      });
      const data = await res.json();

      assert.strictEqual(res.status, 400);
      assert.strictEqual(data.success, false);
      assert.match(data.message, /role/i);

      // Verify role remains customer
      const userInDb = await User.findById(customerA._id);
      assert.strictEqual(userInDb.role, 'customer');
    });

    test('PATCH /api/auth/me rejects account status modification', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({
          status: 'suspended'
        })
      });
      const data = await res.json();

      assert.strictEqual(res.status, 400);
      assert.strictEqual(data.success, false);
      assert.match(data.message, /status/i);
    });

    test('PATCH /api/auth/me rejects email change', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({
          email: 'newemail@hotelpro.test'
        })
      });
      const data = await res.json();

      assert.strictEqual(res.status, 400);
      assert.strictEqual(data.success, false);
      assert.match(data.message, /email/i);
    });

    test('PATCH /api/auth/me rejects password change in profile update', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({
          password: 'NewInsecurePassword123!'
        })
      });
      const data = await res.json();

      assert.strictEqual(res.status, 400);
      assert.strictEqual(data.success, false);
      assert.match(data.message, /password/i);
    });
  });

  // =========================================================================
  // Feature B: Customer Booking History & Isolation
  // =========================================================================
  describe('Feature B: Customer Booking History', () => {
    let bookingA1, bookingA2, bookingB1;
    let paymentA1;

    beforeEach(async () => {
      // Create bookings for Customer A
      bookingA1 = await createTestBooking(customerA, {
        checkInDate: new Date(Date.now() + 86400000 * 5),
        checkOutDate: new Date(Date.now() + 86400000 * 8),
        totalAmount: 750,
        status: 'confirmed'
      });

      paymentA1 = await Payment.create({
        booking: bookingA1._id,
        user: customerA._id,
        amount: 750,
        currency: 'USD',
        provider: 'stripe',
        status: 'completed',
        transactionId: 'pi_test_phase11_a1'
      });

      bookingA2 = await createTestBooking(customerA, {
        checkInDate: new Date(Date.now() - 86400000 * 10),
        checkOutDate: new Date(Date.now() - 86400000 * 7),
        totalAmount: 750,
        status: 'checked_out'
      });

      // Create booking for Customer B
      bookingB1 = await createTestBooking(customerB, {
        checkInDate: new Date(Date.now() + 86400000 * 2),
        checkOutDate: new Date(Date.now() + 86400000 * 4),
        totalAmount: 500,
        status: 'confirmed'
      });
    });

    test('GET /api/bookings/my returns only authenticated customer bookings with batch payments', async () => {
      const res = await fetch(`${baseUrl}/api/bookings/my`, {
        headers: { Authorization: `Bearer ${customerAToken}` }
      });
      const data = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.data.bookings.length, 2);

      // Verify Customer B's booking is NOT present
      const hasCustomerBBooking = data.data.bookings.some(
        (b) => String(b._id) === String(bookingB1._id)
      );
      assert.strictEqual(hasCustomerBBooking, false);

      // Verify batch payment was attached to bookingA1
      const foundA1 = data.data.bookings.find((b) => String(b._id) === String(bookingA1._id));
      assert.ok(foundA1);
      assert.ok(foundA1.payment);
      assert.strictEqual(foundA1.payment.status, 'completed');
      assert.strictEqual(foundA1.payment.transactionId, 'pi_test_phase11_a1');
    });

    test('GET /api/bookings/my supports timeFilter parameter (past)', async () => {
      const res = await fetch(`${baseUrl}/api/bookings/my?timeFilter=past`, {
        headers: { Authorization: `Bearer ${customerAToken}` }
      });
      const data = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.data.bookings.length, 1);
      assert.strictEqual(String(data.data.bookings[0]._id), String(bookingA2._id));
    });

    test('GET /api/bookings/my supports timeFilter parameter (upcoming)', async () => {
      const res = await fetch(`${baseUrl}/api/bookings/my?timeFilter=upcoming`, {
        headers: { Authorization: `Bearer ${customerAToken}` }
      });
      const data = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.data.bookings.length, 1);
      assert.strictEqual(String(data.data.bookings[0]._id), String(bookingA1._id));
    });

    test('GET /api/bookings/:id prevents customer from retrieving another customer booking', async () => {
      const res = await fetch(`${baseUrl}/api/bookings/${bookingB1._id}`, {
        headers: { Authorization: `Bearer ${customerAToken}` }
      });
      assert.strictEqual(res.status, 403);
    });

    test('GET /api/bookings/:id allows admin to retrieve any customer booking', async () => {
      const res = await fetch(`${baseUrl}/api/bookings/${bookingB1._id}`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const data = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.success, true);
      assert.strictEqual(String(data.data.booking._id), String(bookingB1._id));
    });
  });

  // =========================================================================
  // Feature C: Self-Service Cancellation & Refund Flags
  // =========================================================================
  describe('Feature C: Self-Service Cancellation & Reconciliation', () => {
    let activeBooking;
    let completedPayment;

    beforeEach(async () => {
      activeBooking = await createTestBooking(customerA, {
        checkInDate: new Date(Date.now() + 86400000 * 5),
        checkOutDate: new Date(Date.now() + 86400000 * 8),
        totalAmount: 750,
        status: 'confirmed'
      });

      completedPayment = await Payment.create({
        booking: activeBooking._id,
        user: customerA._id,
        amount: 750,
        currency: 'USD',
        provider: 'stripe',
        status: 'completed',
        transactionId: 'pi_test_active_cancellation',
        metadata: new Map()
      });
    });

    test('PATCH /api/bookings/:id/cancel allows customer to cancel own confirmed booking and flags payment for refund reconciliation', async () => {
      const res = await fetch(`${baseUrl}/api/bookings/${activeBooking._id}/cancel`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({
          reason: 'Schedule change requested by customer'
        })
      });
      const data = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.data.booking.status, 'cancelled');
      assert.strictEqual(data.data.booking.cancellation.reason, 'Schedule change requested by customer');

      // Verify payment was NOT falsely marked as 'refunded'
      const updatedPayment = await Payment.findById(completedPayment._id);
      assert.strictEqual(updatedPayment.status, 'completed'); // Stays completed until refund is processed

      // Verify payment reconciliation status was set
      const requiresRefund = updatedPayment.metadata.get('requiresRefund');
      const reconciliationStatus = updatedPayment.metadata.get('reconciliationStatus');
      assert.strictEqual(requiresRefund, 'true');
      assert.strictEqual(reconciliationStatus, 'refund_eligible');
    });

    test('PATCH /api/bookings/:id/cancel prevents repeated cancellation on already cancelled booking', async () => {
      // First cancel
      await fetch(`${baseUrl}/api/bookings/${activeBooking._id}/cancel`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${customerAToken}` }
      });

      // Second cancel attempt
      const res = await fetch(`${baseUrl}/api/bookings/${activeBooking._id}/cancel`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${customerAToken}` }
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /already cancelled/i);
    });

    test('PATCH /api/bookings/:id/cancel prevents customer B from cancelling customer A booking', async () => {
      const res = await fetch(`${baseUrl}/api/bookings/${activeBooking._id}/cancel`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${customerBToken}` }
      });
      assert.strictEqual(res.status, 403);
    });
  });

  // =========================================================================
  // Feature D: Payment Receipt Security & Isolation
  // =========================================================================
  describe('Feature D: Payment Receipt Security & Isolation', () => {
    let bookingA;
    let paymentA;

    beforeEach(async () => {
      bookingA = await createTestBooking(customerA, {
        checkInDate: new Date(Date.now() + 86400000 * 5),
        checkOutDate: new Date(Date.now() + 86400000 * 8),
        totalAmount: 750,
        status: 'confirmed'
      });

      paymentA = await Payment.create({
        booking: bookingA._id,
        user: customerA._id,
        amount: 750,
        currency: 'USD',
        provider: 'stripe',
        status: 'completed',
        transactionId: 'pi_test_receipt_secret_check',
        metadata: new Map([
          ['clientSecret', 'pi_test_secret_REDACTED_DO_NOT_EXPOSE'],
          ['customNote', 'Safe metadata']
        ])
      });
    });

    test('GET /api/payments/:id strips clientSecret before returning receipt details', async () => {
      const res = await fetch(`${baseUrl}/api/payments/${paymentA._id}`, {
        headers: { Authorization: `Bearer ${customerAToken}` }
      });
      const data = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.data.payment.metadata.clientSecret, undefined);
      assert.strictEqual(data.data.payment.metadata.customNote, 'Safe metadata');
      assert.strictEqual(data.data.payment.transactionId, 'pi_test_receipt_secret_check');
    });

    test('GET /api/payments/:id forbids customer B from viewing customer A payment', async () => {
      const res = await fetch(`${baseUrl}/api/payments/${paymentA._id}`, {
        headers: { Authorization: `Bearer ${customerBToken}` }
      });
      assert.strictEqual(res.status, 403);
    });

    test('GET /api/payments/:id allows admin to view customer A payment', async () => {
      const res = await fetch(`${baseUrl}/api/payments/${paymentA._id}`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const data = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.data.payment.id, String(paymentA._id));
    });
  });

  // =========================================================================
  // Feature E: Admin Oversight & Reconciliation
  // =========================================================================
  describe('Feature E: Admin Oversight & Reconciliation', () => {
    let booking1, booking2;
    let payment1;

    beforeEach(async () => {
      booking1 = await createTestBooking(customerA, {
        checkInDate: new Date(Date.now() + 86400000),
        checkOutDate: new Date(Date.now() + 86400000 * 3),
        totalAmount: 500,
        status: 'confirmed',
        guestInfo: {
          name: 'Alice Wonder',
          email: 'alice.wonder@test.com',
          phone: '+1 555-0101'
        }
      });

      payment1 = await Payment.create({
        booking: booking1._id,
        user: customerA._id,
        amount: 500,
        currency: 'USD',
        provider: 'mock',
        status: 'completed',
        transactionId: 'mock_tx_recon_1',
        metadata: new Map([
          ['requiresRefund', 'true'],
          ['reconciliationStatus', 'refund_eligible'],
          ['reconciliationReason', 'Booking cancelled after payment completion']
        ])
      });

      booking2 = await createTestBooking(customerB, {
        checkInDate: new Date(Date.now() + 86400000 * 10),
        checkOutDate: new Date(Date.now() + 86400000 * 12),
        totalAmount: 500,
        status: 'pending',
        guestInfo: {
          name: 'Bob Builder',
          email: 'bob.builder@test.com',
          phone: '+1 555-0202'
        }
      });
    });

    test('GET /api/bookings returns 401 for unauthenticated user', async () => {
      const res = await fetch(`${baseUrl}/api/bookings`);
      assert.strictEqual(res.status, 401);
    });

    test('GET /api/bookings returns 403 for non-admin customer', async () => {
      const res = await fetch(`${baseUrl}/api/bookings`, {
        headers: { Authorization: `Bearer ${customerAToken}` }
      });
      assert.strictEqual(res.status, 403);
    });

    test('GET /api/bookings allows admin and supports search by guest name', async () => {
      const res = await fetch(`${baseUrl}/api/bookings?search=Alice`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const data = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.data.bookings.length, 1);
      assert.strictEqual(String(data.data.bookings[0]._id), String(booking1._id));
    });

    test('GET /api/payments/reconciliation returns 403 for non-admin customer', async () => {
      const res = await fetch(`${baseUrl}/api/payments/reconciliation`, {
        headers: { Authorization: `Bearer ${customerAToken}` }
      });
      assert.strictEqual(res.status, 403);
    });

    test('GET /api/payments/reconciliation allows admin and lists reconciliation records', async () => {
      const res = await fetch(`${baseUrl}/api/payments/reconciliation`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const data = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.success, true);
      assert.ok(data.data.reconciliations.length >= 1);
      const found = data.data.reconciliations.find(
        (r) => String(r._id || r.id) === String(payment1._id)
      );
      assert.ok(found);
    });

    test('POST /api/payments/:id/refund allows admin to execute refund for reconciliation', async () => {
      const res = await fetch(`${baseUrl}/api/payments/${payment1._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          amount: 500,
          reason: 'Administrative refund processed from reconciliation queue'
        })
      });
      const data = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.data.status, 'refunded');
      assert.strictEqual(data.data.amount, 500);
    });
  });

  // =========================================================================
  // Feature F: Security & Business-Logic Audit Regressions
  // =========================================================================
  describe('Feature F: Security & Business-Logic Audit Regressions', () => {
    test('GET /api/bookings/my rejects invalid timeFilter with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/bookings/my?timeFilter=malicious_filter`, {
        headers: { Authorization: `Bearer ${customerAToken}` }
      });
      const data = await res.json();

      assert.strictEqual(res.status, 400);
      assert.strictEqual(data.success, false);
      assert.match(data.message, /invalid timefilter/i);
    });

    test('GET /api/bookings safely handles regex special characters in search without ReDoS', async () => {
      const res = await fetch(`${baseUrl}/api/bookings?search=.*+?^$\{}()|[]\\\\`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const data = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.data.bookings.length, 0); // Treated as literal text with no matches
    });

    test('GET /api/bookings rejects excessive search term length (> 100 chars) with 400', async () => {
      const longTerm = 'a'.repeat(101);
      const res = await fetch(`${baseUrl}/api/bookings?search=${longTerm}`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const data = await res.json();

      assert.strictEqual(res.status, 400);
      assert.strictEqual(data.success, false);
      assert.match(data.message, /search query cannot exceed 100 characters/i);
    });

    test('PATCH /api/bookings/:id/status rejects non-admin customer with 403 Forbidden', async () => {
      const testBooking = await createTestBooking(customerA, { status: 'confirmed' });
      const res = await fetch(`${baseUrl}/api/bookings/${testBooking._id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ status: 'cancelled' })
      });

      assert.strictEqual(res.status, 403);
    });

    test('PATCH /api/bookings/:id/status by admin does not fabricate payment record', async () => {
      const pendingBooking = await createTestBooking(customerA, {
        status: 'pending',
        holdExpiresAt: new Date(Date.now() + 10 * 60 * 1000)
      });

      const res = await fetch(`${baseUrl}/api/bookings/${pendingBooking._id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ status: 'confirmed' })
      });
      const data = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.data.booking.status, 'confirmed');

      // Verify no phantom payment was created
      const payments = await Payment.find({ booking: pendingBooking._id });
      assert.strictEqual(payments.length, 0);
    });

    test('PATCH /api/bookings/:id/status rejects confirming pending booking with expired hold', async () => {
      const expiredBooking = await createTestBooking(customerA, {
        status: 'pending',
        holdExpiresAt: new Date(Date.now() - 5000)
      });

      const res = await fetch(`${baseUrl}/api/bookings/${expiredBooking._id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ status: 'confirmed' })
      });
      const data = await res.json();

      assert.strictEqual(res.status, 400);
      assert.strictEqual(data.success, false);
      assert.match(data.message, /hold has expired/i);
    });

    test('PATCH /api/bookings/:id/status by admin cancelling confirmed booking flags payment for refund', async () => {
      const confirmedBooking = await createTestBooking(customerA, { status: 'confirmed' });
      const payment = await Payment.create({
        booking: confirmedBooking._id,
        user: customerA._id,
        amount: 500,
        currency: 'USD',
        provider: 'stripe',
        status: 'completed',
        transactionId: 'pi_test_admin_cancel_reconcile',
        metadata: new Map()
      });

      const res = await fetch(`${baseUrl}/api/bookings/${confirmedBooking._id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          status: 'cancelled',
          reason: 'Customer requested cancellation via phone support'
        })
      });
      const data = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.data.booking.status, 'cancelled');

      const updatedPayment = await Payment.findById(payment._id);
      assert.strictEqual(updatedPayment.status, 'completed');
      assert.strictEqual(updatedPayment.metadata.get('requiresRefund'), 'true');
      assert.strictEqual(updatedPayment.metadata.get('reconciliationStatus'), 'refund_eligible');
    });

    test('PATCH /api/bookings/:id/status rejects invalid transition (cancelled -> confirmed) with 400', async () => {
      const cancelledBooking = await createTestBooking(customerA, { status: 'cancelled' });

      const res = await fetch(`${baseUrl}/api/bookings/${cancelledBooking._id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ status: 'confirmed' })
      });
      const data = await res.json();

      assert.strictEqual(res.status, 400);
      assert.strictEqual(data.success, false);
      assert.match(data.message, /cannot transition booking status/i);
    });

    test('GET /api/payments/reconciliation strips clientSecret and sensitive metadata keys', async () => {
      const testBooking = await createTestBooking(customerA, { status: 'cancelled' });
      await Payment.create({
        booking: testBooking._id,
        user: customerA._id,
        amount: 300,
        currency: 'USD',
        provider: 'stripe',
        status: 'completed',
        transactionId: 'pi_test_sensitive_metadata',
        metadata: new Map([
          ['requiresRefund', 'true'],
          ['clientSecret', 'pi_test_client_secret_xyz'],
          ['stripeApiKey', 'sk_test_forbidden_secret'],
          ['operatorNote', 'Audit test record']
        ])
      });

      const res = await fetch(`${baseUrl}/api/payments/reconciliation`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const data = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.success, true);

      const target = data.data.reconciliations.find(
        (r) => r.transactionId === 'pi_test_sensitive_metadata'
      );
      assert.ok(target, 'Target reconciliation record should be present');
      assert.strictEqual(target.metadata.clientSecret, undefined);
      assert.strictEqual(target.metadata.stripeApiKey, undefined);
      assert.strictEqual(target.metadata.requiresRefund, 'true');
      assert.strictEqual(target.metadata.operatorNote, 'Audit test record');
    });

    test('GET /api/payments/:id without Authorization header returns 401 Unauthorized', async () => {
      const testBooking = await createTestBooking(customerA, { status: 'confirmed' });
      const payment = await Payment.create({
        booking: testBooking._id,
        user: customerA._id,
        amount: 250,
        currency: 'USD',
        provider: 'mock',
        status: 'completed',
        transactionId: 'mock_tx_unauth'
      });

      const res = await fetch(`${baseUrl}/api/payments/${payment._id}`);
      assert.strictEqual(res.status, 401);
    });

    test('PATCH /api/bookings/:id/cancel rejects invalid ObjectId with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/bookings/not-a-valid-id/cancel`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ reason: 'Test' })
      });
      const data = await res.json();

      assert.strictEqual(res.status, 400);
      assert.match(data.message, /invalid booking format/i);
    });

    test('PATCH /api/bookings/:id/cancel rejects reason exceeding 500 characters with 400', async () => {
      const booking = await createTestBooking(customerA, { status: 'confirmed' });
      const res = await fetch(`${baseUrl}/api/bookings/${booking._id}/cancel`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ reason: 'x'.repeat(501) })
      });
      const data = await res.json();

      assert.strictEqual(res.status, 400);
      assert.match(data.message, /cancellation reason cannot exceed 500 characters/i);
    });

    test('POST /api/payments/:id/refund rejects refund exceeding remaining refundable balance with 400', async () => {
      const booking = await createTestBooking(customerA, { status: 'confirmed' });
      const payment = await Payment.create({
        booking: booking._id,
        user: customerA._id,
        amount: 300,
        currency: 'USD',
        provider: 'mock',
        status: 'completed',
        transactionId: 'mock_tx_refund_exceed'
      });

      const res = await fetch(`${baseUrl}/api/payments/${payment._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          amount: 500, // Exceeds 300
          reason: 'Excessive refund'
        })
      });
      const data = await res.json();

      assert.strictEqual(res.status, 400);
      assert.strictEqual(data.success, false);
      assert.match(data.message, /exceeds remaining refundable amount/i);
    });

    test('POST /api/payments/:id/refund rejects non-positive or invalid refund amounts with 400', async () => {
      const booking = await createTestBooking(customerA, { status: 'confirmed' });
      const payment = await Payment.create({
        booking: booking._id,
        user: customerA._id,
        amount: 300,
        currency: 'USD',
        provider: 'mock',
        status: 'completed',
        transactionId: 'mock_tx_refund_neg'
      });

      // Negative amount
      const resNegative = await fetch(`${baseUrl}/api/payments/${payment._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ amount: -50 })
      });
      assert.strictEqual(resNegative.status, 400);

      // Zero amount
      const resZero = await fetch(`${baseUrl}/api/payments/${payment._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ amount: 0 })
      });
      assert.strictEqual(resZero.status, 400);
    });

    test('POST /api/payments/:id/refund rejects reason exceeding 500 characters with 400', async () => {
      const booking = await createTestBooking(customerA, { status: 'confirmed' });
      const payment = await Payment.create({
        booking: booking._id,
        user: customerA._id,
        amount: 300,
        currency: 'USD',
        provider: 'mock',
        status: 'completed',
        transactionId: 'mock_tx_refund_reason'
      });

      const res = await fetch(`${baseUrl}/api/payments/${payment._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          amount: 100,
          reason: 'y'.repeat(501)
        })
      });
      const data = await res.json();

      assert.strictEqual(res.status, 400);
      assert.match(data.message, /refund reason cannot exceed 500 characters/i);
    });
  });
});

