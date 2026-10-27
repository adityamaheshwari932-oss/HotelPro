import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';

import {
  calculateRemainingHoldTime,
  validateBookingForm,
  formatBookingStatus,
  formatDateDisplay
} from '../src/utils/bookingUtils.js';
import { apiClient, ApiError } from '../src/api/client.js';

describe('Stage 9: Customer Booking Creation & Reservation Hold Tests', () => {
  let mockServer;
  let serverPort;
  let mockBaseUrl;

  before(async () => {
    mockServer = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url, `http://localhost:${serverPort}`);
      const authHeader = req.headers['authorization'];

      // POST /api/bookings
      if (parsedUrl.pathname === '/api/bookings' && req.method === 'POST') {
        if (!authHeader || !authHeader.startsWith('Bearer valid_customer_jwt')) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Authentication required to create a booking' }));
          return;
        }

        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(body);
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Invalid JSON payload' }));
            return;
          }

          // Validation simulations
          if (!parsed.room || !parsed.checkInDate || !parsed.checkOutDate) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Room, checkInDate, and checkOutDate are required.' }));
            return;
          }

          if (parsed.checkOutDate <= parsed.checkInDate) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Check-out date must be strictly after check-in date.' }));
            return;
          }

          if (!parsed.guestCount || parsed.guestCount < 1) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Guest count must be an integer of at least 1 guest' }));
            return;
          }

          // Conflict simulation (Room 66a1b2c3d4e5f67890123499 is already booked for these dates)
          if (parsed.room === '66a1b2c3d4e5f67890123499') {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                success: false,
                message: 'The requested room is no longer available for the selected dates.'
              })
            );
            return;
          }

          // Capacity check simulation (Room capacity = 2, requested 4)
          if (parsed.guestCount > 2 && parsed.room === '66a1b2c3d4e5f67890123402') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                success: false,
                message: 'Guest count (4) exceeds maximum room capacity (2)'
              })
            );
            return;
          }

          // Successful booking reservation creation with 15-minute hold
          const nowMs = Date.now();
          const holdExpiresAt = new Date(nowMs + 15 * 60 * 1000).toISOString();

          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              message: 'Booking reservation created successfully',
              data: {
                booking: {
                  _id: '66a1b2c3d4e5f678901234aa',
                  room: {
                    _id: parsed.room,
                    roomNumber: '101',
                    roomType: 'double',
                    basePrice: 120,
                    capacity: 2
                  },
                  hotel: {
                    _id: 'hotel_1',
                    name: 'HotelPro Central',
                    address: '100 Main Street'
                  },
                  user: {
                    _id: 'user_cust_1',
                    name: parsed.guestInfo?.name || 'Alice Traveler',
                    email: parsed.guestInfo?.email || 'alice@example.com',
                    role: 'customer'
                  },
                  checkInDate: `${parsed.checkInDate}T00:00:00.000Z`,
                  checkOutDate: `${parsed.checkOutDate}T00:00:00.000Z`,
                  guestCount: parsed.guestCount,
                  guestInfo: {
                    name: parsed.guestInfo?.name || 'Alice Traveler',
                    email: parsed.guestInfo?.email || 'alice@example.com',
                    phone: parsed.guestInfo?.phone || ''
                  },
                  priceSnapshot: {
                    baseNightlyRate: 120,
                    nightlyBreakdown: [
                      { date: parsed.checkInDate, rate: 120 }
                    ],
                    totalRoomRate: 120,
                    taxes: 0,
                    fees: 0
                  },
                  totalAmount: 120,
                  currency: 'USD',
                  status: 'pending',
                  holdExpiresAt,
                  createdAt: new Date(nowMs).toISOString(),
                  updatedAt: new Date(nowMs).toISOString()
                }
              }
            })
          );
        });
        return;
      }

      // GET /api/bookings/:id
      const bookingDetailMatch = parsedUrl.pathname.match(/^\/api\/bookings\/([^/]+)$/);
      if (bookingDetailMatch && req.method === 'GET') {
        if (!authHeader || !authHeader.startsWith('Bearer valid_customer_jwt')) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Authentication required' }));
          return;
        }

        const bookingId = bookingDetailMatch[1];

        if (bookingId === 'invalid-booking-id') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Invalid booking ID format.' }));
          return;
        }

        if (bookingId === '66a1b2c3d4e5f67890123404') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Booking not found' }));
          return;
        }

        // Return expired booking simulation
        if (bookingId === '66a1b2c3d4e5f678901234ee') {
          const pastHold = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // Expired 5 mins ago
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              data: {
                booking: {
                  _id: bookingId,
                  room: { _id: 'room_1', roomNumber: '202', roomType: 'suite', capacity: 4, basePrice: 200 },
                  hotel: { name: 'HotelPro Central', address: '100 Main Street' },
                  user: { name: 'Alice Traveler', email: 'alice@example.com' },
                  checkInDate: '2026-11-01T00:00:00.000Z',
                  checkOutDate: '2026-11-04T00:00:00.000Z',
                  guestCount: 2,
                  guestInfo: { name: 'Alice Traveler', email: 'alice@example.com', phone: '' },
                  priceSnapshot: { totalRoomRate: 600, nightlyBreakdown: [{ date: '2026-11-01', rate: 200 }] },
                  totalAmount: 600,
                  currency: 'USD',
                  status: 'pending',
                  holdExpiresAt: pastHold
                }
              }
            })
          );
          return;
        }

        // Active booking simulation
        const futureHold = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes remaining
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            data: {
              booking: {
                _id: bookingId,
                room: { _id: 'room_1', roomNumber: '101', roomType: 'double', capacity: 2, basePrice: 120 },
                hotel: { name: 'HotelPro Central', address: '100 Main Street' },
                user: { name: 'Alice Traveler', email: 'alice@example.com' },
                checkInDate: '2026-11-01T00:00:00.000Z',
                checkOutDate: '2026-11-03T00:00:00.000Z',
                guestCount: 2,
                guestInfo: { name: 'Alice Traveler', email: 'alice@example.com', phone: '+15550199' },
                priceSnapshot: { totalRoomRate: 240, nightlyBreakdown: [{ date: '2026-11-01', rate: 120 }] },
                totalAmount: 240,
                currency: 'USD',
                status: 'pending',
                holdExpiresAt: futureHold
              }
            }
          })
        );
        return;
      }

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

  // --- 1. FORM & DATE VALIDATION TESTS ---
  describe('1. Booking Form Field & Date Validation (validateBookingForm)', () => {
    test('requires checkInDate and checkOutDate', () => {
      const res = validateBookingForm({
        checkInDate: '',
        checkOutDate: '',
        guestCount: '2',
        name: 'Alice Traveler',
        email: 'alice@example.com'
      });
      assert.strictEqual(res.isValid, false);
      assert.strictEqual(res.errors.checkInDate, 'Check-in date is required.');
      assert.strictEqual(res.errors.checkOutDate, 'Check-out date is required.');
    });

    test('rejects checkOutDate equal to or earlier than checkInDate', () => {
      const sameDate = validateBookingForm({
        checkInDate: '2026-11-05',
        checkOutDate: '2026-11-05',
        guestCount: '1',
        name: 'Alice Traveler',
        email: 'alice@example.com'
      });
      assert.strictEqual(sameDate.isValid, false);
      assert.strictEqual(sameDate.errors.checkOutDate, 'Check-out date must be strictly after check-in date.');

      const pastDate = validateBookingForm({
        checkInDate: '2026-11-05',
        checkOutDate: '2026-11-02',
        guestCount: '1',
        name: 'Alice Traveler',
        email: 'alice@example.com'
      });
      assert.strictEqual(pastDate.isValid, false);
      assert.strictEqual(pastDate.errors.checkOutDate, 'Check-out date must be strictly after check-in date.');
    });

    test('validates guest count (must be positive integer)', () => {
      const zeroGuests = validateBookingForm({
        checkInDate: '2026-11-01',
        checkOutDate: '2026-11-03',
        guestCount: '0',
        name: 'Alice',
        email: 'alice@example.com'
      });
      assert.strictEqual(zeroGuests.isValid, false);
      assert.strictEqual(zeroGuests.errors.guestCount, 'Guest count must be at least 1 guest.');

      const missingGuests = validateBookingForm({
        checkInDate: '2026-11-01',
        checkOutDate: '2026-11-03',
        guestCount: '',
        name: 'Alice',
        email: 'alice@example.com'
      });
      assert.strictEqual(missingGuests.isValid, false);
      assert.strictEqual(missingGuests.errors.guestCount, 'Guest count is required.');
    });

    test('enforces room capacity limit when capacity is known', () => {
      const overCapacity = validateBookingForm(
        {
          checkInDate: '2026-11-01',
          checkOutDate: '2026-11-03',
          guestCount: '5',
          name: 'Alice Traveler',
          email: 'alice@example.com'
        },
        2 // Room capacity = 2
      );
      assert.strictEqual(overCapacity.isValid, false);
      assert.strictEqual(overCapacity.errors.guestCount, 'Guest count (5) exceeds room capacity (2).');

      const withinCapacity = validateBookingForm(
        {
          checkInDate: '2026-11-01',
          checkOutDate: '2026-11-03',
          guestCount: '2',
          name: 'Alice Traveler',
          email: 'alice@example.com'
        },
        2
      );
      assert.strictEqual(withinCapacity.isValid, true);
    });

    test('validates primary guest name and email', () => {
      const missingName = validateBookingForm({
        checkInDate: '2026-11-01',
        checkOutDate: '2026-11-03',
        guestCount: '1',
        name: ' ',
        email: 'alice@example.com'
      });
      assert.strictEqual(missingName.isValid, false);
      assert.strictEqual(missingName.errors.name, 'Guest full name is required.');

      const invalidEmail = validateBookingForm({
        checkInDate: '2026-11-01',
        checkOutDate: '2026-11-03',
        guestCount: '1',
        name: 'Alice Traveler',
        email: 'invalid-email-address'
      });
      assert.strictEqual(invalidEmail.isValid, false);
      assert.strictEqual(invalidEmail.errors.email, 'Please provide a valid email address.');
    });

    test('accepts completely valid form values', () => {
      const valid = validateBookingForm(
        {
          checkInDate: '2026-11-01',
          checkOutDate: '2026-11-04',
          guestCount: '2',
          name: 'Alice Traveler',
          email: 'alice@example.com',
          phone: '+1 555-0199'
        },
        4
      );
      assert.strictEqual(valid.isValid, true);
      assert.deepStrictEqual(valid.errors, {});
    });
  });

  // --- 2. HOLD COUNTDOWN CALCULATION TESTS ---
  describe('2. Reservation Hold Countdown Calculation (calculateRemainingHoldTime)', () => {
    test('calculates remaining minutes and seconds from authoritative server timestamp', () => {
      const now = new Date('2026-10-27T12:00:00.000Z');
      // Hold deadline 12 minutes and 34 seconds in future
      const holdExpiresAt = new Date('2026-10-27T12:12:34.000Z');

      const res = calculateRemainingHoldTime(holdExpiresAt, now);
      assert.strictEqual(res.hasHold, true);
      assert.strictEqual(res.expired, false);
      assert.strictEqual(res.minutes, 12);
      assert.strictEqual(res.seconds, 34);
      assert.strictEqual(res.totalSeconds, 754);
      assert.strictEqual(res.formatted, '12:34');
    });

    test('handles single-digit minutes and seconds with leading zero padding', () => {
      const now = new Date('2026-10-27T12:00:00.000Z');
      const holdExpiresAt = new Date('2026-10-27T12:03:05.000Z'); // 3m 5s

      const res = calculateRemainingHoldTime(holdExpiresAt, now);
      assert.strictEqual(res.hasHold, true);
      assert.strictEqual(res.expired, false);
      assert.strictEqual(res.minutes, 3);
      assert.strictEqual(res.seconds, 5);
      assert.strictEqual(res.formatted, '03:05');
    });

    test('marks hold as expired when deadline is in the past', () => {
      const now = new Date('2026-10-27T12:15:01.000Z');
      const holdExpiresAt = new Date('2026-10-27T12:15:00.000Z'); // 1 second ago

      const res = calculateRemainingHoldTime(holdExpiresAt, now);
      assert.strictEqual(res.hasHold, true);
      assert.strictEqual(res.expired, true);
      assert.strictEqual(res.totalSeconds, 0);
      assert.strictEqual(res.formatted, '00:00');
    });

    test('safely handles missing, null, or malformed timestamps without throwing', () => {
      assert.deepStrictEqual(calculateRemainingHoldTime(null), {
        hasHold: false,
        expired: false,
        totalSeconds: 0,
        minutes: 0,
        seconds: 0,
        formatted: '--:--'
      });

      assert.deepStrictEqual(calculateRemainingHoldTime(undefined), {
        hasHold: false,
        expired: false,
        totalSeconds: 0,
        minutes: 0,
        seconds: 0,
        formatted: '--:--'
      });

      assert.deepStrictEqual(calculateRemainingHoldTime('not-a-valid-date'), {
        hasHold: false,
        expired: false,
        totalSeconds: 0,
        minutes: 0,
        seconds: 0,
        formatted: '--:--'
      });
    });
  });

  // --- 3. STATUS & DATE PRESENTATION HELPERS ---
  describe('3. Status & Date Presentation Helpers', () => {
    test('formatBookingStatus distinguishes active hold from expired hold', () => {
      const activePending = formatBookingStatus('pending', false);
      assert.strictEqual(activePending.label, 'Hold Reserved (Pending)');
      assert.strictEqual(activePending.variant, 'status-warning');

      const expiredPending = formatBookingStatus('pending', true);
      assert.strictEqual(expiredPending.label, 'Hold Expired');
      assert.strictEqual(expiredPending.variant, 'status-danger');

      const confirmed = formatBookingStatus('confirmed');
      assert.strictEqual(confirmed.label, 'Confirmed');
      assert.strictEqual(confirmed.variant, 'status-success');

      const cancelled = formatBookingStatus('cancelled');
      assert.strictEqual(cancelled.label, 'Cancelled');
      assert.strictEqual(cancelled.variant, 'status-danger');
    });

    test('formatDateDisplay formats YYYY-MM-DD cleanly', () => {
      assert.strictEqual(formatDateDisplay('2026-11-01'), 'Nov 1, 2026');
      assert.strictEqual(formatDateDisplay('2026-12-25'), 'Dec 25, 2026');
      assert.strictEqual(formatDateDisplay(''), '');
    });
  });

  // --- 4. AUTHENTICATED BOOKING CREATION INTEGRATION ---
  describe('4. Authenticated Booking Creation Endpoint Integration', () => {
    test('successfully creates a booking with 15-minute hold when authenticated', async () => {
      const payload = {
        room: '66a1b2c3d4e5f67890123401',
        checkInDate: '2026-11-01',
        checkOutDate: '2026-11-03',
        guestCount: 2,
        guestInfo: {
          name: 'Alice Traveler',
          email: 'alice@example.com',
          phone: '+1 555-0199'
        }
      };

      const response = await apiClient.post(`${mockBaseUrl}/bookings`, payload, {
        token: 'valid_customer_jwt'
      });

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.message, 'Booking reservation created successfully');
      assert.strictEqual(response.data.booking._id, '66a1b2c3d4e5f678901234aa');
      assert.strictEqual(response.data.booking.status, 'pending');
      assert.strictEqual(response.data.booking.totalAmount, 120);
      assert.ok(response.data.booking.holdExpiresAt);

      // Verify hold timestamp is in the future
      const holdTime = calculateRemainingHoldTime(response.data.booking.holdExpiresAt);
      assert.strictEqual(holdTime.hasHold, true);
      assert.strictEqual(holdTime.expired, false);
      assert.ok(holdTime.totalSeconds > 800); // ~15 minutes
    });

    test('rejects unauthenticated booking creation with 401 Unauthorized', async () => {
      await assert.rejects(
        async () => {
          await apiClient.post(`${mockBaseUrl}/bookings`, {
            room: '66a1b2c3d4e5f67890123401',
            checkInDate: '2026-11-01',
            checkOutDate: '2026-11-03',
            guestCount: 2
          });
        },
        (err) => {
          assert.ok(err instanceof ApiError);
          assert.strictEqual(err.status, 401);
          assert.strictEqual(err.message, 'Authentication required to create a booking');
          return true;
        }
      );
    });

    test('handles room-availability conflict with 409 Conflict', async () => {
      await assert.rejects(
        async () => {
          await apiClient.post(
            `${mockBaseUrl}/bookings`,
            {
              room: '66a1b2c3d4e5f67890123499', // Triggers 409 in mock
              checkInDate: '2026-11-01',
              checkOutDate: '2026-11-03',
              guestCount: 2
            },
            { token: 'valid_customer_jwt' }
          );
        },
        (err) => {
          assert.ok(err instanceof ApiError);
          assert.strictEqual(err.status, 409);
          assert.match(err.message, /no longer available/i);
          return true;
        }
      );
    });

    test('handles capacity violation with 400 Bad Request', async () => {
      await assert.rejects(
        async () => {
          await apiClient.post(
            `${mockBaseUrl}/bookings`,
            {
              room: '66a1b2c3d4e5f67890123402',
              checkInDate: '2026-11-01',
              checkOutDate: '2026-11-03',
              guestCount: 4 // Exceeds capacity 2
            },
            { token: 'valid_customer_jwt' }
          );
        },
        (err) => {
          assert.ok(err instanceof ApiError);
          assert.strictEqual(err.status, 400);
          assert.match(err.message, /exceeds maximum room capacity/i);
          return true;
        }
      );
    });
  });

  // --- 5. BOOKING DETAILS & HOLD EXPIRATION RETRIEVAL ---
  describe('5. Booking Details Retrieval & Hold Expiration Detection', () => {
    test('retrieves active booking hold by ID and computes remaining time', async () => {
      const response = await apiClient.get(`${mockBaseUrl}/bookings/66a1b2c3d4e5f678901234aa`, {
        token: 'valid_customer_jwt'
      });

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.booking._id, '66a1b2c3d4e5f678901234aa');
      assert.strictEqual(response.data.booking.status, 'pending');

      const holdTime = calculateRemainingHoldTime(response.data.booking.holdExpiresAt);
      assert.strictEqual(holdTime.hasHold, true);
      assert.strictEqual(holdTime.expired, false);
      assert.ok(holdTime.minutes > 0);
    });

    test('detects expired booking hold from past timestamp without inventing time', async () => {
      const response = await apiClient.get(`${mockBaseUrl}/bookings/66a1b2c3d4e5f678901234ee`, {
        token: 'valid_customer_jwt'
      });

      assert.strictEqual(response.success, true);
      const booking = response.data.booking;
      const holdTime = calculateRemainingHoldTime(booking.holdExpiresAt);

      assert.strictEqual(holdTime.hasHold, true);
      assert.strictEqual(holdTime.expired, true);
      assert.strictEqual(holdTime.formatted, '00:00');

      const statusInfo = formatBookingStatus(booking.status, holdTime.expired);
      assert.strictEqual(statusInfo.label, 'Hold Expired');
      assert.strictEqual(statusInfo.variant, 'status-danger');
    });

    test('handles nonexistent booking ID with 404 Not Found', async () => {
      await assert.rejects(
        async () => {
          await apiClient.get(`${mockBaseUrl}/bookings/66a1b2c3d4e5f67890123404`, {
            token: 'valid_customer_jwt'
          });
        },
        (err) => {
          assert.ok(err instanceof ApiError);
          assert.strictEqual(err.status, 404);
          assert.strictEqual(err.message, 'Booking not found');
          return true;
        }
      );
    });
  });

  // --- 6. DUPLICATE SUBMISSION GUARD SIMULATION ---
  describe('6. Duplicate Submission Guard', () => {
    test('submission lock prevents concurrent duplicate booking submissions', async () => {
      let isSubmitting = false;
      let callCount = 0;

      const submitBooking = async () => {
        if (isSubmitting) {
          return { skipped: true };
        }
        isSubmitting = true;
        try {
          callCount++;
          const res = await apiClient.post(
            `${mockBaseUrl}/bookings`,
            {
              room: '66a1b2c3d4e5f67890123401',
              checkInDate: '2026-11-01',
              checkOutDate: '2026-11-03',
              guestCount: 2
            },
            { token: 'valid_customer_jwt' }
          );
          return { skipped: false, res };
        } finally {
          isSubmitting = false;
        }
      };

      // Simulate double click / rapid concurrent clicks
      const [res1, res2] = await Promise.all([submitBooking(), submitBooking()]);

      // Only one execution should proceed; the second should be skipped by the guard
      assert.strictEqual(callCount, 1);
      assert.strictEqual(res1.skipped, false);
      assert.strictEqual(res2.skipped, true);
    });
  });
});
