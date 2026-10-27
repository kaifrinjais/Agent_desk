import express from 'express';
import { z } from 'zod';
import { requireAuth, requirePasswordChanged } from '../auth/middleware.js';
import { getProjectForUser } from '../projects/service.js';
import { notFound, requireValid, AppError } from '../utils/http.js';
import {
  createChangeRequest,
  decideChangeRequest,
  getChangeRequestForUser,
  startChangeRequestReview,
  withdrawChangeRequest,
} from './service.js';

const createSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(5000),
  estimatedExtraDays: z.number().int().min(0).max(3650).nullable().optional().default(null),
});

const decisionSchema = z.object({
  status: z.enum(['under_review', 'approved', 'rejected']),
  decisionNotes: z.string().trim().max(5000).optional().default(''),
}).refine((value) => value.status === 'under_review' || value.decisionNotes.length > 0, {
  path: ['decisionNotes'], message: 'Decision notes are required for approval or rejection.',
});

function parseId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw notFound();
  return id;
}

export function createChangeRequestRouter({ database }) {
  const router = express.Router();
  const readyUser = [requireAuth(database), requirePasswordChanged];

  router.get('/projects/:projectId/change-requests', ...readyUser, async (request, response) => {
    const projectId = parseId(request.params.projectId);
    await getProjectForUser(database, projectId, request.authUser);
    const changeRequests = await database.all(
      `SELECT cr.id, cr.project_id AS projectId, cr.requested_by AS requestedBy,
              u.full_name AS requestedByName, cr.title, cr.description, cr.status,
              cr.estimated_extra_days AS estimatedExtraDays,
              cr.decision_by AS decisionBy, d.full_name AS decisionByName,
              cr.decision_notes AS decisionNotes, cr.decided_at AS decidedAt,
              cr.created_at AS createdAt, cr.updated_at AS updatedAt
       FROM change_requests cr JOIN users u ON u.id = cr.requested_by
       LEFT JOIN users d ON d.id = cr.decision_by
       WHERE cr.project_id = ? ORDER BY cr.id DESC LIMIT 100;`,
      projectId,
    );
    response.json({ data: { changeRequests } });
  });

  router.post('/projects/:projectId/change-requests', ...readyUser, async (request, response) => {
    const projectId = parseId(request.params.projectId);
    const input = requireValid(createSchema, request.body);
    const id = await createChangeRequest(database, projectId, input, request.authUser);
    const changeRequest = await getChangeRequestForUser(database, id, request.authUser);
    response.status(201).json({ data: { changeRequest } });
  });

  router.get('/change-requests/:changeRequestId', ...readyUser, async (request, response) => {
    const changeRequest = await getChangeRequestForUser(
      database,
      parseId(request.params.changeRequestId),
      request.authUser,
    );
    delete changeRequest.project;
    response.json({ data: { changeRequest } });
  });

  router.patch('/change-requests/:changeRequestId/decision', ...readyUser, async (request, response) => {
    if (request.authUser.role !== 'manager') {
      throw new AppError(403, 'FORBIDDEN', 'Only managers can review change requests.');
    }
    const changeRequest = await getChangeRequestForUser(
      database,
      parseId(request.params.changeRequestId),
      request.authUser,
    );
    const input = requireValid(decisionSchema, request.body);
    if (input.status === 'under_review') {
      await startChangeRequestReview(database, changeRequest, request.authUser);
    } else {
      await decideChangeRequest(database, changeRequest, {
        decision: input.status,
        decisionNotes: input.decisionNotes,
      }, request.authUser);
    }
    const updated = await getChangeRequestForUser(database, changeRequest.id, request.authUser);
    delete updated.project;
    response.json({ data: { changeRequest: updated } });
  });

  router.post('/change-requests/:changeRequestId/withdraw', ...readyUser, async (request, response) => {
    const changeRequest = await getChangeRequestForUser(
      database,
      parseId(request.params.changeRequestId),
      request.authUser,
    );
    await withdrawChangeRequest(database, changeRequest, request.authUser);
    response.json({ data: { changeRequest: { id: changeRequest.id, status: 'withdrawn' } } });
  });

  return router;
}