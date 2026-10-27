# AgencyDesk Development Plan

This plan follows the agreed implementation sequence. Each phase is a reviewable milestone; later phases depend on the security, database, and business rules established earlier. Do not describe a feature as complete until its acceptance checks have actually been run.

| Phase | Objective and implementation | Acceptance checks |
| --- | --- | --- |
| 0. Repository audit and specification | Inspect the repository and runtime; document product scope, roles, permission matrix, business transitions, architecture, relational data model, phase gates, and initial decisions. | `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/DEVELOPMENT_PLAN.md`, and `docs/DECISIONS.md` agree on roles, ownership, workflows, schema invariants, stack, scope, and phase acceptance criteria. No application source or runtime scaffolding is created in this phase. |
| 1. Foundation and tooling | Set up root scripts and separate `client` and `server` applications; environment validation, logging, API errors, health route, lint/format tooling, Vite `/api` proxy, ignore rules, and initial README. | Frontend and backend start; frontend reaches health endpoint; production client build succeeds; lint runs; intentional API failure has the documented error shape. |
| 2. Database and seed data | Add SQLite connection, numbered migrations, foreign-key enforcement, schema/indexes, parameterized access modules, explicit deterministic seed command, and database tests. | Clean migration and seed work; re-running follows documented behavior; foreign keys and important uniqueness/status constraints are tested using an isolated test database. |
| 3. Authentication and access control | Add password hashing, persistent server-side sessions, login/logout/me/password-change and CSRF endpoints, session rotation, auth/role/resource middleware, rate limits, and tests. Add a read-only project access probe and cross-client identifier-substitution tests before business workflows. | Demo roles authenticate; invalid/inactive login is safe; rotation, logout, CSRF, rate limits, developer assignments, client organization boundaries, and missing sessions are verified. No project mutation/workflow APIs are implemented. |
| 4. Client and project management | Add manager client/client-user and project CRUD, project listing/detail, developer assignment, role-scoped queries, UI forms/pages, and tests. | Managers create clients/projects and assign developers; developers see assigned work only; clients see own organization only; dates, states, and protected fields are validated. |
| 5. Milestones and deliverables | Add ordered milestone rules, deliverables, versioned submissions, reviews, revision feedback, comments, transactions/activity, delivery UI, and workflow tests. | Full submit/approve and submit/revise/resubmit workflows pass; prior versions remain; unauthorized/draft reviews and premature milestone completion are rejected; activity matches successful changes. |
| 6. Change requests and audit | Add client request creation, manager decisions, notes/time/actor, history, UI, and transition tests. | Ownership and manager-only decisions are enforced; invalid transitions fail; decisions remain visible; approval does not silently change project scope/dates. |
| 7. Dashboards and polish | Add role-scoped, database-backed dashboard aggregates, attention lists, justified search/pagination, responsive layouts, accessibility, and explicit UI states. | Counts have defined meanings and correct scope; filters work; no placeholder data remains in completed flows; keyboard and narrow-screen use are checked. |
| 8. Hardening and test completion | Review auth, CSRF, resource authorization, validation, SQL, transactions, error disclosure, query behavior, dependencies, and configuration. | Automated tests, build, and lint pass; critical cross-organization and workflow cases pass; limitations and actual outcomes are recorded. |
| 9. Documentation and demonstration | Complete/verify architecture, ER/API/security/test docs, diagrams, setup/demo instructions, and demonstration checklist. | A new developer can follow setup; docs match shipped behavior; only implemented features are called complete; actual test outcomes and limitations are stated. |

## Phase 0 audit result

The workspace at `C:\Users\chauh\OneDrive\Documents\AgentDesk` was empty: no source files, README, package manifests, or Git repository were present. There is no existing implementation to preserve and no prior dependency or script state to assess. Node.js `v22.20.0` and npm `10.9.3` are installed. On 2026-10-27 the official Node.js release schedule lists v24 as LTS; v22 reached end of life on 2026-10-20. Update/use Node 24 LTS before Phase 1 dependency installation and runtime validation.

## Working gates

