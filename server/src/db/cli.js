import { config } from '../config/env.js';
import { openDatabase } from './connection.js';
import { migrateDatabase } from './migrate.js';
import { seedDemoData } from './seed.js';

const command = process.argv[2];
if (!['migrate', 'seed'].includes(command)) {
  throw new Error('Usage: npm run db:migrate | npm run db:seed');
}

const database = await openDatabase(config.DATABASE_PATH);
try {
  const migrations = await migrateDatabase(database);
  if (migrations.length) {
    console.info(`Applied migrations: ${migrations.join(', ')}`);
  } else {
    console.info('Database schema is up to date.');
  }

  if (command === 'seed') {
    const result = await seedDemoData(database);
    console.info(`Demo data is ready: ${JSON.stringify(result)}.`);
    console.info('Demo accounts use SEED_PASSWORD; change it immediately after local demonstration.');
  }
} finally {
  await database.close();
}