import { promisify } from 'node:util';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import express from 'express';
import { z } from 'zod';
import { newCsrfToken } from './csrf.js';
import { requireAuth } from './middleware.js';

const regenerateSession = promisify((request, callback) => request.session.regenerate(callback));
const saveSession = promisify((request, callback) => request.session.save(callback));
const destroySession = promisify((request, callback) => request.session.destroy(callback));
const invalidUserPasswordHash = await bcrypt.hash('agencydesk-nonexistent-account', 12);

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128).refine((value) => Buffer.byteLength(value, 'utf8') <= 72),
});

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(128).refine((value) => Buffer.byteLength(value, 'utf8') <= 72),
  newPassword: z.string().min(12).max(128).refine((value) => Buffer.byteLength(value, 'utf8') <= 72),
});

function safeUser(row) {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    role: row.role,
    clientId: row.clientId,
    mustChangePassword: row.mustChangePassword === 1 || row.mustChangePassword === true,
  };
}

function sendValidationError(response, error) {
  return response.status(400).json({
    error: {
      code: 'VALIDATION_ERROR',
      message: 'The request contains invalid fields.',
      details: error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    },
  });
}

export function createAuthRouter({ database, loginLimit = 5 }) {
  const router = express.Router();
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });
  const authenticate = requireAuth(database);
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: loginLimit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_request, response) => response.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again later.' },
    }),
  });

  router.get('/csrf', async (request, response) => {
    request.session.csrfToken ??= newCsrfToken();
    await saveSession(request);
    response.json({ data: { csrfToken: request.session.csrfToken } });
  });

  router.get('/me', authenticate, (request, response) => {
    response.json({ data: { user: safeUser(request.authUser) } });
  });

  router.post('/login', loginLimiter, async (request, response) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(response, parsed.error);

    const { email, password } = parsed.data;
    const user = await database.get(
      `SELECT id, full_name AS fullName, email, password_hash AS passwordHash,
              role, client_id AS clientId, is_active AS isActive,
              must_change_password AS mustChangePassword
       FROM users WHERE email = ?;`,
      email,
    );
    const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? invalidUserPasswordHash);

    if (!user || user.isActive !== 1 || !passwordMatches) {
      return response.status(401).json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' },
      });
    }

    await regenerateSession(request);
    request.session.userId = user.id;
    request.session.csrfToken = newCsrfToken();
    await saveSession(request);

    return response.json({
      data: { user: safeUser(user), csrfToken: request.session.csrfToken },
    });
  });

  router.post('/logout', authenticate, async (request, response) => {
    await destroySession(request);
    response.clearCookie('agencydesk.sid', { path: '/' });
    response.json({ data: { loggedOut: true } });
  });

  router.post('/change-password', authenticate, async (request, response) => {
    const parsed = passwordChangeSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(response, parsed.error);

    const user = await database.get(
      'SELECT password_hash AS passwordHash FROM users WHERE id = ? AND is_active = 1;',
      request.authUser.id,
    );
    const currentPasswordMatches = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
    if (!currentPasswordMatches) {
      return response.status(400).json({
        error: { code: 'CURRENT_PASSWORD_INVALID', message: 'The current password is incorrect.' },
      });
    }
    if (parsed.data.currentPassword === parsed.data.newPassword) {
      return response.status(400).json({
        error: { code: 'PASSWORD_UNCHANGED', message: 'Choose a new password different from the current password.' },
      });
    }

    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
    await database.run(
      `UPDATE users SET password_hash = ?, must_change_password = 0,
                        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?;`,
      passwordHash,
      request.authUser.id,
    );

    const userId = request.authUser.id;
    await regenerateSession(request);
    request.session.userId = userId;
    request.session.csrfToken = newCsrfToken();
    await saveSession(request);

    const updatedUser = await database.get(
      `SELECT id, full_name AS fullName, email, role, client_id AS clientId,
              must_change_password AS mustChangePassword
       FROM users WHERE id = ?;`,
      userId,
    );
    return response.json({
      data: { user: safeUser(updatedUser), csrfToken: request.session.csrfToken },
    });
  });

  return router;
}