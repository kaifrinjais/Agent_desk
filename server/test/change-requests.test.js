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
let websiteProjectId;
let portalProjectId;
const changedPasswords = new Map();

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
  websiteProjectId = (await database.get("SELECT id FROM projects WHERE name = 'Website Refresh';")).id;
  portalProjectId = (await database.get("SELECT id FROM projects WHERE name = 'Partner Portal';")).id;
});

after(async () => {
  if (database) await database.close();
});

async function signIn(email, changeTemporaryPassword = false) {
  const agent = request.agent(app);
  const csrf = await agent.get('/api/auth/csrf');
  const currentPassword = changedPasswords.get(email) ?? password;
  const login = await agent.post('/api/auth/login')
    .set('Origin', origin)
    .set('X-CSRF-Token', csrf.body.data.csrfToken)
    .send({ email, password: currentPassword });
  assert.equal(login.status, 200);
  let csrfToken = login.body.data.csrfToken;
  if (changeTemporaryPassword && login.body.data.user.mustChangePassword) {
    const newPassword = `${email.split('@')[0]}-changed-password`;
    const changed = await agent.post('/api/auth/change-password')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrfToken)
      .send({ currentPassword, newPassword });
    assert.equal(changed.status, 200);
    changedPasswords.set(email, newPassword);
    csrfToken = changed.body.data.csrfToken;
  }
  return { agent, csrfToken };
}

function mutate(agent, csrfToken, path, body) {
  return agent.post(path)
    .set('Origin', origin)
    .set('X-CSRF-Token', csrfToken)
    .send(body);
}

function decide(agent, csrfToken, requestId, body) {
  return agent.patch(`/api/change-requests/${requestId}/decision`)
    .set('Origin', origin)
    .set('X-CSRF-Token', csrfToken)
    .send(body);
}

test('client can submit only its project change request and attribution comes from session', async () => {
  const { agent, csrfToken } = await signIn('client@northstar.test', true);
  const response = await mutate(agent, csrfToken, `/api/projects/${websiteProjectId}/change-requests`, {
    title: 'Add a resource center',
    description: 'Please add a searchable resource center.',
    estimatedExtraDays: 5,
    requestedBy: managerId,
    status: 'approved',
    decisionBy: managerId,
  });
  assert.equal(response.status, 201);
  const changeRequest = response.body.data.changeRequest;
  assert.equal(changeRequest.status, 'submitted');
  assert.equal(changeRequest.requestedBy, 4);
  assert.equal(changeRequest.decisionBy, null);
  assert.equal(changeRequest.estimatedExtraDays, 5);

  const crossClient = await mutate(agent, csrfToken, `/api/projects/${portalProjectId}/change-requests`, {
    title: 'Cross-client request', description: 'Must not be accepted.',
  });
  assert.equal(crossClient.status, 404);

  const stored = await database.get('SELECT requested_by, decision_by, status FROM change_requests WHERE id = ?;', changeRequest.id);
  assert.equal(stored.requested_by, changeRequest.requestedBy);
  assert.equal(stored.decision_by, null);
  assert.equal(stored.status, 'submitted');
});

test('only managers can move requests through review and make final decisions with notes', async () => {
  const client = await signIn('client@northstar.test', true);
  const created = await mutate(client.agent, client.csrfToken, `/api/projects/${websiteProjectId}/change-requests`, {
    title: 'Add a resource filter', description: 'A new filter is needed.',
  });
  const requestId = created.body.data.changeRequest.id;

  const clientDecision = await decide(client.agent, client.csrfToken, requestId, {
    status: 'approved', decisionNotes: 'Client cannot approve its own request.',
  });
  assert.equal(clientDecision.status, 403);

  const manager = await signIn('manager@agencydesk.test');
  const missingNotes = await decide(manager.agent, manager.csrfToken, requestId, {
    status: 'approved',
  });
  assert.equal(missingNotes.status, 400);

  const started = await decide(manager.agent, manager.csrfToken, requestId, {
    status: 'under_review',
  });
  assert.equal(started.status, 200);
  assert.equal(started.body.data.changeRequest.status, 'under_review');

  const decided = await decide(manager.agent, manager.csrfToken, requestId, {
    status: 'approved', decisionNotes: 'Approved for a later planning iteration.',
  });
  assert.equal(decided.status, 200);
  assert.equal(decided.body.data.changeRequest.status, 'approved');
  assert.equal(decided.body.data.changeRequest.decisionBy, managerId);
  assert.equal(decided.body.data.changeRequest.decisionNotes, 'Approved for a later planning iteration.');
  assert.ok(decided.body.data.changeRequest.decidedAt);

  const terminal = await decide(manager.agent, manager.csrfToken, requestId, {
    status: 'rejected', decisionNotes: 'It was already approved.',
  });
  assert.equal(terminal.status, 409);

  const stored = await database.get(
    'SELECT decision_by, decision_notes, decided_at FROM change_requests WHERE id = ?;', requestId,
  );
  assert.equal(stored.decision_by, managerId);
  assert.equal(stored.decision_notes, 'Approved for a later planning iteration.');
  assert.ok(stored.decided_at);
});

