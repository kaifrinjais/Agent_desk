import assert from 'node:assert/strict';
import test from 'node:test';
import session from 'express-session';
import pino from 'pino';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig, validateServerConfig } from '../src/config/env.js';

const app = createApp({ logger: pino({ level: 'silent' }) });

test('health endpoint returns the API status envelope', async () => {
  const response = await request(app).get('/api/health');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { data: { status: 'ok' } });
});

test('unknown routes return the documented error envelope', async () => {
  const response = await request(app).get('/api/not-a-route');

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, {
    error: {
      code: 'NOT_FOUND',
      message: 'The requested resource was not found.',
    },
  });
});

test('malformed JSON returns a safe client error envelope', async () => {
  const response = await request(app)
    .post('/api/health')
    .set('Content-Type', 'application/json')
    .send('{invalid');

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, {
    error: {
      code: 'INVALID_JSON',
      message: 'The request body must contain valid JSON.',
    },
  });
});

test('oversized JSON returns a safe payload error envelope', async () => {
  const response = await request(app)
    .post('/api/health')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify({ value: 'x'.repeat(101 * 1024) }));

  assert.equal(response.status, 413);
  assert.deepEqual(response.body, {
    error: {
      code: 'PAYLOAD_TOO_LARGE',
      message: 'The request body is too large.',
    },
  });
});

test('runtime configuration rejects invalid ports without echoing values', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'test', PORT: 'not-a-port', LOG_LEVEL: 'silent' }),
    { message: /Invalid environment configuration: PORT/ },
  );
});

test('database commands can load without an HTTP secret but server config requires one', () => {
  const databaseConfig = loadConfig({ NODE_ENV: 'development' });
  assert.equal(databaseConfig.SESSION_SECRET, undefined);
  assert.equal(loadConfig({ NODE_ENV: 'development', SESSION_SECRET: '' }).SESSION_SECRET, undefined);
  assert.throws(
    () => validateServerConfig(databaseConfig),
    { message: /SESSION_SECRET must be set to at least 32 characters/ },
  );
  assert.equal(validateServerConfig(loadConfig({
    NODE_ENV: 'development', SESSION_SECRET: 'a-valid-test-session-secret-with-over-32-chars',
  })).NODE_ENV, 'development');
});

test('security headers are set and Express version is not exposed', async () => {
  const response = await request(app).get('/api/health');

  assert.equal(response.headers['x-powered-by'], undefined);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-frame-options'], 'SAMEORIGIN');
});

test('production session cookies use Secure, HttpOnly, and SameSite=Lax', async () => {
  const secureApp = createApp({
    logger: pino({ level: 'silent' }),
    database: { get: async () => null },
    sessionStore: new session.MemoryStore(),
    secureCookies: true,
  });
  const response = await request(secureApp)
    .get('/api/auth/csrf')
    .set('X-Forwarded-Proto', 'https');
  const cookie = response.headers['set-cookie'].find((value) => value.startsWith('agencydesk.sid='));

  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=Lax/i);
});

test('application rejects an incomplete database/session configuration', () => {
  assert.throws(
    () => createApp({ database: { get: async () => null } }),
    /database and session store must be configured together/,
  );
  assert.throws(
    () => createApp({
      database: { get: async () => null },
      sessionStore: new session.MemoryStore(),
      sessionSecret: '',
    }),
    /session secret is required/,
  );
});