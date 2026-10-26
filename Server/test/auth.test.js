require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = require('../app');
const { User, SystemLock } = require('../src/models');
const { initializeInitialAdmin } = require('../src/services/auth.service');
const { getJwtSecret, signToken } = require('../src/config/jwt');
const { restrictTo } = require('../src/middleware/auth.middleware');

describe('Stage 3: Backend Authentication & Authorization Tests', () => {
  const ISOLATED_TEST_DB_URI = 'mongodb://127.0.0.1:27017/hotelpro_auth_test_isolation';
  let server;
  let baseUrl;

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

    // Initialize model indexes in isolated DB
    await User.init();
    await SystemLock.init();

    // Clean test collections
    await User.deleteMany({});
    await SystemLock.deleteMany({});
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

  describe('Customer Registration (POST /api/auth/register)', () => {
    test('successfully registers customer with normalized email and hashed password', async () => {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Alice Wonder',
          email: '  Alice.Wonder@Example.COM  ',
          password: 'Password123!',
          phone: '+15551234567'
        })
      });

      const body = await res.json();

      assert.strictEqual(res.status, 201);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.user.email, 'alice.wonder@example.com');
      assert.strictEqual(body.data.user.role, 'customer');
      assert.strictEqual(body.data.user.passwordHash, undefined, 'Must not return password hash');

      // Verify in DB that password is saved as a bcrypt hash, not plaintext
      const dbUser = await User.findOne({ email: 'alice.wonder@example.com' }).select('+passwordHash');
      assert.ok(dbUser);
      assert.notStrictEqual(dbUser.passwordHash, 'Password123!');
      assert.ok(dbUser.passwordHash.startsWith('$2a$') || dbUser.passwordHash.startsWith('$2b$'));
      const isMatch = await bcrypt.compare('Password123!', dbUser.passwordHash);
      assert.strictEqual(isMatch, true);
    });

    test('public registration strictly ignores or overrides client-supplied admin role', async () => {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Sneaky Hacker',
          email: 'hacker@example.com',
          password: 'Password123!',
          role: 'admin' // Attempting privilege escalation
        })
      });

      const body = await res.json();

      assert.strictEqual(res.status, 201);
      assert.strictEqual(body.data.user.role, 'customer', 'Role must remain customer');

      const dbUser = await User.findOne({ email: 'hacker@example.com' });
      assert.strictEqual(dbUser.role, 'customer');
    });

    test('rejects duplicate email registration with 409 Conflict', async () => {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Alice Duplicate',
          email: 'alice.wonder@example.com', // Already registered
          password: 'Password123!'
        })
      });

      const body = await res.json();

      assert.strictEqual(res.status, 409);
      assert.strictEqual(body.success, false);
      assert.match(body.message, /already exists/i);
    });

    test('rejects passwords that fail the security policy with 400 Bad Request', async () => {
      const weakPasswords = [
        'short1!',      // < 8 chars
        'alllowercase1!', // No uppercase
        'ALLUPPERCASE1!', // No lowercase
        'NoDigitsHere!',  // No number
        'NoSpecialChar1'  // No special symbol
      ];

      for (const password of weakPasswords) {
        const res = await fetch(`${baseUrl}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Policy Test',
            email: `policy.${Date.now()}@example.com`,
            password
          })
        });

        assert.strictEqual(res.status, 400, `Expected 400 for password: ${password}`);
      }
    });
  });

  describe('User Login (POST /api/auth/login)', () => {
    test('successfully authenticates active user and returns signed JWT', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'alice.wonder@example.com',
          password: 'Password123!'
        })
      });

      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.ok(body.data.token, 'Must return JWT token');
      assert.strictEqual(body.data.user.email, 'alice.wonder@example.com');
      assert.strictEqual(body.data.user.passwordHash, undefined);

      // Verify token payload contains only minimal claims
      const decoded = jwt.decode(body.data.token);
      assert.ok(decoded.sub);
      assert.strictEqual(decoded.role, 'customer');
      assert.strictEqual(decoded.password, undefined);
      assert.strictEqual(decoded.passwordHash, undefined);
    });

    test('returns generic 401 error for unknown email', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'unknown.ghost@example.com',
          password: 'Password123!'
        })
      });

      const body = await res.json();

      assert.strictEqual(res.status, 401);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.message, 'Invalid email or password.');
    });

    test('returns generic 401 error for incorrect password', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'alice.wonder@example.com',
          password: 'WrongPassword999!'
        })
      });

      const body = await res.json();

      assert.strictEqual(res.status, 401);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.message, 'Invalid email or password.');
    });

    test('refuses authentication for suspended or inactive accounts with 403', async () => {
      // Mark user as suspended
      await User.updateOne({ email: 'alice.wonder@example.com' }, { status: 'suspended' });

      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'alice.wonder@example.com',
          password: 'Password123!'
        })
      });

      const body = await res.json();

      assert.strictEqual(res.status, 403);
      assert.strictEqual(body.success, false);
      assert.match(body.message, /inactive or suspended/i);

      // Restore active status
      await User.updateOne({ email: 'alice.wonder@example.com' }, { status: 'active' });
    });
  });

  describe('JWT Verification & Profile (GET /api/auth/me)', () => {
    let validToken;

    before(async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'alice.wonder@example.com',
          password: 'Password123!'
        })
      });
      const data = await res.json();
      validToken = data.data.token;
    });

    test('allows access and returns profile for valid JWT', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${validToken}`
        }
      });

      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.user.email, 'alice.wonder@example.com');
      assert.strictEqual(body.data.user.role, 'customer');
    });

    test('rejects request with missing token with 401', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`);
      const body = await res.json();

      assert.strictEqual(res.status, 401);
      assert.strictEqual(body.success, false);
    });

    test('rejects request with malformed or tampered token with 401', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: {
          Authorization: 'Bearer invalid.tampered.token'
        }
      });

      const body = await res.json();

      assert.strictEqual(res.status, 401);
      assert.strictEqual(body.success, false);
      assert.match(body.message, /invalid/i);
    });

    test('rejects expired token with 401', async () => {
      const secret = getJwtSecret();
      const user = await User.findOne({ email: 'alice.wonder@example.com' });

      // Create an already-expired token (signed 10 seconds ago with 1s lifetime)
      const expiredToken = jwt.sign(
        { sub: user._id.toString(), role: user.role },
        secret,
        { expiresIn: '-10s' }
      );

      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${expiredToken}`
        }
      });

      const body = await res.json();

      assert.strictEqual(res.status, 401);
      assert.strictEqual(body.success, false);
      assert.match(body.message, /expired/i);
    });
    test('rejects suspended accounts on protected endpoints with 403 even with valid token', async () => {
      // Temporarily mark user as suspended
      await User.updateOne({ email: 'alice.wonder@example.com' }, { status: 'suspended' });

      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${validToken}`
        }
      });

      const body = await res.json();

      assert.strictEqual(res.status, 403);
      assert.strictEqual(body.success, false);
      assert.match(body.message, /inactive or suspended/i);

      // Restore active status
      await User.updateOne({ email: 'alice.wonder@example.com' }, { status: 'active' });
    });

    test('rejects tokens signed with unauthorized or pinned algorithm mismatches with 401', async () => {
      // Craft a token signed with 'none' or mismatched algorithm
      const secret = getJwtSecret();
      const fakeToken = jwt.sign({ sub: 'some-id' }, secret, { algorithm: 'HS384' });

      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${fakeToken}`
        }
      });

      const body = await res.json();

      assert.strictEqual(res.status, 401);
      assert.strictEqual(body.success, false);
      assert.match(body.message, /invalid/i);
    });
  });

  describe('Role-Based Authorization (restrictTo middleware)', () => {
    test('denies non-admin users access to admin-only actions', async () => {
      const req = { user: { role: 'customer' } };
      let errorThrown = null;

      const middleware = restrictTo('admin');
      middleware(req, {}, (err) => {
        errorThrown = err;
      });

      assert.ok(errorThrown);
      assert.strictEqual(errorThrown.statusCode, 403);
      assert.match(errorThrown.message, /permission/i);
    });

    test('allows admin users access to admin-only actions', async () => {
      const req = { user: { role: 'admin' } };
      let errorThrown = null;
      let nextCalled = false;

      const middleware = restrictTo('admin');
      middleware(req, {}, (err) => {
        if (err) errorThrown = err;
        nextCalled = true;
      });

      assert.strictEqual(errorThrown, null);
      assert.strictEqual(nextCalled, true);
    });

    test('source of truth: authorization uses database role, not forged JWT role claim', async () => {
      const customerUser = await User.findOne({ email: 'alice.wonder@example.com' });
      assert.strictEqual(customerUser.role, 'customer');

      // Attacker forges/generates token claiming role = 'admin' for this user ID
      const secret = getJwtSecret();
      const forgedRoleToken = jwt.sign(
        { sub: customerUser._id.toString(), role: 'admin' },
        secret,
        { expiresIn: '15m', algorithm: 'HS256' }
      );

      // Simulate passing forged token through protect + restrictTo('admin')
      const req = { headers: { authorization: `Bearer ${forgedRoleToken}` } };
      const { protect } = require('../src/middleware/auth.middleware');

      // 1. Run protect: loads user from MongoDB
      await new Promise((resolve, reject) => {
        protect(req, {}, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });

      // Verify protect attached database user with role 'customer', ignoring forged JWT role
      assert.strictEqual(req.user.role, 'customer');

      // 2. Run restrictTo('admin'): must reject based on database role
      let rbacError = null;
      restrictTo('admin')(req, {}, (err) => {
        rbacError = err;
      });

      assert.ok(rbacError, 'Must reject user whose database role is customer');
      assert.strictEqual(rbacError.statusCode, 403);
    });
  });

  describe('Initial One-Time Administrator Initialization', () => {
    const validSetupSecret = process.env.ADMIN_SETUP_SECRET;

    test('rejects admin initialization if setup secret is incorrect', async () => {
      await assert.rejects(
        async () => {
          await initializeInitialAdmin({
            name: 'Fake Admin',
            email: 'fake.admin@hotelpro.com',
            password: 'AdminPassword123!',
            setupSecret: 'wrong_secret_123456789012345678901234567890'
          });
        },
        {
          statusCode: 401,
          message: /Invalid administrator setup secret/
        }
      );
    });

    test('successfully initializes first administrator with hashed password', async () => {
      const admin = await initializeInitialAdmin({
        name: 'Chief Administrator',
        email: 'admin.initial@hotelpro.com',
        password: 'AdminPassword123!',
        phone: '+15559876543',
        setupSecret: validSetupSecret
      });

      assert.ok(admin.id);
      assert.strictEqual(admin.email, 'admin.initial@hotelpro.com');
      assert.strictEqual(admin.role, 'admin');

      // Verify password is saved as hash
      const dbAdmin = await User.findById(admin.id).select('+passwordHash');
      assert.ok(dbAdmin.passwordHash.startsWith('$2a$') || dbAdmin.passwordHash.startsWith('$2b$'));
      const isMatch = await bcrypt.compare('AdminPassword123!', dbAdmin.passwordHash);
      assert.strictEqual(isMatch, true);
    });

    test('refuses repeated administrator initialization attempts once admin exists', async () => {
      await assert.rejects(
        async () => {
          await initializeInitialAdmin({
            name: 'Second Admin',
            email: 'second.admin@hotelpro.com',
            password: 'AdminPassword123!',
            setupSecret: validSetupSecret
          });
        },
        {
          statusCode: 409,
          message: /administrator account already exists/i
        }
      );
    });

    test('concurrency safety: atomic lock guarantees only ONE concurrent initialization can ever succeed', async () => {
      // Temporarily clean to simulate fresh initialization attempt with race conditions
      await User.deleteMany({ role: 'admin' });
      await SystemLock.deleteMany({});

      const concurrentAttempts = [
        initializeInitialAdmin({
          name: 'Racer 1',
          email: 'racer1@hotelpro.com',
          password: 'AdminPassword123!',
          setupSecret: validSetupSecret
        }),
        initializeInitialAdmin({
          name: 'Racer 2',
          email: 'racer2@hotelpro.com',
          password: 'AdminPassword123!',
          setupSecret: validSetupSecret
        }),
        initializeInitialAdmin({
          name: 'Racer 3',
          email: 'racer3@hotelpro.com',
          password: 'AdminPassword123!',
          setupSecret: validSetupSecret
        })
      ];

      const results = await Promise.allSettled(concurrentAttempts);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly ONE must succeed and the others must be rejected due to database lock
      assert.strictEqual(fulfilled.length, 1, 'Exactly one concurrent admin initialization must succeed');
      assert.strictEqual(rejected.length, 2, 'All other concurrent attempts must be rejected');

      // Verify only one Admin exists in the database
      const adminCount = await User.countDocuments({ role: 'admin' });
      assert.strictEqual(adminCount, 1, 'Database must contain exactly 1 administrator');
    });

    test('lock recovery: failed admin creation cleans up lock and allows immediate retry', async () => {
      // Temporarily clean admin and lock to test failure/retry cycle
      await User.deleteMany({ role: 'admin' });
      await SystemLock.deleteMany({});

      // Attempt initialization with an email already taken by an existing customer
      await assert.rejects(
        async () => {
          await initializeInitialAdmin({
            name: 'Failed Admin',
            email: 'alice.wonder@example.com', // Duplicate email
            password: 'AdminPassword123!',
            setupSecret: validSetupSecret
          });
        },
        {
          statusCode: 409,
          message: /already exists/
        }
      );

      // Verify that lock was cleanly deleted and not left in an orphaned state
      const lockDoc = await SystemLock.findById('initial_admin_setup');
      assert.strictEqual(lockDoc, null, 'Lock must be deleted when user creation fails');

      // Now retry with a valid fresh email -> must succeed immediately
      const retryAdmin = await initializeInitialAdmin({
        name: 'Recovered Admin',
        email: 'recovered.admin@hotelpro.com',
        password: 'AdminPassword123!',
        setupSecret: validSetupSecret
      });

      assert.ok(retryAdmin.id);
      assert.strictEqual(retryAdmin.email, 'recovered.admin@hotelpro.com');
      assert.strictEqual(retryAdmin.role, 'admin');
    });

    test('stale lock recovery: orphaned lock without admin user is safely recovered after timeout', async () => {
      // Temporarily clean to simulate an orphaned lock from a crashed process
      await User.deleteMany({ role: 'admin' });
      await SystemLock.deleteMany({});

      // Manually insert an orphaned lock created 2 minutes ago
      await SystemLock.create({
        _id: 'initial_admin_setup',
        meta: { initializedEmail: 'crashed@hotelpro.com' },
        initializedAt: new Date(Date.now() - 120000)
      });

      // No admin exists, but stale lock is present
      const adminExistsBefore = await User.exists({ role: 'admin' });
      assert.strictEqual(adminExistsBefore, null);

      // Attempt initialization -> must recognize stale lock, recover, and succeed
      const admin = await initializeInitialAdmin({
        name: 'Stale Recovered Admin',
        email: 'stale.recovered@hotelpro.com',
        password: 'AdminPassword123!',
        setupSecret: validSetupSecret
      });

      assert.ok(admin.id);
      assert.strictEqual(admin.email, 'stale.recovered@hotelpro.com');
      assert.strictEqual(admin.role, 'admin');

      const adminCount = await User.countDocuments({ role: 'admin' });
      assert.strictEqual(adminCount, 1);
    });
  });

  describe('JWT Configuration Security', () => {
    test('fails clearly if JWT_SECRET is missing or insecurely short', () => {
      const originalSecret = process.env.JWT_SECRET;

      try {
        delete process.env.JWT_SECRET;
        assert.throws(() => getJwtSecret(), {
          statusCode: 500,
          message: /JWT_SECRET environment variable is not defined/
        });

        process.env.JWT_SECRET = 'short_secret';
        assert.throws(() => getJwtSecret(), {
          statusCode: 500,
          message: /JWT_SECRET is insecure/
        });
      } finally {
        process.env.JWT_SECRET = originalSecret;
      }
    });
  });
});
