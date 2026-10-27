# AgencyDesk Security Baseline

This document describes the controls implemented so far. These controls and their tests are useful evidence, not proof that the application is production-ready or vulnerability-free.

## Implemented in Phases 2-6

- **Password storage:** `bcryptjs` hashes seed and changed passwords; plaintext is not stored. Client demo accounts require a password change. Seed credentials are controlled by local `SEED_PASSWORD` and must not be used outside local demonstrations.
- **Sessions:** `express-session` stores only server-side session data in a separate SQLite database. Session cookies use the non-default name `agencydesk.sid`, `HttpOnly`, `SameSite=Lax`, a configured lifetime, and `Secure` under production mode. Login and password change regenerate the session identifier.
- **Session persistence:** the session store uses parameterized SQL on the configured SQLite driver. Logout destroys the server-side record. Tests reopen the session database and verify the record remains available.
- **CSRF:** state-changing API calls require a cryptographically random session-bound token in `X-CSRF-Token` and a normalized `Origin` matching `CLIENT_ORIGIN`. Token comparison uses constant-time byte comparison. The CSRF header, Cookie, and Authorization headers are redacted from request logs.
- **Login protection:** a generic invalid-credentials message is used for unknown, inactive, or bad-password accounts. Login attempts are limited. New passwords must be at least 12 characters; all password inputs are limited to bcrypt's 72 UTF-8 byte limit.
- **Authorization:** session identity and user role/client ownership are loaded from the database, never trusted from the body. Projects, milestones, deliverables, comments, change requests, and activity resolve ownership through their actual database parent relationships. Inaccessible and nonexistent records both return 404 for tenant-scoped reads. Tests substitute IDs in URLs and attempt role/client identity fields in request bodies.
- **HTTP/input protections:** Helmet is enabled, Express's identifying header is disabled, JSON bodies are limited to 100 KB, request schemas are validated, SQL values use bound parameters, and errors do not disclose stack traces.
- **Database invariants:** SQLite foreign keys are enabled on each application database connection. Migrations define role/client consistency, allowed statuses, case-insensitive email uniqueness, relationship uniqueness, dates, and bounded/non-empty values.

## Configuration

The HTTP server requires `SESSION_SECRET` to be set to at least 32 characters. Generate a random secret locally and keep it in the ignored `.env` file. Production requires `CLIENT_ORIGIN` to use HTTPS; configure TLS at the deployment boundary and set production mode so session cookies are Secure.

The session database is separate from application data. Both paths are local SQLite files by default and are ignored by Git. Do not copy production session files into development or share session secrets.

## Remaining limitations

- Authentication currently has only one password hash cost setting (bcrypt cost 12); account recovery, email verification, invitations, MFA, and administrative credential reset are not implemented.
- The login rate limiter uses its default in-process store, appropriate only to the current single-instance scope. Multi-instance deployment requires shared rate-limit and session stores.
- The custom SQLite session store does not yet include scheduled expired-row cleanup or operational monitoring.
- No CSRF/CORS configuration for separate origins is supported. The initial app assumes one origin.
- Backend APIs and workflow tests cover the currently implemented client/project/milestone/deliverable/change-request/activity routes. New endpoints must continue resolving ownership and developer assignments from the database and include cross-client ID-substitution tests. React Testing Library covers login errors/forced password navigation, manager project creation, and required revision feedback; it is not an exhaustive UI test suite.
- The React interface is not an authorization boundary; the current UI surfaces common actions, while backend checks remain authoritative.
- The seed command is intentionally idempotent and never resets existing records, but it does not repair or overwrite an already-created account's password or profile.
- No external security review, penetration test, deployment hardening review, or production database concurrency evaluation has been performed.