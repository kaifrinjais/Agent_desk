import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import session from 'express-session';
import pino from 'pino';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db/connection.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { seedDemoData } from '../src/db/seed.js';

const origin = 'http://127.0.0.1:5173';
const password = 'a-long-demo-password';
let database;
let app;
let websiteProjectId;
let portalProjectId;

before(async () => {
  database = await openDatabase(':memory:');
  await migrateDatabase(database);
  await seedDemoData(database, password);
  app = createApp({
    database,
    sessionStore: new session.MemoryStore(),
    logger: pino({ level: 'silent' }),
  });
  websiteProjectId = (await database.get("SELECT id FROM projects WHERE name = 'Website Refresh';")).id;
  portalProjectId = (await database.get("SELECT id FROM projects WHERE name = 'Partner Portal';")).id;
});

after(async () => {
  if (database) await database.close();
});

async function authenticate(email, changeTemporaryPassword = false) {
  const agent = request.agent(app);
  const csrf = await agent.get('/api/auth/csrf');
  const login = await agent.post('/api/auth/login')
    .set('Origin', origin)
    .set('X-CSRF-Token', csrf.body.data.csrfToken)
    .send({ email, password });
  assert.equal(login.status, 200);

  let csrfToken = login.body.data.csrfToken;
  if (changeTemporaryPassword && login.body.data.user.mustChangePassword) {
    const changed = await agent.post('/api/auth/change-password')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrfToken)
      .send({ currentPassword: password, newPassword: 'a-new-safe-password' });
    assert.equal(changed.status, 200);
    csrfToken = changed.body.data.csrfToken;
  }
  return { agent, csrfToken };
}

test('manager can read projects across client organizations', async () => {
  const { agent } = await authenticate('manager@agencydesk.test');

  assert.equal((await agent.get(`/api/projects/${websiteProjectId}`)).status, 200);
  assert.equal((await agent.get(`/api/projects/${portalProjectId}`)).status, 200);
});

test('developer reads assigned project only, even when another project ID is substituted', async () => {
  const { agent } = await authenticate('developer@agencydesk.test');

  assert.equal((await agent.get(`/api/projects/${websiteProjectId}`)).status, 200);
  const unrelated = await agent.get(`/api/projects/${portalProjectId}`);
  assert.equal(unrelated.status, 404);
  assert.equal(unrelated.body.error.code, 'NOT_FOUND');
});

test('client can read own organization project but cannot substitute another client project ID', async () => {
  const { agent } = await authenticate('client@northstar.test', true);

  assert.equal((await agent.get(`/api/projects/${websiteProjectId}`)).status, 200);
  const otherOrganization = await agent.get(`/api/projects/${portalProjectId}?role=manager&clientId=2`);
  assert.equal(otherOrganization.status, 404);
  assert.equal(otherOrganization.body.error.code, 'NOT_FOUND');
});

test('second client sees only its own organization project', async () => {
  const { agent } = await authenticate('client@fieldnotes.test', true);

  assert.equal((await agent.get(`/api/projects/${portalProjectId}`)).status, 200);
  assert.equal((await agent.get(`/api/projects/${websiteProjectId}`)).status, 404);
});

test('project access requires an authenticated session and malformed IDs disclose no records', async () => {
  assert.equal((await request(app).get(`/api/projects/${websiteProjectId}`)).status, 401);
  const { agent } = await authenticate('manager@agencydesk.test');
  assert.equal((await agent.get('/api/projects/not-an-id')).status, 404);
});