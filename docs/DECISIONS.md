# Engineering Decisions

Initial decisions for AgencyDesk. Revisit only when a concrete requirement changes the trade-off.

## D-001: React and Vite

- **Context:** The interface is a conventional, form- and dashboard-oriented app; the developer knows React.
- **Decision:** Use React functional components and Vite, with React Router, plain CSS, and React Context for authentication state.
- **Alternatives:** A larger full-stack frontend framework or a different UI framework.
- **Advantages:** Familiar component model, quick local feedback, and a small toolchain.
- **Trade-offs:** Routing, server-data conventions, and application structure are assembled explicitly; the API remains a separate application.
- **Revisit if:** Server rendering, framework-specific deployment, or a substantial need for shared server/client routing emerges.

## D-002: Express and a modular monolith

- **Context:** The project is a small single-agency application and backend learning is an explicit goal.
- **Decision:** Keep one deployable Express API, organized by features and layers.
- **Alternatives:** A more opinionated backend framework or independently deployed services.
- **Advantages:** HTTP, middleware, and request flow remain visible; local operation and deployment are simpler.
- **Trade-offs:** The project must establish conventions and keep module boundaries clear; backend modules share a process and release.
- **Revisit if:** Team size, independent deployment needs, or measured scaling requirements justify added operational complexity.

## D-003: SQLite and explicit SQL

- **Context:** Development should be local and simple while still teaching relational constraints and transactions.
- **Decision:** Use SQLite, numbered SQL migrations, and parameterized queries behind a small database access layer.
- **Alternatives:** A hosted database or an ORM.
- **Advantages:** No separate database service; schema, joins, constraints, and transactions stay inspectable.
- **Trade-offs:** One local database and one application instance are the target; SQL and migrations require explicit maintenance.
- **Revisit if:** Concurrent deployment, operational availability, or measured workload requires a server database. An ORM should be reconsidered only if it solves demonstrated maintenance pain without obscuring important SQL behavior.

## D-004: Server-side sessions

- **Context:** A browser app and same-origin API need revocable authentication without token-refresh infrastructure.
- **Decision:** Use `express-session` with persistent SQLite-backed session storage, rotated session IDs on login, secure cookie settings, and explicit logout invalidation.
- **Alternatives:** JWT access/refresh tokens or an in-memory session store.
- **Advantages:** Server-side revocation and straightforward browser cookie handling; sessions can survive a server restart.
- **Trade-offs:** Session storage must be secured and maintained; this arrangement assumes a single application deployment and shared origin. A small callback-compatible session store must be maintained alongside the application.
- **Revisit if:** A genuinely separate API/client origin or multi-instance deployment is introduced; that change requires a reviewed cookie, CSRF, CORS, and session-store design.

### D-004 implementation note: SQLite store on the existing driver

`connect-sqlite3` was checked against the selected SQLite stack. Installing it added a nested legacy SQLite build tree; `npm audit` reported seven transitive advisories, including a critical `tar` advisory. It was removed. The app now implements only the `express-session` store operations it needs (`get`, `set`, `touch`, and `destroy`) on the existing `sqlite`/`sqlite3` driver with parameterized SQL. This avoids a second database driver and the audited transitive tree, at the cost of maintaining a small adapter and its tests.

## D-005: Versioned deliverable submissions

- **Context:** Each review must identify the exact link/version the client saw, including after a revision.
- **Decision:** Store every submission in a separate numbered record and link each final review to that submission.
- **Alternatives:** Overwrite one URL and status on the deliverable.
- **Advantages:** Earlier versions, submitters, review outcomes, and timestamps remain auditable.
- **Trade-offs:** More relational records and transaction rules are needed; the UI must clearly identify the current review target.
- **Revisit if:** The business requires branching/version comparison or immutable external artifact storage beyond link history.

## D-006: One agency organization, multiple clients

- **Context:** Initial scope is one agency serving several client organizations, not a multi-agency SaaS platform.
- **Decision:** Model client organizations and enforce client organization ownership on every project-scoped API request; do not introduce an agency-tenant abstraction.
- **Alternatives:** Multi-tenant agency accounts from the outset.
- **Advantages:** The data model and authorization rules stay aligned with the stated educational scope.
- **Trade-offs:** The schema and deployment do not isolate multiple agencies.
- **Revisit if:** Independent agencies become a supported product requirement; tenant isolation would then require a deliberate schema, authorization, and test redesign.

## D-007: Node.js 24 LTS target

