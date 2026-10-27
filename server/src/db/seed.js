import bcrypt from 'bcryptjs';
import { config } from '../config/env.js';

async function ensureClient(database, name, contactEmail, description) {
  await database.run(
    `INSERT INTO clients (name, contact_email, description)
     VALUES (?, ?, ?) ON CONFLICT(name) DO NOTHING;`,
    name,
    contactEmail,
    description,
  );
  return database.get('SELECT id FROM clients WHERE name = ?;', name);
}

async function ensureUser(database, user, password) {
  const existing = await database.get('SELECT id FROM users WHERE email = ?;', user.email);
  if (existing) return existing;

  const passwordHash = await bcrypt.hash(password, 12);
  await database.run(
    `INSERT INTO users (full_name, email, password_hash, role, client_id, must_change_password)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO NOTHING;`,
    user.fullName,
    user.email,
    passwordHash,
    user.role,
    user.clientId,
    user.mustChangePassword ? 1 : 0,
  );
  return database.get('SELECT id FROM users WHERE email = ?;', user.email);
}

async function ensureProject(database, project) {
  await database.run(
    `INSERT INTO projects
      (client_id, name, description, status, start_date, due_date, project_manager_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(client_id, name) DO NOTHING;`,
    project.clientId,
    project.name,
    project.description,
    project.status,
    project.startDate,
    project.dueDate,
    project.managerId,
    project.managerId,
  );
  return database.get('SELECT id FROM projects WHERE client_id = ? AND name = ?;', project.clientId, project.name);
}

async function ensureMilestone(database, projectId, title, position, status) {
  await database.run(
    `INSERT INTO milestones (project_id, title, position, status)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id, position) DO NOTHING;`,
    projectId,
    title,
    position,
    status,
  );
  return database.get('SELECT id FROM milestones WHERE project_id = ? AND position = ?;', projectId, position);
}

async function ensureDeliverable(database, milestoneId, title, description, status, createdBy) {
  let deliverable = await database.get(
    'SELECT id FROM deliverables WHERE milestone_id = ? AND title = ?;',
    milestoneId,
    title,
  );
  if (!deliverable) {
    const result = await database.run(
      `INSERT INTO deliverables (milestone_id, title, description, status, created_by)
       VALUES (?, ?, ?, ?, ?);`,
      milestoneId,
      title,
      description,
      status,
      createdBy,
    );
    deliverable = { id: result.lastID };
  }
  return deliverable;
}

async function ensureSubmission(database, deliverableId, version, url, notes, submittedBy) {
  await database.run(
    `INSERT INTO deliverable_submissions
      (deliverable_id, version_number, url, notes, submitted_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(deliverable_id, version_number) DO NOTHING;`,
    deliverableId,
    version,
    url,
    notes,
    submittedBy,
  );
  return database.get(
    'SELECT id FROM deliverable_submissions WHERE deliverable_id = ? AND version_number = ?;',
    deliverableId,
    version,
  );
}

async function ensureActivity(database, projectId, entityType, entityId, action, actorId, metadata) {
  const exists = await database.get(
    `SELECT id FROM activity_logs
     WHERE project_id = ? AND entity_type = ? AND entity_id = ? AND action = ?;`,
    projectId,
    entityType,
    entityId,
    action,
  );
  if (!exists) {
    await database.run(
      `INSERT INTO activity_logs
        (actor_user_id, project_id, entity_type, entity_id, action, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?);`,
      actorId,
      projectId,
      entityType,
      entityId,
      action,
      JSON.stringify(metadata),
    );
  }
}