- Keep each phase small enough to validate before beginning the next.
- Add tests with the feature that they establish; keep test data isolated from developer data.
- Update API, schema, security, and setup documentation when the corresponding contract changes.
- Never reset user data implicitly; database reset behavior must be explicit and documented.
- Report checks as passed only when run and inspected. If a check cannot run, state the blocker and remaining work.

## Phase 1 implementation record

**Implemented:** npm workspaces for the React/Vite client and Express server; Node 24 engine declaration and `.nvmrc`; root `.env.example` with Zod startup validation for `NODE_ENV`, `PORT`, and `LOG_LEVEL`, loaded relative to the config module regardless of workspace working directory; Pino request logging with cookie, authorization, and CSRF header redaction; bounded JSON parsing; consistent 400/404/413/500 error envelopes; `/api/health`; Vite `/api` proxy; shared frontend JSON client and API connection shell; ESLint flat config; README, ignore rules, and API contract documentation.

**Verified:**

- `npm install` and `npm ci` completed; npm reported 0 vulnerabilities. Those npm commands emitted `EBADENGINE` because the installed npm shim ran under host Node `22.20.0`, while the package correctly requires Node `>=24 <25`.
- `npx --yes --package=node@24.22.1 --call "npm run check"` passed: ESLint, all 5 server tests, and the Vite production build.
- With the same isolated Node 24 runtime, `npm run dev` started both services. A request to `http://127.0.0.1:5173/` returned HTTP 200 and a request to `http://127.0.0.1:5173/api/health` returned `{ "data": { "status": "ok" } }` through the Vite proxy.
- `npx --yes --package=node@24.22.1 --call "npm test"` passed all 5 tests after the final API error-path change.

**Not implemented in Phase 1:** authentication, authorization, CSRF enforcement, database connectivity/schema, business endpoints, and project workflows. The configured CSRF-header log redaction is preparatory only and does not imply CSRF protection is active.

## Phase 0 deliverables and acceptance

- [PRD.md](PRD.md): product scope, roles, permission matrix, user-visible workflows, status transitions, dashboard definitions, and success criteria.
- [ARCHITECTURE.md](ARCHITECTURE.md): system/deployment diagram, request lifecycle, security boundaries, responsibility split, data stores, and known limitations.
- [DATA_MODEL.md](DATA_MODEL.md): ER diagram, proposed tables/relationships, constraints, indexes, workflow state storage, and enforcement boundaries.
- [DECISIONS.md](DECISIONS.md): initial decisions, alternatives, trade-offs, and revisit conditions.
- This plan: repository audit, phase sequence, and acceptance checks.

Phase 0 is accepted when the repository audit is recorded; these documents state one consistent design for organization ownership, role/resource access, submission/review history, comment access, project/milestone/change-request transitions, completion rules, and audit writes; and each later phase has a testable gate. Phase 0 does not create application code, install dependencies, or claim runtime, build, or test success.

## Demonstration checklist (to be exercised after implementation)

- [ ] Sign in as a manager and view agency-wide work; create a client/project and assign a developer.
- [ ] Sign in as that developer and submit a deliverable for an assigned project.
- [ ] Sign in as the matching client; request a revision with feedback, then review a later submission version.
- [ ] Submit a change request as a client and record a manager decision.
- [ ] Inspect project activity and confirm the acting users and timestamps.
- [ ] Attempt to access another client's project/deliverable by changing IDs and confirm access is denied.

This checklist is intentionally unchecked until a real implementation is available and the steps are performed.

## Phases 2-3 implementation record

**Phase 2 implemented:** checksummed numbered SQL migration, Promise-based SQLite connection with foreign keys enabled, explicit `db:migrate` and idempotent non-destructive `db:seed` commands, the documented relational tables/indexes/constraints, separate session database configuration, and deterministic two-client demo data. Database tests use SQLite `:memory:` or temporary OS directories, never the configured local database.

