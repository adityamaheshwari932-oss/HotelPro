require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const app = require('../app');
const connectDB = require('../src/config/db');

describe('Health and Readiness Endpoints', () => {
  let server;
  let baseUrl;

  before(async () => {
    // Start app on ephemeral port for testing
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close(false);
    }
  });

  test('GET /api/health returns 200 with liveness details', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(typeof data.message, 'string');
    assert.strictEqual(typeof data.environment, 'string');
  });

  test('GET /api/health/ready returns 503 when database is disconnected', async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close(false);
    }

    const res = await fetch(`${baseUrl}/api/health/ready`);
    const data = await res.json();

    assert.strictEqual(res.status, 503);
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.status, 'not_ready');
    assert.strictEqual(data.database, 'disconnected');
  });

  test('GET /api/health/ready returns 200 when database is connected', async () => {
    await connectDB();

    const res = await fetch(`${baseUrl}/api/health/ready`);
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.status, 'ready');
    assert.strictEqual(data.database, 'connected');
  });

  test('connectDB throws clearly if MONGODB_URI is missing', async () => {
    const originalUri = process.env.MONGODB_URI;
    delete process.env.MONGODB_URI;

    try {
      await assert.rejects(
        async () => {
          await connectDB();
        },
        {
          name: 'Error',
          message: /MONGODB_URI environment variable is not defined/
        }
      );
    } finally {
      process.env.MONGODB_URI = originalUri;
    }
  });
});
