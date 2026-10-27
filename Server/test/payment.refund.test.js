require('dotenv').config();
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const app = require('../app');
const { Hotel, Room, Booking, Payment, User, WebhookEvent } = require('../src/models');
const { signToken } = require('../src/config/jwt');
const { getPaymentProvider } = require('../src/services/payment');

describe('Payment Refund Lifecycle & Reconciliation Tests', () => {
  const ISOLATED_TEST_DB_URI = 'mongodb://127.0.0.1:27017/hotelpro_payment_refund_isolation';
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

    // Seed test users
    customerA = await User.create({
      name: 'Alice RefundTester',
      email: 'alice.refund@hotelpro.com',
      passwordHash: '$2a$12$e8YQzabcdef1234567890',
      role: 'customer',
      status: 'active'
    });

    customerB = await User.create({
      name: 'Bob Unauthorized',
      email: 'bob.refund@hotelpro.com',
      passwordHash: '$2a$12$e8YQzabcdef1234567890',
      role: 'customer',
      status: 'active'
    });

    adminUser = await User.create({
      name: 'Super Admin',
      email: 'admin.refund@hotelpro.com',
      passwordHash: '$2a$12$e8YQzabcdef1234567890',
      role: 'admin',
      status: 'active'
    });

    customerAToken = signToken({ sub: customerA._id.toString(), role: 'customer' });
    customerBToken = signToken({ sub: customerB._id.toString(), role: 'customer' });
    adminToken = signToken({ sub: adminUser._id.toString(), role: 'admin' });

    // Seed test hotel and room
    testHotel = await Hotel.create({
      name: 'Refund Grand Hotel',
      address: { street: '100 Refund Blvd', city: 'Metropolis', country: 'USA' },
      contact: { phone: '+1-555-0199', email: 'concierge@refundhotel.com' },
      status: 'active'
    });

    testRoom = await Room.create({
      hotel: testHotel._id,
      roomNumber: 'RF-101',
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

  describe('Refund Processing - Security & Validation', () => {
    let completedBooking;
    let completedPayment;

    beforeEach(async () => {
      await Booking.deleteMany({});
      await Payment.deleteMany({});

      completedBooking = await Booking.create({
        hotel: testHotel._id,
        room: testRoom._id,
        user: customerA._id,
        checkInDate: new Date('2029-01-10T00:00:00.000Z'),
        checkOutDate: new Date('2029-01-12T00:00:00.000Z'),
        guestInfo: { name: 'Alice RefundTester', email: 'alice.refund@hotelpro.com' },
        guestCount: 2,
        priceSnapshot: {
          baseNightlyRate: 200,
          nightlyBreakdown: [{ date: '2029-01-10', rate: 200 }, { date: '2029-01-11', rate: 200 }],
          totalRoomRate: 400,
          taxes: 0,
          fees: 0
        },
        totalAmount: 400,
        currency: 'USD',
        status: 'confirmed'
      });

      completedPayment = await Payment.create({
        booking: completedBooking._id,
        amount: 400,
        currency: 'USD',
        provider: 'mock',
        status: 'completed',
        transactionId: `tx_comp_${Date.now()}`
      });
    });

    test('1. unauthenticated refund request is rejected with 401 Unauthorized', async () => {
      const res = await fetch(`${baseUrl}/api/payments/${completedPayment._id}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 100 })
      });
      const body = await res.json();

      assert.strictEqual(res.status, 401);
      assert.strictEqual(body.success, false);
    });

    test('2. customer cannot refund another customer payment (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/payments/${completedPayment._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerBToken}`
        },
        body: JSON.stringify({ amount: 100 })
      });
      const body = await res.json();

      assert.strictEqual(res.status, 403);
      assert.strictEqual(body.success, false);
      assert.match(body.message, /permission/i);
    });

    test('3. rejects refund for nonexistent payment ID with 404', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();
      const res = await fetch(`${baseUrl}/api/payments/${nonExistentId}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ amount: 100 })
      });
      const body = await res.json();

      assert.strictEqual(res.status, 404);
      assert.strictEqual(body.success, false);
    });

    test('4. rejects refund on a pending payment with 400 Bad Request', async () => {
      const pendingPayment = await Payment.create({
        booking: completedBooking._id,
        amount: 400,
        currency: 'USD',
        provider: 'mock',
        status: 'pending',
        transactionId: `tx_pend_${Date.now()}`
      });

      const res = await fetch(`${baseUrl}/api/payments/${pendingPayment._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ amount: 100 })
      });
      const body = await res.json();

      assert.strictEqual(res.status, 400);
      assert.strictEqual(body.success, false);
      assert.match(body.message, /only completed or partially refunded/i);
    });

    test('5. rejects refund on a failed payment with 400 Bad Request', async () => {
      const failedPayment = await Payment.create({
        booking: completedBooking._id,
        amount: 400,
        currency: 'USD',
        provider: 'mock',
        status: 'failed',
        transactionId: `tx_fail_${Date.now()}`
      });

      const res = await fetch(`${baseUrl}/api/payments/${failedPayment._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ amount: 100 })
      });
      const body = await res.json();

      assert.strictEqual(res.status, 400);
      assert.strictEqual(body.success, false);
    });

    test('6. rejects refund amount greater than captured amount with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/payments/${completedPayment._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ amount: 500 }) // captured is 400
      });
      const body = await res.json();

      assert.strictEqual(res.status, 400);
      assert.strictEqual(body.success, false);
      assert.match(body.message, /exceeds remaining refundable amount/i);
    });

    test('7. rejects negative or zero refund amount with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/payments/${completedPayment._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ amount: -50 })
      });
      const body = await res.json();

      assert.strictEqual(res.status, 400);
      assert.strictEqual(body.success, false);
    });

    test('8. rejects raw card credentials in refund payload (PCI Protection)', async () => {
      const res = await fetch(`${baseUrl}/api/payments/${completedPayment._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ amount: 50, cardNumber: '4242424242424242', cvv: '123' })
      });
      const body = await res.json();

      assert.strictEqual(res.status, 400);
      assert.strictEqual(body.success, false);
      assert.match(body.message, /security violation/i);
    });
  });

  describe('Refund Execution & Partial Refund Lifecycle', () => {
    let activeBooking;
    let activePayment;

    beforeEach(async () => {
      await Booking.deleteMany({});
      await Payment.deleteMany({});

      activeBooking = await Booking.create({
        hotel: testHotel._id,
        room: testRoom._id,
        user: customerA._id,
        checkInDate: new Date('2029-02-10T00:00:00.000Z'),
        checkOutDate: new Date('2029-02-12T00:00:00.000Z'),
        guestInfo: { name: 'Alice RefundTester', email: 'alice.refund@hotelpro.com' },
        guestCount: 2,
        priceSnapshot: {
          baseNightlyRate: 200,
          nightlyBreakdown: [{ date: '2029-02-10', rate: 200 }, { date: '2029-02-11', rate: 200 }],
          totalRoomRate: 400,
          taxes: 0,
          fees: 0
        },
        totalAmount: 400,
        currency: 'USD',
        status: 'confirmed'
      });

      activePayment = await Payment.create({
        booking: activeBooking._id,
        amount: 400,
        currency: 'USD',
        provider: 'mock',
        status: 'completed',
        transactionId: `tx_rf_exec_${Date.now()}`
      });
    });

    test('9. customer can execute a partial refund successfully and transition status to partially_refunded', async () => {
      const res = await fetch(`${baseUrl}/api/payments/${activePayment._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ amount: 150, reason: 'Guest shortened stay' })
      });
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.amount, 150);
      assert.strictEqual(body.data.status, 'partially_refunded');
      assert.strictEqual(body.data.totalRefunded, 150);
      assert.strictEqual(body.data.remainingRefundable, 250);
      assert.strictEqual(body.data.isFullRefund, false);

      // Verify persisted state in MongoDB
      const dbPayment = await Payment.findById(activePayment._id);
      assert.strictEqual(dbPayment.status, 'partially_refunded');
      assert.strictEqual(dbPayment.refund.status, 'completed');
      assert.strictEqual(dbPayment.refund.amount, 150);
      assert.strictEqual(dbPayment.refunds.length, 1);
      assert.strictEqual(dbPayment.refunds[0].amount, 150);
      assert.strictEqual(dbPayment.refunds[0].status, 'completed');
    });

    test('10. second partial refund succeeds up to captured amount and transitions status to refunded', async () => {
      // First refund: 150
      await fetch(`${baseUrl}/api/payments/${activePayment._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ amount: 150 })
      });

      // Second refund: remaining 250
      const res2 = await fetch(`${baseUrl}/api/payments/${activePayment._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ amount: 250, reason: 'Full remainder refunded' })
      });
      const body2 = await res2.json();

      assert.strictEqual(res2.status, 200);
      assert.strictEqual(body2.success, true);
      assert.strictEqual(body2.data.status, 'refunded');
      assert.strictEqual(body2.data.totalRefunded, 400);
      assert.strictEqual(body2.data.remainingRefundable, 0);
      assert.strictEqual(body2.data.isFullRefund, true);

      // Verify database
      const dbPayment = await Payment.findById(activePayment._id);
      assert.strictEqual(dbPayment.status, 'refunded');
      assert.strictEqual(dbPayment.refund.amount, 400);
      assert.strictEqual(dbPayment.refunds.length, 2);

      // Third refund attempt is rejected as already fully refunded
      const res3 = await fetch(`${baseUrl}/api/payments/${activePayment._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ amount: 10 })
      });
      assert.strictEqual(res3.status, 400);
    });

    test('11. full refund without specifying amount defaults to full captured amount', async () => {
      const res = await fetch(`${baseUrl}/api/payments/${activePayment._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ reason: 'Guest cancellation full refund' })
      });
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.data.amount, 400);
      assert.strictEqual(body.data.status, 'refunded');
      assert.strictEqual(body.data.isFullRefund, true);
      assert.strictEqual(body.data.remainingRefundable, 0);
    });

    test('12. administrator can issue a refund for any customer booking', async () => {
      const res = await fetch(`${baseUrl}/api/payments/${activePayment._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ amount: 100, reason: 'Admin customer satisfaction courtesy' })
      });
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.amount, 100);
    });

    test('13. refund idempotency: repeated request with same idempotencyKey does not repeat provider refund', async () => {
      const idempotencyKey = `idem_rf_${Date.now()}`;

      // First call
      const res1 = await fetch(`${baseUrl}/api/payments/${activePayment._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ amount: 100, idempotencyKey })
      });
      const body1 = await res1.json();
      assert.strictEqual(res1.status, 200);
      assert.strictEqual(body1.data.totalRefunded, 100);

      // Duplicate call with identical key
      const res2 = await fetch(`${baseUrl}/api/payments/${activePayment._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ amount: 100, idempotencyKey })
      });
      const body2 = await res2.json();

      assert.strictEqual(res2.status, 200);
      assert.strictEqual(body2.data.idempotent, true);
      assert.strictEqual(body2.data.totalRefunded, 100);

      // Ensure database has exactly 1 refund record, not 2
      const dbPayment = await Payment.findById(activePayment._id);
      assert.strictEqual(dbPayment.refunds.length, 1);
      assert.strictEqual(dbPayment.refund.amount, 100);
    });

    test('14. provider refund failure records failure details and leaves remaining refundable balance intact', async () => {
      const res = await fetch(`${baseUrl}/api/payments/${activePayment._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({
          amount: 100,
          simulation: { shouldFail: true, failureReason: 'Banking partner simulated refund decline' }
        })
      });
      const body = await res.json();

      assert.strictEqual(res.status, 400);
      assert.strictEqual(body.success, false);
      assert.match(body.message, /refund decline/i);

      // Verify payment was NOT refunded and failure attempt was recorded
      const dbPayment = await Payment.findById(activePayment._id);
      assert.strictEqual(dbPayment.status, 'completed');
      assert.strictEqual(dbPayment.refund.amount, 0);
      assert.strictEqual(dbPayment.metadata.get('reconciliationStatus'), 'refund_failed');
      assert.strictEqual(dbPayment.refunds.length, 1);
      assert.strictEqual(dbPayment.refunds[0].status, 'failed');
    });
  });

  describe('Cancellation Integration & Reconciliation', () => {
    let cancelBooking;
    let cancelPayment;

    beforeEach(async () => {
      await Booking.deleteMany({});
      await Payment.deleteMany({});

      cancelBooking = await Booking.create({
        hotel: testHotel._id,
        room: testRoom._id,
        user: customerA._id,
        checkInDate: new Date('2029-03-10T00:00:00.000Z'),
        checkOutDate: new Date('2029-03-12T00:00:00.000Z'),
        guestInfo: { name: 'Alice CancelTester', email: 'alice.refund@hotelpro.com' },
        guestCount: 2,
        priceSnapshot: {
          baseNightlyRate: 200,
          nightlyBreakdown: [{ date: '2029-03-10', rate: 200 }, { date: '2029-03-11', rate: 200 }],
          totalRoomRate: 400,
          taxes: 0,
          fees: 0
        },
        totalAmount: 400,
        currency: 'USD',
        status: 'confirmed'
      });

      cancelPayment = await Payment.create({
        booking: cancelBooking._id,
        amount: 400,
        currency: 'USD',
        provider: 'mock',
        status: 'completed',
        transactionId: `tx_cancel_test_${Date.now()}`
      });
    });

    test('15. booking cancellation automatically flags associated completed payment for refund reconciliation', async () => {
      const res = await fetch(`${baseUrl}/api/bookings/${cancelBooking._id}/cancel`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ reason: 'Trip rescheduled by guest' })
      });
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.booking.status, 'cancelled');

      // Verify associated payment now has reconciliation metadata
      const dbPayment = await Payment.findById(cancelPayment._id);
      assert.strictEqual(dbPayment.status, 'completed');
      assert.strictEqual(dbPayment.metadata.get('requiresRefund'), 'true');
      assert.strictEqual(dbPayment.metadata.get('reconciliationStatus'), 'refund_eligible');
      assert.match(dbPayment.metadata.get('reconciliationReason'), /cancelled/i);
    });

    test('16. admin reconciliation listing endpoint retrieves flagged payments with proper authorization', async () => {
      // Flag payment for reconciliation
      cancelPayment.metadata.set('requiresRefund', 'true');
      cancelPayment.metadata.set('reconciliationStatus', 'refund_eligible');
      cancelPayment.metadata.set('reconciliationReason', 'Cancelled booking payment');
      await cancelPayment.save();

      // 1. Unauthenticated request rejected
      const unauthRes = await fetch(`${baseUrl}/api/payments/reconciliation`);
      assert.strictEqual(unauthRes.status, 401);

      // 2. Regular customer rejected (403)
      const custRes = await fetch(`${baseUrl}/api/payments/reconciliation`, {
        headers: { Authorization: `Bearer ${customerAToken}` }
      });
      assert.strictEqual(custRes.status, 403);

      // 3. Admin request succeeds
      const adminRes = await fetch(`${baseUrl}/api/payments/reconciliation`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const body = await adminRes.json();

      assert.strictEqual(adminRes.status, 200);
      assert.strictEqual(body.success, true);
      assert.ok(Array.isArray(body.data.reconciliations));
      assert.ok(body.data.pagination);

      // Find our flagged payment
      const found = body.data.reconciliations.find((p) => p._id.toString() === cancelPayment._id.toString());
      assert.ok(found, 'Flagged payment should appear in reconciliation listing');
      assert.strictEqual(found.metadata.requiresRefund, 'true');
    });

    test('17. refund webhook event (charge.refunded) transitions payment status and resolves requiresRefund flag', async () => {
      const webhookPayload = {
        id: `evt_rf_wh_${Date.now()}`,
        type: 'charge.refunded',
        data: {
          transactionId: cancelPayment.transactionId,
          amount: 400,
          currency: 'USD',
          status: 'refunded'
        }
      };

      const res = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-payment-provider': 'mock',
          'x-mock-signature': 'mock_sig_valid'
        },
        body: JSON.stringify(webhookPayload)
      });
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.status, 'refunded');

      // Verify database payment
      const dbPayment = await Payment.findById(cancelPayment._id);
      assert.strictEqual(dbPayment.status, 'refunded');
      assert.strictEqual(dbPayment.refund.status, 'completed');
      assert.strictEqual(dbPayment.refund.amount, 400);
      assert.strictEqual(dbPayment.metadata.get('requiresRefund'), 'false');
      assert.strictEqual(dbPayment.metadata.get('reconciliationStatus'), 'refund_confirmed');
    });

    test('18. concurrent refund requests are serialized by payment lock and cannot exceed refundable balance', async () => {
      const booking = await Booking.create({
        hotel: testHotel._id,
        room: testRoom._id,
        user: customerA._id,
        checkInDate: new Date('2029-06-01T00:00:00.000Z'),
        checkOutDate: new Date('2029-06-03T00:00:00.000Z'),
        guestInfo: { name: 'Concurrent Refund Guest', email: 'concurrent@hotelpro.com' },
        guestCount: 2,
        priceSnapshot: {
          baseNightlyRate: 200,
          nightlyBreakdown: [{ date: '2029-06-01', rate: 200 }, { date: '2029-06-02', rate: 200 }],
          totalRoomRate: 400,
          taxes: 0,
          fees: 0
        },
        totalAmount: 400,
        currency: 'USD',
        status: 'confirmed',
        holdExpiresAt: null
      });

      const payment = await Payment.create({
        booking: booking._id,
        amount: 400,
        currency: 'USD',
        provider: 'mock',
        status: 'completed',
        transactionId: `mock_tx_concurrent_${Date.now()}`,
        paymentMethod: { methodType: 'card', last4: '4242' },
        metadata: new Map([['bookingId', booking._id.toString()]])
      });

      // Issue two concurrent refund requests for 300 each (total requested = 600 > 400)
      const [res1, res2] = await Promise.all([
        fetch(`${baseUrl}/api/payments/${payment._id}/refund`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customerAToken}`
          },
          body: JSON.stringify({ amount: 300, reason: 'Concurrent request 1', idempotencyKey: `idem_c1_${Date.now()}` })
        }),
        fetch(`${baseUrl}/api/payments/${payment._id}/refund`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customerAToken}`
          },
          body: JSON.stringify({ amount: 300, reason: 'Concurrent request 2', idempotencyKey: `idem_c2_${Date.now()}` })
        })
      ]);

      const [body1, body2] = await Promise.all([res1.json(), res2.json()]);

      // Exactly ONE request must succeed (200 OK) and the other must be rejected (400 or 409)
      const successCount = (res1.status === 200 ? 1 : 0) + (res2.status === 200 ? 1 : 0);
      assert.strictEqual(successCount, 1, 'Only one concurrent refund request should succeed');

      // The losing request must have failed with an appropriate error
      const failedRes = res1.status === 200 ? res2 : res1;
      const failedBody = res1.status === 200 ? body2 : body1;
      assert.ok([400, 409].includes(failedRes.status), `Failed request status should be 400 or 409, got ${failedRes.status}`);

      // Verify the persisted payment state
      const dbPayment = await Payment.findById(payment._id);
      assert.strictEqual(dbPayment.status, 'partially_refunded');
      assert.strictEqual(dbPayment.refund.amount, 300); // NEVER 600!
      const completedRefunds = dbPayment.refunds.filter((r) => r.status === 'completed');
      assert.strictEqual(completedRefunds.length, 1);
      assert.strictEqual(completedRefunds[0].amount, 300);
    });

    test('19. two concurrent partial refund requests within available balance both succeed without over-refunding', async () => {
      const booking = await Booking.create({
        hotel: testHotel._id,
        room: testRoom._id,
        user: customerA._id,
        checkInDate: new Date('2029-07-01T00:00:00.000Z'),
        checkOutDate: new Date('2029-07-03T00:00:00.000Z'),
        guestInfo: { name: 'Concurrent Partial Guest', email: 'cpartial@hotelpro.com' },
        guestCount: 2,
        priceSnapshot: {
          baseNightlyRate: 200,
          nightlyBreakdown: [{ date: '2029-07-01', rate: 200 }, { date: '2029-07-02', rate: 200 }],
          totalRoomRate: 400,
          taxes: 0,
          fees: 0
        },
        totalAmount: 400,
        currency: 'USD',
        status: 'confirmed'
      });

      const payment = await Payment.create({
        booking: booking._id,
        amount: 400,
        currency: 'USD',
        provider: 'mock',
        status: 'completed',
        transactionId: `mock_tx_concurrent_partial_${Date.now()}`,
        paymentMethod: { methodType: 'card', cardBrand: 'visa', cardLast4: '4242' },
        metadata: new Map([['bookingId', booking._id.toString()]])
      });

      // Two requests for 150 each (total 300 <= 400)
      const [res1, res2] = await Promise.all([
        fetch(`${baseUrl}/api/payments/${payment._id}/refund`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customerAToken}`
          },
          body: JSON.stringify({ amount: 150, reason: 'Partial concurrent 1', idempotencyKey: `idem_p1_${Date.now()}` })
        }),
        fetch(`${baseUrl}/api/payments/${payment._id}/refund`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customerAToken}`
          },
          body: JSON.stringify({ amount: 150, reason: 'Partial concurrent 2', idempotencyKey: `idem_p2_${Date.now()}` })
        })
      ]);

      const [body1, body2] = await Promise.all([res1.json(), res2.json()]);

      assert.strictEqual(res1.status, 200);
      assert.strictEqual(res2.status, 200);
      assert.strictEqual(body1.success, true);
      assert.strictEqual(body2.success, true);

      const dbPayment = await Payment.findById(payment._id);
      assert.strictEqual(dbPayment.status, 'partially_refunded');
      assert.strictEqual(dbPayment.refund.amount, 300);
      const completedRefunds = dbPayment.refunds.filter((r) => r.status === 'completed');
      assert.strictEqual(completedRefunds.length, 2);
    });

    test('20. concurrent full and partial refund requests cannot exceed payment total', async () => {
      const booking = await Booking.create({
        hotel: testHotel._id,
        room: testRoom._id,
        user: customerA._id,
        checkInDate: new Date('2029-08-01T00:00:00.000Z'),
        checkOutDate: new Date('2029-08-03T00:00:00.000Z'),
        guestInfo: { name: 'Concurrent Full/Partial Guest', email: 'cfull@hotelpro.com' },
        guestCount: 2,
        priceSnapshot: {
          baseNightlyRate: 200,
          nightlyBreakdown: [{ date: '2029-08-01', rate: 200 }, { date: '2029-08-02', rate: 200 }],
          totalRoomRate: 400,
          taxes: 0,
          fees: 0
        },
        totalAmount: 400,
        currency: 'USD',
        status: 'confirmed'
      });

      const payment = await Payment.create({
        booking: booking._id,
        amount: 400,
        currency: 'USD',
        provider: 'mock',
        status: 'completed',
        transactionId: `mock_tx_concurrent_full_${Date.now()}`,
        paymentMethod: { methodType: 'card', cardBrand: 'visa', cardLast4: '4242' },
        metadata: new Map([['bookingId', booking._id.toString()]])
      });

      // One request for full 400, one request for partial 200
      const [res1, res2] = await Promise.all([
        fetch(`${baseUrl}/api/payments/${payment._id}/refund`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customerAToken}`
          },
          body: JSON.stringify({ amount: 400, reason: 'Full concurrent', idempotencyKey: `idem_full_${Date.now()}` })
        }),
        fetch(`${baseUrl}/api/payments/${payment._id}/refund`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customerAToken}`
          },
          body: JSON.stringify({ amount: 200, reason: 'Partial concurrent', idempotencyKey: `idem_part_${Date.now()}` })
        })
      ]);

      const [body1, body2] = await Promise.all([res1.json(), res2.json()]);

      // Exactly one succeeds, and combined total never exceeds 400
      const dbPayment = await Payment.findById(payment._id);
      assert.ok(dbPayment.refund.amount <= 400, `Total refunded (${dbPayment.refund.amount}) must not exceed 400`);
      assert.ok(['partially_refunded', 'refunded'].includes(dbPayment.status));
      const successCount = (res1.status === 200 ? 1 : 0) + (res2.status === 200 ? 1 : 0);
      assert.strictEqual(successCount, 1, 'Only one request can succeed since sum 600 > 400');
      const failedRes = res1.status === 200 ? res2 : res1;
      assert.ok([400, 409].includes(failedRes.status), `Failed request status must be 400 or 409, got ${failedRes.status}`);
    });

    test('21. refund retry after provider timeout or uncertain outcome succeeds without blind duplicate refund', async () => {
      const booking = await Booking.create({
        hotel: testHotel._id,
        room: testRoom._id,
        user: customerA._id,
        checkInDate: new Date('2029-09-01T00:00:00.000Z'),
        checkOutDate: new Date('2029-09-02T00:00:00.000Z'),
        guestInfo: { name: 'Retry Timeout Guest', email: 'retry@hotelpro.com' },
        guestCount: 1,
        priceSnapshot: {
          baseNightlyRate: 200,
          nightlyBreakdown: [{ date: '2029-09-01', rate: 200 }],
          totalRoomRate: 200,
          taxes: 0,
          fees: 0
        },
        totalAmount: 200,
        currency: 'USD',
        status: 'confirmed'
      });

      const payment = await Payment.create({
        booking: booking._id,
        amount: 200,
        currency: 'USD',
        provider: 'mock',
        status: 'completed',
        transactionId: `mock_tx_retry_to_${Date.now()}`,
        paymentMethod: { methodType: 'card', cardBrand: 'visa', cardLast4: '4242' },
        metadata: new Map([['bookingId', booking._id.toString()]])
      });

      const sharedIdempotencyKey = `idem_timeout_retry_${Date.now()}`;

      // Request 1: Simulated network timeout
      const res1 = await fetch(`${baseUrl}/api/payments/${payment._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({
          amount: 200,
          reason: 'Attempt with timeout',
          idempotencyKey: sharedIdempotencyKey,
          simulation: { timeout: true }
        })
      });

      assert.strictEqual(res1.status, 400);

      // Verify DB after timeout: NOT marked as refunded!
      const dbPaymentAfterTimeout = await Payment.findById(payment._id);
      assert.strictEqual(dbPaymentAfterTimeout.status, 'completed');
      assert.strictEqual(dbPaymentAfterTimeout.refund?.amount || 0, 0);

      // Request 2: Retry with SAME idempotency key without timeout
      const res2 = await fetch(`${baseUrl}/api/payments/${payment._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({
          amount: 200,
          reason: 'Retry after timeout',
          idempotencyKey: sharedIdempotencyKey
        })
      });

      const body2 = await res2.json();
      assert.strictEqual(res2.status, 200);
      assert.strictEqual(body2.success, true);
      assert.strictEqual(body2.data.status, 'refunded');
      assert.strictEqual(body2.data.amount, 200);

      const dbPaymentAfterRetry = await Payment.findById(payment._id);
      assert.strictEqual(dbPaymentAfterRetry.status, 'refunded');
      assert.strictEqual(dbPaymentAfterRetry.refund.amount, 200);
      const completedEntries = (dbPaymentAfterRetry.refunds || []).filter((r) => r.status === 'completed');
      assert.strictEqual(completedEntries.length, 1);

      // Request 3: Subsequent duplicate submission with the same idempotency key returns idempotent 200
      const res3 = await fetch(`${baseUrl}/api/payments/${payment._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({
          amount: 200,
          idempotencyKey: sharedIdempotencyKey
        })
      });

      const body3 = await res3.json();
      assert.strictEqual(res3.status, 200);
      assert.strictEqual(body3.data.idempotent, true);
      assert.strictEqual(body3.data.totalRefunded, 200);
    });

    test('22. duplicate refund webhook events do not create duplicate refunds or corrupt balances', async () => {
      const booking = await Booking.create({
        hotel: testHotel._id,
        room: testRoom._id,
        user: customerA._id,
        checkInDate: new Date('2029-10-01T00:00:00.000Z'),
        checkOutDate: new Date('2029-10-02T00:00:00.000Z'),
        guestInfo: { name: 'Dup Webhook Guest', email: 'dupwh@hotelpro.com' },
        guestCount: 1,
        priceSnapshot: {
          baseNightlyRate: 300,
          nightlyBreakdown: [{ date: '2029-10-01', rate: 300 }],
          totalRoomRate: 300,
          taxes: 0,
          fees: 0
        },
        totalAmount: 300,
        currency: 'USD',
        status: 'confirmed'
      });

      const payment = await Payment.create({
        booking: booking._id,
        amount: 300,
        currency: 'USD',
        provider: 'mock',
        status: 'completed',
        transactionId: `mock_tx_dupwh_${Date.now()}`,
        paymentMethod: { methodType: 'card', cardBrand: 'visa', cardLast4: '4242' },
        metadata: new Map([
          ['bookingId', booking._id.toString()],
          ['requiresRefund', 'true'],
          ['reconciliationStatus', 'refund_eligible']
        ])
      });

      const webhookPayload = {
        id: `evt_dup_rf_${Date.now()}`,
        type: 'charge.refunded',
        data: {
          transactionId: payment.transactionId,
          amount: 300,
          currency: 'USD',
          status: 'refunded'
        }
      };

      // Webhook event 1
      const res1 = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-payment-provider': 'mock',
          'x-mock-signature': 'mock_sig_valid'
        },
        body: JSON.stringify(webhookPayload)
      });
      const body1 = await res1.json();
      assert.strictEqual(res1.status, 200);
      assert.strictEqual(body1.success, true);
      assert.strictEqual(body1.status, 'refunded');

      // Webhook event 2 (duplicate delivery)
      const res2 = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-payment-provider': 'mock',
          'x-mock-signature': 'mock_sig_valid'
        },
        body: JSON.stringify(webhookPayload)
      });
      const body2 = await res2.json();
      assert.strictEqual(res2.status, 200);
      assert.strictEqual(body2.success, true);
      assert.strictEqual(body2.idempotent, true);

      // Verify DB: exactly 1 refund record, status refunded, amount 300
      const dbPayment = await Payment.findById(payment._id);
      assert.strictEqual(dbPayment.status, 'refunded');
      assert.strictEqual(dbPayment.refund.amount, 300);
      assert.strictEqual(dbPayment.metadata.get('requiresRefund'), 'false');
      assert.strictEqual(dbPayment.metadata.get('reconciliationStatus'), 'refund_confirmed');
    });

    test('23. refund amount exceeding remaining refundable balance is rejected with informative 400', async () => {
      const booking = await Booking.create({
        hotel: testHotel._id,
        room: testRoom._id,
        user: customerA._id,
        checkInDate: new Date('2029-11-01T00:00:00.000Z'),
        checkOutDate: new Date('2029-11-02T00:00:00.000Z'),
        guestInfo: { name: 'Exceed Guest', email: 'exceed@hotelpro.com' },
        guestCount: 1,
        priceSnapshot: {
          baseNightlyRate: 200,
          nightlyBreakdown: [{ date: '2029-11-01', rate: 200 }],
          totalRoomRate: 200,
          taxes: 0,
          fees: 0
        },
        totalAmount: 200,
        currency: 'USD',
        status: 'confirmed'
      });

      const payment = await Payment.create({
        booking: booking._id,
        amount: 200,
        currency: 'USD',
        provider: 'mock',
        status: 'completed',
        transactionId: `mock_tx_exceed_${Date.now()}`,
        paymentMethod: { methodType: 'card', cardBrand: 'visa', cardLast4: '4242' },
        metadata: new Map([['bookingId', booking._id.toString()]])
      });

      // Partial refund of 150
      const res1 = await fetch(`${baseUrl}/api/payments/${payment._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ amount: 150, reason: 'First partial' })
      });
      assert.strictEqual(res1.status, 200);

      // Attempt to refund 100 when remaining is 50
      const res2 = await fetch(`${baseUrl}/api/payments/${payment._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ amount: 100, reason: 'Exceeding refund' })
      });
      const body2 = await res2.json();
      assert.strictEqual(res2.status, 400);
      assert.ok(body2.message.includes('exceeds remaining refundable amount'));

      // Refund exact remaining 50
      const res3 = await fetch(`${baseUrl}/api/payments/${payment._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ amount: 50, reason: 'Final partial' })
      });
      assert.strictEqual(res3.status, 200);

      // Attempt refund on fully refunded payment
      const res4 = await fetch(`${baseUrl}/api/payments/${payment._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ amount: 10 })
      });
      assert.strictEqual(res4.status, 400);
      const body4 = await res4.json();
      assert.ok(body4.message.includes('already been fully refunded') || body4.message.includes('Cannot refund payment with status "refunded"'));
    });

    test('24. sensitive fields are omitted from all payment-related responses', async () => {
      const booking = await Booking.create({
        hotel: testHotel._id,
        room: testRoom._id,
        user: customerA._id,
        checkInDate: new Date('2029-12-01T00:00:00.000Z'),
        checkOutDate: new Date('2029-12-03T00:00:00.000Z'),
        guestInfo: { name: 'Sanitization Guest', email: 'sanit@hotelpro.com' },
        guestCount: 1,
        priceSnapshot: {
          baseNightlyRate: 150,
          nightlyBreakdown: [{ date: '2029-12-01', rate: 150 }, { date: '2029-12-02', rate: 150 }],
          totalRoomRate: 300,
          taxes: 0,
          fees: 0
        },
        totalAmount: 300,
        currency: 'USD',
        status: 'confirmed'
      });

      const payment = await Payment.create({
        booking: booking._id,
        amount: 300,
        currency: 'USD',
        provider: 'mock',
        status: 'completed',
        transactionId: `mock_tx_sanit_${Date.now()}`,
        paymentMethod: { methodType: 'card', cardBrand: 'visa', cardLast4: '4242' },
        metadata: new Map([
          ['bookingId', booking._id.toString()],
          ['clientSecret', 'pi_secret_sensitive_12345'],
          ['apiKey', 'sk_live_secret_key_12345'],
          ['webhookSecret', 'whsec_secret_12345'],
          ['lockToken', 'internal_lock_token_12345'],
          ['requiresRefund', 'true'],
          ['reconciliationStatus', 'refund_eligible'],
          ['reconciliationReason', 'Cancellation after payment']
        ])
      });

      const forbiddenKeys = ['clientSecret', 'apiKey', 'webhookSecret', 'lockToken', 'password', 'passwordHash', '__v'];

      // 1. GET /api/payments/:id
      const resPay = await fetch(`${baseUrl}/api/payments/${payment._id}`, {
        headers: { Authorization: `Bearer ${customerAToken}` }
      });
      const bodyPay = await resPay.json();
      assert.strictEqual(resPay.status, 200);
      const payDataStr = JSON.stringify(bodyPay);
      for (const key of forbiddenKeys) {
        assert.ok(!payDataStr.includes('sensitive_12345') && !payDataStr.includes('secret_key_12345'), `Payment receipt must not expose "${key}"`);
      }
      assert.strictEqual(bodyPay.data.payment.metadata.clientSecret, undefined);
      assert.strictEqual(bodyPay.data.payment.metadata.apiKey, undefined);

      // 2. GET /api/payments/reconciliation (Admin)
      const resRecon = await fetch(`${baseUrl}/api/payments/reconciliation`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const bodyRecon = await resRecon.json();
      assert.strictEqual(resRecon.status, 200);
      const reconDataStr = JSON.stringify(bodyRecon);
      assert.ok(!reconDataStr.includes('pi_secret_sensitive_12345'), 'Reconciliation listing must not expose clientSecret');
      assert.ok(!reconDataStr.includes('sk_live_secret_key_12345'), 'Reconciliation listing must not expose apiKey');

      // 3. GET /api/bookings/:id
      const resBooking = await fetch(`${baseUrl}/api/bookings/${booking._id}`, {
        headers: { Authorization: `Bearer ${customerAToken}` }
      });
      const bodyBooking = await resBooking.json();
      assert.strictEqual(resBooking.status, 200);
      const bookingStr = JSON.stringify(bodyBooking);
      assert.ok(!bookingStr.includes('pi_secret_sensitive_12345'), 'Booking details must not expose clientSecret');

      // 4. GET /api/bookings/my
      const resMy = await fetch(`${baseUrl}/api/bookings/my`, {
        headers: { Authorization: `Bearer ${customerAToken}` }
      });
      const bodyMy = await resMy.json();
      assert.strictEqual(resMy.status, 200);
      const myStr = JSON.stringify(bodyMy);
      assert.ok(!myStr.includes('pi_secret_sensitive_12345'), 'Booking history must not expose clientSecret');
    });

    test('25. cancelling a booking with a partially refunded payment flags remaining balance for reconciliation', async () => {
      const booking = await Booking.create({
        hotel: testHotel._id,
        room: testRoom._id,
        user: customerA._id,
        checkInDate: new Date('2030-01-01T00:00:00.000Z'),
        checkOutDate: new Date('2030-01-04T00:00:00.000Z'),
        guestInfo: { name: 'Partial Cancel Guest', email: 'pcancel@hotelpro.com' },
        guestCount: 2,
        priceSnapshot: {
          baseNightlyRate: 150,
          nightlyBreakdown: [{ date: '2030-01-01', rate: 150 }, { date: '2030-01-02', rate: 150 }, { date: '2030-01-03', rate: 150 }],
          totalRoomRate: 450,
          taxes: 0,
          fees: 0
        },
        totalAmount: 450,
        currency: 'USD',
        status: 'confirmed'
      });

      const payment = await Payment.create({
        booking: booking._id,
        amount: 450,
        currency: 'USD',
        provider: 'mock',
        status: 'completed',
        transactionId: `mock_tx_pcancel_${Date.now()}`,
        paymentMethod: { methodType: 'card', cardBrand: 'visa', cardLast4: '4242' },
        metadata: new Map([['bookingId', booking._id.toString()]])
      });

      // Partial refund of 150
      const refundRes = await fetch(`${baseUrl}/api/payments/${payment._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ amount: 150, reason: 'Early partial refund' })
      });
      assert.strictEqual(refundRes.status, 200);

      // Cancel the booking via customer self-service endpoint
      const cancelRes = await fetch(`${baseUrl}/api/bookings/${booking._id}/cancel`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ reason: 'Trip rescheduled' })
      });
      assert.strictEqual(cancelRes.status, 200);

      // Verify payment was properly flagged for remaining refund reconciliation
      const dbPayment = await Payment.findById(payment._id);
      assert.strictEqual(dbPayment.status, 'partially_refunded');
      assert.strictEqual(dbPayment.metadata.get('requiresRefund'), 'true');
      assert.strictEqual(dbPayment.metadata.get('reconciliationStatus'), 'refund_eligible');
      assert.ok(dbPayment.metadata.get('reconciliationReason').includes('cancelled'));

      // Admin executes remaining refund of 300
      const adminRefundRes = await fetch(`${baseUrl}/api/payments/${payment._id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ amount: 300, reason: 'Reconciliation final refund' })
      });
      assert.strictEqual(adminRefundRes.status, 200);
      const adminBody = await adminRefundRes.json();
      assert.strictEqual(adminBody.data.status, 'refunded');
      assert.strictEqual(adminBody.data.totalRefunded, 450);

      const reconciledPayment = await Payment.findById(payment._id);
      assert.strictEqual(reconciledPayment.status, 'refunded');
      assert.strictEqual(reconciledPayment.metadata.get('requiresRefund'), 'false');
      assert.strictEqual(reconciledPayment.metadata.get('reconciliationStatus'), 'refund_confirmed');
    });

    test('26. late payment webhook for cancelled booking flags payment without confirming booking', async () => {
      const booking = await Booking.create({
        hotel: testHotel._id,
        room: testRoom._id,
        user: customerA._id,
        checkInDate: new Date('2030-02-01T00:00:00.000Z'),
        checkOutDate: new Date('2030-02-03T00:00:00.000Z'),
        guestInfo: { name: 'Late Payment Guest', email: 'latepay@hotelpro.com' },
        guestCount: 1,
        priceSnapshot: {
          baseNightlyRate: 200,
          nightlyBreakdown: [{ date: '2030-02-01', rate: 200 }, { date: '2030-02-02', rate: 200 }],
          totalRoomRate: 400,
          taxes: 0,
          fees: 0
        },
        totalAmount: 400,
        currency: 'USD',
        status: 'cancelled',
        cancellation: { cancelledAt: new Date(), reason: 'Customer cancelled early' }
      });

      const payment = await Payment.create({
        booking: booking._id,
        amount: 400,
        currency: 'USD',
        provider: 'mock',
        status: 'pending',
        transactionId: `mock_tx_late_${Date.now()}`,
        paymentMethod: { methodType: 'card', cardBrand: 'visa', cardLast4: '4242' },
        metadata: new Map([['bookingId', booking._id.toString()]])
      });

      // Late payment_intent.succeeded arrives
      const webhookPayload = {
        id: `evt_late_${Date.now()}`,
        type: 'payment_intent.succeeded',
        data: {
          transactionId: payment.transactionId,
          amount: 400,
          currency: 'USD',
          status: 'completed'
        }
      };

      const res = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-payment-provider': 'mock',
          'x-mock-signature': 'mock_sig_valid'
        },
        body: JSON.stringify(webhookPayload)
      });
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.bookingConfirmed, false);
      assert.strictEqual(body.requiresRefund, true);

      // Verify booking did NOT transition to confirmed
      const dbBooking = await Booking.findById(booking._id);
      assert.strictEqual(dbBooking.status, 'cancelled');

      // Verify payment was marked completed and flagged for refund
      const dbPayment = await Payment.findById(payment._id);
      assert.strictEqual(dbPayment.status, 'completed');
      assert.strictEqual(dbPayment.metadata.get('requiresRefund'), 'true');
      assert.strictEqual(dbPayment.metadata.get('reconciliationStatus'), 'refund_eligible');
    });
  });
});
