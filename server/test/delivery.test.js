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
let researchProjectId;
let portalProjectId;
let designMilestoneId;
let buildMilestoneId;
let deliverableId;
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
  websiteProjectId = (await database.get("SELECT id FROM projects WHERE name = 'Website Refresh';")).id;
  researchProjectId = (await database.get("SELECT id FROM projects WHERE name = 'Product Research';")).id;
  portalProjectId = (await database.get("SELECT id FROM projects WHERE name = 'Partner Portal';")).id;
  designMilestoneId = (await database.get(
    "SELECT id FROM milestones WHERE project_id = ? AND title = 'Design review';", websiteProjectId,
  )).id;
  buildMilestoneId = (await database.get(
    "SELECT id FROM milestones WHERE project_id = ? AND title = 'Implementation';", websiteProjectId,
  )).id;
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
    const changed = await agent.post('/api/auth/change-password')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrfToken)
      .send({ currentPassword, newPassword: 'a-new-safe-password' });
    assert.equal(changed.status, 200);
    changedPasswords.set(email, 'a-new-safe-password');
    csrfToken = changed.body.data.csrfToken;
  }
  return { agent, csrfToken };
}

function send(agent, csrfToken, method, path, body) {
  let call = agent[method](path).set('Origin', origin).set('X-CSRF-Token', csrfToken);
  if (body !== undefined) call = call.send(body);
  return call;
}

test('developer progress is limited and milestone completion requires approved deliverables', async () => {
  const { agent, csrfToken } = await signIn('developer@agencydesk.test');
  const progress = await send(agent, csrfToken, 'patch', `/api/milestones/${buildMilestoneId}`, {
    status: 'in_progress',
  });
  assert.equal(progress.status, 200);

  const metadataEdit = await send(agent, csrfToken, 'patch', `/api/milestones/${buildMilestoneId}`, {
    title: 'Developer changed title',
  });
  assert.equal(metadataEdit.status, 403);

  const prematureCompletion = await send(agent, csrfToken, 'patch', `/api/milestones/${designMilestoneId}`, {
    status: 'completed',
  });
  assert.equal(prematureCompletion.status, 409);
});

test('manager can complete an empty milestone after an allowed progress transition', async () => {
  const { agent, csrfToken } = await signIn('manager@agencydesk.test');
  const created = await send(agent, csrfToken, 'post', `/api/projects/${researchProjectId}/milestones`, {
    title: 'Manual handoff', description: 'No deliverables in this milestone.', position: 3,
  });
  assert.equal(created.status, 201);
  const milestoneId = created.body.data.milestone.id;

  assert.equal((await send(agent, csrfToken, 'patch', `/api/milestones/${milestoneId}`, {
    status: 'in_progress',
  })).status, 200);
  const completed = await send(agent, csrfToken, 'patch', `/api/milestones/${milestoneId}`, {
    status: 'completed',
  });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.data.milestone.status, 'completed');
  const completedEdit = await send(agent, csrfToken, 'patch', `/api/milestones/${milestoneId}`, {
    title: 'Cannot edit after completion',
  });
  assert.equal(completedEdit.status, 409);
});

