require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const app = require('../app');
const { Hotel, Room, Booking, User } = require('../src/models');
const { signToken } = require('../src/config/jwt');
const { calculateStayPrice } = require('../src/services/pricing.service');

describe('Stage 4: Room Management, Public Search, Dynamic Availability & Pricing Tests', () => {
  const ISOLATED_TEST_DB_URI = 'mongodb://127.0.0.1:27017/hotelpro_room_test_isolation';
  let server;
  let baseUrl;

  let testHotel;
  let secondaryHotel;
  let inactiveHotel;

  let adminUser;
  let customerUser;
  let adminToken;
  let customerToken;

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

    // Ensure model indexes
    await Hotel.init();
    await Room.init();
    await Booking.init();
    await User.init();

    // Clean test collections
    await Hotel.deleteMany({});
    await Room.deleteMany({});
    await Booking.deleteMany({});
    await User.deleteMany({});

    // Seed test users
    adminUser = await User.create({
      name: 'Test Administrator',
      email: 'admin.roomtest@hotelpro.com',
      passwordHash: '$2a$12$e8YQzabcdef1234567890',
      role: 'admin',
      status: 'active'
    });
    adminToken = signToken({ sub: adminUser._id.toString(), role: 'admin' });

    customerUser = await User.create({
      name: 'Test Customer',
      email: 'customer.roomtest@hotelpro.com',
      passwordHash: '$2a$12$e8YQzabcdef1234567890',
      role: 'customer',
      status: 'active'
    });
    customerToken = signToken({ sub: customerUser._id.toString(), role: 'customer' });

    // Seed test hotels
    testHotel = await Hotel.create({
      name: 'Grand Horizon Resort',
      address: { street: '100 Ocean Drive', city: 'Miami', country: 'USA' },
      contact: { phone: '+13055551000', email: 'concierge@grandhorizon.com' },
      status: 'active'
    });

    secondaryHotel = await Hotel.create({
      name: 'Alpine Vista Lodge',
      address: { street: '200 Mountain Way', city: 'Aspen', country: 'USA' },
      contact: { phone: '+19705552000', email: 'info@alpinevista.com' },
      status: 'active'
    });

    inactiveHotel = await Hotel.create({
      name: 'Closed Property Inn',
      address: { street: '300 Abandoned Rd', city: 'Ghostown', country: 'USA' },
      contact: { phone: '+19995553000', email: 'closed@property.com' },
      status: 'inactive',
      isActive: false
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

  describe('Room Administration Endpoints', () => {
    let createdRoomId;

    test('admin can create a valid room associated with an active hotel', async () => {
      const res = await fetch(`${baseUrl}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          hotel: testHotel._id.toString(),
          roomNumber: '101',
          roomType: 'double',
          description: 'Ocean view deluxe room',
          basePrice: 150,
          capacity: 2,
          pricingRules: [
            {
              ruleName: 'Summer Surge',
              startDate: '2027-06-01',
              endDate: '2027-08-31',
              price: 190
            }
          ]
        })
      });

      const body = await res.json();

      assert.strictEqual(res.status, 201);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.room.roomNumber, '101');
      assert.strictEqual(body.data.room.roomType, 'double');
      assert.strictEqual(body.data.room.basePrice, 150);
      assert.strictEqual(body.data.room.capacity, 2);
      assert.strictEqual(body.data.room.status, 'active');

      createdRoomId = body.data.room._id;
    });

    test('customer cannot create rooms (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken}`
        },
        body: JSON.stringify({
          hotel: testHotel._id.toString(),
          roomNumber: '102',
          roomType: 'single',
          basePrice: 100,
          capacity: 1
        })
      });

      assert.strictEqual(res.status, 403);
    });

    test('unauthenticated request cannot create rooms (401 Unauthorized)', async () => {
      const res = await fetch(`${baseUrl}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hotel: testHotel._id.toString(),
          roomNumber: '102',
          roomType: 'single',
          basePrice: 100,
          capacity: 1
        })
      });

      assert.strictEqual(res.status, 401);
    });

    test('rejects rooms associated with nonexistent or inactive hotels', async () => {
      const fakeHotelId = new mongoose.Types.ObjectId().toString();

      // Nonexistent hotel
      const resNonexistent = await fetch(`${baseUrl}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          hotel: fakeHotelId,
          roomNumber: '999',
          roomType: 'single',
          basePrice: 100,
          capacity: 1
        })
      });

      assert.strictEqual(resNonexistent.status, 404);

      // Inactive hotel
      const resInactive = await fetch(`${baseUrl}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          hotel: inactiveHotel._id.toString(),
          roomNumber: '999',
          roomType: 'single',
          basePrice: 100,
          capacity: 1
        })
      });

      assert.strictEqual(resInactive.status, 400);
      const bodyInactive = await resInactive.json();
      assert.match(bodyInactive.message, /inactive hotel/i);
    });

    test('rejects duplicate room numbers within the same hotel (409 Conflict)', async () => {
      const res = await fetch(`${baseUrl}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          hotel: testHotel._id.toString(),
          roomNumber: '101', // Already exists in testHotel
          roomType: 'suite',
          basePrice: 250,
          capacity: 4
        })
      });

      assert.strictEqual(res.status, 409);
      const body = await res.json();
      assert.match(body.message, /already exists in this hotel/i);
    });

    test('allows the same room number in a different hotel', async () => {
      const res = await fetch(`${baseUrl}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          hotel: secondaryHotel._id.toString(), // Different hotel
          roomNumber: '101', // Same number allowed across hotels
          roomType: 'suite',
          basePrice: 300,
          capacity: 4
        })
      });

      assert.strictEqual(res.status, 201);
      const body = await res.json();
      assert.strictEqual(body.data.room.roomNumber, '101');
    });

    test('rejects invalid room fields (type, price, capacity)', async () => {
      // Invalid roomType
      const resType = await fetch(`${baseUrl}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          hotel: testHotel._id.toString(),
          roomNumber: '103',
          roomType: 'penthouse', // Not single, double, or suite
          basePrice: 200,
          capacity: 2
        })
      });
      assert.strictEqual(resType.status, 400);

      // Negative basePrice
      const resPrice = await fetch(`${baseUrl}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          hotel: testHotel._id.toString(),
          roomNumber: '104',
          roomType: 'single',
          basePrice: -50,
          capacity: 1
        })
      });
      assert.strictEqual(resPrice.status, 400);

      // Non-positive capacity
      const resCap = await fetch(`${baseUrl}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          hotel: testHotel._id.toString(),
          roomNumber: '105',
          roomType: 'single',
          basePrice: 100,
          capacity: 0
        })
      });
      assert.strictEqual(resCap.status, 400);
    });

    test('admin can update permitted room fields and change operational status', async () => {
      // Update fields
      const resUpdate = await fetch(`${baseUrl}/api/rooms/${createdRoomId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          basePrice: 165,
          description: 'Updated luxury description'
        })
      });

      assert.strictEqual(resUpdate.status, 200);
      const bodyUpdate = await resUpdate.json();
      assert.strictEqual(bodyUpdate.data.room.basePrice, 165);
      assert.strictEqual(bodyUpdate.data.room.description, 'Updated luxury description');

      // Update operational status
      const resStatus = await fetch(`${baseUrl}/api/rooms/${createdRoomId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          status: 'maintenance'
        })
      });

      assert.strictEqual(resStatus.status, 200);
      const bodyStatus = await resStatus.json();
      assert.strictEqual(bodyStatus.data.room.status, 'maintenance');

      // Restore status to active for subsequent tests
      await fetch(`${baseUrl}/api/rooms/${createdRoomId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ status: 'active' })
      });
    });

    test('customer cannot update room fields or status (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/rooms/${createdRoomId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken}`
        },
        body: JSON.stringify({ basePrice: 50 })
      });

      assert.strictEqual(res.status, 403);
    });
  });

  describe('Public Room Retrieval & Listings', () => {
    test('public listing returns active rooms without authentication', async () => {
      const res = await fetch(`${baseUrl}/api/rooms`);
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.ok(Array.isArray(body.data.rooms));
      assert.ok(body.data.pagination);
      assert.strictEqual(body.data.pagination.page, 1);
    });

    test('public retrieval returns room details by valid ID', async () => {
      const room = await Room.findOne({ roomNumber: '101', hotel: testHotel._id });
      const res = await fetch(`${baseUrl}/api/rooms/${room._id}`);
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.data.room.roomNumber, '101');
      assert.strictEqual(body.data.room.__v, undefined);
    });

    test('retrieval returns 400 for malformed ID and 404 for nonexistent ID', async () => {
      const resBad = await fetch(`${baseUrl}/api/rooms/not-a-valid-object-id`);
      assert.strictEqual(resBad.status, 400);

      const resNotFound = await fetch(`${baseUrl}/api/rooms/${new mongoose.Types.ObjectId()}`);
      assert.strictEqual(resNotFound.status, 404);
    });

    test('pagination and filters (roomType, capacity, minPrice, maxPrice) work correctly', async () => {
      const resFiltered = await fetch(
        `${baseUrl}/api/rooms?roomType=double&capacity=2&minPrice=100&maxPrice=300&page=1&limit=5`
      );
      const body = await resFiltered.json();

      assert.strictEqual(resFiltered.status, 200);
      assert.ok(body.data.rooms.length >= 1);
      for (const r of body.data.rooms) {
        assert.strictEqual(r.roomType, 'double');
        assert.ok(r.capacity >= 2);
        assert.ok(r.basePrice >= 100 && r.basePrice <= 300);
      }
    });

    test('maintenance and inactive rooms are excluded from public listings', async () => {
      // Seed a maintenance room and an inactive room
      await Room.create({
        hotel: testHotel._id,
        roomNumber: 'M99',
        roomType: 'single',
        basePrice: 80,
        capacity: 1,
        status: 'maintenance'
      });

      await Room.create({
        hotel: testHotel._id,
        roomNumber: 'I99',
        roomType: 'single',
        basePrice: 80,
        capacity: 1,
        status: 'inactive'
      });

      const res = await fetch(`${baseUrl}/api/rooms`);
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      for (const room of body.data.rooms) {
        assert.strictEqual(room.status, 'active', 'Public listings must contain only active rooms');
        assert.notStrictEqual(room.roomNumber, 'M99');
        assert.notStrictEqual(room.roomNumber, 'I99');
      }
    });
  });

  describe('Dynamic Availability Search', () => {
    let availableRoom;
    let bookedRoom;

    before(async () => {
      // Seed two rooms for availability tests
      availableRoom = await Room.create({
        hotel: testHotel._id,
        roomNumber: '201',
        roomType: 'suite',
        basePrice: 200,
        capacity: 3,
        status: 'active'
      });

      bookedRoom = await Room.create({
        hotel: testHotel._id,
        roomNumber: '202',
        roomType: 'suite',
        basePrice: 200,
        capacity: 3,
        status: 'active'
      });

      // Existing booking for bookedRoom: 2027-07-10 to 2027-07-15 (confirmed)
      await Booking.create({
        hotel: testHotel._id,
        room: bookedRoom._id,
        user: customerUser._id,
        checkInDate: new Date('2027-07-10T00:00:00Z'),
        checkOutDate: new Date('2027-07-15T00:00:00Z'),
        guestInfo: { name: 'Booked Guest', email: 'booked@example.com' },
        guestCount: 2,
        priceSnapshot: { baseNightlyRate: 200, totalRoomRate: 1000 },
        totalAmount: 1000,
        status: 'confirmed'
      });
    });

    test('overlapping stay search correctly excludes booked room and includes available room', async () => {
      // Search for stay: 2027-07-12 to 2027-07-14 (overlaps with 2027-07-10 to 2027-07-15)
      const res = await fetch(
        `${baseUrl}/api/rooms/search?checkInDate=2027-07-12&checkOutDate=2027-07-14`
      );
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);

      const returnedRoomNumbers = body.data.rooms.map((r) => r.roomNumber);
      assert.ok(returnedRoomNumbers.includes('201'), 'Room 201 must be available');
      assert.strictEqual(returnedRoomNumbers.includes('202'), false, 'Room 202 must be excluded due to overlap');
    });

    test('non-overlapping stay search allows both rooms to be available', async () => {
      // Search for stay outside booked range: 2027-07-20 to 2027-07-25
      const res = await fetch(
        `${baseUrl}/api/rooms/search?checkInDate=2027-07-20&checkOutDate=2027-07-25`
      );
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      const returnedRoomNumbers = body.data.rooms.map((r) => r.roomNumber);
      assert.ok(returnedRoomNumbers.includes('201'));
      assert.ok(returnedRoomNumbers.includes('202'), 'Room 202 is available for non-overlapping dates');
    });

    test('checkout/checkin boundary behavior: stay ending on checkin day or starting on checkout day does not overlap', async () => {
      // Stay ending exactly when existing booking begins (checkout 2027-07-10)
      const resBefore = await fetch(
        `${baseUrl}/api/rooms/search?checkInDate=2027-07-05&checkOutDate=2027-07-10`
      );
      const bodyBefore = await resBefore.json();
      assert.ok(bodyBefore.data.rooms.map((r) => r.roomNumber).includes('202'));

      // Stay starting exactly when existing booking checks out (checkin 2027-07-15)
      const resAfter = await fetch(
        `${baseUrl}/api/rooms/search?checkInDate=2027-07-15&checkOutDate=2027-07-20`
      );
      const bodyAfter = await resAfter.json();
      assert.ok(bodyAfter.data.rooms.map((r) => r.roomNumber).includes('202'));
    });

    test('cancelled bookings do not block room availability', async () => {
      const cancelledRoom = await Room.create({
        hotel: testHotel._id,
        roomNumber: '203',
        roomType: 'single',
        basePrice: 90,
        capacity: 1,
        status: 'active'
      });

      await Booking.create({
        hotel: testHotel._id,
        room: cancelledRoom._id,
        user: customerUser._id,
        checkInDate: new Date('2027-08-01T00:00:00Z'),
        checkOutDate: new Date('2027-08-05T00:00:00Z'),
        guestInfo: { name: 'Cancelled Guest', email: 'cancelled@example.com' },
        guestCount: 1,
        priceSnapshot: { baseNightlyRate: 90, totalRoomRate: 360 },
        totalAmount: 360,
        status: 'cancelled'
      });

      const res = await fetch(
        `${baseUrl}/api/rooms/search?checkInDate=2027-08-02&checkOutDate=2027-08-04`
      );
      const body = await res.json();
      const roomNumbers = body.data.rooms.map((r) => r.roomNumber);
      assert.ok(roomNumbers.includes('203'), 'Cancelled booking must not block room availability');
    });

    test('checked_in and pending bookings block overlapping availability', async () => {
      const roomCheckedIn = await Room.create({
        hotel: testHotel._id,
        roomNumber: '204',
        roomType: 'double',
        basePrice: 120,
        capacity: 2,
        status: 'active'
      });

      await Booking.create({
        hotel: testHotel._id,
        room: roomCheckedIn._id,
        user: customerUser._id,
        checkInDate: new Date('2027-09-01T00:00:00Z'),
        checkOutDate: new Date('2027-09-05T00:00:00Z'),
        guestInfo: { name: 'Current Guest', email: 'current@example.com' },
        guestCount: 2,
        priceSnapshot: { baseNightlyRate: 120, totalRoomRate: 480 },
        totalAmount: 480,
        status: 'checked_in'
      });

      const roomPending = await Room.create({
        hotel: testHotel._id,
        roomNumber: '205',
        roomType: 'double',
        basePrice: 120,
        capacity: 2,
        status: 'active'
      });

      await Booking.create({
        hotel: testHotel._id,
        room: roomPending._id,
        user: customerUser._id,
        checkInDate: new Date('2027-09-01T00:00:00Z'),
        checkOutDate: new Date('2027-09-05T00:00:00Z'),
        guestInfo: { name: 'Pending Guest', email: 'pending@example.com' },
        guestCount: 2,
        priceSnapshot: { baseNightlyRate: 120, totalRoomRate: 480 },
        totalAmount: 480,
        status: 'pending'
      });

      const res = await fetch(
        `${baseUrl}/api/rooms/search?checkInDate=2027-09-02&checkOutDate=2027-09-04`
      );
      const body = await res.json();
      const roomNumbers = body.data.rooms.map((r) => r.roomNumber);

      assert.strictEqual(roomNumbers.includes('204'), false, 'checked_in booking must block availability');
      assert.strictEqual(roomNumbers.includes('205'), false, 'pending booking must block availability');
    });

    test('rejects invalid or missing search date parameters with 400 Bad Request', async () => {
      // Missing dates
      const resMissing = await fetch(`${baseUrl}/api/rooms/search`);
      assert.strictEqual(resMissing.status, 400);

      // CheckOut before CheckIn
      const resInverted = await fetch(
        `${baseUrl}/api/rooms/search?checkInDate=2027-10-10&checkOutDate=2027-10-05`
      );
      assert.strictEqual(resInverted.status, 400);

      // Same day CheckIn and CheckOut
      const resSameDay = await fetch(
        `${baseUrl}/api/rooms/search?checkInDate=2027-10-10&checkOutDate=2027-10-10`
      );
      assert.strictEqual(resSameDay.status, 400);

      // Malformed date
      const resBadFormat = await fetch(
        `${baseUrl}/api/rooms/search?checkInDate=10-10-2027&checkOutDate=2027-10-15`
      );
      assert.strictEqual(resBadFormat.status, 400);
    });
  });

  describe('Date-Specific Pricing Calculation', () => {
    test('calculates base nightly price correctly when no pricing rules exist', () => {
      const room = {
        basePrice: 100,
        pricingRules: []
      };

      const pricing = calculateStayPrice(room, '2027-11-01', '2027-11-04');

      assert.strictEqual(pricing.nights, 3);
      assert.strictEqual(pricing.totalRoomPrice, 300);
      assert.strictEqual(pricing.nightlyBreakdown.length, 3);
      assert.strictEqual(pricing.nightlyBreakdown[0].date, '2027-11-01');
      assert.strictEqual(pricing.nightlyBreakdown[0].rate, 100);
      assert.strictEqual(pricing.nightlyBreakdown[2].date, '2027-11-03');
      assert.strictEqual(pricing.nightlyBreakdown[2].rate, 100);
      // Checkout date 2027-11-04 is excluded
      assert.strictEqual(pricing.nightlyBreakdown.some((n) => n.date === '2027-11-04'), false);
    });

    test('applies date-specific pricing rule on matching nights only', () => {
      const room = {
        basePrice: 100,
        pricingRules: [
          {
            ruleName: 'Weekend Surge',
            startDate: '2027-11-05', // Friday
            endDate: '2027-11-07',   // Sunday morning (rules cover Fri & Sat nights)
            price: 150
          }
        ]
      };

      // Stay from Thursday 2027-11-04 to Monday 2027-11-08 (4 nights)
      // Thu Nov 04: basePrice (100)
      // Fri Nov 05: rule (150)
      // Sat Nov 06: rule (150)
      // Sun Nov 07: basePrice (100) [Since endDate 2027-11-07 is exclusive]
      const pricing = calculateStayPrice(room, '2027-11-04', '2027-11-08');

      assert.strictEqual(pricing.nights, 4);
      assert.strictEqual(pricing.totalRoomPrice, 500); // 100 + 150 + 150 + 100 = 500

      assert.strictEqual(pricing.nightlyBreakdown[0].date, '2027-11-04');
      assert.strictEqual(pricing.nightlyBreakdown[0].rate, 100);
      assert.strictEqual(pricing.nightlyBreakdown[0].ruleApplied, null);

      assert.strictEqual(pricing.nightlyBreakdown[1].date, '2027-11-05');
      assert.strictEqual(pricing.nightlyBreakdown[1].rate, 150);
      assert.strictEqual(pricing.nightlyBreakdown[1].ruleApplied, 'Weekend Surge');

      assert.strictEqual(pricing.nightlyBreakdown[2].date, '2027-11-06');
      assert.strictEqual(pricing.nightlyBreakdown[2].rate, 150);
      assert.strictEqual(pricing.nightlyBreakdown[2].ruleApplied, 'Weekend Surge');

      assert.strictEqual(pricing.nightlyBreakdown[3].date, '2027-11-07');
      assert.strictEqual(pricing.nightlyBreakdown[3].rate, 100);
      assert.strictEqual(pricing.nightlyBreakdown[3].ruleApplied, null);
    });

    test('deterministic rule precedence applies first matching rule without unpredictable results', () => {
      const room = {
        basePrice: 100,
        pricingRules: [
          {
            ruleName: 'First Rule',
            startDate: '2027-12-01',
            endDate: '2027-12-10',
            price: 130
          },
          {
            ruleName: 'Overlapping Second Rule',
            startDate: '2027-12-01',
            endDate: '2027-12-05',
            price: 170
          }
        ]
      };

      const pricing = calculateStayPrice(room, '2027-12-01', '2027-12-03');

      // Evaluates deterministically using the first covering rule
      assert.strictEqual(pricing.nights, 2);
      assert.strictEqual(pricing.nightlyBreakdown[0].rate, 130);
      assert.strictEqual(pricing.nightlyBreakdown[0].ruleApplied, 'First Rule');
    });

    test('searchAvailableRooms returns transparent pricing breakdown for each room without inventing taxes or fees', async () => {
      const res = await fetch(
        `${baseUrl}/api/rooms/search?checkInDate=2027-11-05&checkOutDate=2027-11-07`
      );
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.ok(body.data.rooms.length > 0);

      for (const room of body.data.rooms) {
        assert.ok(room.pricing);
        assert.strictEqual(room.pricing.nights, 2);
        assert.ok(Number.isFinite(room.pricing.totalRoomPrice));
        assert.strictEqual(room.pricing.currency, 'USD');
        assert.strictEqual(room.pricing.taxes, undefined, 'Must not invent taxes');
        assert.strictEqual(room.pricing.fees, undefined, 'Must not invent fees');
      }
    });

    test('price filters (minPrice / maxPrice) apply to total calculated stay price during search', async () => {
      // Search for stay with minPrice = 350 and maxPrice = 600
      const res = await fetch(
        `${baseUrl}/api/rooms/search?checkInDate=2027-11-05&checkOutDate=2027-11-07&minPrice=350&maxPrice=600`
      );
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      for (const room of body.data.rooms) {
        assert.ok(
          room.pricing.totalRoomPrice >= 350 && room.pricing.totalRoomPrice <= 600,
          `Room price ${room.pricing.totalRoomPrice} must be within [350, 600]`
        );
      }
    });
  });
});
