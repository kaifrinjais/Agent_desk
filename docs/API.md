# AgencyDesk API

All API routes use the `/api` prefix and JSON. Successful responses use a `data` envelope. Errors use an `error` object containing a stable `code` and user-safe `message`; validation errors include field details. Production responses do not include stack traces or SQL details.

## Health

### `GET /api/health`

Returns HTTP `200` while the Express process can serve requests:

```json
{
  "data": {
    "status": "ok"
  }
}
```

This foundation endpoint reports process-level HTTP availability only. It does not claim that a database or future dependency is healthy.

## Errors

An unknown route returns HTTP `404`:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "The requested resource was not found."
  }
}
```

Malformed JSON returns HTTP `400` with code `INVALID_JSON`. Request bodies larger than the configured 100 KB limit return HTTP `413` with code `PAYLOAD_TOO_LARGE`. Unexpected failures return HTTP `500` with code `INTERNAL_SERVER_ERROR` and a generic message; implementation details are written to the server logger, not returned to the caller.

## Authentication and CSRF

Every state-changing API request requires an `Origin` whose normalized origin equals configured `CLIENT_ORIGIN`. Mutations also require the session-bound synchronizer token in `X-CSRF-Token`. CSRF and invalid-Origin failures return `403` with `CSRF_TOKEN_REQUIRED`, `INVALID_CSRF_TOKEN`, or `INVALID_ORIGIN`.

### `GET /api/auth/csrf`

Creates or returns the current session token and establishes the session cookie:

```json
{ "data": { "csrfToken": "session-bound-random-token" } }
```

### `POST /api/auth/login`

Requires CSRF and a JSON body containing an email and a password of at most 72 UTF-8 bytes. On success, the session identifier is regenerated and the response returns a safe user profile and a new CSRF token. Invalid and inactive account failures share the same `401 INVALID_CREDENTIALS` response. Attempts are rate-limited.

### `GET /api/auth/me`

Returns the current safe user profile or `401 UNAUTHENTICATED`. Password hashes and session IDs are never included.

### `POST /api/auth/logout`

Requires an authenticated session, matching Origin, and CSRF token. Destroys the server-side session and clears the session cookie.

### `POST /api/auth/change-password`

Requires an authenticated session, matching Origin, CSRF token, `currentPassword`, and a `newPassword` of 12-128 characters and at most 72 UTF-8 bytes. Success rotates the session identifier and CSRF token and clears the forced-change flag.

## Clients

Manager-only routes:

- `GET /api/clients` lists organizations and project/user counts.
- `POST /api/clients` creates an organization.
- `PATCH /api/clients/:clientId` updates its name/contact/description/active flag; organizations are deactivated, not deleted.
- `POST /api/clients/:clientId/users` creates a client account with a temporary password and forced-change flag.

`GET /api/clients/:clientId` is available to managers and that organization's client users. Developers cannot enumerate client organizations.

## Projects and milestones

- `GET /api/projects` returns manager-wide, assigned-developer, or own-organization projects.
- `POST /api/projects` and `PATCH /api/projects/:projectId` are manager-only. Project client ownership is immutable after creation. New projects start in planning; allowed status transitions and completion requirements are in [DATA_MODEL.md](DATA_MODEL.md).
- `GET /api/projects/:projectId` uses the same server-side scope; inaccessible and nonexistent records both return `404 NOT_FOUND`.
- `GET /api/projects/managers` and `GET /api/projects/developers` return active role-appropriate assignment choices to managers.
- `GET /api/projects/:projectId/members`, `POST /api/projects/:projectId/members`, and `DELETE /api/projects/:projectId/members/:userId` manage developer assignments. Writes are manager-only.
- `GET /api/projects/:projectId/milestones`, `POST /api/projects/:projectId/milestones`, and `PATCH /api/milestones/:milestoneId` provide scoped ordered milestone access and role-limited progress updates.

## Deliverables and review history

- `GET /api/milestones/:milestoneId/deliverables` and `POST /api/milestones/:milestoneId/deliverables` list/create deliveries on accessible projects. Managers can create across agency projects; developers can create only on assigned projects.
- `GET /api/deliverables/:deliverableId` returns the deliverable and immutable submission/review history, newest first.
- `POST /api/deliverables/:deliverableId/submissions` accepts only HTTP/HTTPS links and creates a higher version from draft/revision-requested state.
- `POST /api/submissions/:submissionId/review` accepts `approved` or `revision_requested`; only a client user from the owning organization can review the latest submitted version. Revision feedback is required.
- `GET /api/deliverables/:deliverableId/comments` and `POST /api/deliverables/:deliverableId/comments` are available to authorized project participants. Comments are append-only.

## Change requests and activity

- `GET /api/projects/:projectId/change-requests` and `POST /api/projects/:projectId/change-requests` are scoped to the project's authorized users; only the owning client organization can create requests.
- `GET /api/change-requests/:changeRequestId` returns a scoped request and decision history.
- `PATCH /api/change-requests/:changeRequestId/decision` is manager-only. Send `{ "status": "under_review" }` to begin review, or `{ "status": "approved" | "rejected", "decisionNotes": "..." }` for a final decision.
- `POST /api/change-requests/:changeRequestId/withdraw` lets the requesting client withdraw only its own undecided request.
- `GET /api/projects/:projectId/activity?limit=50&beforeId=123` returns paginated, role-scoped activity, newest first. The limit is clamped to 1-100.

Important workflow writes and their activity event are committed in the same SQLite transaction. Approved change requests do not alter project scope or deadlines.