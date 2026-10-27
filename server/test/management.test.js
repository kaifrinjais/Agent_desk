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
let managerId;
let clientOneId;
let clientTwoId;
let developerOneId;
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
    loginLimit: 100,
  });
  managerId = (await database.get("SELECT id FROM users WHERE email = 'manager@agencydesk.test';")).id;
  clientOneId = (await database.get("SELECT client_id AS id FROM users WHERE email = 'client@northstar.test';")).id;
  clientTwoId = (await database.get("SELECT client_id AS id FROM users WHERE email = 'client@fieldnotes.test';")).id;
  developerOneId = (await database.get("SELECT id FROM users WHERE email = 'developer@agencydesk.test';")).id;
  websiteProjectId = (await database.get("SELECT id FROM projects WHERE name = 'Website Refresh';")).id;
  portalProjectId = (await database.get("SELECT id FROM projects WHERE name = 'Partner Portal';")).id;
});

after(async () => {
  if (database) await database.close();
});

async function signIn(email, changeTemporaryPassword = false) {
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

function mutation(agent, csrfToken, path, body) {
  return agent.post(path)
    .set('Origin', origin)
    .set('X-CSRF-Token', csrfToken)
    .send(body);
}

test('manager can create a client and temporary client user without exposing password data', async () => {
  const { agent, csrfToken } = await signIn('manager@agencydesk.test');
  const clientResponse = await mutation(agent, csrfToken, '/api/clients', {
    name: 'Cedar Works', contactEmail: 'contact@cedar.example', description: 'New client account.',
  });
  assert.equal(clientResponse.status, 201);
  assert.equal(clientResponse.body.data.client.name, 'Cedar Works');
  const clientId = clientResponse.body.data.client.id;

  const userResponse = await mutation(agent, csrfToken, `/api/clients/${clientId}/users`, {
    fullName: 'Cedar Client', email: 'cedar.client@example.test', temporaryPassword: 'temporary-cedar-pass',
    role: 'manager', clientId: clientTwoId,
  });
  assert.equal(userResponse.status, 201);
  assert.equal(userResponse.body.data.user.role, 'client');
  assert.equal(userResponse.body.data.user.clientId, clientId);
  assert.equal(userResponse.body.data.user.mustChangePassword, true);
  assert.equal(JSON.stringify(userResponse.body).includes('password_hash'), false);

  const stored = await database.get('SELECT password_hash, must_change_password FROM users WHERE id = ?;', userResponse.body.data.user.id);
  assert.match(stored.password_hash, /^\$2[aby]\$/);
  assert.equal(stored.must_change_password, 1);
  assert.ok((await database.get(
    `SELECT id FROM activity_logs WHERE entity_type = 'client' AND entity_id = ? AND action = 'client.created';`,
    clientId,
  )));
});

test('non-manager cannot list or create client organizations or projects', async () => {
  const { agent, csrfToken } = await signIn('developer@agencydesk.test');
  assert.equal((await agent.get('/api/clients')).status, 403);
  assert.equal((await mutation(agent, csrfToken, '/api/clients', { name: 'Forbidden Client' })).status, 403);
  assert.equal((await mutation(agent, csrfToken, '/api/projects', {
    clientId: clientOneId, name: 'Forbidden project', projectManagerId: managerId,
  })).status, 403);
});

test('manager creates projects with validated dates and cannot complete unfinished work', async () => {
  const { agent, csrfToken } = await signIn('manager@agencydesk.test');
  const invalidDate = await mutation(agent, csrfToken, '/api/projects', {
    clientId: clientOneId, name: 'Invalid Dates', projectManagerId: managerId,
    startDate: '2026-12-10', dueDate: '2026-12-01',
  });
  assert.equal(invalidDate.status, 400);
  assert.equal(invalidDate.body.error.code, 'VALIDATION_ERROR');

  const invalidManager = await mutation(agent, csrfToken, '/api/projects', {
    clientId: clientOneId, name: 'Invalid Manager', projectManagerId: developerOneId,
  });
  assert.equal(invalidManager.status, 409);

  const created = await mutation(agent, csrfToken, '/api/projects', {
    clientId: clientOneId,
    name: 'New Client Launch',
    description: 'Project created in the management test.',
    projectManagerId: managerId,
    startDate: '2026-11-01',
    dueDate: '2026-12-01',
    clientIdOverride: clientTwoId,
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.project.clientId, clientOneId);

  const incomplete = await agent.patch(`/api/projects/${websiteProjectId}`)
    .set('Origin', origin)
    .set('X-CSRF-Token', csrfToken)
    .send({ status: 'completed' });
  assert.equal(incomplete.status, 409);
});

test('manager updates allowed project fields but cannot reassign project client ownership', async () => {
  const { agent, csrfToken } = await signIn('manager@agencydesk.test');
  const response = await agent.patch(`/api/projects/${websiteProjectId}`)
    .set('Origin', origin)
    .set('X-CSRF-Token', csrfToken)
    .send({ name: 'Website Refresh Renamed', clientId: clientTwoId, createdBy: developerOneId });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.project.name, 'Website Refresh Renamed');
  assert.equal(response.body.data.project.clientId, clientOneId);
});

test('manager assignments are developer-only, unique, and affect developer project visibility', async () => {
  const { agent, csrfToken } = await signIn('manager@agencydesk.test');
  const assigned = await mutation(agent, csrfToken, `/api/projects/${portalProjectId}/members`, {
    developerId: developerOneId,
  });
  assert.equal(assigned.status, 201);
  const duplicate = await mutation(agent, csrfToken, `/api/projects/${portalProjectId}/members`, {
    developerId: developerOneId,
  });
  assert.equal(duplicate.status, 409);

  const { agent: developer } = await signIn('developer@agencydesk.test');
  const projects = await developer.get('/api/projects');
  assert.deepEqual(new Set(projects.body.data.projects.map((project) => project.id)),
    new Set([websiteProjectId, portalProjectId]));

  const removed = await agent.delete(`/api/projects/${portalProjectId}/members/${developerOneId}`)
    .set('Origin', origin)
    .set('X-CSRF-Token', csrfToken);
  assert.equal(removed.status, 204);
  const afterRemoval = await developer.get('/api/projects');
  assert.deepEqual(afterRemoval.body.data.projects.map((project) => project.id), [websiteProjectId]);
});

test('client project and client-detail lists remain within the owning organization', async () => {
  const { agent } = await signIn('client@northstar.test', true);
  const ownProjects = await agent.get('/api/projects');
  assert.ok(ownProjects.body.data.projects.length >= 2);
  assert.ok(ownProjects.body.data.projects.every((project) => project.clientId === clientOneId));
  assert.equal((await agent.get(`/api/clients/${clientOneId}`)).status, 200);
  assert.equal((await agent.get(`/api/clients/${clientTwoId}`)).status, 404);

  const { agent: manager, csrfToken } = await signIn('manager@agencydesk.test');
  const deactivated = await manager.patch(`/api/clients/${clientOneId}`)
    .set('Origin', origin)
    .set('X-CSRF-Token', csrfToken)
    .send({ isActive: false });
  assert.equal(deactivated.status, 200);
  assert.equal((await agent.get(`/api/clients/${clientOneId}`)).status, 404);
  assert.deepEqual((await agent.get('/api/projects')).body.data.projects, []);
  assert.equal((await manager.patch(`/api/clients/${clientOneId}`)
    .set('Origin', origin)
    .set('X-CSRF-Token', csrfToken)
    .send({ isActive: true })).status, 200);
});