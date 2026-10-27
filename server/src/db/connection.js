import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

export function resolveDatabasePath(path) {
  return isAbsolute(path) ? path : resolve(repositoryRoot, path);
}

export async function openDatabase(path) {
  const filename = path === ':memory:' ? path : resolveDatabasePath(path);
  if (filename !== ':memory:') {
    await mkdir(dirname(filename), { recursive: true });
  }

  const database = await open({ filename, driver: sqlite3.Database });
  await database.exec('PRAGMA foreign_keys = ON;');
  const foreignKeys = await database.get('PRAGMA foreign_keys;');
  if (foreignKeys.foreign_keys !== 1) {
    await database.close();
    throw new Error('SQLite foreign-key enforcement could not be enabled.');
  }

  return database;
}