- **Context:** Runtime support must be current and verifiable rather than inferred from the machine's installed version.
- **Decision:** Target Node.js 24 LTS as of 2026-10-27. The audited environment has Node.js 22.20.0, whose release line reached end of life on 2026-10-20.
- **Alternatives:** Continue on the installed Node 22 runtime or use Node 26 Current.
- **Advantages:** The target is an LTS release and avoids starting on an unsupported runtime or a Current release.
- **Trade-offs:** The local runtime must be updated before dependency compatibility, scripts, and tests can be validated.
- **Revisit if:** The official release schedule changes or an essential dependency has a verified Node 24 incompatibility; any alternative must be documented and tested.

## D-008: Same-origin frontend and API; CSRF synchronizer token

- **Context:** Browser sessions use cookies, which are sent automatically for eligible requests.
- **Decision:** Proxy `/api` through Vite in development and serve the frontend/API from one origin initially. Require a cryptographically random session-bound synchronizer token in `X-CSRF-Token` for state-changing requests and validate Origin as defense in depth.
- **Alternatives:** Cross-origin development or relying on SameSite cookies alone.
- **Advantages:** Avoids unnecessary CORS configuration while providing an explicit state-changing-request defense.
- **Trade-offs:** CSRF endpoint/client token lifecycle and production cookie configuration must be implemented and tested; separate origins need additional design.
- **Revisit if:** The frontend and API must be deployed on separate origins.

## D-009: Explicit workflow and participation rules

- **Context:** The initial requirements name required deliverables, role-restricted progress, client review, comments, and terminal decisions, but do not define every transition or whether a deliverable can be optional.
- **Decision:** In the MVP, every deliverable in a milestone is required for milestone completion. Only managers complete milestones; assigned developers may perform only the documented progress transitions. Project completion is a manager action requiring all milestones complete, while a project with no milestones may be manually completed. Client reviews apply once to the exact current submission; approved deliverables and final project/change-request states are terminal. Managers, assigned developers, and owning client users may read/add deliverable comments, but only owning client users may review and only managers may decide change requests.
- **Alternatives:** Add per-deliverable optionality, allow developers to complete milestones, allow managers to approve client deliverables, or permit reopening terminal states.
- **Advantages:** The workflow is implementable with the proposed schema, has clear attribution, and is straightforward to test without introducing fields and exceptional transitions not needed for the MVP.
- **Trade-offs:** All-or-nothing milestone deliverables and terminal approved/completed states are restrictive; reopening or optional deliverables would require explicitly designed history and schema rules.
- **Revisit if:** A real workflow requires optional deliverables, reopening, managers reviewing as clients, or a more detailed milestone completion model. Such changes must update the PRD, data model, API contract, and tests together.

### Phase 0 reconciliation findings

The original requirements and first specification draft contained underspecified edges, not irreconcilable architecture choices. The following baseline resolves them consistently across [PRD.md](PRD.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [DATA_MODEL.md](DATA_MODEL.md):

| Ambiguity found | Consistent MVP design |
| --- | --- |
| Milestone rules refer to “required” deliverables, but the proposed deliverable table has no optionality field. | All deliverables in a milestone are required. No optional flag is modeled until a real use case warrants a migration. |
| Managers can access all agency projects, but approval must represent a real client decision. | Managers retain agency-wide read/work access but cannot approve or request revisions as a client. Only an owning client user can review. |
| `project_manager_id` exists alongside manager-wide access. | It identifies the accountable project manager; it is not the scope of a manager's read authorization. |
| Deliverables keep a current status while submissions/reviews preserve history. | The deliverable row stores current workflow state; each submission and its one final review are separate historical rows. State and audit writes are transactional. |
| Developers and clients are explicitly allowed to comment, while manager comment rights were not stated. | Any authorized manager, assigned developer, or owning client user may read/add deliverable comments. This grants no manager review authority. |
| Milestone completion was defined, but project completion behavior was not. | Project completion is an explicit manager action requiring all milestones complete; zero-milestone projects may be manually completed. It is never inferred from one milestone. |
| Change requests name an `under_review` state and final decisions, but do not say who can withdraw or when. | Only the requesting client may withdraw its own request while submitted or under review; final states are terminal. |
| Cancelled projects cannot receive new work, but the exact blocked operations were not enumerated. | Completed and cancelled projects accept no new milestones, deliverables, submissions, comments, or change requests; authorized historical reads remain available. |

These are explicit MVP policy choices, not claims that the initial requirements mandated every detail. Revisit a row only by updating the PRD, schema design, API contract, and tests together.