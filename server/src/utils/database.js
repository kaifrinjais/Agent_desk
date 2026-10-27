import { AppError } from './http.js';

export async function inTransaction(database, operation) {
  await database.exec('BEGIN IMMEDIATE;');
  try {
    const result = await operation();
    await database.exec('COMMIT;');
    return result;
  } catch (error) {
    await database.exec('ROLLBACK;');
    throw error;
  }
}

export async function recordActivity(database, {
  actorUserId,
  projectId = null,
  entityType,
  entityId,
  action,
  metadata = {},
}) {
  await database.run(
    `INSERT INTO activity_logs
      (actor_user_id, project_id, entity_type, entity_id, action, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?);`,
    actorUserId,
    projectId,
    entityType,
    entityId,
    action,
    JSON.stringify(metadata),
  );
}

export function conflict(message) {
  return new AppError(409, 'CONFLICT', message);
}