test('deliverable submission supports revision and approval while preserving exact version history', async () => {
  const { agent: developer, csrfToken: developerCsrf } = await signIn('developer@agencydesk.test');
  const created = await send(developer, developerCsrf, 'post', `/api/milestones/${designMilestoneId}/deliverables`, {
    title: 'Pricing page', description: 'Pricing page implementation for review.',
  });
  assert.equal(created.status, 201);
  deliverableId = created.body.data.deliverable.id;

  const invalidUrl = await send(developer, developerCsrf, 'post', `/api/deliverables/${deliverableId}/submissions`, {
    url: 'javascript:alert(1)', notes: 'Invalid scheme.',
  });
  assert.equal(invalidUrl.status, 400);

  const first = await send(developer, developerCsrf, 'post', `/api/deliverables/${deliverableId}/submissions`, {
    url: 'https://example.test/pricing-v1', notes: 'Version one.',
  });
  assert.equal(first.status, 201);
  assert.equal(first.body.data.submission.versionNumber, 1);

  const duplicateSubmit = await send(developer, developerCsrf, 'post', `/api/deliverables/${deliverableId}/submissions`, {
    url: 'https://example.test/pricing-v1b', notes: 'Must not open another review.',
  });
  assert.equal(duplicateSubmit.status, 409);

  const { agent: otherClient, csrfToken: otherClientCsrf } = await signIn('client@fieldnotes.test', true);
  assert.equal((await send(otherClient, otherClientCsrf, 'post', `/api/submissions/${first.body.data.submission.id}/review`, {
    decision: 'approved',
  })).status, 404);

  const { agent: client, csrfToken: clientCsrf } = await signIn('client@northstar.test', true);
  const missingFeedback = await send(client, clientCsrf, 'post', `/api/submissions/${first.body.data.submission.id}/review`, {
    decision: 'revision_requested', feedback: '   ',
  });
  assert.equal(missingFeedback.status, 400);

  const revision = await send(client, clientCsrf, 'post', `/api/submissions/${first.body.data.submission.id}/review`, {
    decision: 'revision_requested', feedback: 'Please adjust the mobile pricing table.',
  });
  assert.equal(revision.status, 200);

  const second = await send(developer, developerCsrf, 'post', `/api/deliverables/${deliverableId}/submissions`, {
    url: 'https://example.test/pricing-v2', notes: 'Updated mobile pricing table.',
  });
  assert.equal(second.status, 201);
  assert.equal(second.body.data.submission.versionNumber, 2);

  const approval = await send(client, clientCsrf, 'post', `/api/submissions/${second.body.data.submission.id}/review`, {
    decision: 'approved',
  });
  assert.equal(approval.status, 200);

  const detail = await client.get(`/api/deliverables/${deliverableId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.deliverable.status, 'approved');
  assert.deepEqual(detail.body.data.submissions.map((submission) => submission.versionNumber), [2, 1]);
  assert.equal(detail.body.data.submissions[1].url, 'https://example.test/pricing-v1');
  assert.equal(detail.body.data.submissions[1].decision, 'revision_requested');
  assert.equal(detail.body.data.submissions[1].feedback, 'Please adjust the mobile pricing table.');
  assert.equal(detail.body.data.submissions[0].decision, 'approved');
  assert.equal(detail.body.data.submissions[0].reviewerId, 4);

  const activity = await client.get(`/api/projects/${websiteProjectId}/activity`);
  assert.equal(activity.status, 200);
  assert.ok(activity.body.data.activity.some((event) => event.action === 'deliverable.approved'));
  assert.ok(activity.body.data.activity.some((event) => event.action === 'deliverable.revision_requested'));
});

test('clients may comment on their project but cannot see deliverables from another organization', async () => {
  const { agent: client, csrfToken } = await signIn('client@northstar.test', true);
  const comment = await send(client, csrfToken, 'post', `/api/deliverables/${deliverableId}/comments`, {
    body: 'The approved version looks good.',
  });
  assert.equal(comment.status, 201);
  assert.equal(comment.body.data.comment.authorName, 'Casey Client');

  const { agent: otherClient } = await signIn('client@fieldnotes.test', true);
  assert.equal((await otherClient.get(`/api/deliverables/${deliverableId}`)).status, 404);
  assert.equal((await otherClient.get(`/api/deliverables/${deliverableId}/comments`)).status, 404);
});

test('client review is rejected after the project is cancelled', async () => {
  const { agent: manager, csrfToken: managerCsrf } = await signIn('manager@agencydesk.test');
  const portal = await database.get(
    `SELECT d.id AS deliverableId, ds.id AS submissionId
     FROM deliverables d JOIN milestones m ON m.id = d.milestone_id
     JOIN deliverable_submissions ds ON ds.deliverable_id = d.id
     WHERE m.project_id = ? AND d.status = 'submitted' LIMIT 1;`,
    portalProjectId,
  );
  const cancelled = await send(manager, managerCsrf, 'patch', `/api/projects/${portalProjectId}`, {
    status: 'cancelled',
  });
  assert.equal(cancelled.status, 200);

  const { agent: client, csrfToken } = await signIn('client@fieldnotes.test', true);
  const review = await send(client, csrfToken, 'post', `/api/submissions/${portal.submissionId}/review`, {
    decision: 'approved',
  });
  assert.equal(review.status, 409);
});