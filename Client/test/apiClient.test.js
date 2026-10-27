import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';

import { apiClient, ApiError, getStoredToken, setStoredToken, removeStoredToken } from '../src/api/client.js';

describe('Stage 7: Frontend API Client & Token Management Tests', () => {
  let mockServer;
  let serverPort;
  let mockBaseUrl;

  before(async () => {
    // Start a lightweight local HTTP mock server to test real HTTP request/response handling
    mockServer = http.createServer((req, res) => {
      // Echo authorization header back
      if (req.url === '/api/auth/me') {
        const authHeader = req.headers['authorization'];
        if (authHeader === 'Bearer valid_test_jwt_token') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              data: {
                user: {
                  id: 'usr_123',
                  name: 'Test Customer',
                  email: 'test@hotelpro.com',
                  role: 'customer'
                }
              }
            })
          );
          return;
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: false,
              message: 'Authentication token has expired'
            })
          );
          return;
        }
      }

      if (req.url === '/api/auth/login' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          const parsed = JSON.parse(body);
          if (parsed.email === 'guest@hotelpro.com' && parsed.password === 'ValidPass123!') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                success: true,
                message: 'Login successful',
                data: {
                  token: 'valid_test_jwt_token',
                  user: { id: 'usr_123', name: 'Test Customer', role: 'customer' }
                }
              })
            );
          } else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                success: false,
                message: 'Invalid email or password.'
              })
            );
          }
        });
        return;
      }

      if (req.url === '/api/auth/register' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          const parsed = JSON.parse(body);
          if (parsed.email === 'duplicate@hotelpro.com') {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                success: false,
                message: 'A user with that email address already exists.'
              })
            );
            return;
          }

          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              message: 'Customer account registered successfully',
              data: {
                user: { id: 'usr_new', name: parsed.name, email: parsed.email, role: 'customer' }
              }
            })
          );
        });
        return;
      }

      if (req.url === '/api/test/slow') {
        // Hang connection to test client-side AbortController timeout
        return;
      }

      if (req.url === '/api/test/empty') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.url === '/api/test/html') {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<html><body>Internal Server Error</body></html>');
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

  test('1. apiClient sends JSON body and parses JSON responses correctly', async () => {
    const res = await apiClient.post(`${mockBaseUrl}/auth/login`, {
      email: 'guest@hotelpro.com',
      password: 'ValidPass123!'
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.message, 'Login successful');
    assert.strictEqual(res.data.token, 'valid_test_jwt_token');
    assert.strictEqual(res.data.user.role, 'customer');
  });

  test('2. apiClient attaches Bearer token header when token is provided', async () => {
    const res = await apiClient.get(`${mockBaseUrl}/auth/me`, {
      token: 'valid_test_jwt_token'
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data.user.name, 'Test Customer');
  });

  test('3. apiClient throws ApiError on 401 with preserved backend message', async () => {
    await assert.rejects(
      async () => {
        await apiClient.get(`${mockBaseUrl}/auth/me`, {
          token: 'expired_invalid_token'
        });
      },
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.strictEqual(err.status, 401);
        assert.strictEqual(err.message, 'Authentication token has expired');
        return true;
      }
    );
  });

  test('4. apiClient handles 409 Conflict with duplicate email message', async () => {
    await assert.rejects(
      async () => {
        await apiClient.post(`${mockBaseUrl}/auth/register`, {
          name: 'Jane',
          email: 'duplicate@hotelpro.com',
          password: 'Password123!'
        });
      },
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.strictEqual(err.status, 409);
        assert.match(err.message, /already exists/i);
        return true;
      }
    );
  });

  test('5. apiClient handles empty 204 response without crashing', async () => {
    const res = await apiClient.get(`${mockBaseUrl}/test/empty`);
    assert.strictEqual(res, null);
  });

  test('6. apiClient handles non-JSON error response safely without crashing', async () => {
    await assert.rejects(
      async () => {
        await apiClient.get(`${mockBaseUrl}/test/html`);
      },
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.strictEqual(err.status, 500);
        assert.ok(err.message.includes('Internal Server Error'));
        return true;
      }
    );
  });

  test('7. apiClient timeout triggers readable 408 error via AbortController', async () => {
    await assert.rejects(
      async () => {
        await apiClient.get(`${mockBaseUrl}/test/slow`, {
          timeout: 10 // 10ms timeout
        });
      },
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.ok([0, 408].includes(err.status));
        assert.ok(err.message.includes('timed out') || err.message.includes('connect'));
        return true;
      }
    );
  });

  test('8. token storage helpers handle missing or unavailable localStorage gracefully', () => {
    // In Node.js environment without window.localStorage, storage helpers fall back gracefully
    assert.strictEqual(getStoredToken(), null);
    // Setting and removing does not throw
    assert.doesNotThrow(() => setStoredToken('test_token'));
    assert.doesNotThrow(() => removeStoredToken());
  });
});