test('rejected and withdrawn request transitions remain distinct and terminal', async () => {
  const client = await signIn('client@northstar.test', true);
  const rejectedRequest = await mutate(client.agent, client.csrfToken, `/api/projects/${websiteProjectId}/change-requests`, {
    title: 'Add custom reporting', description: 'Add one more report.',
  });
  const withdrawRequest = await mutate(client.agent, client.csrfToken, `/api/projects/${websiteProjectId}/change-requests`, {
    title: 'Add a newsletter', description: 'Add a newsletter subscription form.',
  });

  const manager = await signIn('manager@agencydesk.test');
  const rejectedId = rejectedRequest.body.data.changeRequest.id;
  await decide(manager.agent, manager.csrfToken, rejectedId, { status: 'under_review' });
  const rejected = await decide(manager.agent, manager.csrfToken, rejectedId, {
    status: 'rejected', decisionNotes: 'Outside the agreed scope.',
  });
  assert.equal(rejected.body.data.changeRequest.status, 'rejected');

  const withdrawId = withdrawRequest.body.data.changeRequest.id;
  const withdrawn = await mutate(client.agent, client.csrfToken, `/api/change-requests/${withdrawId}/withdraw`, {});
  assert.equal(withdrawn.status, 200);
  assert.equal(withdrawn.body.data.changeRequest.status, 'withdrawn');
  assert.equal((await mutate(client.agent, client.csrfToken, `/api/change-requests/${withdrawId}/withdraw`, {})).status, 409);

  const requestList = await client.agent.get(`/api/projects/${websiteProjectId}/change-requests`);
  assert.ok(requestList.body.data.changeRequests.some((item) => item.id === rejectedId && item.status === 'rejected'));
  assert.ok(requestList.body.data.changeRequests.some((item) => item.id === withdrawId && item.status === 'withdrawn'));
});

test('change decisions record activity but do not change project scope or deadlines', async () => {
  const before = await database.get('SELECT due_date AS dueDate FROM projects WHERE id = ?;', websiteProjectId);
  const client = await signIn('client@northstar.test', true);
  const created = await mutate(client.agent, client.csrfToken, `/api/projects/${websiteProjectId}/change-requests`, {
    title: 'New dashboard request', description: 'A request only; no automatic project changes.',
  });
  const manager = await signIn('manager@agencydesk.test');
  const requestId = created.body.data.changeRequest.id;
  const started = await decide(manager.agent, manager.csrfToken, requestId, { status: 'under_review' });
  assert.equal(started.status, 200);
  const decided = await decide(manager.agent, manager.csrfToken, requestId, {
    status: 'approved', decisionNotes: 'Accepted for separate planning.',
  });
  assert.equal(decided.status, 200);

  const after = await database.get('SELECT due_date AS dueDate FROM projects WHERE id = ?;', websiteProjectId);
  assert.equal(after.dueDate, before.dueDate);
  const persistedEvent = await database.get(
    `SELECT id FROM activity_logs WHERE entity_type = 'change_request' AND entity_id = ? AND action = 'change_request.approved';`,
    requestId,
  );
  assert.ok(persistedEvent);
  const activity = await client.agent.get(`/api/projects/${websiteProjectId}/activity?limit=100`);
  assert.ok(activity.body.data.activity.some((event) => (
    event.entityType === 'change_request' && event.entityId === requestId && event.action === 'change_request.approved'
  )));
});

test('project activity is hidden across client organizations and activity limits are bounded', async () => {
  const { agent: client } = await signIn('client@fieldnotes.test', true);
  assert.equal((await client.get(`/api/projects/${websiteProjectId}/activity`)).status, 404);
  const ownActivity = await client.get(`/api/projects/${portalProjectId}/activity?limit=-1`);
  assert.equal(ownActivity.status, 200);
  assert.ok(ownActivity.body.data.activity.length <= 1);
});