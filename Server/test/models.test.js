require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const {
  Hotel,
  User,
  Room,
  Booking,
  Payment
} = require('../src/models');

/**
 * Helper to validate a Mongoose document asynchronously using `doc.validate()`.
 * Returns the ValidationError if validation fails, or null if valid.
 */
const getValidationError = async (doc) => {
  try {
    await doc.validate();
    return null;
  } catch (err) {
    return err;
  }
};

describe('Stage 2: Core Data Models - Schema Validation Tests', () => {
  describe('Hotel Model Validation', () => {
    test('rejects missing required fields', async () => {
      const hotel = new Hotel({});
      const err = await getValidationError(hotel);

      assert.ok(err, 'Expected validation error for empty Hotel');
      assert.ok(err.errors['name'], 'Expected name error');
      assert.ok(err.errors['address.street'], 'Expected address.street error');
      assert.ok(err.errors['address.city'], 'Expected address.city error');
      assert.ok(err.errors['address.country'], 'Expected address.country error');
      assert.ok(err.errors['contact.phone'], 'Expected contact.phone error');
      assert.ok(err.errors['contact.email'], 'Expected contact.email error');
    });

    test('rejects invalid contact email format', async () => {
      const hotel = new Hotel({
        name: 'The Grand Palace',
        address: { street: '123 Main St', city: 'Metropolis', country: 'USA' },
        contact: { phone: '+1234567890', email: 'invalid-email-address' }
      });
      const err = await getValidationError(hotel);

      assert.ok(err);
      assert.ok(err.errors['contact.email']);
    });

    test('accepts valid hotel document with defaults', async () => {
      const hotel = new Hotel({
        name: 'The Grand Palace',
        address: { street: '123 Main St', city: 'Metropolis', country: 'USA' },
        contact: { phone: '+1234567890', email: 'concierge@grandpalace.com' }
      });
      const err = await getValidationError(hotel);

      assert.strictEqual(err, null);
      assert.strictEqual(hotel.status, 'active');
      assert.strictEqual(hotel.isActive, true);
    });
  });

  describe('User Model Validation', () => {
    test('rejects missing required user fields', async () => {
      const user = new User({});
      const err = await getValidationError(user);

      assert.ok(err);
      assert.ok(err.errors['name']);
      assert.ok(err.errors['email']);
      assert.ok(err.errors['passwordHash']);
    });

    test('normalizes email by trimming and converting to lowercase', async () => {
      const user = new User({
        name: 'Jane Doe',
        email: '   Jane.Doe@EXAMPLE.COM   ',
        passwordHash: '$2a$12$e8YQzabcdef1234567890'
      });

      assert.strictEqual(user.email, 'jane.doe@example.com');
      const err = await getValidationError(user);
      assert.strictEqual(err, null);
    });

    test('rejects invalid email formats', async () => {
      const invalidEmails = ['plainaddress', '@missingusername.com', 'user@.com', 'user@domain'];
      for (const email of invalidEmails) {
        const user = new User({
          name: 'Jane Doe',
          email,
          passwordHash: 'dummy-hash'
        });
        const err = await getValidationError(user);
        assert.ok(err, `Expected email validation error for: ${email}`);
        assert.ok(err.errors['email']);
      }
    });

    test('defaults role to customer and rejects unauthorized roles', async () => {
      const user = new User({
        name: 'Regular Customer',
        email: 'cust@test.com',
        passwordHash: 'hash-abc'
      });
      assert.strictEqual(user.role, 'customer');

      user.role = 'superadmin';
      const err = await getValidationError(user);
      assert.ok(err);
      assert.ok(err.errors['role']);
    });

    test('accepts valid admin role', async () => {
      const admin = new User({
        name: 'Hotel Admin',
        email: 'admin@test.com',
        passwordHash: 'hash-abc',
        role: 'admin'
      });
      const err = await getValidationError(admin);
      assert.strictEqual(err, null);
      assert.strictEqual(admin.role, 'admin');
    });

    test('does not expose passwordHash when converted to JSON', () => {
      const user = new User({
        name: 'Safe User',
        email: 'safe@test.com',
        passwordHash: 'super-secret-hash-123'
      });

      const json = JSON.parse(JSON.stringify(user));
      assert.strictEqual(json.passwordHash, undefined);
      assert.strictEqual(json.__v, undefined);
    });
  });

  describe('Room Model Validation', () => {
    const dummyHotelId = new mongoose.Types.ObjectId();

    test('rejects missing required room fields', async () => {
      const room = new Room({});
      const err = await getValidationError(room);

      assert.ok(err);
      assert.ok(err.errors['hotel']);
      assert.ok(err.errors['roomNumber']);
      assert.ok(err.errors['roomType']);
      assert.ok(err.errors['basePrice']);
      assert.ok(err.errors['capacity']);
    });

    test('rejects invalid room types', async () => {
      const room = new Room({
        hotel: dummyHotelId,
        roomNumber: '101',
        roomType: 'villa', // Only 'single', 'double', 'suite' allowed
        basePrice: 150,
        capacity: 2
      });
      const err = await getValidationError(room);
      assert.ok(err);
      assert.ok(err.errors['roomType']);
    });

    test('rejects negative base price and non-positive capacity', async () => {
      const room = new Room({
        hotel: dummyHotelId,
        roomNumber: '101',
        roomType: 'double',
        basePrice: -10,
        capacity: 0
      });
      const err = await getValidationError(room);
      assert.ok(err);
      assert.ok(err.errors['basePrice']);
      assert.ok(err.errors['capacity']);
    });

    test('validates pricing rule date format and requires endDate > startDate', async () => {
      // Invalid date format
      const roomBadFormat = new Room({
        hotel: dummyHotelId,
        roomNumber: '102',
        roomType: 'suite',
        basePrice: 200,
        capacity: 4,
        pricingRules: [
          {
            ruleName: 'Holiday',
            startDate: '12/25/2026', // Not YYYY-MM-DD
            endDate: '2026-12-28',
            price: 300
          }
        ]
      });
      const errFormat = await getValidationError(roomBadFormat);
      assert.ok(errFormat);
      assert.ok(errFormat.errors['pricingRules.0.startDate']);

      // endDate equal to or before startDate
      const roomInvertedDates = new Room({
        hotel: dummyHotelId,
        roomNumber: '102',
        roomType: 'suite',
        basePrice: 200,
        capacity: 4,
        pricingRules: [
          {
            ruleName: 'Inverted Range',
            startDate: '2026-12-30',
            endDate: '2026-12-25',
            price: 300
          }
        ]
      });
      const errInverted = await getValidationError(roomInvertedDates);
      assert.ok(errInverted);
      assert.ok(errInverted.errors['pricingRules.0.endDate']);

      // Negative rule price
      const roomNegativeRulePrice = new Room({
        hotel: dummyHotelId,
        roomNumber: '102',
        roomType: 'suite',
        basePrice: 200,
        capacity: 4,
        pricingRules: [
          {
            ruleName: 'Negative',
            startDate: '2026-12-25',
            endDate: '2026-12-28',
            price: -50
          }
        ]
      });
      const errNegative = await getValidationError(roomNegativeRulePrice);
      assert.ok(errNegative);
      assert.ok(errNegative.errors['pricingRules.0.price']);
    });

    test('accepts valid room with pricing rule and confirms no permanent availability field', async () => {
      const room = new Room({
        hotel: dummyHotelId,
        roomNumber: '201',
        roomType: 'single',
        basePrice: 100,
        capacity: 1,
        pricingRules: [
          {
            ruleName: 'Summer Peak',
            startDate: '2026-07-01',
            endDate: '2026-08-31',
            price: 140
          }
        ]
      });
      const err = await getValidationError(room);
      assert.strictEqual(err, null);

      // Verify availability is not a permanent field in the model schema
      assert.strictEqual(room.isAvailable, undefined);
      assert.strictEqual(room.schema.paths.isAvailable, undefined);
    });
  });

  describe('Booking Model Validation', () => {
    const dummyHotelId = new mongoose.Types.ObjectId();
    const dummyRoomId = new mongoose.Types.ObjectId();
    const dummyUserId = new mongoose.Types.ObjectId();

    test('rejects missing booking references and details', async () => {
      const booking = new Booking({});
      const err = await getValidationError(booking);

      assert.ok(err);
      assert.ok(err.errors['hotel']);
      assert.ok(err.errors['room']);
      assert.ok(err.errors['user']);
      assert.ok(err.errors['checkInDate']);
      assert.ok(err.errors['checkOutDate']);
      assert.ok(err.errors['guestInfo.name']);
      assert.ok(err.errors['guestInfo.email']);
      assert.ok(err.errors['guestCount']);
      assert.ok(err.errors['priceSnapshot']);
      assert.ok(err.errors['totalAmount']);
    });

    test('rejects checkOutDate that is on or before checkInDate', async () => {
      const bookingSameDay = new Booking({
        hotel: dummyHotelId,
        room: dummyRoomId,
        user: dummyUserId,
        checkInDate: new Date('2026-11-10T15:00:00Z'),
        checkOutDate: new Date('2026-11-10T11:00:00Z'),
        guestInfo: { name: 'Alice Smith', email: 'alice@example.com' },
        guestCount: 2,
        priceSnapshot: {
          baseNightlyRate: 120,
          totalRoomRate: 120
        },
        totalAmount: 120
      });
      const err = await getValidationError(bookingSameDay);
      assert.ok(err);
      assert.ok(err.errors['checkOutDate']);
    });

    test('rejects invalid guest count and negative total amount', async () => {
      const booking = new Booking({
        hotel: dummyHotelId,
        room: dummyRoomId,
        user: dummyUserId,
        checkInDate: new Date('2026-11-10T15:00:00Z'),
        checkOutDate: new Date('2026-11-12T11:00:00Z'),
        guestInfo: { name: 'Alice Smith', email: 'alice@example.com' },
        guestCount: 0,
        priceSnapshot: {
          baseNightlyRate: 100,
          totalRoomRate: 200
        },
        totalAmount: -50
      });
      const err = await getValidationError(booking);
      assert.ok(err);
      assert.ok(err.errors['guestCount']);
      assert.ok(err.errors['totalAmount']);
    });

    test('accepts valid booking with price snapshot and defaults status to pending', async () => {
      const booking = new Booking({
        hotel: dummyHotelId,
        room: dummyRoomId,
        user: dummyUserId,
        checkInDate: new Date('2026-11-10T15:00:00Z'),
        checkOutDate: new Date('2026-11-13T11:00:00Z'),
        guestInfo: { name: 'Alice Smith', email: 'alice@example.com', phone: '+15551234567' },
        guestCount: 2,
        priceSnapshot: {
          baseNightlyRate: 100,
          nightlyBreakdown: [
            { date: '2026-11-10', rate: 100 },
            { date: '2026-11-11', rate: 100 },
            { date: '2026-11-12', rate: 110 }
          ],
          totalRoomRate: 310,
          taxes: 31,
          fees: 15
        },
        totalAmount: 356,
        currency: 'USD'
      });
      const err = await getValidationError(booking);
      assert.strictEqual(err, null);
      assert.strictEqual(booking.status, 'pending');
      assert.strictEqual(booking.priceSnapshot.totalRoomRate, 310);
    });
  });

  describe('Payment Model Validation & PCI Security Guardrail', () => {
    const dummyBookingId = new mongoose.Types.ObjectId();

    test('rejects missing required payment fields', async () => {
      const payment = new Payment({});
      const err = await getValidationError(payment);

      assert.ok(err);
      assert.ok(err.errors['booking']);
      assert.ok(err.errors['amount']);
      assert.ok(err.errors['provider']);
    });

    test('rejects negative payment amounts and invalid providers', async () => {
      const payment = new Payment({
        booking: dummyBookingId,
        amount: -25,
        provider: 'unsupported_gateway'
      });
      const err = await getValidationError(payment);

      assert.ok(err);
      assert.ok(err.errors['amount']);
      assert.ok(err.errors['provider']);
    });

    test('PCI Security: throws error if raw card number or CVV is passed', async () => {
      const unsafePayment = new Payment({
        booking: dummyBookingId,
        amount: 250,
        provider: 'stripe',
        cardNumber: '4111111111111234',
        cvv: '123'
      });

      await assert.rejects(
        async () => {
          await unsafePayment.validate();
        },
        {
          name: 'Error',
          message: /Security Violation: Storing raw payment credentials/
        }
      );
    });

    test('PCI Security: throws error if raw card credentials are passed in metadata Map', async () => {
      const unsafePaymentMap = new Payment({
        booking: dummyBookingId,
        amount: 250,
        provider: 'stripe',
        metadata: new Map([['cvv', '999']])
      });

      await assert.rejects(
        async () => {
          await unsafePaymentMap.validate();
        },
        {
          name: 'Error',
          message: /Security Violation: Storing raw payment credentials/
        }
      );
    });

    test('accepts safe payment metadata with masked cardLast4', async () => {
      const payment = new Payment({
        booking: dummyBookingId,
        amount: 356,
        currency: 'USD',
        provider: 'stripe',
        transactionId: 'ch_3Mxyz98765',
        paymentMethod: {
          methodType: 'card',
          cardBrand: 'Visa',
          cardLast4: '4242'
        }
      });
      const err = await getValidationError(payment);
      assert.strictEqual(err, null);
      assert.strictEqual(payment.status, 'pending');
      assert.strictEqual(payment.paymentMethod.cardLast4, '4242');
    });
  });
});