**Phase 2 verified:** the initial migration and repeated migration pass; edited or missing migration files are rejected; role/client shape, case-insensitive email uniqueness, statuses, dates, project membership, URL schemes, review feedback, comments, and valid activity JSON are constrained; seed creates the expected fixture, unique salted password hashes, and is idempotent.

**Phase 3 implemented:** bcrypt password hashing; `express-session` with a persistent SQLite-backed store using the existing SQLite driver; regenerated session IDs and CSRF tokens after login/password change; logout invalidation; safe `/api/auth/me`; forced client password change; login rate limiting; Helmet; synchronizer-token CSRF plus normalized Origin validation; role/resource helpers; and a read-only scoped project detail route solely for authorization verification.

**Security boundary:** the project detail route is not project-management functionality. No client/project writes, developer assignment routes, milestones, deliverables, approvals, change-request workflows, dashboards, or activity endpoints were added. Cross-client and developer-assignment isolation tests pass before those later workflows are started.

**Dependency decision:** `connect-sqlite3` was trial-installed and `npm audit` reported 7 transitive advisories (including a critical `tar` issue) through its nested SQLite build tree. It was removed. The session store uses the already-installed `sqlite`/`sqlite3` pair instead. After removal, clean install/audit and final checks are recorded below.

**Verified under Node 24.22.1 using the isolated npm `node` package:** clean `npm ci` completed; `npm run check` passed ESLint, all 29 server tests, and the Vite production build; `npm audit` reported 0 vulnerabilities. npm still emits `EBADENGINE` during installation because the host npm shim runs under installed Node 22.20.0 even though scripts are launched with isolated Node 24.22.1.

Database/seed CLIs succeeded against disposable temporary database files. Tests cover constraints, migration checksum/history, seed idempotence and unique salted password hashes, safe profiles, generic/inactive credentials, caller-supplied role rejection, forced password changes, bcrypt byte limits, session rotation/logout/persistence/expiry, secure cookie flags, CSRF/Origin, rate limits, manager scope, developer assignments, and both directions of client-organization isolation.

A live Express smoke test using only disposable temporary databases passed manager CSRF initialization/login, project read, logout invalidation, and health requests. The temporary server and databases were stopped and removed after the check.

The Vite frontend and API are not left running as part of this backend-focused task. The earlier Phase 1 live proxy check remains recorded above.

## Phases 4-6 implementation record

**Phase 4 implemented:** manager client CRUD/deactivation and client-user creation; project listing/create/update, manager selection, project status transitions, developer assignment/unassignment, and team reads. Listing and nested-resource authorization is database-derived. Project ownership is immutable after creation; duplicate keys map to 409; writes that require audit events commit their activity rows transactionally.

**Phase 5 implemented:** ordered milestone management with manager/developer transition rules and completion checks; deliverable creation; HTTP/HTTPS linked submissions with immutable version history; client review of the current submission; revision feedback; comments; and transactional activity events.

**Phase 6 implemented:** client change-request creation/withdrawal, manager review and final approval/rejection with notes/actor/time, scoped activity history, and a project-detail React workspace for all roles. Approval does not alter project scope or deadlines.

**Frontend implemented:** login/forced-password-change screens, authenticated navigation, role-scoped project/client pages, milestone and team controls, deliverable submission/review history/comments, and change-request/activity views. Dashboard analytics have deliberately not been added.

**Verification:** `npm ci` completes from the lockfile; `npm test` passes all 45 backend tests and 5 React Testing Library interactions; `npm run check` passes lint, both test suites, and the Vite production build under Node 24.22.1; `npm audit` reports 0 vulnerabilities. During this audit npm emitted `EBADENGINE` because the installed npm process runs on Node 22.20.0, while application checks were executed using Node 24.22.1. Tests include cross-client ID substitution, assignment scope, deactivated-client reads, milestone completion/terminal rules, full submit/revision/resubmit/approval history, comment isolation, change-request transitions, audit attribution, and no deadline side effects. Browser smoke checks passed manager login, client forced-password-change, role-scoped project navigation, client revision feedback, client request withdrawal, and manager client/project editing. Desktop and mobile layout checks found no horizontal overflow. Temporary browser databases were removed after use.