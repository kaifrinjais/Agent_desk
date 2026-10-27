import express from 'express';
import { z } from 'zod';
import { requireAuth, requirePasswordChanged } from '../auth/middleware.js';
import { requireRole } from '../auth/middleware.js';
import { assignDeveloper, createProject, getProjectForUser, projectStatuses, removeDeveloper, updateProject } from './service.js';
import { AppError, notFound, requireValid } from '../utils/http.js';

const dateSchema = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }),
  z.null(),
]);

const projectCreateSchema = z.object({
  clientId: z.number().int().positive(),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(5000).optional().default(''),
  status: z.literal('planning').default('planning'),
  startDate: dateSchema.optional().default(null),
  dueDate: dateSchema.optional().default(null),
  projectManagerId: z.number().int().positive(),
}).refine((value) => !value.startDate || !value.dueDate || value.startDate <= value.dueDate, {
  path: ['dueDate'], message: 'Due date must be on or after the start date.',
});

const projectUpdateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(5000).optional(),
  status: z.enum([...projectStatuses]).optional(),
  startDate: dateSchema.optional(),
  dueDate: dateSchema.optional(),
  projectManagerId: z.number().int().positive().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one supported project field is required.',
});

const assignmentSchema = z.object({ developerId: z.number().int().positive() });

function parseId(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw notFound();
  return parsed;
}

export function createProjectRouter({ database }) {
  const router = express.Router();
  const authenticate = requireAuth(database);
  const readyUser = [authenticate, requirePasswordChanged];
  const manager = [...readyUser, requireRole('manager')];

  router.get('/', ...readyUser, async (request, response) => {
    const { role, id, clientId } = request.authUser;
    const projects = await database.all(
      `SELECT p.id, p.name, p.description, p.status,
              p.start_date AS startDate, p.due_date AS dueDate,
              p.client_id AS clientId, c.name AS clientName,
              p.project_manager_id AS projectManagerId, p.updated_at AS updatedAt
       FROM projects p JOIN clients c ON c.id = p.client_id
       WHERE (
         ? = 'manager'
         OR (? = 'developer' AND EXISTS (
           SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?
         ))
         OR (? = 'client' AND p.client_id = ? AND c.is_active = 1)
       )
       ORDER BY p.updated_at DESC, p.id DESC LIMIT 100;`,
      role, role, id, role, clientId,
    );
    response.json({ data: { projects } });
  });

  router.post('/', ...manager, async (request, response) => {
    const input = requireValid(projectCreateSchema, request.body);
    const projectId = await createProject(database, input, request.authUser.id);
    const project = await getProjectForUser(database, projectId, request.authUser);
    response.status(201).json({ data: { project } });
  });

  router.get('/developers', ...manager, async (_request, response) => {
    const developers = await database.all(
      `SELECT id, full_name AS fullName, email FROM users
       WHERE role = 'developer' AND is_active = 1
       ORDER BY full_name COLLATE NOCASE LIMIT 100;`,
    );
    response.json({ data: { developers } });
  });

  router.get('/managers', ...manager, async (_request, response) => {
    const managers = await database.all(
      `SELECT id, full_name AS fullName, email FROM users
       WHERE role = 'manager' AND is_active = 1
       ORDER BY full_name COLLATE NOCASE LIMIT 100;`,
    );
    response.json({ data: { managers } });
  });

  router.get('/:projectId/members', ...readyUser, async (request, response) => {
    const projectId = parseId(request.params.projectId);
    await getProjectForUser(database, projectId, request.authUser);
    if (request.authUser.role === 'client') {
      throw new AppError(403, 'FORBIDDEN', 'Project team assignments are not available to clients.');
    }
    const members = await database.all(
      `SELECT u.id, u.full_name AS fullName, u.email, pm.assigned_at AS assignedAt
       FROM project_members pm JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = ? ORDER BY u.full_name COLLATE NOCASE;`,
      projectId,
    );
    response.json({ data: { members } });
  });

  router.post('/:projectId/members', ...manager, async (request, response) => {
    const projectId = parseId(request.params.projectId);
    const { developerId } = requireValid(assignmentSchema, request.body);
    await assignDeveloper(database, projectId, developerId, request.authUser.id);
    response.status(201).json({ data: { projectId, developerId } });
  });

  router.delete('/:projectId/members/:userId', ...manager, async (request, response) => {
    await removeDeveloper(database, parseId(request.params.projectId), parseId(request.params.userId), request.authUser.id);
    response.status(204).end();
  });

  router.get('/:projectId', ...readyUser, async (request, response) => {
    const project = await getProjectForUser(database, parseId(request.params.projectId), request.authUser);
    response.json({ data: { project } });
  });

  router.patch('/:projectId', ...manager, async (request, response) => {
    const projectId = parseId(request.params.projectId);
    const input = requireValid(projectUpdateSchema, request.body);
    if (input.startDate && input.dueDate && input.startDate > input.dueDate) {
      throw new AppError(400, 'VALIDATION_ERROR', 'The request contains invalid fields.', [
        { field: 'dueDate', message: 'Due date must be on or after the start date.' },
      ]);
    }
    if (input.projectManagerId) {
      const projectManager = await database.get(
        `SELECT id FROM users WHERE id = ? AND role = 'manager' AND is_active = 1;`,
        input.projectManagerId,
      );
      if (!projectManager) throw new AppError(409, 'CONFLICT', 'The selected project manager is not an active manager.');
    }
    await updateProject(database, projectId, input, request.authUser.id);
    const project = await getProjectForUser(database, projectId, request.authUser);
    response.json({ data: { project } });
  });

  return router;
}