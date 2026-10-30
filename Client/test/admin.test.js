import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import {
  getAdminRooms,
  createRoom,
  updateRoom,
  updateRoomStatus,
  getHotels
} from '../src/api/roomApi.js';
import { getUsers } from '../src/api/userApi.js';

describe('Admin Dashboard Frontend API Client Tests', () => {
  let mockServer;
  let serverPort;
  let mockBaseUrl;

  before(async () => {
    mockServer = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url, `http://localhost:${serverPort}`);
      const authHeader = req.headers['authorization'];

      // Route: GET /api/rooms/admin
      if (parsedUrl.pathname === '/api/rooms/admin' && req.method === 'GET') {
        if (!authHeader || !authHeader.includes('admin_token')) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Forbidden: Admin access required' }));
          return;
        }

        const statusParam = parsedUrl.searchParams.get('status');
        const allRooms = [
          { _id: 'r1', roomNumber: '101', roomType: 'single', status: 'active', basePrice: 150 },
          { _id: 'r2', roomNumber: '201', roomType: 'double', status: 'maintenance', basePrice: 280 },
          { _id: 'r3', roomNumber: '301', roomType: 'suite', status: 'inactive', basePrice: 500 }
        ];

        const filtered = statusParam ? allRooms.filter((r) => r.status === statusParam) : allRooms;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            data: {
              rooms: filtered,
              pagination: { total: filtered.length, page: 1, limit: 10, totalPages: 1 }
            }
          })
        );
        return;
      }

      // Route: POST /api/rooms
      if (parsedUrl.pathname === '/api/rooms' && req.method === 'POST') {
        if (!authHeader || !authHeader.includes('admin_token')) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Forbidden' }));
          return;
        }

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          const parsed = JSON.parse(body);
          if (!parsed.roomNumber || !parsed.hotel) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Missing required room fields' }));
            return;
          }

          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              message: 'Room created successfully',
              data: {
                room: {
                  _id: 'r_new_123',
                  ...parsed
                }
              }
            })
          );
        });
        return;
      }

      // Route: PATCH /api/rooms/:id
      if (parsedUrl.pathname.startsWith('/api/rooms/') && !parsedUrl.pathname.endsWith('/status') && req.method === 'PATCH') {
        const id = parsedUrl.pathname.split('/')[3];
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          const parsed = JSON.parse(body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              message: 'Room updated successfully',
              data: {
                room: {
                  _id: id,
                  ...parsed
                }
              }
            })
          );
        });
        return;
      }

      // Route: PATCH /api/rooms/:id/status
      if (parsedUrl.pathname.startsWith('/api/rooms/') && parsedUrl.pathname.endsWith('/status') && req.method === 'PATCH') {
        const id = parsedUrl.pathname.split('/')[3];
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          const parsed = JSON.parse(body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              message: `Room status updated to ${parsed.status}`,
              data: {
                room: {
                  _id: id,
                  status: parsed.status
                }
              }
            })
          );
        });
        return;
      }

      // Route: GET /api/hotels
      if (parsedUrl.pathname === '/api/hotels' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            data: {
              hotels: [
                { _id: 'h1', name: 'HotelPro Sanctuary Cupertino', status: 'active' }
              ]
            }
          })
        );
        return;
      }

      // Route: GET /api/users
      if (parsedUrl.pathname === '/api/users' && req.method === 'GET') {
        if (!authHeader || !authHeader.includes('admin_token')) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Forbidden' }));
          return;
        }

        const search = parsedUrl.searchParams.get('search');
        const role = parsedUrl.searchParams.get('role');

        let userList = [
          { _id: 'u1', name: 'Aditya Admin', email: 'aditya@hotelpro.test', role: 'admin', status: 'active' },
          { _id: 'u2', name: 'Charlie Guest', email: 'charlie@hotelpro.test', role: 'customer', status: 'active' }
        ];

        if (search) {
          userList = userList.filter((u) => u.name.includes(search) || u.email.includes(search));
        }

        if (role && role !== 'all') {
          userList = userList.filter((u) => u.role === role);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            data: {
              users: userList,
              pagination: { total: userList.length, page: 1, limit: 10, totalPages: 1 }
            }
          })
        );
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Not Found' }));
    });

    await new Promise((resolve) => {
      mockServer.listen(0, () => {
        serverPort = mockServer.address().port;
        mockBaseUrl = `http://localhost:${serverPort}/api`;
        resolve();
      });
    });
  });

  after(async () => {
    if (mockServer) {
      await new Promise((resolve) => mockServer.close(resolve));
    }
  });

  describe('Feature A: Room API Client (roomApi.js)', () => {
    test('getAdminRooms retrieves rooms across all statuses with admin token', async () => {
      const res = await getAdminRooms({}, {
        baseUrl: mockBaseUrl,
        token: 'admin_token'
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.rooms.length, 3);
      assert.ok(res.data.rooms.some((r) => r.status === 'active'));
      assert.ok(res.data.rooms.some((r) => r.status === 'maintenance'));
      assert.ok(res.data.rooms.some((r) => r.status === 'inactive'));
    });

    test('getAdminRooms filters by status', async () => {
      const res = await getAdminRooms({ status: 'maintenance' }, {
        baseUrl: mockBaseUrl,
        token: 'admin_token'
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.rooms.length, 1);
      assert.strictEqual(res.data.rooms[0].status, 'maintenance');
    });

    test('getAdminRooms throws on non-admin token', async () => {
      await assert.rejects(
        getAdminRooms({}, { baseUrl: mockBaseUrl, token: 'customer_token' }),
        /Forbidden/
      );
    });

    test('createRoom sends room data and returns created room', async () => {
      const payload = {
        hotel: 'h1',
        roomNumber: '401',
        roomType: 'suite',
        capacity: 4,
        basePrice: 450,
        description: 'New luxury suite',
        photos: ['https://example.com/photo.jpg'],
        status: 'active'
      };

      const res = await createRoom(payload, {
        baseUrl: mockBaseUrl,
        token: 'admin_token'
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.room.roomNumber, '401');
      assert.strictEqual(res.data.room._id, 'r_new_123');
    });

    test('updateRoom updates permitted room fields', async () => {
      const res = await updateRoom('r1', { basePrice: 175 }, {
        baseUrl: mockBaseUrl,
        token: 'admin_token'
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.room.basePrice, 175);
    });

    test('updateRoomStatus updates room operational status', async () => {
      const res = await updateRoomStatus('r1', 'maintenance', {
        baseUrl: mockBaseUrl,
        token: 'admin_token'
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.room.status, 'maintenance');
    });

    test('getHotels retrieves active properties', async () => {
      const res = await getHotels({ baseUrl: mockBaseUrl });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.hotels.length, 1);
      assert.strictEqual(res.data.hotels[0].name, 'HotelPro Sanctuary Cupertino');
    });
  });

  describe('Feature B: User API Client (userApi.js)', () => {
    test('getUsers retrieves registered accounts for admin', async () => {
      const res = await getUsers({}, {
        baseUrl: mockBaseUrl,
        token: 'admin_token'
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.users.length, 2);
    });

    test('getUsers searches by user name or email', async () => {
      const res = await getUsers({ search: 'Charlie' }, {
        baseUrl: mockBaseUrl,
        token: 'admin_token'
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.users.length, 1);
      assert.strictEqual(res.data.users[0].name, 'Charlie Guest');
    });

    test('getUsers filters by role', async () => {
      const res = await getUsers({ role: 'admin' }, {
        baseUrl: mockBaseUrl,
        token: 'admin_token'
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.users.length, 1);
      assert.strictEqual(res.data.users[0].role, 'admin');
    });

    test('getUsers rejects non-admin with Forbidden error', async () => {
      await assert.rejects(
        getUsers({}, { baseUrl: mockBaseUrl, token: 'customer_token' }),
        /Forbidden/
      );
    });
  });
});
