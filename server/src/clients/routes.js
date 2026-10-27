import bcrypt from 'bcryptjs';
import express from 'express';
import { z } from 'zod';
import { requireAuth, requirePasswordChanged, requireRole } from '../auth/middleware.js';
import { inTransaction, recordActivity } from '../utils/database.js';
import { AppError, notFound, requireValid } from '../utils/http.js';

const clientSchema = z.object({
  name: z.string().trim().min(1).max(120),
  contactEmail: z.union([z.string().trim().email().max(254), z.literal('')]).optional()
    .transform((value) => value || null),
  description: z.string().trim().max(2000).optional().default(''),
});

const clientUpdateSchema = clientSchema.partial().extend({
  isActive: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0);

const clientUserSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  temporaryPassword: z.string().min(12).max(128)
    .refine((value) => Buffer.byteLength(value, 'utf8') <= 72),
});

function clientProfile(row) {
  return { ...row, isActive: row.isActive === 1 };
}

export function createClientRouter({ database }) {
  const router = express.Router();
  const manager = [requireAuth(database), requirePasswordChanged, requireRole('manager')];

  router.get('/', ...manager, async (_request, response) => {
    const rows = await database.all(
      `SELECT c.id, c.name, c.contact_email AS contactEmail, c.description,
              c.is_active AS isActive, c.created_at AS createdAt,
              COUNT(DISTINCT p.id) AS projectCount,
              COUNT(DISTINCT u.id) AS userCount
       FROM clients c
       LEFT JOIN projects p ON p.client_id = c.id
       LEFT JOIN users u ON u.client_id = c.id
       GROUP BY c.id ORDER BY c.name COLLATE NOCASE LIMIT 100;`,
    );
    response.json({ data: { clients: rows.map(clientProfile) } });
  });

  router.post('/', ...manager, async (request, response) => {
    const input = requireValid(clientSchema, request.body);
    const client = await inTransaction(database, async () => {
      const result = await database.run(
        `INSERT INTO clients (name, contact_email, description) VALUES (?, ?, ?);`,
        input.name,
        input.contactEmail ?? null,
        input.description,
      );
      await recordActivity(database, {
        actorUserId: request.authUser.id,
        entityType: 'client',
        entityId: result.lastID,
        action: 'client.created',
        metadata: { name: input.name },
      });
      return database.get(
        `SELECT id, name, contact_email AS contactEmail, description,
                is_active AS isActive, created_at AS createdAt
         FROM clients WHERE id = ?;`,
        result.lastID,
      );
    });
    response.status(201).json({ data: { client: clientProfile(client) } });
  });

  router.get('/:clientId', requireAuth(database), requirePasswordChanged, async (request, response) => {
    const clientId = Number(request.params.clientId);
    if (!Number.isSafeInteger(clientId) || clientId < 1) throw notFound();
    const row = await database.get(
      `SELECT id, name, contact_email AS contactEmail, description,
              is_active AS isActive, created_at AS createdAt
       FROM clients WHERE id = ? AND (
         ? = 'manager'
         OR (? = 'client' AND id = ? AND is_active = 1)
       );`,
      clientId,
      request.authUser.role,
      request.authUser.role,
      request.authUser.clientId,
    );
    if (!row) throw notFound();
    if (request.authUser.role === 'developer') {
      throw new AppError(403, 'FORBIDDEN', 'You do not have permission to view client organizations.');
    }
    response.json({ data: { client: clientProfile(row) } });
  });

  router.patch('/:clientId', ...manager, async (request, response) => {
    const clientId = Number(request.params.clientId);
    if (!Number.isSafeInteger(clientId) || clientId < 1) throw notFound();
    const input = requireValid(clientUpdateSchema, request.body);
    const current = await database.get('SELECT id FROM clients WHERE id = ?;', clientId);
    if (!current) throw notFound();
    const fields = Object.keys(input);
    const setters = fields.map((field) => `${({ contactEmail: 'contact_email', isActive: 'is_active' })[field] ?? field} = ?`);
    const values = fields.map((field) => field === 'isActive' ? Number(input[field]) : input[field]);
    await inTransaction(database, async () => {
      await database.run(
        `UPDATE clients SET ${setters.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?;`,
        ...values,
        clientId,
      );
      await recordActivity(database, {
        actorUserId: request.authUser.id,
        entityType: 'client',
        entityId: clientId,
        action: 'client.updated',
        metadata: { fields },
      });
    });
    const client = await database.get(
      `SELECT id, name, contact_email AS contactEmail, description,
              is_active AS isActive, updated_at AS updatedAt
       FROM clients WHERE id = ?;`,
      clientId,
    );
    response.json({ data: { client: clientProfile(client) } });
  });

  router.post('/:clientId/users', ...manager, async (request, response) => {
    const clientId = Number(request.params.clientId);
    if (!Number.isSafeInteger(clientId) || clientId < 1) throw notFound();
    const input = requireValid(clientUserSchema, request.body);
    const client = await database.get('SELECT id FROM clients WHERE id = ? AND is_active = 1;', clientId);
    if (!client) throw notFound();

    const passwordHash = await bcrypt.hash(input.temporaryPassword, 12);
    const user = await inTransaction(database, async () => {
      const result = await database.run(
        `INSERT INTO users (full_name, email, password_hash, role, client_id, must_change_password)
         VALUES (?, ?, ?, 'client', ?, 1);`,
        input.fullName,
        input.email,
        passwordHash,
        clientId,
      );
      await recordActivity(database, {
        actorUserId: request.authUser.id,
        entityType: 'user',
        entityId: result.lastID,
        action: 'client_user.created',
        metadata: { clientId, email: input.email },
      });
      return database.get(
        `SELECT id, full_name AS fullName, email, role, client_id AS clientId,
                must_change_password AS mustChangePassword
         FROM users WHERE id = ?;`,
        result.lastID,
      );
    });
    response.status(201).json({ data: { user: { ...user, mustChangePassword: true } } });
  });

  return router;
}