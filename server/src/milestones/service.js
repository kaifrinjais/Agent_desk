import { ensureProjectOpen, getProjectForUser } from '../projects/service.js';
import { inTransaction, recordActivity, conflict } from '../utils/database.js';
import { AppError, notFound } from '../utils/http.js';

const managerTransitions = {
  not_started: new Set(['in_progress', 'blocked']),
  in_progress: new Set(['blocked', 'completed']),
  blocked: new Set(['in_progress']),
  completed: new Set(),
};
const developerTransitions = {
  not_started: new Set(['in_progress']),
  in_progress: new Set(['blocked']),
  blocked: new Set(['in_progress']),
  completed: new Set(),
};

export async function getMilestoneForUser(database, milestoneId, user) {
  const milestone = await database.get(
    `SELECT m.id, m.project_id AS projectId, m.title, m.description, m.position,
            m.start_date AS startDate, m.due_date AS dueDate, m.status,
            m.created_at AS createdAt, m.updated_at AS updatedAt
     FROM milestones m WHERE m.id = ?;`,
    milestoneId,
  );
  if (!milestone) throw notFound();
  milestone.project = await getProjectForUser(database, milestone.projectId, user);
  return milestone;
}

export async function createMilestone(database, projectId, input, actorId) {
  await ensureProjectOpen(database, projectId);
  return inTransaction(database, async () => {
    const result = await database.run(
      `INSERT INTO milestones (project_id, title, description, position, start_date, due_date)
       VALUES (?, ?, ?, ?, ?, ?);`,
      projectId,
      input.title,
      input.description,
      input.position,
      input.startDate,
      input.dueDate,
    );
    await recordActivity(database, {
      actorUserId: actorId,
      projectId,
      entityType: 'milestone',
      entityId: result.lastID,
      action: 'milestone.created',
      metadata: { title: input.title, position: input.position },
    });
    return result.lastID;
  });
}

export async function updateMilestone(database, milestone, input, user) {
  const { project } = milestone;
  await ensureProjectOpen(database, project.id);
  if (milestone.status === 'completed') throw conflict('Completed milestones cannot be edited.');
  const fields = Object.keys(input);
  if (user.role === 'developer' && fields.some((field) => field !== 'status')) {
    throw new AppError(403, 'FORBIDDEN', 'Developers may update milestone progress only.');
  }

  if (input.status && input.status !== milestone.status) {
    const transitions = user.role === 'manager' ? managerTransitions : developerTransitions;
    if (!transitions[milestone.status]?.has(input.status)) {
      throw conflict(`Milestone cannot move from ${milestone.status} to ${input.status}.`);
    }
    if (input.status === 'completed') {
      const { incomplete } = await database.get(
        `SELECT COUNT(*) AS incomplete FROM deliverables
         WHERE milestone_id = ? AND status <> 'approved';`,
        milestone.id,
      );
      if (incomplete > 0) throw conflict('All milestone deliverables must be approved before completion.');
    }
  }

  const columns = { startDate: 'start_date', dueDate: 'due_date' };
  const setters = fields.map((field) => `${columns[field] ?? field} = ?`);
  const values = fields.map((field) => input[field]);
  await inTransaction(database, async () => {
    await database.run(
      `UPDATE milestones SET ${setters.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?;`,
      ...values,
      milestone.id,
    );
    await recordActivity(database, {
      actorUserId: user.id,
      projectId: project.id,
      entityType: 'milestone',
      entityId: milestone.id,
      action: 'milestone.updated',
      metadata: { fields },
    });
  });
}