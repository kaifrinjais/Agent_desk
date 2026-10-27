import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../src/db/connection.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { seedDemoData } from '../src/db/seed.js';

async function createMigratedDatabase() {
  const database = await openDatabase(':memory:');
  await migrateDatabase(database);
  return database;
}

test('migrations apply once, retain checksums, and enable foreign keys', async () => {
  const database = await openDatabase(':memory:');
  try {
    assert.deepEqual(await migrateDatabase(database), ['001_initial_schema.sql']);
    assert.deepEqual(await migrateDatabase(database), []);
    assert.equal((await database.get('PRAGMA foreign_keys;')).foreign_keys, 1);
    assert.equal((await database.get('SELECT COUNT(*) AS count FROM schema_migrations;')).count, 1);
  } finally {
    await database.close();
  }
});

test('database constraints enforce roles, ownership shape, statuses, and unique relationships', async () => {
  const database = await createMigratedDatabase();
  try {
    const client = await database.run('INSERT INTO clients (name) VALUES (?);', 'Acme');
    const manager = await database.run(
      `INSERT INTO users (full_name, email, password_hash, role)
       VALUES ('Manager', 'MANAGER@example.test', 'hash', 'manager');`,
    );
    const developer = await database.run(
      `INSERT INTO users (full_name, email, password_hash, role)
       VALUES ('Developer', 'dev@example.test', 'hash', 'developer');`,
    );
    const clientUser = await database.run(
      `INSERT INTO users (full_name, email, password_hash, role, client_id)
       VALUES ('Client', 'client@example.test', 'hash', 'client', ?);`,
      client.lastID,
    );

    await assert.rejects(database.run(
      `INSERT INTO users (full_name, email, password_hash, role)
       VALUES ('Bad Client', 'bad@example.test', 'hash', 'client');`,
    ));
    await assert.rejects(database.run(
      `INSERT INTO users (full_name, email, password_hash, role, client_id)
       VALUES ('Bad Manager', 'bad-manager@example.test', 'hash', 'manager', ?);`,
      client.lastID,
    ));
    await assert.rejects(database.run(
      `INSERT INTO users (full_name, email, password_hash, role)
       VALUES ('Duplicate', 'manager@example.test', 'hash', 'manager');`,
    ));

    const project = await database.run(
      `INSERT INTO projects (client_id, name, status, project_manager_id, created_by)
       VALUES (?, 'Site', 'planning', ?, ?);`,
      client.lastID,
      manager.lastID,
      manager.lastID,
    );
    await assert.rejects(database.run(
      `INSERT INTO projects (client_id, name, status, project_manager_id, created_by)
       VALUES (?, 'Bad status', 'unknown', ?, ?);`,
      client.lastID,
      manager.lastID,
      manager.lastID,
    ));
    await assert.rejects(database.run(
      `INSERT INTO projects (client_id, name, start_date, due_date, project_manager_id, created_by)
       VALUES (?, 'Bad dates', '2026-12-01', '2026-11-01', ?, ?);`,
      client.lastID,
      manager.lastID,
      manager.lastID,
    ));

    await database.run(
      'INSERT INTO project_members (project_id, user_id, assigned_by) VALUES (?, ?, ?);',
      project.lastID,
      developer.lastID,
      manager.lastID,
    );
    await assert.rejects(database.run(
      'INSERT INTO project_members (project_id, user_id, assigned_by) VALUES (?, ?, ?);',
      project.lastID,
      developer.lastID,
      manager.lastID,
    ));

    const milestone = await database.run(
      `INSERT INTO milestones (project_id, title, position) VALUES (?, 'One', 1);`,
      project.lastID,
    );
    const deliverable = await database.run(
      `INSERT INTO deliverables (milestone_id, title, created_by) VALUES (?, 'Link', ?);`,
      milestone.lastID,
      developer.lastID,
    );
    await database.run(
      `INSERT INTO deliverable_submissions (deliverable_id, version_number, url, submitted_by)
       VALUES (?, 1, 'https://example.test/one', ?);`,
      deliverable.lastID,
      developer.lastID,
    );
    await assert.rejects(database.run(
      `INSERT INTO deliverable_submissions (deliverable_id, version_number, url, submitted_by)
       VALUES (?, 1, 'https://example.test/duplicate', ?);`,
      deliverable.lastID,
      developer.lastID,
    ));
    await assert.rejects(database.run(
      `INSERT INTO deliverable_submissions (deliverable_id, version_number, url, submitted_by)
       VALUES (?, 2, 'javascript:alert(1)', ?);`,
      deliverable.lastID,
      developer.lastID,
    ));
    await assert.rejects(database.run(
      `INSERT INTO deliverable_reviews (submission_id, reviewer_id, decision, feedback)
       VALUES (1, ?, 'revision_requested', '   ');`,
      clientUser.lastID,
    ));
    await assert.rejects(database.run(
      `INSERT INTO comments (deliverable_id, author_id, body) VALUES (?, ?, '   ');`,
      deliverable.lastID,
      clientUser.lastID,
    ));
    await assert.rejects(database.run(
      `INSERT INTO activity_logs (project_id, entity_type, entity_id, action, metadata_json)
       VALUES (?, 'project', ?, 'bad.json', '{');`,
      project.lastID,
      project.lastID,
    ));
  } finally {
    await database.close();
  }
});

test('migration checksum prevents editing an already-applied migration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agencydesk-migrations-'));
  const migrationFile = join(directory, '001_test.sql');
  const database = await openDatabase(':memory:');
  try {
    await writeFile(migrationFile, 'CREATE TABLE first_table (id INTEGER PRIMARY KEY);');
    await migrateDatabase(database, directory);
    await writeFile(migrationFile, 'CREATE TABLE changed_table (id INTEGER PRIMARY KEY);');
    await assert.rejects(migrateDatabase(database, directory), /has changed/);
  } finally {
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('demo seed is deterministic, complete, and idempotent', async () => {
  const database = await createMigratedDatabase();
  try {
    await seedDemoData(database, 'a-long-demo-password');
    await seedDemoData(database, 'a-long-demo-password');

    assert.equal((await database.get('SELECT COUNT(*) AS count FROM clients;')).count, 2);
    assert.equal((await database.get('SELECT COUNT(*) AS count FROM users;')).count, 5);
    assert.equal((await database.get('SELECT COUNT(DISTINCT password_hash) AS count FROM users;')).count, 5);
    assert.equal((await database.get('SELECT COUNT(*) AS count FROM projects;')).count, 3);
    assert.equal((await database.get('SELECT COUNT(*) AS count FROM milestones;')).count, 5);
    assert.equal((await database.get('SELECT COUNT(*) AS count FROM deliverables;')).count, 4);
    assert.equal((await database.get('SELECT COUNT(*) AS count FROM deliverable_reviews;')).count, 2);
    assert.equal((await database.get('SELECT COUNT(*) AS count FROM change_requests;')).count, 1);
    assert.equal((await database.get('SELECT COUNT(*) AS count FROM activity_logs;')).count, 4);
  } finally {
    await database.close();
  }
});

test('migration runner rejects a migration removed from applied history', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agencydesk-missing-migration-'));
  const migrationFile = join(directory, '001_test.sql');
  const database = await openDatabase(':memory:');
  try {
    await writeFile(migrationFile, 'CREATE TABLE first_table (id INTEGER PRIMARY KEY);');
    await migrateDatabase(database, directory);
    await rm(migrationFile, { force: true });
    await assert.rejects(migrateDatabase(database, directory), /is missing/);
  } finally {
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }
});