export async function seedDemoData(database, password = config.SEED_PASSWORD) {
  if (config.NODE_ENV === 'production') {
    throw new Error('Demo seeding is disabled in production.');
  }
  if (
    typeof password !== 'string'
    || password.length < 12
    || Buffer.byteLength(password, 'utf8') > 72
  ) {
    throw new Error('SEED_PASSWORD must be at least 12 characters and no more than 72 UTF-8 bytes.');
  }

  await database.exec('BEGIN IMMEDIATE;');
  try {
    const northstar = await ensureClient(database, 'Northstar Labs', 'ops@northstar.test', 'Demo client organization');
    const fieldnotes = await ensureClient(database, 'Fieldnotes Co.', 'team@fieldnotes.test', 'Second demo client organization');
    const manager = await ensureUser(database, {
      fullName: 'Morgan Manager', email: 'manager@agencydesk.test', role: 'manager', clientId: null,
    }, password);
    const developerOne = await ensureUser(database, {
      fullName: 'Devon Developer', email: 'developer@agencydesk.test', role: 'developer', clientId: null,
    }, password);
    const developerTwo = await ensureUser(database, {
      fullName: 'Riley Engineer', email: 'riley@agencydesk.test', role: 'developer', clientId: null,
    }, password);
    const clientOne = await ensureUser(database, {
      fullName: 'Casey Client', email: 'client@northstar.test', role: 'client', clientId: northstar.id,
      mustChangePassword: true,
    }, password);
    await ensureUser(database, {
      fullName: 'Jordan Client', email: 'client@fieldnotes.test', role: 'client', clientId: fieldnotes.id,
      mustChangePassword: true,
    }, password);

    const website = await ensureProject(database, {
      clientId: northstar.id, name: 'Website Refresh', description: 'Demo project for client review.',
      status: 'in_progress', startDate: '2026-09-01', dueDate: '2026-12-15', managerId: manager.id,
    });
    const research = await ensureProject(database, {
      clientId: northstar.id, name: 'Product Research', description: 'Planning-stage demo project.',
      status: 'planning', startDate: '2026-11-01', dueDate: '2027-01-30', managerId: manager.id,
    });
    const portal = await ensureProject(database, {
      clientId: fieldnotes.id, name: 'Partner Portal', description: 'Second organization demo project.',
      status: 'in_progress', startDate: '2026-08-15', dueDate: '2026-12-20', managerId: manager.id,
    });

    for (const [projectId, developerId] of [[website.id, developerOne.id], [portal.id, developerTwo.id]]) {
      await database.run(
        `INSERT INTO project_members (project_id, user_id, assigned_by)
         VALUES (?, ?, ?) ON CONFLICT(project_id, user_id) DO NOTHING;`,
        projectId,
        developerId,
        manager.id,
      );
    }

    const design = await ensureMilestone(database, website.id, 'Design review', 1, 'in_progress');
    const build = await ensureMilestone(database, website.id, 'Implementation', 2, 'not_started');
    await ensureMilestone(database, research.id, 'Discovery', 1, 'not_started');
    const portalMilestone = await ensureMilestone(database, portal.id, 'Portal prototype', 1, 'in_progress');

    const approvedDeliverable = await ensureDeliverable(
      database, design.id, 'Approved landing-page concept', 'Approved design concept link.', 'approved', developerOne.id,
    );
    const approvedSubmission = await ensureSubmission(
      database, approvedDeliverable.id, 1, 'https://example.com/northstar-approved', 'Initial concept.', developerOne.id,
    );
    await database.run(
      `INSERT INTO deliverable_reviews (submission_id, reviewer_id, decision, feedback)
       VALUES (?, ?, 'approved', '') ON CONFLICT(submission_id) DO NOTHING;`,
      approvedSubmission.id,
      clientOne.id,
    );

    const pendingDeliverable = await ensureDeliverable(
      database, design.id, 'Navigation prototype', 'Prototype awaiting client review.', 'submitted', developerOne.id,
    );
    await ensureSubmission(
      database, pendingDeliverable.id, 1, 'https://example.com/northstar-navigation', 'Please review navigation.', developerOne.id,
    );

    const revisionDeliverable = await ensureDeliverable(
      database, build.id, 'Mobile layout', 'A version with revision feedback.', 'revision_requested', developerOne.id,
    );
    const revisionSubmission = await ensureSubmission(
      database, revisionDeliverable.id, 1, 'https://example.com/northstar-mobile-v1', 'First mobile layout.', developerOne.id,
    );
    await database.run(
      `INSERT INTO deliverable_reviews (submission_id, reviewer_id, decision, feedback)
       VALUES (?, ?, 'revision_requested', 'Please improve the small-screen menu.')
       ON CONFLICT(submission_id) DO NOTHING;`,
      revisionSubmission.id,
      clientOne.id,
    );

    const portalDeliverable = await ensureDeliverable(
      database, portalMilestone.id, 'Portal homepage', 'Second client sample deliverable.', 'submitted', developerTwo.id,
    );
    await ensureSubmission(
      database, portalDeliverable.id, 1, 'https://example.com/fieldnotes-portal', 'Homepage for review.', developerTwo.id,
    );
    await ensureMilestone(database, research.id, 'Stakeholder interviews', 2, 'not_started');

    await database.run(
      `INSERT INTO comments (deliverable_id, author_id, body)
       SELECT ?, ?, 'Thanks, we are reviewing this version.'
       WHERE NOT EXISTS (SELECT 1 FROM comments WHERE deliverable_id = ? AND body = ?);`,
      pendingDeliverable.id,
      clientOne.id,
      pendingDeliverable.id,
      'Thanks, we are reviewing this version.',
    );

    await database.run(
      `INSERT INTO change_requests (project_id, requested_by, title, description, status, estimated_extra_days)
       SELECT ?, ?, 'Add a resource library', 'Please add a searchable resource library.', 'submitted', 4
       WHERE NOT EXISTS (
         SELECT 1 FROM change_requests WHERE project_id = ? AND title = 'Add a resource library'
       );`,
      website.id,
      clientOne.id,
      website.id,
    );
    const changeRequest = await database.get(
      "SELECT id FROM change_requests WHERE project_id = ? AND title = 'Add a resource library';",
      website.id,
    );

    for (const event of [
      [website.id, 'project', website.id, 'project.created', manager.id, { name: 'Website Refresh' }],
      [website.id, 'deliverable', approvedDeliverable.id, 'deliverable.approved', clientOne.id, { version: 1 }],
      [website.id, 'deliverable', pendingDeliverable.id, 'deliverable.submitted', developerOne.id, { version: 1 }],
      [website.id, 'change_request', changeRequest.id, 'change_request.submitted', clientOne.id, { title: 'Add a resource library' }],
    ]) {
      await ensureActivity(database, ...event);
    }

    await database.exec('COMMIT;');
    return { clients: 2, users: 5, projects: 3, milestones: 5, deliverables: 4 };
  } catch (error) {
    await database.exec('ROLLBACK;');
    throw error;
  }
}