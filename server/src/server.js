import pino from 'pino';
import { createApp } from './app.js';
import { createSqliteSessionStore } from './auth/session-store.js';
import { config, validateServerConfig } from './config/env.js';
import { openDatabase } from './db/connection.js';
import { migrateDatabase } from './db/migrate.js';

const logger = pino({ level: config.LOG_LEVEL });
validateServerConfig(config);
const database = await openDatabase(config.DATABASE_PATH);
await migrateDatabase(database);
const sessionDatabase = await openDatabase(config.SESSION_DATABASE_PATH);
const sessionStore = await createSqliteSessionStore(sessionDatabase);
const app = createApp({ logger, database, sessionStore });
const server = app.listen(config.PORT, '127.0.0.1', () => {
  logger.info({ port: config.PORT, environment: config.NODE_ENV }, 'AgencyDesk API listening');
});

server.on('error', (error) => {
  logger.error({ err: error }, 'AgencyDesk API failed to start');
  process.exitCode = 1;
});

async function shutdown() {
  server.close(async () => {
    await Promise.all([database.close(), sessionDatabase.close()]);
    process.exitCode = 0;
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);