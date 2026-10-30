const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'super-secret-jwt-key-for-test-suites-minimum-32-chars-long';
}
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const app = require('../app');
const { Hotel, Room, User } = require('../src/models');
const { signToken } = require('../src/config/jwt');

describe('Admin Dashboard Backend Implementation Tests', () => {
  const ISOLATED_TEST_DB_URI = 'mongodb://127.0.0.1:27017/hotelpro_admin_test_isolation';
  let server;
  let baseUrl;

  let testHotel;
  let adminUser;
  let customerUser;
  let adminToken;
  let customerToken;

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    });

    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close(false);
    }
    await mongoose.connect(ISOLATED_TEST_DB_URI);

    await Hotel.init();
    await Room.init();
    await User.init();

    await Hotel.deleteMany({});
    await Room.deleteMany({});
    await User.deleteMany({});

    testHotel = await Hotel.create({
      name: 'Admin Test Sanctuary',
      address: {
        street: '100 Executive Way',
        city: 'Cupertino',
        state: 'CA',
        country: 'USA',
        postalCode: '95014'
      },
      contact: {
        phone: '+1 (408) 555-0100',
        email: 'concierge@admintest.hotelpro'
      },
      status: 'active'
    });

    adminUser = await User.create({
      name: 'Aditya Administrator',
      email: 'aditya.admin@hotelpro.test',
      passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
      phone: '+1 555-9000',
      role: 'admin',
      status: 'active'
    });

    customerUser = await User.create({
      name: 'Charlie Customer',
      email: 'charlie.customer@hotelpro.test',
      passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
      phone: '+1 555-9001',
      role: 'customer',
      status: 'active'
    });

    adminToken = signToken({
      sub: adminUser._id.toString(),
      email: adminUser.email,
      role: 'admin'
    });

    customerToken = signToken({
      sub: customerUser._id.toString(),
      email: customerUser.email,
      role: 'customer'
    });

    // Create 3 rooms: active, maintenance, inactive
    await Room.create({
      hotel: testHotel._id,
      roomNumber: 'A101',
      roomType: 'single',
      capacity: 1,
      basePrice: 150,
      description: 'Active single room',
      status: 'active'
    });

    await Room.create({
      hotel: testHotel._id,
      roomNumber: 'M201',
      roomType: 'double',
      capacity: 2,
      basePrice: 280,
      description: 'Room undergoing scheduled maintenance',
      status: 'maintenance'
    });

    await Room.create({
      hotel: testHotel._id,
      roomNumber: 'I301',
      roomType: 'suite',
      capacity: 4,
      basePrice: 600,
      description: 'Decommissioned inactive penthouse',
      status: 'inactive'
    });
  });

  after(async () => {
    try {
      if (mongoose.connection.readyState !== 0) {
        await Hotel.deleteMany({});
        await Room.deleteMany({});
        await User.deleteMany({});
        await mongoose.connection.close(false);
      }
    } finally {
      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }
    }
  });

  describe('Feature A: Admin Room Listing (GET /api/rooms/admin)', () => {
    test('rejects unauthenticated request with 401 Unauthorized', async () => {
      const res = await fetch(`${baseUrl}/api/rooms/admin`);
      assert.strictEqual(res.status, 401);
      const json = await res.json();
      assert.strictEqual(json.success, false);
    });

    test('rejects regular customer with 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/rooms/admin`, {
        headers: { Authorization: `Bearer ${customerToken}` }
      });
      assert.strictEqual(res.status, 403);
      const json = await res.json();
      assert.strictEqual(json.success, false);
    });

    test('returns all rooms across active, maintenance, and inactive statuses for admin', async () => {
      const res = await fetch(`${baseUrl}/api/rooms/admin`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.data.rooms.length, 3);

      const statuses = json.data.rooms.map((r) => r.status);
      assert.ok(statuses.includes('active'));
      assert.ok(statuses.includes('maintenance'));
      assert.ok(statuses.includes('inactive'));

      // Check hotel is populated
      assert.ok(json.data.rooms[0].hotel);
      assert.strictEqual(json.data.rooms[0].hotel.name, 'Admin Test Sanctuary');
    });

    test('filters admin rooms by status when requested', async () => {
      const res = await fetch(`${baseUrl}/api/rooms/admin?status=maintenance`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.data.rooms.length, 1);
      assert.strictEqual(json.data.rooms[0].roomNumber, 'M201');
      assert.strictEqual(json.data.rooms[0].status, 'maintenance');
    });

    test('searches admin rooms by room number', async () => {
      const res = await fetch(`${baseUrl}/api/rooms/admin?search=I301`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.data.rooms.length, 1);
      assert.strictEqual(json.data.rooms[0].roomNumber, 'I301');
    });

    test('rejects invalid status filter with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/rooms/admin?status=bogus_status`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(res.status, 400);
      const json = await res.json();
      assert.strictEqual(json.success, false);
    });

    test('public GET /api/rooms continues returning ONLY active rooms', async () => {
      const res = await fetch(`${baseUrl}/api/rooms`);
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.data.rooms.length, 1);
      assert.strictEqual(json.data.rooms[0].status, 'active');
      assert.strictEqual(json.data.rooms[0].roomNumber, 'A101');
    });
  });

  describe('Feature B: Admin User Listing (GET /api/users)', () => {
    test('rejects unauthenticated request with 401 Unauthorized', async () => {
      const res = await fetch(`${baseUrl}/api/users`);
      assert.strictEqual(res.status, 401);
      const json = await res.json();
      assert.strictEqual(json.success, false);
    });

    test('rejects regular customer with 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/users`, {
        headers: { Authorization: `Bearer ${customerToken}` }
      });
      assert.strictEqual(res.status, 403);
      const json = await res.json();
      assert.strictEqual(json.success, false);
    });

    test('admin can retrieve all registered users', async () => {
      const res = await fetch(`${baseUrl}/api/users`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.data.users.length, 2);
      assert.ok(json.data.pagination);
      assert.strictEqual(json.data.pagination.total, 2);
    });

    test('CRITICAL SECURITY: user list excludes passwordHash and sensitive fields', async () => {
      const res = await fetch(`${baseUrl}/api/users`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const json = await res.json();
      for (const u of json.data.users) {
        assert.strictEqual(u.passwordHash, undefined, 'passwordHash must never be returned');
        assert.strictEqual(u.__v, undefined, '__v must not be returned');
        assert.ok(u._id, 'User must have _id');
        assert.ok(u.name, 'User must have name');
        assert.ok(u.email, 'User must have email');
        assert.ok(u.role, 'User must have role');
        assert.ok(u.status, 'User must have status');
        assert.ok(u.createdAt, 'User must have registration date');
      }
    });

    test('supports search by name or email', async () => {
      const res = await fetch(`${baseUrl}/api/users?search=Charlie`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const json = await res.json();
      assert.strictEqual(json.data.users.length, 1);
      assert.strictEqual(json.data.users[0].name, 'Charlie Customer');
    });

    test('supports filtering by role', async () => {
      const res = await fetch(`${baseUrl}/api/users?role=admin`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const json = await res.json();
      assert.strictEqual(json.data.users.length, 1);
      assert.strictEqual(json.data.users[0].email, 'aditya.admin@hotelpro.test');
    });

    test('rejects invalid role filter with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/users?role=superhacker`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(res.status, 400);
      const json = await res.json();
      assert.strictEqual(json.success, false);
    });

    test('rejects excessive search length with 400 Bad Request', async () => {
      const longTerm = 'a'.repeat(101);
      const res = await fetch(`${baseUrl}/api/users?search=${longTerm}`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(res.status, 400);
    });
  });

  describe('Feature C: Hotels Listing Endpoint (GET /api/hotels)', () => {
    test('returns active hotels for selection in Add Room form', async () => {
      const res = await fetch(`${baseUrl}/api/hotels`);
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.ok(Array.isArray(json.data.hotels));
      assert.ok(json.data.hotels.length >= 1);
      assert.strictEqual(json.data.hotels[0].name, 'Admin Test Sanctuary');
    });
  });
});