describe('Stage 2: Core Data Models - Database Unique Index Tests (Isolated Database)', () => {
  // Dedicated isolated test database to protect the main hotelpro database
  const ISOLATED_TEST_DB_URI = 'mongodb://127.0.0.1:27017/hotelpro_model_test_isolation';
  let isolatedConn;
  let IsolatedUser;
  let IsolatedRoom;
  let IsolatedHotel;

  before(async () => {
    isolatedConn = await mongoose.createConnection(ISOLATED_TEST_DB_URI).asPromise();
    IsolatedHotel = isolatedConn.model('Hotel', Hotel.schema);
    IsolatedUser = isolatedConn.model('User', User.schema);
    IsolatedRoom = isolatedConn.model('Room', Room.schema);

    // Ensure MongoDB creates the unique indexes in this isolated database
    await IsolatedUser.init();
    await IsolatedRoom.init();
    await IsolatedHotel.init();
  });

  after(async () => {
    if (isolatedConn) {
      // Safely drop ONLY the isolated test database
      await isolatedConn.dropDatabase();
      await isolatedConn.close();
    }
  });

  test('MongoDB unique index rejects duplicate emails for User', async () => {
    const userEmail = 'unique.user@example.com';

    await IsolatedUser.create({
      name: 'Original User',
      email: userEmail,
      passwordHash: 'hash-original'
    });

    await assert.rejects(
      async () => {
        await IsolatedUser.create({
          name: 'Duplicate User',
          email: userEmail,
          passwordHash: 'hash-duplicate'
        });
      },
      (err) => {
        return err && err.code === 11000;
      },
      'Expected MongoDB E11000 duplicate key error for duplicate email'
    );
  });

  test('MongoDB compound unique index rejects duplicate roomNumber in the SAME hotel', async () => {
    const hotelA = await IsolatedHotel.create({
      name: 'Hotel Alpha',
      address: { street: '1 A St', city: 'City A', country: 'Country A' },
      contact: { phone: '111', email: 'alpha@hotel.com' }
    });

    await IsolatedRoom.create({
      hotel: hotelA._id,
      roomNumber: '101',
      roomType: 'single',
      basePrice: 100,
      capacity: 1
    });

    await assert.rejects(
      async () => {
        await IsolatedRoom.create({
          hotel: hotelA._id,
          roomNumber: '101', // Same hotel, same room number
          roomType: 'double',
          basePrice: 120,
          capacity: 2
        });
      },
      (err) => {
        return err && err.code === 11000;
      },
      'Expected MongoDB E11000 duplicate key error for duplicate roomNumber in the same hotel'
    );
  });

  test('MongoDB compound unique index ALLOWS same roomNumber in a DIFFERENT hotel', async () => {
    const hotelB = await IsolatedHotel.create({
      name: 'Hotel Beta',
      address: { street: '2 B St', city: 'City B', country: 'Country B' },
      contact: { phone: '222', email: 'beta@hotel.com' }
    });

    // Room 101 in Hotel Beta should succeed even though Hotel Alpha also has Room 101
    const roomHotelB = await IsolatedRoom.create({
      hotel: hotelB._id,
      roomNumber: '101',
      roomType: 'suite',
      basePrice: 250,
      capacity: 3
    });

    assert.ok(roomHotelB._id);
    assert.strictEqual(roomHotelB.roomNumber, '101');
  });
});
