import { config as loadDotEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

loadDotEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_PATH: z.string().min(1).default('./server/data/agencydesk.sqlite'),
  SESSION_DATABASE_PATH: z.string().min(1).default('./server/data/sessions.sqlite'),
  SESSION_SECRET: z.preprocess((value) => value === '' ? undefined : value, z.string().min(32).optional()),
  SESSION_MAX_AGE_MS: z.coerce.number().int().min(60000).max(2592000000).default(28800000),
  CLIENT_ORIGIN: z.string().url().default('http://127.0.0.1:5173').transform((value) => new URL(value).origin),
  SEED_PASSWORD: z.preprocess((value) => value === '' ? undefined : value, z.string().optional()),
}).superRefine((value, context) => {
  if (value.NODE_ENV === 'production' && !value.CLIENT_ORIGIN.startsWith('https://')) {
    context.addIssue({
      code: 'custom',
      path: ['CLIENT_ORIGIN'],
      message: 'must use HTTPS in production',
    });
  }
});

export function loadConfig(source = process.env) {
  const result = environmentSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return Object.freeze(result.data);
}

export function validateServerConfig(value) {
  if (value.NODE_ENV !== 'test' && (!value.SESSION_SECRET || value.SESSION_SECRET.length < 32)) {
    throw new Error('Invalid server configuration: SESSION_SECRET must be set to at least 32 characters.');
  }
  return value;
}

export const config = loadConfig();