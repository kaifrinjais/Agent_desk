import { inTransaction, recordActivity, conflict } from '../utils/database.js';
import { AppError, notFound } from '../utils/http.js';

export const projectStatuses = new Set(['planning', 'in_progress', 'on_hold', 'completed', 'cancelled']);
const projectTransitions = {
  planning: new Set(['in_progress', 'on_hold', 'cancelled']),
  in_progress: new Set(['on_hold', 'completed', 'cancelled']),
  on_hold: new Set(['planning', 'in_progress', 'cancelled']),
  completed: new Set(),
  cancelled: new Set(),
};

export async function getProjectForUser(database, projectId, user) {
  const project = await database.get(
    `SELECT p.id, p.name, p.description, p.status,
            p.start_date AS startDate, p.due_date AS dueDate,
            p.client_id AS clientId, c.name AS clientName,
            p.project_manager_id AS projectManagerId
     FROM projects p
     JOIN clients c ON c.id = p.client_id
     WHERE p.id = ? AND (
       ? = 'manager'
       OR (? = 'developer' AND EXISTS (
         SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?
       ))
       OR (? = 'client' AND p.client_id = ? AND c.is_active = 1)
     );`,
    projectId,
    user.role,
    user.role,
    user.id,
    user.role,
    user.clientId,
  );
  if (!project) throw notFound();
  return project;
}

export async function ensureProjectOpen(database, projectId) {
  const row = await database.get('SELECT status FROM projects WHERE id = ?;', projectId);
  if (!row) throw notFound();
  if (row.status === 'completed' || row.status === 'cancelled') {
    throw conflict('Completed or cancelled projects cannot receive new work.');
  }
  return row;
}

export async function createProject(database, input, actorId) {
  const client = await database.get('SELECT id FROM clients WHERE id = ? AND is_active = 1;', input.clientId);
  if (!client) throw notFound();
  const manager = await database.get(
    `SELECT id FROM users WHERE id = ? AND role = 'manager' AND is_active = 1;`,
    input.projectManagerId,
  );
  if (!manager) throw conflict('The selected project manager is not an active manager.');

  return inTransaction(database, async () => {
    const result = await database.run(
      `INSERT INTO projects
        (client_id, name, description, status, start_date, due_date, project_manager_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      input.clientId,
      input.name,
      input.description,
      input.status,
      input.startDate,
      input.dueDate,
      input.projectManagerId,
      actorId,
    );
    await recordActivity(database, {
      actorUserId: actorId,
      projectId: result.lastID,
      entityType: 'project',
      entityId: result.lastID,
      action: 'project.created',
      metadata: { name: input.name },
    });
    return result.lastID;
  });
}

export async function updateProject(database, projectId, input, actorId) {
  const current = await database.get(
    `SELECT id, status, start_date AS startDate, due_date AS dueDate FROM projects WHERE id = ?;`,
    projectId,
  );
  if (!current) throw notFound();
  const startDate = input.startDate === undefined ? current.startDate : input.startDate;
  const dueDate = input.dueDate === undefined ? current.dueDate : input.dueDate;
  if (startDate && dueDate && startDate > dueDate) {
    throw new AppError(400, 'VALIDATION_ERROR', 'The request contains invalid fields.', [
      { field: 'dueDate', message: 'Due date must be on or after the start date.' },
    ]);
  }
  if (input.status && input.status !== current.status) {
    if (!projectTransitions[current.status]?.has(input.status)) {
      throw conflict(`Project cannot move from ${current.status} to ${input.status}.`);
    }
    if (input.status === 'completed') {
      const { incomplete } = await database.get(
        `SELECT COUNT(*) AS incomplete FROM milestones WHERE project_id = ? AND status <> 'completed';`,
        projectId,
      );
      if (incomplete > 0) throw conflict('All milestones must be complete before completing a project.');
    }
  }

  const fields = Object.keys(input);
  const dbFields = {
    projectManagerId: 'project_manager_id',
    startDate: 'start_date',
    dueDate: 'due_date',
  };
  const setters = fields.map((field) => `${dbFields[field] ?? field} = ?`);
  const values = fields.map((field) => input[field]);

  await inTransaction(database, async () => {
    await database.run(
      `UPDATE projects SET ${setters.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?;`,
      ...values,
      projectId,
    );
    await recordActivity(database, {
      actorUserId: actorId,
      projectId,
      entityType: 'project',
      entityId: projectId,
      action: 'project.updated',
      metadata: { fields },
    });
  });
}

export async function assignDeveloper(database, projectId, developerId, actorId) {
  await ensureProjectOpen(database, projectId);
  const developer = await database.get(
    `SELECT id FROM users WHERE id = ? AND role = 'developer' AND is_active = 1;`,
    developerId,
  );
  if (!developer) throw conflict('The selected user is not an active developer.');
  await inTransaction(database, async () => {
    try {
      await database.run(
        'INSERT INTO project_members (project_id, user_id, assigned_by) VALUES (?, ?, ?);',
        projectId,
        developerId,
        actorId,
      );
    } catch (error) {
      if (error.code?.startsWith('SQLITE_CONSTRAINT')) {
        throw conflict('The developer is already assigned to this project.');
      }
      throw error;
    }
    await recordActivity(database, {
      actorUserId: actorId,
      projectId,
      entityType: 'project_member',
      entityId: developerId,
      action: 'developer.assigned',
      metadata: { developerId },
    });
  });
}

export async function removeDeveloper(database, projectId, developerId, actorId) {
  await ensureProjectOpen(database, projectId);
  await inTransaction(database, async () => {
    const result = await database.run(
      'DELETE FROM project_members WHERE project_id = ? AND user_id = ?;',
      projectId,
      developerId,
    );
    if (!result.changes) throw notFound();
    await recordActivity(database, {
      actorUserId: actorId,
      projectId,
      entityType: 'project_member',
      entityId: developerId,
      action: 'developer.unassigned',
      metadata: { developerId },
    });
  });
}