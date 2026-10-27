import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { createAuthRouter } from './auth/routes.js';
import { createCsrfMiddleware } from './auth/csrf.js';
import { createClientRouter } from './clients/routes.js';
import { config } from './config/env.js';
import { createDeliverableRouter } from './deliverables/routes.js';
import { createChangeRequestRouter } from './change-requests/routes.js';
import { createMilestoneRouter } from './milestones/routes.js';
import { createProjectRouter } from './projects/routes.js';

export function createApp({
  logger = pino({ level: config.LOG_LEVEL }),
  database,
  sessionStore,
  sessionSecret = config.SESSION_SECRET,
  sessionMaxAge = config.SESSION_MAX_AGE_MS,
  clientOrigin = config.CLIENT_ORIGIN,
  secureCookies = config.NODE_ENV === 'production',
  loginLimit = 5,
} = {}) {
  if (Boolean(database) !== Boolean(sessionStore)) {
    throw new Error('The application database and session store must be configured together.');
  }
  if (sessionStore && !sessionSecret) {
    throw new Error('A session secret is required when the session store is enabled.');
  }

  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(pinoHttp({
    logger,
    redact: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["x-csrf-token"]',
    ],
  }));
  app.use(express.json({ limit: '100kb' }));

  if (sessionStore) {
    app.use('/api', session({
      name: 'agencydesk.sid',
      secret: sessionSecret,
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      proxy: secureCookies,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: secureCookies,
        maxAge: sessionMaxAge,
        path: '/',
      },
    }));
    app.use('/api', createCsrfMiddleware(clientOrigin));
  }

  if (database) {
    app.use('/api/auth', createAuthRouter({ database, loginLimit }));
    app.use('/api/clients', createClientRouter({ database }));
    app.use('/api', createChangeRequestRouter({ database }));
    app.use('/api', createMilestoneRouter({ database }));
    app.use('/api', createDeliverableRouter({ database }));
    app.use('/api/projects', createProjectRouter({ database }));
  }

  app.get('/api/health', (_request, response) => {
    response.json({ data: { status: 'ok' } });
  });

  app.use((_request, response) => {
    response.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
      },
    });
  });

  app.use((error, request, response, _next) => {
    const isMalformedJson = error.type === 'entity.parse.failed';
    const isPayloadTooLarge = error.type === 'entity.too.large';
    const isConstraintConflict = error.code?.startsWith('SQLITE_CONSTRAINT');
    const status = error.status ?? (isMalformedJson ? 400 : isPayloadTooLarge ? 413 : isConstraintConflict ? 409 : 500);

    if (status === 500) {
      request.log.error({ err: error }, 'Unhandled request error');
    }

    response.status(status).json({
      error: {
        code: error.status && error.code ? error.code
          : isMalformedJson ? 'INVALID_JSON'
            : isPayloadTooLarge ? 'PAYLOAD_TOO_LARGE'
              : isConstraintConflict ? 'CONFLICT' : 'INTERNAL_SERVER_ERROR',
        message: isMalformedJson
          ? 'The request body must contain valid JSON.'
          : isPayloadTooLarge
            ? 'The request body is too large.'
            : error.status ? error.message
              : isConstraintConflict ? 'The request conflicts with an existing record.'
                : 'An unexpected error occurred.',
        ...(error.details ? { details: error.details } : {}),
      },
    });
  });

  return app;
}