import { ensureProjectOpen } from '../projects/service.js';
import { getMilestoneForUser } from '../milestones/service.js';
import { inTransaction, recordActivity, conflict } from '../utils/database.js';
import { AppError, notFound } from '../utils/http.js';

export async function getDeliverableForUser(database, deliverableId, user) {
  const deliverable = await database.get(
    `SELECT d.id, d.milestone_id AS milestoneId, d.title, d.description, d.status,
            d.created_by AS createdBy, d.created_at AS createdAt, d.updated_at AS updatedAt,
            m.project_id AS projectId
     FROM deliverables d JOIN milestones m ON m.id = d.milestone_id WHERE d.id = ?;`,
    deliverableId,
  );
  if (!deliverable) throw notFound();
  deliverable.milestone = await getMilestoneForUser(database, deliverable.milestoneId, user);
  deliverable.project = deliverable.milestone.project;
  return deliverable;
}

export async function createDeliverable(database, milestone, input, actorId) {
  await ensureProjectOpen(database, milestone.projectId);
  if (milestone.status === 'completed') throw conflict('Completed milestones cannot receive new deliverables.');
  return inTransaction(database, async () => {
    const result = await database.run(
      `INSERT INTO deliverables (milestone_id, title, description, created_by)
       VALUES (?, ?, ?, ?);`,
      milestone.id,
      input.title,
      input.description,
      actorId,
    );
    await recordActivity(database, {
      actorUserId: actorId,
      projectId: milestone.projectId,
      entityType: 'deliverable',
      entityId: result.lastID,
      action: 'deliverable.created',
      metadata: { title: input.title },
    });
    return result.lastID;
  });
}

export async function submitDeliverable(database, deliverable, input, actorId) {
  await ensureProjectOpen(database, deliverable.project.id);
  if (deliverable.milestone.status === 'completed') throw conflict('Completed milestones cannot receive submissions.');
  if (!['draft', 'revision_requested'].includes(deliverable.status)) {
    throw conflict('Only draft or revision-requested deliverables can be submitted.');
  }

  return inTransaction(database, async () => {
    const { versionNumber } = await database.get(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS versionNumber
       FROM deliverable_submissions WHERE deliverable_id = ?;`,
      deliverable.id,
    );
    const submission = await database.run(
      `INSERT INTO deliverable_submissions
        (deliverable_id, version_number, url, notes, submitted_by)
       VALUES (?, ?, ?, ?, ?);`,
      deliverable.id,
      versionNumber,
      input.url,
      input.notes,
      actorId,
    );
    await database.run(
      `UPDATE deliverables SET status = 'submitted',
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?;`,
      deliverable.id,
    );
    await recordActivity(database, {
      actorUserId: actorId,
      projectId: deliverable.project.id,
      entityType: 'deliverable',
      entityId: deliverable.id,
      action: 'deliverable.submitted',
      metadata: { submissionId: submission.lastID, versionNumber },
    });
    return { id: submission.lastID, versionNumber };
  });
}

export async function reviewSubmission(database, submissionId, input, reviewer) {
  const row = await database.get(
    `SELECT ds.id AS submissionId, ds.version_number AS versionNumber,
            d.id AS deliverableId, d.status AS deliverableStatus,
            d.milestone_id AS milestoneId, p.id AS projectId, p.client_id AS clientId,
            c.is_active AS clientIsActive
     FROM deliverable_submissions ds
     JOIN deliverables d ON d.id = ds.deliverable_id
     JOIN milestones m ON m.id = d.milestone_id
     JOIN projects p ON p.id = m.project_id
     JOIN clients c ON c.id = p.client_id
     WHERE ds.id = ?;`,
    submissionId,
  );
  if (!row || reviewer.role !== 'client' || row.clientId !== reviewer.clientId || row.clientIsActive !== 1) {
    throw notFound();
  }
  await ensureProjectOpen(database, row.projectId);
  if (row.deliverableStatus !== 'submitted') throw conflict('Only a submitted deliverable can be reviewed.');
  const current = await database.get(
    `SELECT id FROM deliverable_submissions WHERE deliverable_id = ?
     ORDER BY version_number DESC LIMIT 1;`,
    row.deliverableId,
  );
  if (current.id !== submissionId) throw conflict('Only the current submission version can be reviewed.');

  return inTransaction(database, async () => {
    await database.run(
      `INSERT INTO deliverable_reviews (submission_id, reviewer_id, decision, feedback)
       VALUES (?, ?, ?, ?);`,
      submissionId,
      reviewer.id,
      input.decision,
      input.feedback,
    );
    await database.run(
      `UPDATE deliverables SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?;`,
      input.decision,
      row.deliverableId,
    );
    await recordActivity(database, {
      actorUserId: reviewer.id,
      projectId: row.projectId,
      entityType: 'deliverable',
      entityId: row.deliverableId,
      action: input.decision === 'approved' ? 'deliverable.approved' : 'deliverable.revision_requested',
      metadata: { submissionId, versionNumber: row.versionNumber },
    });
    return { deliverableId: row.deliverableId, projectId: row.projectId };
  });
}

export async function addComment(database, deliverable, body, user) {
  await ensureProjectOpen(database, deliverable.project.id);
  if (deliverable.milestone.status === 'completed') throw conflict('Completed milestones cannot receive comments.');
  return inTransaction(database, async () => {
    const result = await database.run(
      'INSERT INTO comments (deliverable_id, author_id, body) VALUES (?, ?, ?);',
      deliverable.id,
      user.id,
      body,
    );
    await recordActivity(database, {
      actorUserId: user.id,
      projectId: deliverable.project.id,
      entityType: 'comment',
      entityId: result.lastID,
      action: 'comment.added',
      metadata: { deliverableId: deliverable.id },
    });
    return result.lastID;
  });
}

export function assertCanWorkOnProject(user, project) {
  if (user.role === 'manager') return;
  if (user.role === 'developer' && project) return;
  throw new AppError(403, 'FORBIDDEN', 'You do not have permission to submit deliverables.');
}