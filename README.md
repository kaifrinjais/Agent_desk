# AgencyDesk

AgencyDesk is a B2B client project delivery and approval management system for one small web/software agency. This repository is being built in phases. Phases 1-6 currently provide the React/Vite client, Express API, SQLite schema/migrations/seed, server-side sessions, CSRF/Origin protection, client/project management, milestone tracking, versioned deliverable review, comments, change requests, and activity history. Dashboard analytics and final hardening/polish remain future phases.

## Requirements

- Node.js 24 LTS (`.nvmrc` is set to `24`)
- npm 10 or later

The project targets Node 24. If `node --version` shows a different major version, switch runtimes before installing dependencies. For local use, make a private environment file from `.env.example` and adjust only the settings you need.

## Setup

```powershell
npm ci
Copy-Item .env.example .env
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
# Put the generated value in SESSION_SECRET in .env; set a private SEED_PASSWORD of at least 12 characters.
npm run db:migrate --workspace server
npm run db:seed --workspace server
npm run dev
```

The frontend is served by Vite at `http://127.0.0.1:5173`. The Express API listens on `http://127.0.0.1:3000`; Vite proxies `/api` requests to it. `CLIENT_ORIGIN` must match the browser origin exactly.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the API and frontend together; stops both if either process exits. |
| `npm run build` | Create the frontend production build in `client/dist`. |
| `npm run lint` | Lint client and server JavaScript with ESLint. |
| `npm test` | Run server database/auth/workflow tests and client React interaction tests. |
| `npm run check` | Run lint, tests, and the frontend production build. |
| `npm run db:migrate --workspace server` | Apply pending checksummed SQL migrations. Server startup also applies pending migrations. |
| `npm run db:seed --workspace server` | Add deterministic local demo data without deleting or resetting existing records. Requires `SEED_PASSWORD` of at least 12 characters. |

## API foundation

- `GET /api/health` returns `{ "data": { "status": "ok" } }`.
- Unknown routes return the documented JSON error envelope. See [docs/API.md](docs/API.md).
- Runtime variables are validated at startup. The HTTP server requires a random `SESSION_SECRET` of at least 32 characters. See `.env.example`.

## Authentication and database

The API uses password hashes and server-side SQLite sessions. After logging in as a client seed account, change its temporary password with `POST /api/auth/change-password` before reading project data. Local seeded accounts are `manager@agencydesk.test`, `developer@agencydesk.test`, `riley@agencydesk.test`, `client@northstar.test`, and `client@fieldnotes.test`; they use the locally configured `SEED_PASSWORD`. These accounts and credentials are only for local demonstrations.

Project and workflow endpoints are role-scoped on the server. Managers can create client organizations/projects and assign developers; developers work only on assigned projects; clients see only their own organization's projects. See [docs/API.md](docs/API.md) for available routes and [docs/SECURITY.md](docs/SECURITY.md) for remaining limitations.

See [docs/PRD.md](docs/PRD.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DATA_MODEL.md](docs/DATA_MODEL.md), and [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) for product scope and later phases.