import { getProjectForUser, ensureProjectOpen } from '../projects/service.js';
import { inTransaction, recordActivity, conflict } from '../utils/database.js';
import { AppError, notFound } from '../utils/http.js';

export async function getChangeRequestForUser(database, changeRequestId, user) {
  const changeRequest = await database.get(
    `SELECT cr.id, cr.project_id AS projectId, cr.requested_by AS requestedBy,
            requester.full_name AS requestedByName, cr.title, cr.description, cr.status,
            cr.estimated_extra_days AS estimatedExtraDays,
            cr.decision_by AS decisionBy, decider.full_name AS decisionByName,
            cr.decision_notes AS decisionNotes, cr.decided_at AS decidedAt,
            cr.created_at AS createdAt, cr.updated_at AS updatedAt
     FROM change_requests cr
     JOIN users requester ON requester.id = cr.requested_by
     LEFT JOIN users decider ON decider.id = cr.decision_by
     WHERE cr.id = ?;`,
    changeRequestId,
  );
  if (!changeRequest) throw notFound();
  changeRequest.project = await getProjectForUser(database, changeRequest.projectId, user);
  return changeRequest;
}

export async function createChangeRequest(database, projectId, input, actor) {
  const project = await getProjectForUser(database, projectId, actor);
  await ensureProjectOpen(database, projectId);
  if (actor.role !== 'client' || actor.clientId !== project.clientId) {
    throw new AppError(403, 'FORBIDDEN', 'Only a client user from the owning organization can request a change.');
  }

  return inTransaction(database, async () => {
    const result = await database.run(
      `INSERT INTO change_requests
        (project_id, requested_by, title, description, estimated_extra_days)
       VALUES (?, ?, ?, ?, ?);`,
      projectId,
      actor.id,
      input.title,
      input.description,
      input.estimatedExtraDays,
    );
    await recordActivity(database, {
      actorUserId: actor.id,
      projectId,
      entityType: 'change_request',
      entityId: result.lastID,
      action: 'change_request.submitted',
      metadata: { title: input.title },
    });
    return result.lastID;
  });
}

export async function startChangeRequestReview(database, changeRequest, actor) {
  if (actor.role !== 'manager') throw new AppError(403, 'FORBIDDEN', 'Only managers can review change requests.');
  if (changeRequest.status !== 'submitted') throw conflict('Only submitted change requests can enter review.');

  await inTransaction(database, async () => {
    await database.run(
      `UPDATE change_requests SET status = 'under_review',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?;`,
      changeRequest.id,
    );
    await recordActivity(database, {
      actorUserId: actor.id,
      projectId: changeRequest.projectId,
      entityType: 'change_request',
      entityId: changeRequest.id,
      action: 'change_request.review_started',
      metadata: {},
    });
  });
}

export async function decideChangeRequest(database, changeRequest, input, actor) {
  if (actor.role !== 'manager') throw new AppError(403, 'FORBIDDEN', 'Only managers can decide change requests.');
  if (changeRequest.status !== 'under_review') throw conflict('Only change requests under review can be decided.');

  await inTransaction(database, async () => {
    await database.run(
      `UPDATE change_requests SET status = ?, decision_by = ?, decision_notes = ?,
       decided_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?;`,
      input.decision,
      actor.id,
      input.decisionNotes,
      changeRequest.id,
    );
    await recordActivity(database, {
      actorUserId: actor.id,
      projectId: changeRequest.projectId,
      entityType: 'change_request',
      entityId: changeRequest.id,
      action: `change_request.${input.decision}`,
      metadata: { decisionNotes: input.decisionNotes },
    });
  });
}

export async function withdrawChangeRequest(database, changeRequest, actor) {
  if (actor.role !== 'client' || actor.id !== changeRequest.requestedBy) {
    throw new AppError(403, 'FORBIDDEN', 'Only the requesting client can withdraw this request.');
  }
  if (!['submitted', 'under_review'].includes(changeRequest.status)) {
    throw conflict('Only undecided change requests can be withdrawn.');
  }

  await inTransaction(database, async () => {
    await database.run(
      `UPDATE change_requests SET status = 'withdrawn',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?;`,
      changeRequest.id,
    );
    await recordActivity(database, {
      actorUserId: actor.id,
      projectId: changeRequest.projectId,
      entityType: 'change_request',
      entityId: changeRequest.id,
      action: 'change_request.withdrawn',
      metadata: {},
    });
  });
}