import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';
import session from 'express-session';
import pino from 'pino';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createSqliteSessionStore } from '../src/auth/session-store.js';
import { openDatabase } from '../src/db/connection.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { seedDemoData } from '../src/db/seed.js';

const origin = 'http://127.0.0.1:5173';
const demoPassword = 'a-long-demo-password';
let database;
let app;

before(async () => {
  database = await openDatabase(':memory:');
  await migrateDatabase(database);
  await seedDemoData(database, demoPassword);
  app = createApp({
    database,
    sessionStore: new session.MemoryStore(),
    logger: pino({ level: 'silent' }),
    loginLimit: 100,
  });
});

after(async () => {
  if (database) await database.close();
});

async function startSession(agent = request.agent(app)) {
  const response = await agent.get('/api/auth/csrf');
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  return { agent, csrfToken: response.body.data.csrfToken, cookie: response.headers['set-cookie']?.[0] };
}

async function login(email, password = demoPassword) {
  const sessionState = await startSession();
  const response = await sessionState.agent
    .post('/api/auth/login')
    .set('Origin', origin)
    .set('X-CSRF-Token', sessionState.csrfToken)
    .send({ email, password });
  return { ...sessionState, response, csrfToken: response.body.data?.csrfToken };
}

test('CSRF endpoint creates a session token and mutation rejects missing, invalid, or foreign origin', async () => {
  const { agent, csrfToken } = await startSession();

  const missing = await agent.post('/api/auth/login').set('Origin', origin).send({
    email: 'manager@agencydesk.test', password: demoPassword,
  });
  assert.equal(missing.status, 403);
  assert.equal(missing.body.error.code, 'CSRF_TOKEN_REQUIRED');

  const invalid = await agent.post('/api/auth/login')
    .set('Origin', origin)
    .set('X-CSRF-Token', 'invalid-token')
    .send({ email: 'manager@agencydesk.test', password: demoPassword });
  assert.equal(invalid.status, 403);
  assert.equal(invalid.body.error.code, 'INVALID_CSRF_TOKEN');

  const foreignOrigin = await agent.post('/api/auth/login')
    .set('Origin', 'https://attacker.example')
    .set('X-CSRF-Token', csrfToken)
    .send({ email: 'manager@agencydesk.test', password: demoPassword });
  assert.equal(foreignOrigin.status, 403);
  assert.equal(foreignOrigin.body.error.code, 'INVALID_ORIGIN');
});

test('login uses generic errors, rotates the session, and returns only safe profile fields', async () => {
  const sessionState = await startSession();
  const invalid = await sessionState.agent
    .post('/api/auth/login')
    .set('Origin', origin)
    .set('X-CSRF-Token', sessionState.csrfToken)
    .send({ email: 'nobody@example.test', password: demoPassword });
  assert.equal(invalid.status, 401);
  assert.deepEqual(invalid.body.error, {
    code: 'INVALID_CREDENTIALS',
    message: 'Email or password is incorrect.',
  });

  const loginResponse = await sessionState.agent
    .post('/api/auth/login')
    .set('Origin', origin)
    .set('X-CSRF-Token', sessionState.csrfToken)
    .send({ email: 'manager@agencydesk.test', password: demoPassword });
  assert.equal(loginResponse.status, 200);
  const rotatedCookie = loginResponse.headers['set-cookie'].find((cookie) => cookie.startsWith('agencydesk.sid='));
  assert.ok(rotatedCookie);
  assert.notEqual(rotatedCookie, sessionState.cookie);
  assert.deepEqual(Object.keys(loginResponse.body.data.user).sort(), [
    'clientId', 'email', 'fullName', 'id', 'mustChangePassword', 'role',
  ]);
  assert.equal(loginResponse.body.data.user.role, 'manager');

  const me = await sessionState.agent.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.data.user.email, 'manager@agencydesk.test');

  const oldSession = await request(app).get('/api/auth/me').set('Cookie', sessionState.cookie.split(';')[0]);
  assert.equal(oldSession.status, 401);
});

test('login ignores caller-supplied role and client ownership fields', async () => {
  const { agent, csrfToken } = await startSession();
  const response = await agent.post('/api/auth/login')
    .set('Origin', origin)
    .set('X-CSRF-Token', csrfToken)
    .send({
      email: 'client@northstar.test',
      password: demoPassword,
      role: 'manager',
      clientId: null,
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.user.role, 'client');
  assert.equal(response.body.data.user.clientId, 1);
});

test('inactive account login is denied with the same generic credentials error', async () => {
  const passwordHash = (await database.get(
    'SELECT password_hash FROM users WHERE email = ?;',
    'manager@agencydesk.test',
  )).password_hash;
  await database.run(
    `INSERT INTO users (full_name, email, password_hash, role, is_active)
     VALUES ('Inactive Account', 'inactive@example.test', ?, 'developer', 0);`,
    passwordHash,
  );

  const { agent, csrfToken } = await startSession();
  const response = await agent.post('/api/auth/login')
    .set('Origin', origin)
    .set('X-CSRF-Token', csrfToken)
    .send({ email: 'inactive@example.test', password: demoPassword });

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'INVALID_CREDENTIALS');
});

