import express from 'express';
import { z } from 'zod';
import { requireAuth, requirePasswordChanged } from '../auth/middleware.js';
import { createMilestone, getMilestoneForUser, updateMilestone } from './service.js';
import { getProjectForUser, ensureProjectOpen } from '../projects/service.js';
import { AppError, notFound, requireValid } from '../utils/http.js';

const dateSchema = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }),
  z.null(),
]);

const createSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(5000).optional().default(''),
  position: z.number().int().min(0),
  startDate: dateSchema.optional().default(null),
  dueDate: dateSchema.optional().default(null),
}).refine((value) => !value.startDate || !value.dueDate || value.startDate <= value.dueDate, {
  path: ['dueDate'], message: 'Due date must be on or after the start date.',
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(5000).optional(),
  position: z.number().int().min(0).optional(),
  startDate: dateSchema.optional(),
  dueDate: dateSchema.optional(),
  status: z.enum(['not_started', 'in_progress', 'blocked', 'completed']).optional(),
}).refine((value) => Object.keys(value).length > 0);

function parseId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw notFound();
  return id;
}

function parseDatePair(input, current) {
  const startDate = input.startDate === undefined ? current?.startDate : input.startDate;
  const dueDate = input.dueDate === undefined ? current?.dueDate : input.dueDate;
  if (startDate && dueDate && startDate > dueDate) {
    throw new AppError(400, 'VALIDATION_ERROR', 'The request contains invalid fields.', [
      { field: 'dueDate', message: 'Due date must be on or after the start date.' },
    ]);
  }
}

export function createMilestoneRouter({ database }) {
  const router = express.Router();
  const readyUser = [requireAuth(database), requirePasswordChanged];

  router.get('/projects/:projectId/milestones', ...readyUser, async (request, response) => {
    const projectId = parseId(request.params.projectId);
    await getProjectForUser(database, projectId, request.authUser);
    const milestones = await database.all(
      `SELECT m.id, m.project_id AS projectId, m.title, m.description, m.position,
              m.start_date AS startDate, m.due_date AS dueDate, m.status,
              COUNT(d.id) AS deliverableCount,
              SUM(CASE WHEN d.status = 'approved' THEN 1 ELSE 0 END) AS approvedDeliverableCount
       FROM milestones m LEFT JOIN deliverables d ON d.milestone_id = m.id
       WHERE m.project_id = ? GROUP BY m.id ORDER BY m.position;`,
      projectId,
    );
    response.json({ data: { milestones } });
  });

  router.post('/projects/:projectId/milestones', ...readyUser, async (request, response) => {
    if (request.authUser.role !== 'manager') {
      throw new AppError(403, 'FORBIDDEN', 'Only managers can create milestones.');
    }
    const projectId = parseId(request.params.projectId);
    await getProjectForUser(database, projectId, request.authUser);
    await ensureProjectOpen(database, projectId);
    const input = requireValid(createSchema, request.body);
    const milestoneId = await createMilestone(database, projectId, input, request.authUser.id);
    const milestone = await getMilestoneForUser(database, milestoneId, request.authUser);
    response.status(201).json({ data: { milestone } });
  });

  router.patch('/milestones/:milestoneId', ...readyUser, async (request, response) => {
    const milestoneId = parseId(request.params.milestoneId);
    const milestone = await getMilestoneForUser(database, milestoneId, request.authUser);
    if (!['manager', 'developer'].includes(request.authUser.role)) {
      throw new AppError(403, 'FORBIDDEN', 'Clients cannot update milestones.');
    }
    const input = requireValid(updateSchema, request.body);
    parseDatePair(input, milestone);
    await updateMilestone(database, milestone, input, request.authUser);
    const updated = await getMilestoneForUser(database, milestoneId, request.authUser);
    response.json({ data: { milestone: updated } });
  });

  return router;
}