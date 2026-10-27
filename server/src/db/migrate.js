import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const migrationsDirectory = fileURLToPath(new URL('./migrations/', import.meta.url));

export async function migrateDatabase(database, directory = migrationsDirectory) {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const names = (await readdir(directory))
    .filter((name) => /^\d{3}_[a-z0-9_-]+\.sql$/.test(name))
    .sort();
  const applied = await database.all('SELECT name, checksum FROM schema_migrations ORDER BY name;');
  const appliedByName = new Map(applied.map((migration) => [migration.name, migration.checksum]));
  const migrationNames = new Set(names);
  const missing = applied.find((migration) => !migrationNames.has(migration.name));
  if (missing) {
    throw new Error(`Applied migration ${missing.name} is missing; restore it instead of changing migration history.`);
  }
  const pending = [];

  for (const name of names) {
    const sql = await readFile(new URL(name, `file://${directory.replaceAll('\\', '/')}/`), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const previousChecksum = appliedByName.get(name);

    if (previousChecksum && previousChecksum !== checksum) {
      throw new Error(`Applied migration ${name} has changed; add a new migration instead.`);
    }
    if (!previousChecksum) pending.push({ name, sql, checksum });
  }

  for (const migration of pending) {
    await database.exec('BEGIN IMMEDIATE;');
    try {
      await database.exec(migration.sql);
      await database.run(
        'INSERT INTO schema_migrations (name, checksum) VALUES (?, ?);',
        migration.name,
        migration.checksum,
      );
      await database.exec('COMMIT;');
    } catch (error) {
      await database.exec('ROLLBACK;');
      throw new Error(`Migration ${migration.name} failed: ${error.message}`, { cause: error });
    }
  }

  return pending.map(({ name }) => name);
}