test('forced password change validates the current password and rotates authentication state', async () => {
  const sessionState = await login('client@northstar.test');
  assert.equal(sessionState.response.status, 200);
  assert.equal(sessionState.response.body.data.user.mustChangePassword, true);

  const project = await sessionState.agent.get('/api/projects/1');
  assert.equal(project.status, 403);
  assert.equal(project.body.error.code, 'PASSWORD_CHANGE_REQUIRED');

  const invalid = await sessionState.agent.post('/api/auth/change-password')
    .set('Origin', origin)
    .set('X-CSRF-Token', sessionState.csrfToken)
    .send({ currentPassword: 'wrong-current-password', newPassword: 'a-new-safe-password' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'CURRENT_PASSWORD_INVALID');

  const changed = await sessionState.agent.post('/api/auth/change-password')
    .set('Origin', origin)
    .set('X-CSRF-Token', sessionState.csrfToken)
    .send({ currentPassword: demoPassword, newPassword: 'a-new-safe-password' });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.data.user.mustChangePassword, false);
  assert.notEqual(changed.body.data.csrfToken, sessionState.csrfToken);
  assert.notEqual(
    changed.headers['set-cookie'].find((cookie) => cookie.startsWith('agencydesk.sid=')),
    sessionState.response.headers['set-cookie'].find((cookie) => cookie.startsWith('agencydesk.sid=')),
  );

  const projectAfterChange = await sessionState.agent.get('/api/projects/1');
  assert.equal(projectAfterChange.status, 200);
});

test('logout invalidates the server-side session', async () => {
  const sessionState = await login('manager@agencydesk.test');
  assert.equal(sessionState.response.status, 200);

  const response = await sessionState.agent.post('/api/auth/logout')
    .set('Origin', origin)
    .set('X-CSRF-Token', sessionState.csrfToken);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, { loggedOut: true });
  assert.equal((await sessionState.agent.get('/api/auth/me')).status, 401);
});

test('login rate limit returns a generic 429 response', async () => {
  const limitedApp = createApp({
    database,
    sessionStore: new session.MemoryStore(),
    logger: pino({ level: 'silent' }),
    loginLimit: 2,
  });
  const agent = request.agent(limitedApp);
  const { csrfToken } = await startSession(agent);
  const attempt = () => agent.post('/api/auth/login')
    .set('Origin', origin)
    .set('X-CSRF-Token', csrfToken)
    .send({ email: 'nobody@example.test', password: 'bad-password' });

  assert.equal((await attempt()).status, 401);
  assert.equal((await attempt()).status, 401);
  const limited = await attempt();
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'RATE_LIMITED');
});

test('SQLite session records survive reopening the session database', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agencydesk-session-'));
  const path = join(directory, 'sessions.sqlite');
  let sessionDatabase = await openDatabase(path);
  let store = await createSqliteSessionStore(sessionDatabase);
  await new Promise((resolve, reject) => store.set('persistent-session', {
    userId: 42,
    csrfToken: 'test-token',
    cookie: { maxAge: 60000, expires: new Date(Date.now() + 60000).toISOString() },
  }, (error) => error ? reject(error) : resolve()));
  await sessionDatabase.close();

  try {
    sessionDatabase = await openDatabase(path);
    store = await createSqliteSessionStore(sessionDatabase);
    const stored = await new Promise((resolve, reject) => store.get('persistent-session', (error, value) => {
      if (error) reject(error);
      else resolve(value);
    }));
    assert.equal(stored.userId, 42);
    assert.equal(stored.csrfToken, 'test-token');
  } finally {
    await sessionDatabase.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('SQLite session store refreshes expiry and deletes expired sessions on read', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agencydesk-session-expiry-'));
  const path = join(directory, 'sessions.sqlite');
  const sessionDatabase = await openDatabase(path);
  try {
    const store = await createSqliteSessionStore(sessionDatabase);
    const initialData = {
      userId: 7,
      cookie: { maxAge: 60000, expires: new Date(Date.now() + 60000).toISOString() },
    };
    await new Promise((resolve, reject) => store.set('refreshable', initialData, (error) => (
      error ? reject(error) : resolve()
    )));
    const before = await sessionDatabase.get('SELECT expires_at FROM sessions WHERE sid = ?;', 'refreshable');
    const renewedData = {
      ...initialData,
      csrfToken: 'rotated-token',
      cookie: { maxAge: 120000, expires: new Date(Date.now() + 120000).toISOString() },
    };
    await new Promise((resolve, reject) => store.touch('refreshable', renewedData, (error) => (
      error ? reject(error) : resolve()
    )));
    const after = await sessionDatabase.get('SELECT sess, expires_at FROM sessions WHERE sid = ?;', 'refreshable');
    assert.ok(after.expires_at > before.expires_at);
    assert.equal(JSON.parse(after.sess).csrfToken, 'rotated-token');

    await sessionDatabase.run('UPDATE sessions SET expires_at = ? WHERE sid = ?;', Date.now() - 1, 'refreshable');
    const expired = await new Promise((resolve, reject) => store.get('refreshable', (error, value) => (
      error ? reject(error) : resolve(value)
    )));
    assert.equal(expired, null);
    assert.equal((await sessionDatabase.get('SELECT COUNT(*) AS count FROM sessions;')).count, 0);
  } finally {
    await sessionDatabase.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('password inputs over bcrypt’s UTF-8 byte limit are rejected', async () => {
  const { agent, csrfToken } = await startSession();
  const response = await agent.post('/api/auth/login')
    .set('Origin', origin)
    .set('X-CSRF-Token', csrfToken)
    .send({ email: 'manager@agencydesk.test', password: '😀'.repeat(19) });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});