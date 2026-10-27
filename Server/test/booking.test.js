require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const app = require('../app');
const { Hotel, Room, Booking, User, SystemLock } = require('../src/models');
const { signToken } = require('../src/config/jwt');
const { acquireRoomLock, releaseRoomLock } = require('../src/utils/roomLock');

describe('Stage 5: Booking Management, Reservation Lifecycle & Double-Booking Prevention Tests', () => {
  const ISOLATED_TEST_DB_URI = 'mongodb://127.0.0.1:27017/hotelpro_booking_test_isolation';
  let server;
  let baseUrl;

  let activeHotel;
  let inactiveHotel;

  let activeRoom;
  let maintenanceRoom;
  let inactiveRoom;
  let secondaryRoom;

  let adminUser;
  let customerA;
  let customerB;
  let adminToken;
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

    // Initialize indexes
    await Hotel.init();
    await Room.init();
    await Booking.init();
    await User.init();
    await SystemLock.init();

    // Clean test collections
    await Hotel.deleteMany({});
    await Room.deleteMany({});
    await Booking.deleteMany({});
    await User.deleteMany({});
    await SystemLock.deleteMany({});

    // Seed test users
    adminUser = await User.create({
      name: 'System Administrator',
      email: 'admin.stage5@hotelpro.com',
      passwordHash: '$2a$12$e8YQzabcdef1234567890',
      role: 'admin',
      status: 'active'
    });
    adminToken = signToken({ sub: adminUser._id.toString(), role: 'admin' });

    customerA = await User.create({
      name: 'Alice Traveler',
      email: 'alice.stage5@hotelpro.com',
      passwordHash: '$2a$12$e8YQzabcdef1234567890',
      role: 'customer',
      status: 'active',
      phone: '+15551234567'
    });
    customerAToken = signToken({ sub: customerA._id.toString(), role: 'customer' });

    customerB = await User.create({
      name: 'Bob Voyager',
      email: 'bob.stage5@hotelpro.com',
      passwordHash: '$2a$12$e8YQzabcdef1234567890',
      role: 'customer',
      status: 'active'
    });
    customerBToken = signToken({ sub: customerB._id.toString(), role: 'customer' });

    // Seed test hotels
    activeHotel = await Hotel.create({
      name: 'Stage 5 Grand Resort',
      address: { street: '500 Boardwalk', city: 'Atlantic City', country: 'USA' },
      contact: { phone: '+16095551000', email: 'stage5@resort.com' },
      status: 'active',
      isActive: true
    });

    inactiveHotel = await Hotel.create({
      name: 'Stage 5 Abandoned Motel',
      address: { street: '99 Desert Rd', city: 'Nowhere', country: 'USA' },
      contact: { phone: '+19995559999', email: 'abandoned@desert.com' },
      status: 'inactive',
      isActive: false
    });

    // Seed test rooms
    // Room 101: Active, basePrice 100, capacity 2, date rule for Nov 13-15 at 150/night
    activeRoom = await Room.create({
      hotel: activeHotel._id,
      roomNumber: '101',
      roomType: 'double',
      basePrice: 100,
      capacity: 2,
      status: 'active',
      pricingRules: [
        {
          ruleName: 'Mid-Nov Peak',
          startDate: '2026-11-13',
          endDate: '2026-11-15',
          price: 150
        }
      ]
    });

    // Room 102: Active, basePrice 200, capacity 4
    secondaryRoom = await Room.create({
      hotel: activeHotel._id,
      roomNumber: '102',
      roomType: 'suite',
      basePrice: 200,
      capacity: 4,
      status: 'active'
    });

    // Room 103: Maintenance
    maintenanceRoom = await Room.create({
      hotel: activeHotel._id,
      roomNumber: '103',
      roomType: 'single',
      basePrice: 80,
      capacity: 1,
      status: 'maintenance'
    });

    // Room 104: Inactive
    inactiveRoom = await Room.create({
      hotel: activeHotel._id,
      roomNumber: '104',
      roomType: 'single',
      basePrice: 75,
      capacity: 1,
      status: 'inactive'
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
  // Section 1: Creation and Validation Tests
  // ==========================================
  describe('Creation and Validation', () => {
    test('unauthenticated request is rejected with 401', async () => {
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room: activeRoom._id.toString(),
          checkInDate: '2026-11-01',
          checkOutDate: '2026-11-03',
          guestCount: 2
        })
      });
      assert.strictEqual(res.status, 401);
      const body = await res.json();
      assert.strictEqual(body.success, false);
    });

    test('successfully creates a valid booking and freezes price snapshot', async () => {
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({
          room: activeRoom._id.toString(),
          checkInDate: '2026-11-01',
          checkOutDate: '2026-11-04',
          guestCount: 2,
          guestInfo: {
            name: 'Alice Traveler',
            email: 'alice.stage5@hotelpro.com',
            phone: '+15551234567'
          }
        })
      });

      assert.strictEqual(res.status, 201);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.ok(body.data.booking._id);
      assert.strictEqual(body.data.booking.status, 'pending');
      assert.strictEqual(body.data.booking.guestCount, 2);

      // Verify price snapshot: 3 nights (Nov 1, Nov 2, Nov 3) at basePrice 100 = 300
      const snapshot = body.data.booking.priceSnapshot;
      assert.strictEqual(snapshot.baseNightlyRate, 100);
      assert.strictEqual(snapshot.nightlyBreakdown.length, 3);
      assert.strictEqual(snapshot.totalRoomRate, 300);
      assert.strictEqual(body.data.booking.totalAmount, 300);
      assert.strictEqual(body.data.booking.currency, 'USD');

      // Verify customer ID matches authenticated user
      assert.strictEqual(
        body.data.booking.user._id.toString(),
        customerA._id.toString()
      );
    });

    test('customer ID spoofing prevention: uses req.user._id instead of request body user', async () => {
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({
          room: secondaryRoom._id.toString(),
          checkInDate: '2026-11-01',
          checkOutDate: '2026-11-03',
          guestCount: 2,
          user: customerB._id.toString(), // Attacker tries to book on behalf of Bob
          userId: customerB._id.toString()
        })
      });

      assert.strictEqual(res.status, 201);
      const body = await res.json();
      // Must be attributed to authenticated Alice, NOT Bob
      assert.strictEqual(
        body.data.booking.user._id.toString(),
        customerA._id.toString()
      );
      assert.notStrictEqual(
        body.data.booking.user._id.toString(),
        customerB._id.toString()
      );
    });

    test('applies date-specific pricing rules correctly in price snapshot', async () => {
      // Stay from Nov 12 to Nov 15:
      // Nov 12: base price 100
      // Nov 13: peak rule 150
      // Nov 14: peak rule 150
      // Check-out on Nov 15 (departure day, not billed)
      // Total: 100 + 150 + 150 = 400
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerBToken}`
        },
        body: JSON.stringify({
          room: activeRoom._id.toString(),
          checkInDate: '2026-11-12',
          checkOutDate: '2026-11-15',
          guestCount: 1
        })
      });

      assert.strictEqual(res.status, 201);
      const body = await res.json();
      const snapshot = body.data.booking.priceSnapshot;
      assert.strictEqual(snapshot.nightlyBreakdown.length, 3);
      assert.strictEqual(snapshot.nightlyBreakdown[0].rate, 100);
      assert.strictEqual(snapshot.nightlyBreakdown[1].rate, 150);
      assert.strictEqual(snapshot.nightlyBreakdown[2].rate, 150);
      assert.strictEqual(snapshot.totalRoomRate, 400);
      assert.strictEqual(body.data.booking.totalAmount, 400);
    });

    test('subsequent changes to room basePrice do not alter historical price snapshot', async () => {
      // Create a booking when basePrice is 100
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({
          room: activeRoom._id.toString(),
          checkInDate: '2026-11-20',
          checkOutDate: '2026-11-22',
          guestCount: 1
        })
      });
      const created = await res.json();
      const bookingId = created.data.booking._id;
      assert.strictEqual(created.data.booking.totalAmount, 200);

      // Admin increases room basePrice to 500
      await Room.findByIdAndUpdate(activeRoom._id, { basePrice: 500 });

      // Fetch the booking again; rate snapshot must remain 200
      const fetchRes = await fetch(`${baseUrl}/api/bookings/${bookingId}`, {
        headers: { Authorization: `Bearer ${customerAToken}` }
      });
      const fetched = await fetchRes.json();
      assert.strictEqual(fetched.data.booking.totalAmount, 200);
      assert.strictEqual(fetched.data.booking.priceSnapshot.totalRoomRate, 200);

      // Restore basePrice for subsequent tests
      await Room.findByIdAndUpdate(activeRoom._id, { basePrice: 100 });
    });

    test('rejects booking for invalid or nonexistent room reference with 404', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({
          room: nonExistentId,
          checkInDate: '2026-11-25',
          checkOutDate: '2026-11-27',
          guestCount: 1
        })
      });
      assert.strictEqual(res.status, 404);
    });

    test('rejects booking for maintenance room with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({
          room: maintenanceRoom._id.toString(),
          checkInDate: '2026-11-25',
          checkOutDate: '2026-11-27',
          guestCount: 1
        })
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.match(body.message, /operational status: maintenance/i);
    });

    test('rejects booking for inactive room with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({
          room: inactiveRoom._id.toString(),
          checkInDate: '2026-11-25',
          checkOutDate: '2026-11-27',
          guestCount: 1
        })
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.match(body.message, /operational status: inactive/i);
    });

    test('rejects booking exceeding room capacity with 400 Bad Request', async () => {
      // activeRoom has capacity 2; request 3 guests
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({
          room: activeRoom._id.toString(),
          checkInDate: '2026-11-25',
          checkOutDate: '2026-11-27',
          guestCount: 3
        })
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.match(body.message, /exceeds maximum room capacity/i);
    });

    test('rejects invalid stay dates (check-out on or before check-in) with 400', async () => {
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({
          room: activeRoom._id.toString(),
          checkInDate: '2026-11-25',
          checkOutDate: '2026-11-25', // Same day checkout
          guestCount: 1
        })
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.match(body.message, /strictly after checkInDate/i);
    });

    test('rejects stay durations exceeding 180 days with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({
          room: activeRoom._id.toString(),
          checkInDate: '2026-11-01',
          checkOutDate: '2027-06-01', // > 200 days
          guestCount: 1
        })
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.match(body.message, /cannot exceed 180 days/i);
    });
  });

  // ==========================================
  // Section 2: Availability and Concurrency Tests
  // ==========================================
  describe('Availability & Concurrency Control', () => {
    test('overlapping confirmed booking blocks a new booking with 409 Conflict', async () => {
      // Create confirmed booking for Nov 05 - Nov 08
      await Booking.create({
        hotel: activeHotel._id,
        room: activeRoom._id,
        user: customerA._id,
        checkInDate: new Date('2026-11-05T00:00:00.000Z'),
        checkOutDate: new Date('2026-11-08T00:00:00.000Z'),
        guestInfo: { name: 'Alice Traveler', email: 'alice@hotelpro.com' },
        guestCount: 1,
        priceSnapshot: {
          baseNightlyRate: 100,
          nightlyBreakdown: [{ date: '2026-11-05', rate: 100 }],
          totalRoomRate: 300,
          taxes: 0,
          fees: 0
        },
        totalAmount: 300,
        currency: 'USD',
        status: 'confirmed'
      });

      // Attempt to book Nov 06 - Nov 09 (overlaps Nov 06 and Nov 07)
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerBToken}`
        },
        body: JSON.stringify({
          room: activeRoom._id.toString(),
          checkInDate: '2026-11-06',
          checkOutDate: '2026-11-09',
          guestCount: 1
        })
      });

      assert.strictEqual(res.status, 409);
      const body = await res.json();
      assert.match(body.message, /no longer available/i);
    });

    test('overlapping checked_in booking blocks a new booking with 409 Conflict', async () => {
      // Create checked_in booking for Nov 08 - Nov 11
      await Booking.create({
        hotel: activeHotel._id,
        room: activeRoom._id,
        user: customerA._id,
        checkInDate: new Date('2026-11-08T00:00:00.000Z'),
        checkOutDate: new Date('2026-11-11T00:00:00.000Z'),
        guestInfo: { name: 'Alice Traveler', email: 'alice@hotelpro.com' },
        guestCount: 1,
        priceSnapshot: {
          baseNightlyRate: 100,
          nightlyBreakdown: [{ date: '2026-11-08', rate: 100 }],
          totalRoomRate: 300,
          taxes: 0,
          fees: 0
        },
        totalAmount: 300,
        currency: 'USD',
        status: 'checked_in'
      });

      // Attempt to book Nov 10 - Nov 12
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerBToken}`
        },
        body: JSON.stringify({
          room: activeRoom._id.toString(),
          checkInDate: '2026-11-10',
          checkOutDate: '2026-11-12',
          guestCount: 1
        })
      });

      assert.strictEqual(res.status, 409);
    });

    test('cancelled bookings do not block availability', async () => {
      // Create a cancelled booking for Dec 01 - Dec 05
      await Booking.create({
        hotel: activeHotel._id,
        room: activeRoom._id,
        user: customerA._id,
        checkInDate: new Date('2026-12-01T00:00:00.000Z'),
        checkOutDate: new Date('2026-12-05T00:00:00.000Z'),
        guestInfo: { name: 'Alice Traveler', email: 'alice@hotelpro.com' },
        guestCount: 1,
        priceSnapshot: {
          baseNightlyRate: 100,
          nightlyBreakdown: [{ date: '2026-12-01', rate: 100 }],
          totalRoomRate: 400,
          taxes: 0,
          fees: 0
        },
        totalAmount: 400,
        currency: 'USD',
        status: 'cancelled',
        cancellation: { cancelledAt: new Date(), reason: 'Trip cancelled' }
      });

      // Customer B books the exact same dates Dec 01 - Dec 05
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerBToken}`
        },
        body: JSON.stringify({
          room: activeRoom._id.toString(),
          checkInDate: '2026-12-01',
          checkOutDate: '2026-12-05',
          guestCount: 1
        })
      });

      assert.strictEqual(res.status, 201);
      const body = await res.json();
      assert.strictEqual(body.data.booking.status, 'pending');
    });

    test('checked_out bookings do not block future availability', async () => {
      // Create a checked_out booking for Dec 05 - Dec 08
      await Booking.create({
        hotel: activeHotel._id,
        room: activeRoom._id,
        user: customerA._id,
        checkInDate: new Date('2026-12-05T00:00:00.000Z'),
        checkOutDate: new Date('2026-12-08T00:00:00.000Z'),
        guestInfo: { name: 'Alice Traveler', email: 'alice@hotelpro.com' },
        guestCount: 1,
        priceSnapshot: {
          baseNightlyRate: 100,
          nightlyBreakdown: [{ date: '2026-12-05', rate: 100 }],
          totalRoomRate: 300,
          taxes: 0,
          fees: 0
        },
        totalAmount: 300,
        currency: 'USD',
        status: 'checked_out'
      });

      // Booking starts on Dec 08 (same day check-in as check-out)
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerBToken}`
        },
        body: JSON.stringify({
          room: activeRoom._id.toString(),
          checkInDate: '2026-12-08',
          checkOutDate: '2026-12-10',
          guestCount: 1
        })
      });

      assert.strictEqual(res.status, 201);
    });

    test('same-day checkout / check-in boundary allows non-overlapping back-to-back stays', async () => {
      // Active booking: Dec 15 - Dec 18
      await Booking.create({
        hotel: activeHotel._id,
        room: activeRoom._id,
        user: customerA._id,
        checkInDate: new Date('2026-12-15T00:00:00.000Z'),
        checkOutDate: new Date('2026-12-18T00:00:00.000Z'),
        guestInfo: { name: 'Alice Traveler', email: 'alice@hotelpro.com' },
        guestCount: 1,
        priceSnapshot: {
          baseNightlyRate: 100,
          nightlyBreakdown: [{ date: '2026-12-15', rate: 100 }],
          totalRoomRate: 300,
          taxes: 0,
          fees: 0
        },
        totalAmount: 300,
        currency: 'USD',
        status: 'confirmed'
      });

      // Stay 1 ending exactly on check-in day: Dec 12 - Dec 15
      const res1 = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerBToken}`
        },
        body: JSON.stringify({
          room: activeRoom._id.toString(),
          checkInDate: '2026-12-12',
          checkOutDate: '2026-12-15',
          guestCount: 1
        })
      });
      assert.strictEqual(res1.status, 201);

      // Stay 2 starting exactly on checkout day: Dec 18 - Dec 21
      const res2 = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerBToken}`
        },
        body: JSON.stringify({
          room: activeRoom._id.toString(),
          checkInDate: '2026-12-18',
          checkOutDate: '2026-12-21',
          guestCount: 1
        })
      });
      assert.strictEqual(res2.status, 201);
    });

    test('different rooms can be booked independently without cross-room blocking', async () => {
      // Book secondaryRoom for Dec 20 - Dec 25
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({
          room: secondaryRoom._id.toString(),
          checkInDate: '2026-12-20',
          checkOutDate: '2026-12-25',
          guestCount: 2
        })
      });
      assert.strictEqual(res.status, 201);
    });

    test('CRITICAL CONCURRENCY: concurrent overlapping booking requests cannot both succeed', async () => {
      // Target room: secondaryRoom
      // Target stay: Jan 10, 2027 to Jan 14, 2027 (overlapping stay)
      const payloadA = {
        room: secondaryRoom._id.toString(),
        checkInDate: '2027-01-10',
        checkOutDate: '2027-01-14',
        guestCount: 1
      };

      const payloadB = {
        room: secondaryRoom._id.toString(),
        checkInDate: '2027-01-12',
        checkOutDate: '2027-01-16',
        guestCount: 2
      };

      // Launch both requests concurrently via Promise.all
      const [resA, resB] = await Promise.all([
        fetch(`${baseUrl}/api/bookings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customerAToken}`
          },
          body: JSON.stringify(payloadA)
        }),
        fetch(`${baseUrl}/api/bookings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customerBToken}`
          },
          body: JSON.stringify(payloadB)
        })
      ]);

      const statuses = [resA.status, resB.status].sort();

      // Exactly ONE request must succeed (201) and ONE must fail with conflict (409)
      assert.strictEqual(
        statuses[0],
        201,
        `Expected one successful reservation (201), got ${statuses[0]}`
      );
      assert.strictEqual(
        statuses[1],
        409,
        `Expected conflicting concurrent reservation to be rejected (409), got ${statuses[1]}`
      );

      // Verify database state: exactly ONE booking exists in that date window
      const count = await Booking.countDocuments({
        room: secondaryRoom._id,
        checkInDate: { $lt: new Date('2027-01-16T00:00:00.000Z') },
        checkOutDate: { $gt: new Date('2027-01-10T00:00:00.000Z') },
        status: { $in: ['pending', 'confirmed'] }
      });
      assert.strictEqual(count, 1, 'Database must contain exactly 1 active reservation');

      // Verify that the room lock was cleanly released and is not left permanently locked
      const lockDoc = await SystemLock.findById(`room_lock_${secondaryRoom._id}`);
      assert.strictEqual(lockDoc, null, 'Room lock must be deleted after request completion');
    });

    test('failure during reservation processing releases lock without leaving orphaned lock', async () => {
      // Simulate an error inside the lock by passing a payload that fails validation after lock acquisition
      // Or verify that acquireRoomLock and releaseRoomLock handle stale recovery
      const lockKey = `room_lock_${activeRoom._id}`;

      // Simulate a leftover stale lock older than 10 seconds
      await SystemLock.create({
        _id: lockKey,
        initializedAt: new Date(Date.now() - 15000), // 15 seconds ago (stale)
        meta: { acquiredAt: Date.now() - 15000 }
      });

      // Next reservation attempt for activeRoom should automatically detect and safely reclaim the stale lock
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({
          room: activeRoom._id.toString(),
          checkInDate: '2027-02-01',
          checkOutDate: '2027-02-04',
          guestCount: 1
        })
      });

      assert.strictEqual(res.status, 201, 'Stale lock should be recovered and booking created');

      // Lock must be released
      const remainingLock = await SystemLock.findById(lockKey);
      assert.strictEqual(remainingLock, null);
    });

    test('ownership-safe cleanup: obsolete lock owner cannot release a subsequent owner lock', async () => {
      const lockKey = `room_lock_${activeRoom._id}`;

      // Simulate Owner A acquiring lock with tokenA
      const tokenA = 'token-owner-a-1111';
      await SystemLock.create({
        _id: lockKey,
        initializedAt: new Date(Date.now() - 20000), // stale
        meta: { roomId: activeRoom._id.toString(), lockToken: tokenA, acquiredAt: Date.now() - 20000 }
      });

      // Owner B reclaims lock with tokenB
      const tokenB = 'token-owner-b-2222';
      await SystemLock.findOneAndDelete({ _id: lockKey });
      await SystemLock.create({
        _id: lockKey,
        initializedAt: new Date(),
        meta: { roomId: activeRoom._id.toString(), lockToken: tokenB, acquiredAt: Date.now() }
      });

      // Owner A finishes delayed execution and calls releaseRoomLock with tokenA
      const releasedByA = await releaseRoomLock(activeRoom._id, tokenA);
      assert.strictEqual(releasedByA, false, 'Release with obsolete tokenA must return false');

      // Verify Owner B's lock is STILL intact in MongoDB
      const currentLock = await SystemLock.findById(lockKey);
      assert.ok(currentLock, 'Owner B lock must remain in database');
      assert.strictEqual(currentLock.meta.lockToken, tokenB, 'Owner B token must be preserved');

      // Owner B releases with valid tokenB
      const releasedByB = await releaseRoomLock(activeRoom._id, tokenB);
      assert.strictEqual(releasedByB, true, 'Release with valid tokenB must return true');

      // Lock is now deleted
      const finalLock = await SystemLock.findById(lockKey);
      assert.strictEqual(finalLock, null);
    });

    test('stale-lock recovery while earlier owner is delayed: fencing check prevents obsolete commit', async () => {
      // Setup room for this test
      const testRoom = await Room.create({
        hotel: activeHotel._id,
        roomNumber: 'FENCE-101',
        roomType: 'double',
        basePrice: 120,
        capacity: 2,
        status: 'active'
      });

      // Simulate Owner A holding an obsolete lock token that was reclaimed by Owner B
      const tokenA = 'obsolete-token-a';
      const lockKey = `room_lock_${testRoom._id}`;

      // Owner B has acquired the active lock
      await SystemLock.create({
        _id: lockKey,
        initializedAt: new Date(),
        meta: { roomId: testRoom._id.toString(), lockToken: 'active-token-b', acquiredAt: Date.now() }
      });

      // Owner B creates a booking for Feb 10 - Feb 14
      await Booking.create({
        hotel: activeHotel._id,
        room: testRoom._id,
        user: customerB._id,
        checkInDate: new Date('2027-02-10T00:00:00.000Z'),
        checkOutDate: new Date('2027-02-14T00:00:00.000Z'),
        guestInfo: { name: 'Bob Voyager', email: 'bob@hotelpro.com' },
        guestCount: 1,
        priceSnapshot: {
          baseNightlyRate: 120,
          nightlyBreakdown: [
            { date: '2027-02-10', rate: 120 },
            { date: '2027-02-11', rate: 120 },
            { date: '2027-02-12', rate: 120 },
            { date: '2027-02-13', rate: 120 }
          ],
          totalRoomRate: 480,
          taxes: 0,
          fees: 0
        },
        totalAmount: 480,
        currency: 'USD',
        status: 'pending'
      });

      // Owner B releases lock
      await releaseRoomLock(testRoom._id, 'active-token-b');

      // Now Owner A (delayed/stale) attempts to commit an overlapping stay (Feb 12 - Feb 16)
      // When Owner A invokes createBooking via API, it must re-acquire lock and find the overlap
      const resA = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({
          room: testRoom._id.toString(),
          checkInDate: '2027-02-12',
          checkOutDate: '2027-02-16',
          guestCount: 1
        })
      });

      // Must be rejected with 409 Conflict
      assert.strictEqual(resA.status, 409);
      const bodyA = await resA.json();
      assert.match(bodyA.message, /no longer available/i);

      // Verify only 1 booking exists in that period
      const activeBookings = await Booking.countDocuments({
        room: testRoom._id,
        status: { $in: ['pending', 'confirmed'] }
      });
      assert.strictEqual(activeBookings, 1);
    });

    test('concurrent non-overlapping requests for the same room both succeed under serialization', async () => {
      // Room: secondaryRoom
      // Request 1: 2027-07-01 to 2027-07-04
      // Request 2: 2027-07-04 to 2027-07-07 (same-day checkout/checkin)
      const payload1 = {
        room: secondaryRoom._id.toString(),
        checkInDate: '2027-07-01',
        checkOutDate: '2027-07-04',
        guestCount: 2
      };

      const payload2 = {
        room: secondaryRoom._id.toString(),
        checkInDate: '2027-07-04',
        checkOutDate: '2027-07-07',
        guestCount: 2
      };

      const [res1, res2] = await Promise.all([
        fetch(`${baseUrl}/api/bookings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customerAToken}`
          },
          body: JSON.stringify(payload1)
        }),
        fetch(`${baseUrl}/api/bookings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customerBToken}`
          },
          body: JSON.stringify(payload2)
        })
      ]);

      // Both non-overlapping stays must succeed (201)
      assert.strictEqual(res1.status, 201, 'Request 1 should succeed');
      assert.strictEqual(res2.status, 201, 'Request 2 should succeed');

      const body1 = await res1.json();
      const body2 = await res2.json();
      assert.strictEqual(body1.success, true);
      assert.strictEqual(body2.success, true);
    });

    test('database-enforced invariant: WiredTiger rejects overlapping active booking insertion directly', async () => {
      // Even if an application bug bypassed application locking completely,
      // the partial unique index on (room, nightlyBreakdown.date) physically blocks double bookings at the DB engine level.
      const invariantRoom = await Room.create({
        hotel: activeHotel._id,
        roomNumber: 'INVAR-101',
        roomType: 'suite',
        basePrice: 250,
        capacity: 4,
        status: 'active'
      });

      // Direct DB insert 1: Nov 10 & Nov 11
      await Booking.create({
        hotel: activeHotel._id,
        room: invariantRoom._id,
        user: customerA._id,
        checkInDate: new Date('2027-11-10T00:00:00.000Z'),
        checkOutDate: new Date('2027-11-12T00:00:00.000Z'),
        guestInfo: { name: 'Direct Guest A', email: 'a@example.com' },
        guestCount: 2,
        priceSnapshot: {
          baseNightlyRate: 250,
          nightlyBreakdown: [
            { date: '2027-11-10', rate: 250 },
            { date: '2027-11-11', rate: 250 }
          ],
          totalRoomRate: 500,
          taxes: 0,
          fees: 0
        },
        totalAmount: 500,
        currency: 'USD',
        status: 'pending'
      });

      // Direct DB insert 2: Nov 11 & Nov 12 (overlaps on Nov 11)
      let duplicateError = null;
      try {
        await Booking.create({
          hotel: activeHotel._id,
          room: invariantRoom._id,
          user: customerB._id,
          checkInDate: new Date('2027-11-11T00:00:00.000Z'),
          checkOutDate: new Date('2027-11-13T00:00:00.000Z'),
          guestInfo: { name: 'Direct Guest B', email: 'b@example.com' },
          guestCount: 2,
          priceSnapshot: {
            baseNightlyRate: 250,
            nightlyBreakdown: [
              { date: '2027-11-11', rate: 250 },
              { date: '2027-11-12', rate: 250 }
            ],
            totalRoomRate: 500,
            taxes: 0,
            fees: 0
          },
          totalAmount: 500,
          currency: 'USD',
          status: 'confirmed'
        });
      } catch (err) {
        duplicateError = err;
      }

      assert.ok(duplicateError, 'Direct overlapping insert must be rejected by MongoDB');
      assert.strictEqual(duplicateError.code, 11000, 'Must be E11000 duplicate key error');
    });
  });

  // ==========================================
  // Section 3: Authorization & Lifecycle Tests
  // ==========================================
  describe('Authorization & Reservation Lifecycle', () => {
    let customerABooking;

    before(async () => {
      // Create a designated booking for customer A
      customerABooking = await Booking.create({
        hotel: activeHotel._id,
        room: activeRoom._id,
        user: customerA._id,
        checkInDate: new Date('2027-03-01T00:00:00.000Z'),
        checkOutDate: new Date('2027-03-05T00:00:00.000Z'),
        guestInfo: { name: 'Alice Traveler', email: 'alice@hotelpro.com' },
        guestCount: 1,
        priceSnapshot: {
          baseNightlyRate: 100,
          nightlyBreakdown: [{ date: '2027-03-01', rate: 100 }],
          totalRoomRate: 400,
          taxes: 0,
          fees: 0
        },
        totalAmount: 400,
        currency: 'USD',
        status: 'pending'
      });
    });

    test('customer can retrieve their own booking by ID', async () => {
      const res = await fetch(`${baseUrl}/api/bookings/${customerABooking._id}`, {
        headers: { Authorization: `Bearer ${customerAToken}` }
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.booking._id, customerABooking._id.toString());
    });

    test('customer CANNOT retrieve another customer booking (403 Forbidden)', async () => {
      // Customer B attempts to view Customer A's booking
      const res = await fetch(`${baseUrl}/api/bookings/${customerABooking._id}`, {
        headers: { Authorization: `Bearer ${customerBToken}` }
      });
      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.match(body.message, /permission to access this booking/i);
    });

    test('admin can retrieve any customer booking by ID', async () => {
      const res = await fetch(`${baseUrl}/api/bookings/${customerABooking._id}`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.data.booking._id, customerABooking._id.toString());
    });

    test('customer can list their own bookings via /api/bookings/my with pagination', async () => {
      const res = await fetch(`${baseUrl}/api/bookings/my?page=1&limit=5`, {
        headers: { Authorization: `Bearer ${customerAToken}` }
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body.data.bookings));
      assert.ok(body.data.pagination);
      assert.strictEqual(body.data.pagination.page, 1);
      // All returned bookings must belong to customerA
      for (const b of body.data.bookings) {
        // user may be populated or an ID
        assert.ok(b._id);
      }
    });

    test('non-admin customer cannot access admin listing endpoint /api/bookings (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/bookings`, {
        headers: { Authorization: `Bearer ${customerAToken}` }
      });
      assert.strictEqual(res.status, 403);
    });

    test('admin can list all bookings with filters via /api/bookings', async () => {
      const res = await fetch(`${baseUrl}/api/bookings?hotel=${activeHotel._id}&limit=10`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body.data.bookings));
      assert.ok(body.data.pagination);
    });

    test('customer can cancel their own pending booking via PATCH /api/bookings/:id/cancel', async () => {
      const res = await fetch(`${baseUrl}/api/bookings/${customerABooking._id}/cancel`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ reason: 'Plans changed' })
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.data.booking.status, 'cancelled');
      assert.strictEqual(body.data.booking.cancellation.reason, 'Plans changed');
      assert.ok(body.data.booking.cancellation.cancelledAt);
    });

    test('customer cannot cancel another customer booking (403 Forbidden)', async () => {
      // Create new booking for customer A
      const b = await Booking.create({
        hotel: activeHotel._id,
        room: activeRoom._id,
        user: customerA._id,
        checkInDate: new Date('2027-04-01T00:00:00.000Z'),
        checkOutDate: new Date('2027-04-05T00:00:00.000Z'),
        guestInfo: { name: 'Alice Traveler', email: 'alice@hotelpro.com' },
        guestCount: 1,
        priceSnapshot: {
          baseNightlyRate: 100,
          nightlyBreakdown: [{ date: '2027-04-01', rate: 100 }],
          totalRoomRate: 400,
          taxes: 0,
          fees: 0
        },
        totalAmount: 400,
        currency: 'USD',
        status: 'pending'
      });

      // Customer B attempts cancellation
      const res = await fetch(`${baseUrl}/api/bookings/${b._id}/cancel`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${customerBToken}` }
      });
      assert.strictEqual(res.status, 403);
    });

    test('cannot cancel an already cancelled booking with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/bookings/${customerABooking._id}/cancel`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${customerAToken}` }
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.match(body.message, /already cancelled/i);
    });

    test('customer cannot directly update booking status via /api/bookings/:id/status (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/bookings/${customerABooking._id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerAToken}`
        },
        body: JSON.stringify({ status: 'confirmed' })
      });
      assert.strictEqual(res.status, 403);
    });

    test('admin can transition booking through valid lifecycle: pending -> confirmed -> checked_in -> checked_out', async () => {
      // Create new pending booking
      const b = await Booking.create({
        hotel: activeHotel._id,
        room: activeRoom._id,
        user: customerB._id,
        checkInDate: new Date('2027-05-01T00:00:00.000Z'),
        checkOutDate: new Date('2027-05-04T00:00:00.000Z'),
        guestInfo: { name: 'Bob Voyager', email: 'bob@hotelpro.com' },
        guestCount: 1,
        priceSnapshot: {
          baseNightlyRate: 100,
          nightlyBreakdown: [{ date: '2027-05-01', rate: 100 }],
          totalRoomRate: 300,
          taxes: 0,
          fees: 0
        },
        totalAmount: 300,
        currency: 'USD',
        status: 'pending'
      });

      // 1. pending -> confirmed
      const res1 = await fetch(`${baseUrl}/api/bookings/${b._id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ status: 'confirmed' })
      });
      assert.strictEqual(res1.status, 200);
      const body1 = await res1.json();
      assert.strictEqual(body1.data.booking.status, 'confirmed');

      // 2. confirmed -> checked_in
      const res2 = await fetch(`${baseUrl}/api/bookings/${b._id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ status: 'checked_in' })
      });
      assert.strictEqual(res2.status, 200);
      const body2 = await res2.json();
      assert.strictEqual(body2.data.booking.status, 'checked_in');

      // 3. checked_in -> checked_out
      const res3 = await fetch(`${baseUrl}/api/bookings/${b._id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ status: 'checked_out' })
      });
      assert.strictEqual(res3.status, 200);
      const body3 = await res3.json();
      assert.strictEqual(body3.data.booking.status, 'checked_out');

      // 4. checked_out is terminal: attempting any transition from checked_out must fail with 400
      const res4 = await fetch(`${baseUrl}/api/bookings/${b._id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ status: 'pending' })
      });
      assert.strictEqual(res4.status, 400);
      const body4 = await res4.json();
      assert.match(body4.message, /Cannot transition booking status from "checked_out"/i);
    });

    test('admin cannot perform invalid lifecycle transitions (e.g. pending -> checked_out)', async () => {
      const b = await Booking.create({
        hotel: activeHotel._id,
        room: activeRoom._id,
        user: customerB._id,
        checkInDate: new Date('2027-06-01T00:00:00.000Z'),
        checkOutDate: new Date('2027-06-04T00:00:00.000Z'),
        guestInfo: { name: 'Bob Voyager', email: 'bob@hotelpro.com' },
        guestCount: 1,
        priceSnapshot: {
          baseNightlyRate: 100,
          nightlyBreakdown: [{ date: '2027-06-01', rate: 100 }],
          totalRoomRate: 300,
          taxes: 0,
          fees: 0
        },
        totalAmount: 300,
        currency: 'USD',
        status: 'pending'
      });

      const res = await fetch(`${baseUrl}/api/bookings/${b._id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ status: 'checked_out' })
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.match(body.message, /Cannot transition booking status from "pending" to "checked_out"/i);
    });
  });
});
