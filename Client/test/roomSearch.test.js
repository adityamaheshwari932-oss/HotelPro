import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';

import {
  validateSearchParams,
  buildRoomSearchParams,
  getTodayIso,
  getTomorrowIso
} from '../src/utils/roomSearchValidation.js';
import {
  formatRoomType,
  calculateAverageNightlyRate,
  formatPrice
} from '../src/utils/roomFormatters.js';
import { apiClient, ApiError } from '../src/api/client.js';

describe('Stage 8: Public Room Search, Filters & Details Unit Tests', () => {
  let mockServer;
  let serverPort;
  let mockBaseUrl;

  before(async () => {
    mockServer = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url, `http://localhost:${serverPort}`);

      // Search endpoint: /api/rooms/search
      if (parsedUrl.pathname === '/api/rooms/search') {
        const checkIn = parsedUrl.searchParams.get('checkInDate');
        const checkOut = parsedUrl.searchParams.get('checkOutDate');
        const capacity = parsedUrl.searchParams.get('capacity');
        const _minPrice = parsedUrl.searchParams.get('minPrice');
        const maxPrice = parsedUrl.searchParams.get('maxPrice');
        const roomType = parsedUrl.searchParams.get('roomType');

        // Validation simulation
        if (!checkIn || !checkOut) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: false,
              message: 'checkInDate and checkOutDate are required query parameters.'
            })
          );
          return;
        }

        if (checkOut <= checkIn) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: false,
              message: 'checkOutDate must be after checkInDate.'
            })
          );
          return;
        }

        // Empty results simulation if maxPrice is extremely low
        if (maxPrice && parseFloat(maxPrice) < 50) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              data: {
                stay: { checkInDate: checkIn, checkOutDate: checkOut, nights: 2 },
                totalAvailable: 0,
                rooms: []
              }
            })
          );
          return;
        }

        // Delay simulation for slow query test
        if (parsedUrl.searchParams.get('delay')) {
          setTimeout(() => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                success: true,
                data: {
                  stay: { checkInDate: checkIn, checkOutDate: checkOut, nights: 1 },
                  totalAvailable: 1,
                  rooms: [{ _id: 'room_slow', roomNumber: '999', roomType: 'single' }]
                }
              })
            );
          }, 80);
          return;
        }

        // Successful search results
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            data: {
              stay: {
                checkInDate: checkIn,
                checkOutDate: checkOut,
                nights: 3
              },
              totalAvailable: 2,
              rooms: [
                {
                  _id: '66a1b2c3d4e5f6789012345a',
                  roomNumber: '101',
                  roomType: roomType || 'single',
                  capacity: capacity ? parseInt(capacity, 10) : 2,
                  basePrice: 120,
                  photos: ['https://example.com/photo1.jpg'],
                  hotel: {
                    _id: 'hotel_1',
                    name: 'HotelPro Central',
                    address: '100 Main Street'
                  },
                  pricing: {
                    nights: 3,
                    baseNightlyPrice: 120,
                    nightlyBreakdown: [
                      { date: '2026-11-01', rate: 120, ruleApplied: null },
                      { date: '2026-11-02', rate: 140, ruleApplied: 'weekend' },
                      { date: '2026-11-03', rate: 140, ruleApplied: 'weekend' }
                    ],
                    totalRoomPrice: 400,
                    currency: 'USD'
                  }
                },
                {
                  _id: '66a1b2c3d4e5f6789012345b',
                  roomNumber: '202',
                  roomType: 'suite',
                  capacity: 4,
                  basePrice: 250,
                  photos: [],
                  hotel: {
                    _id: 'hotel_1',
                    name: 'HotelPro Central',
                    address: '100 Main Street'
                  },
                  pricing: {
                    nights: 3,
                    baseNightlyPrice: 250,
                    nightlyBreakdown: [
                      { date: '2026-11-01', rate: 250, ruleApplied: null },
                      { date: '2026-11-02', rate: 300, ruleApplied: 'weekend' },
                      { date: '2026-11-03', rate: 300, ruleApplied: 'weekend' }
                    ],
                    totalRoomPrice: 850,
                    currency: 'USD'
                  }
                }
              ]
            }
          })
        );
        return;
      }

      // Room details endpoint: /api/rooms/:id
      const roomDetailMatch = parsedUrl.pathname.match(/^\/api\/rooms\/([^/]+)$/);
      if (roomDetailMatch) {
        const roomId = roomDetailMatch[1];

        if (roomId === 'invalid-id-format') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: false,
              message: 'Invalid room ID format.'
            })
          );
          return;
        }

        if (roomId === '66a1b2c3d4e5f67890123400') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: false,
              message: 'Room not found.'
            })
          );
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            data: {
              room: {
                _id: roomId,
                roomNumber: '305',
                roomType: 'suite',
                capacity: 4,
                basePrice: 280,
                description: 'Luxury panoramic corner suite with king-size bed.',
                photos: ['https://example.com/suite1.jpg', 'https://example.com/suite2.jpg'],
                amenities: ['Wi-Fi', 'Balcony', 'Mini Bar', 'Ocean View'],
                status: 'active',
                hotel: {
                  _id: 'hotel_10',
                  name: 'Grand Horizon HotelPro',
                  address: '77 Ocean Drive',
                  contact: {
                    phone: '+1-555-0199',
                    email: 'reservations@grandhorizon.com'
                  }
                }
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

  // --- 1. SEARCH PARAMETER VALIDATION TESTS ---
  describe('1. Search Parameter Validation (validateSearchParams)', () => {
    test('requires check-in date', () => {
      const res = validateSearchParams({ checkInDate: '', checkOutDate: '2026-11-05' });
      assert.strictEqual(res.isValid, false);
      assert.strictEqual(res.errors.checkInDate, 'Check-in date is required.');
    });

    test('validates ISO date format YYYY-MM-DD', () => {
      const res = validateSearchParams({ checkInDate: '05-11-2026', checkOutDate: '2026-11-10' });
      assert.strictEqual(res.isValid, false);
      assert.strictEqual(res.errors.checkInDate, 'Check-in date must be formatted as YYYY-MM-DD.');
    });

    test('requires check-out date', () => {
      const res = validateSearchParams({ checkInDate: '2026-11-05', checkOutDate: '' });
      assert.strictEqual(res.isValid, false);
      assert.strictEqual(res.errors.checkOutDate, 'Check-out date is required.');
    });

    test('rejects check-out date on or before check-in date', () => {
      const sameDay = validateSearchParams({ checkInDate: '2026-11-05', checkOutDate: '2026-11-05' });
      assert.strictEqual(sameDay.isValid, false);
      assert.strictEqual(sameDay.errors.checkOutDate, 'Check-out date must be strictly after check-in date.');

      const earlierDay = validateSearchParams({ checkInDate: '2026-11-05', checkOutDate: '2026-11-04' });
      assert.strictEqual(earlierDay.isValid, false);
      assert.strictEqual(earlierDay.errors.checkOutDate, 'Check-out date must be strictly after check-in date.');
    });

    test('rejects stay duration exceeding 180 days', () => {
      const res = validateSearchParams({ checkInDate: '2026-01-01', checkOutDate: '2026-07-15' }); // ~195 days
      assert.strictEqual(res.isValid, false);
      assert.strictEqual(res.errors.checkOutDate, 'Stay duration cannot exceed 180 days.');
    });

    test('validates guest counts (must be integer >= 1)', () => {
      const zeroGuests = validateSearchParams({
        checkInDate: '2026-11-01',
        checkOutDate: '2026-11-05',
        guests: '0'
      });
      assert.strictEqual(zeroGuests.isValid, false);
      assert.strictEqual(zeroGuests.errors.guests, 'Guest count must be at least 1.');

      const negativeGuests = validateSearchParams({
        checkInDate: '2026-11-01',
        checkOutDate: '2026-11-05',
        guests: '-3'
      });
      assert.strictEqual(negativeGuests.isValid, false);
      assert.strictEqual(negativeGuests.errors.guests, 'Guest count must be at least 1.');
    });

    test('validates price ranges (non-negative and minPrice <= maxPrice)', () => {
      const negMin = validateSearchParams({
        checkInDate: '2026-11-01',
        checkOutDate: '2026-11-05',
        minPrice: '-50'
      });
      assert.strictEqual(negMin.isValid, false);
      assert.strictEqual(negMin.errors.minPrice, 'Minimum price must be a non-negative number.');

      const minGtMax = validateSearchParams({
        checkInDate: '2026-11-01',
        checkOutDate: '2026-11-05',
        minPrice: '400',
        maxPrice: '200'
      });
      assert.strictEqual(minGtMax.isValid, false);
      assert.strictEqual(minGtMax.errors.minPrice, 'Minimum price cannot exceed maximum price.');
    });

    test('validates roomType enum against supported types', () => {
      const invalidType = validateSearchParams({
        checkInDate: '2026-11-01',
        checkOutDate: '2026-11-05',
        roomType: 'penthouse'
      });
      assert.strictEqual(invalidType.isValid, false);
      assert.strictEqual(invalidType.errors.roomType, 'Room type must be single, double, or suite.');

      const validType = validateSearchParams({
        checkInDate: '2026-11-01',
        checkOutDate: '2026-11-05',
        roomType: 'suite'
      });
      assert.strictEqual(validType.isValid, true);
    });

    test('accepts valid parameters and generates ISO helpers', () => {
      const today = getTodayIso();
      const tomorrow = getTomorrowIso();
      assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(tomorrow, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(tomorrow > today);

      const res = validateSearchParams({
        checkInDate: today,
        checkOutDate: tomorrow,
        guests: '2',
        roomType: 'double',
        minPrice: '100',
        maxPrice: '300'
      });
      assert.strictEqual(res.isValid, true);
      assert.deepStrictEqual(res.errors, {});
    });
  });

  // --- 2. QUERY PARAMETER MAPPING & CONSTRUCTION ---
  describe('2. Query Parameter Mapping (buildRoomSearchParams)', () => {
    test('maps frontend guest count to backend capacity field', () => {
      const query = buildRoomSearchParams({
        checkInDate: '2026-11-01',
        checkOutDate: '2026-11-05',
        guests: '3',
        roomType: 'double',
        minPrice: '150',
        maxPrice: '450'
      });

      assert.strictEqual(query.checkInDate, '2026-11-01');
      assert.strictEqual(query.checkOutDate, '2026-11-05');
      assert.strictEqual(query.capacity, 3);
      assert.strictEqual(query.roomType, 'double');
      assert.strictEqual(query.minPrice, 150);
      assert.strictEqual(query.maxPrice, 450);
    });

    test('omits optional empty or undefined parameters', () => {
      const query = buildRoomSearchParams({
        checkInDate: '2026-11-01',
        checkOutDate: '2026-11-02',
        guests: '',
        roomType: '',
        minPrice: '',
        maxPrice: ''
      });

      assert.strictEqual(query.checkInDate, '2026-11-01');
      assert.strictEqual(query.checkOutDate, '2026-11-02');
      assert.strictEqual(query.capacity, undefined);
      assert.strictEqual(query.roomType, undefined);
      assert.strictEqual(query.minPrice, undefined);
      assert.strictEqual(query.maxPrice, undefined);
    });
  });

  // --- 3. FORMATTING & PRICING PRESENTATION HELPERS ---
  describe('3. Formatting and Pricing Presentation Helpers', () => {
    test('formatRoomType formats types and provides fallbacks', () => {
      assert.strictEqual(formatRoomType('single'), 'Single Room');
      assert.strictEqual(formatRoomType('double'), 'Double Room');
      assert.strictEqual(formatRoomType('suite'), 'Luxury Suite');
      assert.strictEqual(formatRoomType('deluxe'), 'Deluxe');
      assert.strictEqual(formatRoomType(''), 'Standard Room');
      assert.strictEqual(formatRoomType(null), 'Standard Room');
      assert.strictEqual(formatRoomType(undefined), 'Standard Room');
    });

    test('calculateAverageNightlyRate computes average without client-side re-pricing', () => {
      assert.strictEqual(calculateAverageNightlyRate(400, 3), 133);
      assert.strictEqual(calculateAverageNightlyRate(850, 3), 283);
      assert.strictEqual(calculateAverageNightlyRate(0, 3), 0);
      assert.strictEqual(calculateAverageNightlyRate(500, 0), 0); // No division by zero
      assert.strictEqual(calculateAverageNightlyRate(NaN, 2), 0);
    });

    test('formatPrice formats monetary values with currency symbol', () => {
      assert.strictEqual(formatPrice(120), '$120');
      assert.strictEqual(formatPrice(1200), '$1,200');
      assert.strictEqual(formatPrice(150, 'EUR'), 'EUR 150');
      assert.strictEqual(formatPrice(NaN), '$0');
    });
  });

  // --- 4. ROOM SEARCH ENDPOINT INTEGRATION TESTS ---
  describe('4. Room Search Endpoint Integration (apiClient)', () => {
    test('successfully executes room search with query parameters', async () => {
      const response = await apiClient.get(`${mockBaseUrl}/rooms/search`, {
        params: {
          checkInDate: '2026-11-01',
          checkOutDate: '2026-11-04',
          capacity: 2
        }
      });

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.totalAvailable, 2);
      assert.strictEqual(response.data.stay.nights, 3);
      assert.strictEqual(response.data.rooms.length, 2);

      const room1 = response.data.rooms[0];
      assert.strictEqual(room1.roomNumber, '101');
      assert.strictEqual(room1.pricing.totalRoomPrice, 400);
      assert.strictEqual(room1.pricing.nightlyBreakdown.length, 3);
    });

    test('handles empty search results gracefully', async () => {
      const response = await apiClient.get(`${mockBaseUrl}/rooms/search`, {
        params: {
          checkInDate: '2026-11-01',
          checkOutDate: '2026-11-03',
          maxPrice: 30 // Triggers empty results in mock server
        }
      });

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.totalAvailable, 0);
      assert.strictEqual(Array.isArray(response.data.rooms), true);
      assert.strictEqual(response.data.rooms.length, 0);
    });

    test('handles backend validation error (400 Bad Request)', async () => {
      await assert.rejects(
        async () => {
          await apiClient.get(`${mockBaseUrl}/rooms/search`, {
            params: {
              checkInDate: '2026-11-05',
              checkOutDate: '2026-11-01' // Invalid date range
            }
          });
        },
        (err) => {
          assert.ok(err instanceof ApiError);
          assert.strictEqual(err.status, 400);
          assert.strictEqual(err.message, 'checkOutDate must be after checkInDate.');
          return true;
        }
      );
    });
  });

  // --- 5. ROOM DETAILS ENDPOINT INTEGRATION TESTS ---
  describe('5. Room Details Endpoint Integration (apiClient)', () => {
    test('successfully retrieves room details by ID', async () => {
      const response = await apiClient.get(`${mockBaseUrl}/rooms/66a1b2c3d4e5f6789012345a`);

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.room._id, '66a1b2c3d4e5f6789012345a');
      assert.strictEqual(response.data.room.roomNumber, '305');
      assert.strictEqual(response.data.room.roomType, 'suite');
      assert.strictEqual(response.data.room.capacity, 4);
      assert.strictEqual(response.data.room.basePrice, 280);
      assert.strictEqual(response.data.room.hotel.name, 'Grand Horizon HotelPro');
      assert.ok(Array.isArray(response.data.room.amenities));
      assert.ok(response.data.room.amenities.includes('Wi-Fi'));
    });

    test('handles nonexistent room ID with 404 Not Found', async () => {
      await assert.rejects(
        async () => {
          await apiClient.get(`${mockBaseUrl}/rooms/66a1b2c3d4e5f67890123400`);
        },
        (err) => {
          assert.ok(err instanceof ApiError);
          assert.strictEqual(err.status, 404);
          assert.strictEqual(err.message, 'Room not found.');
          return true;
        }
      );
    });

    test('handles invalid ObjectId format with 400 Bad Request', async () => {
      await assert.rejects(
        async () => {
          await apiClient.get(`${mockBaseUrl}/rooms/invalid-id-format`);
        },
        (err) => {
          assert.ok(err instanceof ApiError);
          assert.strictEqual(err.status, 400);
          assert.strictEqual(err.message, 'Invalid room ID format.');
          return true;
        }
      );
    });
  });

  // --- 6. STALE REQUEST FENCING & CANCELLATION ---
  describe('6. Stale Request Fencing and AbortController Cancellation', () => {
    test('fences out superseded slow search responses', async () => {
      let latestSequence = 0;
      let committedResult = null;

      const triggerSearch = async (seq, delay) => {
        latestSequence = seq;
        const currentSeq = seq;

        const response = await apiClient.get(`${mockBaseUrl}/rooms/search`, {
          params: {
            checkInDate: '2026-11-01',
            checkOutDate: '2026-11-02',
            delay: delay ? 'true' : ''
          }
        });

        // Fencing check: only commit if this request is still the latest initiated
        if (currentSeq === latestSequence) {
          committedResult = { seq: currentSeq, data: response.data };
        }
      };

      // Launch slow Request 1 (seq = 1, 80ms delay)
      const promise1 = triggerSearch(1, true);
      // Wait 10ms and launch fast Request 2 (seq = 2, no delay)
      await new Promise((r) => setTimeout(r, 10));
      const promise2 = triggerSearch(2, false);

      await Promise.all([promise1, promise2]);

      // Request 2 must win and supersede Request 1
      assert.ok(committedResult !== null);
      assert.strictEqual(committedResult.seq, 2);
      assert.strictEqual(committedResult.data.totalAvailable, 2);
    });

    test('AbortController immediately cancels in-flight search request', async () => {
      const controller = new AbortController();

      const searchPromise = apiClient.get(`${mockBaseUrl}/rooms/search`, {
        params: {
          checkInDate: '2026-11-01',
          checkOutDate: '2026-11-02',
          delay: 'true'
        },
        signal: controller.signal
      });

      // Immediately abort
      controller.abort('Search canceled by user');

      await assert.rejects(
        searchPromise,
        (err) => {
          assert.ok(err instanceof ApiError);
          assert.strictEqual(err.status, 0);
          assert.ok(err.message.includes('cancelled') || err.message.includes('aborted'));
          return true;
        }
      );
    });
  });
});
