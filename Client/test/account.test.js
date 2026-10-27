import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';

import { getProfile, updateProfile } from '../src/api/userApi.js';
import {
  getMyBookings,
  getBookingDetails,
  cancelBooking,
  getAdminBookings,
  updateAdminBookingStatus,
  getAdminReconciliations,
  processRefund
} from '../src/api/bookingApi.js';
import {
  formatBookingReference,
  formatBookingStatus,
  formatPaymentStatus
} from '../src/utils/bookingUtils.js';

describe('Phase 11: Customer Account & Booking Management Frontend Tests', () => {
  let mockServer;
  let serverPort;
  let mockBaseUrl;

  before(async () => {
    mockServer = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url, `http://localhost:${serverPort}`);
      const authHeader = req.headers['authorization'];

      // Route: GET /api/auth/me
      if (parsedUrl.pathname === '/api/auth/me' && req.method === 'GET') {
        if (!authHeader || !authHeader.includes('valid_jwt')) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            data: {
              user: {
                id: 'usr_test_1',
                name: 'Alice Traveler',
                email: 'alice@hotelpro.test',
                phone: '+1 555-0101',
                role: 'customer',
                status: 'active'
              }
            }
          })
        );
        return;
      }

      // Route: PATCH /api/auth/me
      if (parsedUrl.pathname === '/api/auth/me' && req.method === 'PATCH') {
        if (!authHeader || !authHeader.includes('valid_jwt')) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
          return;
        }

        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const parsed = JSON.parse(body);
          if (parsed.role) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Modifying role is strictly forbidden.' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              data: {
                user: {
                  id: 'usr_test_1',
                  name: parsed.name || 'Alice Traveler',
                  email: 'alice@hotelpro.test',
                  phone: parsed.phone || '+1 555-0101',
                  role: 'customer'
                }
              }
            })
          );
        });
        return;
      }

      // Route: GET /api/bookings/my
      if (parsedUrl.pathname === '/api/bookings/my' && req.method === 'GET') {
        if (!authHeader || !authHeader.includes('valid_jwt')) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
          return;
        }
        const timeFilter = parsedUrl.searchParams.get('timeFilter') || 'all';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            data: {
              bookings: [
                {
                  _id: '60c72b2f9b1d8b2bad000001',
                  status: timeFilter === 'cancelled' ? 'cancelled' : 'confirmed',
                  totalAmount: 500,
                  currency: 'USD',
                  checkInDate: '2027-06-01',
                  checkOutDate: '2027-06-03',
                  payment: {
                    status: 'completed',
                    amount: 500
                  }
                }
              ],
              pagination: {
                total: 1,
                page: 1,
                limit: 10,
                totalPages: 1
              }
            }
          })
        );
        return;
      }

      // Route: GET /api/bookings/:id
      if (parsedUrl.pathname.startsWith('/api/bookings/') && req.method === 'GET') {
        const id = parsedUrl.pathname.split('/')[3];
        if (id === 'forbidden_booking') {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Forbidden' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            data: {
              booking: {
                _id: id,
                status: 'confirmed',
                totalAmount: 500,
                currency: 'USD'
              }
            }
          })
        );
        return;
      }

      // Route: PATCH /api/bookings/:id/cancel
      if (parsedUrl.pathname.includes('/cancel') && req.method === 'PATCH') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            message: 'Booking cancelled successfully',
            data: {
              booking: {
                _id: '60c72b2f9b1d8b2bad000001',
                status: 'cancelled',
                cancellation: {
                  reason: 'Customer requested'
                }
              }
            }
          })
        );
        return;
      }

      // Route: GET /api/bookings (Admin)
      if (parsedUrl.pathname === '/api/bookings' && req.method === 'GET') {
        if (!authHeader || !authHeader.includes('admin_jwt')) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Forbidden' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            data: {
              bookings: [
                {
                  _id: '60c72b2f9b1d8b2bad000002',
                  status: 'confirmed',
                  totalAmount: 600
                }
              ],
              pagination: { total: 1, page: 1, limit: 10, totalPages: 1 }
            }
          })
        );
        return;
      }

      // Route: PATCH /api/bookings/:id/status (Admin)
      if (parsedUrl.pathname.includes('/status') && req.method === 'PATCH') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Status updated' }));
        return;
      }

      // Route: GET /api/payments/reconciliation (Admin)
      if (parsedUrl.pathname === '/api/payments/reconciliation' && req.method === 'GET') {
        if (!authHeader || !authHeader.includes('admin_jwt')) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Forbidden' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            data: {
              reconciliations: [
                {
                  id: 'pay_recon_1',
                  amount: 500,
                  status: 'completed',
                  reconciliationReason: 'Cancelled after payment'
                }
              ],
              pagination: { total: 1, page: 1, limit: 10, totalPages: 1 }
            }
          })
        );
        return;
      }

      // Route: POST /api/payments/:id/refund
      if (parsedUrl.pathname.includes('/refund') && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            data: {
              status: 'refunded',
              amount: 500
            }
          })
        );
        return;
      }

      // Default 404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Not found' }));
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

  // =========================================================================
  // Feature A: Profile API Client Tests
  // =========================================================================
  describe('Feature A: User Profile API Client', () => {
    test('getProfile retrieves current user details with valid token', async () => {
      const res = await getProfile({
        baseUrl: mockBaseUrl,
        headers: { Authorization: 'Bearer valid_jwt' }
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.user.email, 'alice@hotelpro.test');
      assert.strictEqual(res.data.user.name, 'Alice Traveler');
    });

    test('getProfile throws error on unauthenticated request', async () => {
      await assert.rejects(
        async () => {
          await getProfile({ baseUrl: mockBaseUrl });
        },
        (err) => {
          assert.strictEqual(err.status, 401);
          return true;
        }
      );
    });

    test('updateProfile sends name and phone and returns updated profile', async () => {
      const res = await updateProfile(
        { name: 'Alice New Name', phone: '+1 555-8888' },
        {
          baseUrl: mockBaseUrl,
          headers: { Authorization: 'Bearer valid_jwt' }
        }
      );
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.user.name, 'Alice New Name');
      assert.strictEqual(res.data.user.phone, '+1 555-8888');
    });

    test('updateProfile throws error if privilege escalation is rejected by server', async () => {
      await assert.rejects(
        async () => {
          await updateProfile(
            { role: 'admin' },
            {
              baseUrl: mockBaseUrl,
              headers: { Authorization: 'Bearer valid_jwt' }
            }
          );
        },
        (err) => {
          assert.strictEqual(err.status, 400);
          assert.match(err.message, /role/i);
          return true;
        }
      );
    });
  });

  // =========================================================================
  // Feature B & C: Booking API Client & Utilities
  // =========================================================================
  describe('Feature B & C: Customer Bookings & Cancellation Client', () => {
    test('getMyBookings retrieves bookings with timeFilter and pagination', async () => {
      const res = await getMyBookings(
        { timeFilter: 'cancelled', page: 1, limit: 10 },
        {
          baseUrl: mockBaseUrl,
          headers: { Authorization: 'Bearer valid_jwt' }
        }
      );
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.bookings.length, 1);
      assert.strictEqual(res.data.bookings[0].status, 'cancelled');
      assert.strictEqual(res.data.bookings[0].payment.status, 'completed');
    });

    test('getBookingDetails retrieves specific booking', async () => {
      const res = await getBookingDetails('60c72b2f9b1d8b2bad000001', {
        baseUrl: mockBaseUrl,
        headers: { Authorization: 'Bearer valid_jwt' }
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.booking._id, '60c72b2f9b1d8b2bad000001');
    });

    test('getBookingDetails throws 403 when attempting to access another customer booking', async () => {
      await assert.rejects(
        async () => {
          await getBookingDetails('forbidden_booking', {
            baseUrl: mockBaseUrl,
            headers: { Authorization: 'Bearer valid_jwt' }
          });
        },
        (err) => {
          assert.strictEqual(err.status, 403);
          return true;
        }
      );
    });

    test('cancelBooking triggers self-service cancellation with reason', async () => {
      const res = await cancelBooking('60c72b2f9b1d8b2bad000001', 'Change of plans', {
        baseUrl: mockBaseUrl,
        headers: { Authorization: 'Bearer valid_jwt' }
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.booking.status, 'cancelled');
    });
  });

  // =========================================================================
  // Feature E: Admin Bookings & Reconciliation Client
  // =========================================================================
  describe('Feature E: Admin Oversight API Client', () => {
    test('getAdminBookings rejects regular customer with 403', async () => {
      await assert.rejects(
        async () => {
          await getAdminBookings(
            { page: 1 },
            {
              baseUrl: mockBaseUrl,
              headers: { Authorization: 'Bearer valid_jwt' } // Customer token
            }
          );
        },
        (err) => {
          assert.strictEqual(err.status, 403);
          return true;
        }
      );
    });

    test('getAdminBookings returns all reservations for admin', async () => {
      const res = await getAdminBookings(
        { page: 1 },
        {
          baseUrl: mockBaseUrl,
          headers: { Authorization: 'Bearer admin_jwt' }
        }
      );
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.bookings.length, 1);
    });

    test('getAdminReconciliations returns queue items for admin', async () => {
      const res = await getAdminReconciliations(
        { page: 1 },
        {
          baseUrl: mockBaseUrl,
          headers: { Authorization: 'Bearer admin_jwt' }
        }
      );
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.reconciliations.length, 1);
      assert.strictEqual(res.data.reconciliations[0].id, 'pay_recon_1');
    });

    test('updateAdminBookingStatus updates reservation status for admin', async () => {
      const res = await updateAdminBookingStatus(
        '60c72b2f9b1d8b2bad000002',
        { status: 'checked_in', reason: 'Guest arrived' },
        {
          baseUrl: mockBaseUrl,
          headers: { Authorization: 'Bearer admin_jwt' }
        }
      );
      assert.strictEqual(res.success, true);
    });

    test('processRefund executes administrative refund', async () => {
      const res = await processRefund(
        'pay_recon_1',
        { amount: 500, reason: 'Approved cancellation refund' },
        {
          baseUrl: mockBaseUrl,
          headers: { Authorization: 'Bearer admin_jwt' }
        }
      );
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.status, 'refunded');
      assert.strictEqual(res.data.amount, 500);
    });
  });

  // =========================================================================
  // Utility and formatting checks
  // =========================================================================
  describe('Utility & Lifecycle Distinction Checks', () => {
    test('formatBookingReference produces clean formatted string', () => {
      const ref = formatBookingReference('60c72b2f9b1d8b2bad000001');
      assert.ok(ref.startsWith('HP-'));
    });

    test('formatBookingStatus formats status badges correctly', () => {
      const confirmed = formatBookingStatus('confirmed');
      assert.strictEqual(confirmed.variant, 'status-success');
      assert.strictEqual(confirmed.label, 'Confirmed');

      const cancelled = formatBookingStatus('cancelled');
      assert.strictEqual(cancelled.variant, 'status-danger');
      assert.strictEqual(cancelled.label, 'Cancelled');
    });

    test('formatPaymentStatus distinguishes between pending, completed, refunded, and failed', () => {
      const completed = formatPaymentStatus('completed');
      assert.strictEqual(completed.label, 'Paid & Completed');

      const refunded = formatPaymentStatus('refunded');
      assert.strictEqual(refunded.label, 'Refunded');

      const failed = formatPaymentStatus('failed');
      assert.strictEqual(failed.label, 'Payment Failed');
    });
  });
});
