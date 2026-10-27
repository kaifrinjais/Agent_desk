import express from 'express';
import { z } from 'zod';
import { requireAuth, requirePasswordChanged } from '../auth/middleware.js';
import { getProjectForUser, ensureProjectOpen } from '../projects/service.js';
import { getMilestoneForUser } from '../milestones/service.js';
import { AppError, notFound, requireValid } from '../utils/http.js';
import {
  addComment,
  assertCanWorkOnProject,
  createDeliverable,
  getDeliverableForUser,
  reviewSubmission,
  submitDeliverable,
} from './service.js';

const createSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(5000).optional().default(''),
});

const submissionSchema = z.object({
  url: z.string().trim().url().max(2048).refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  }, 'URL must use HTTP or HTTPS.'),
  notes: z.string().trim().max(5000).optional().default(''),
});

const reviewSchema = z.object({
  decision: z.enum(['approved', 'revision_requested']),
  feedback: z.string().trim().max(5000).optional().default(''),
}).refine((value) => value.decision !== 'revision_requested' || value.feedback.length > 0, {
  path: ['feedback'], message: 'Feedback is required when requesting revisions.',
});

const commentSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});

function parseId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw notFound();
  return id;
}

async function getDeliverableHistory(database, deliverableId) {
  const submissions = await database.all(
    `SELECT ds.id, ds.version_number AS versionNumber, ds.url, ds.notes,
            ds.submitted_at AS submittedAt, ds.submitted_by AS submittedBy,
            submitter.full_name AS submittedByName,
            dr.decision, dr.feedback, dr.reviewed_at AS reviewedAt,
            dr.reviewer_id AS reviewerId, reviewer.full_name AS reviewerName
     FROM deliverable_submissions ds
     JOIN users submitter ON submitter.id = ds.submitted_by
     LEFT JOIN deliverable_reviews dr ON dr.submission_id = ds.id
     LEFT JOIN users reviewer ON reviewer.id = dr.reviewer_id
     WHERE ds.deliverable_id = ? ORDER BY ds.version_number DESC;`,
    deliverableId,
  );
  return submissions;
}

export function createDeliverableRouter({ database }) {
  const router = express.Router();
  const readyUser = [requireAuth(database), requirePasswordChanged];

  router.get('/milestones/:milestoneId/deliverables', ...readyUser, async (request, response) => {
    const milestone = await getMilestoneForUser(database, parseId(request.params.milestoneId), request.authUser);
    const deliverables = await database.all(
      `SELECT id, milestone_id AS milestoneId, title, description, status,
              created_by AS createdBy, created_at AS createdAt, updated_at AS updatedAt
       FROM deliverables WHERE milestone_id = ? ORDER BY id;`,
      milestone.id,
    );
    response.json({ data: { deliverables } });
  });

  router.post('/milestones/:milestoneId/deliverables', ...readyUser, async (request, response) => {
    const milestone = await getMilestoneForUser(database, parseId(request.params.milestoneId), request.authUser);
    assertCanWorkOnProject(request.authUser, milestone.project);
    await ensureProjectOpen(database, milestone.projectId);
    const input = requireValid(createSchema, request.body);
    const deliverableId = await createDeliverable(database, milestone, input, request.authUser.id);
    const deliverable = await getDeliverableForUser(database, deliverableId, request.authUser);
    response.status(201).json({ data: { deliverable } });
  });

  router.get('/deliverables/:deliverableId', ...readyUser, async (request, response) => {
    const deliverable = await getDeliverableForUser(database, parseId(request.params.deliverableId), request.authUser);
    const submissions = await getDeliverableHistory(database, deliverable.id);
    response.json({ data: { deliverable, submissions } });
  });

  router.post('/deliverables/:deliverableId/submissions', ...readyUser, async (request, response) => {
    const deliverable = await getDeliverableForUser(database, parseId(request.params.deliverableId), request.authUser);
    assertCanWorkOnProject(request.authUser, deliverable.project);
    const input = requireValid(submissionSchema, request.body);
    const submission = await submitDeliverable(database, deliverable, input, request.authUser.id);
    response.status(201).json({ data: { submission } });
  });

  router.post('/submissions/:submissionId/review', ...readyUser, async (request, response) => {
    if (request.authUser.role !== 'client') {
      throw new AppError(403, 'FORBIDDEN', 'Only the project client can review a deliverable.');
    }
    const submissionId = parseId(request.params.submissionId);
    const input = requireValid(reviewSchema, request.body);
    await reviewSubmission(database, submissionId, input, request.authUser);
    response.json({ data: { review: { submissionId, decision: input.decision } } });
  });

  router.get('/deliverables/:deliverableId/comments', ...readyUser, async (request, response) => {
    const deliverable = await getDeliverableForUser(database, parseId(request.params.deliverableId), request.authUser);
    const comments = await database.all(
      `SELECT c.id, c.deliverable_id AS deliverableId, c.author_id AS authorId,
              u.full_name AS authorName, c.body, c.created_at AS createdAt
       FROM comments c JOIN users u ON u.id = c.author_id
       WHERE c.deliverable_id = ? ORDER BY c.id;`,
      deliverable.id,
    );
    response.json({ data: { comments } });
  });

  router.post('/deliverables/:deliverableId/comments', ...readyUser, async (request, response) => {
    const deliverable = await getDeliverableForUser(database, parseId(request.params.deliverableId), request.authUser);
    const input = requireValid(commentSchema, request.body);
    const commentId = await addComment(database, deliverable, input.body, request.authUser);
    const comment = await database.get(
      `SELECT c.id, c.deliverable_id AS deliverableId, c.author_id AS authorId,
              u.full_name AS authorName, c.body, c.created_at AS createdAt
       FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = ?;`,
      commentId,
    );
    response.status(201).json({ data: { comment } });
  });

  router.get('/projects/:projectId/activity', ...readyUser, async (request, response) => {
    const projectId = parseId(request.params.projectId);
    await getProjectForUser(database, projectId, request.authUser);
    const requestedLimit = Number(request.query.limit);
    const limit = Number.isSafeInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
    const beforeId = request.query.beforeId ? parseId(request.query.beforeId) : Number.MAX_SAFE_INTEGER;
    const activity = await database.all(
      `SELECT a.id, a.actor_user_id AS actorUserId, u.full_name AS actorName,
              a.entity_type AS entityType, a.entity_id AS entityId,
              a.action, a.metadata_json AS metadataJson, a.created_at AS createdAt
       FROM activity_logs a LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE a.project_id = ? AND a.id < ? ORDER BY a.id DESC LIMIT ?;`,
      projectId,
      beforeId,
      limit,
    );
    response.json({ data: { activity: activity.map((item) => ({
      ...item,
      metadata: JSON.parse(item.metadataJson),
      metadataJson: undefined,
    })) } });
  });

  return router;
}