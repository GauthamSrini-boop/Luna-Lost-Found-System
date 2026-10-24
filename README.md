# LUNA — Lost & Found Network

A campus lost-and-found system: students and staff report lost/found items, LUNA suggests explainable matches, owners submit claims, staff verify and record the handover, and admins manage users, catalogues, moderation and audit logs.

**Stack:** React 19 + Vite + React Router (client) · Node.js + Express (server) · SQLite (PostgreSQL-ready SQL design).

## Verification status — read this first

This project was built in a sandbox where the npm registry returned **HTTP 403**, so `express`, `vite`, `react`, `react-router-dom`, `better-sqlite3`, `helmet`, `multer`, `vitest` etc. could **not be installed**. Work that does not need them was verified; the rest is written but **unverified**. Nothing below is claimed beyond its evidence.

| Area | Status | Evidence |
|---|---|---|
| Business logic: auth, roles, reports, search, matching, claims, handover, notifications, admin, audit | **Verified** | 62 backend tests pass (`npm run test:server`) via the shared route table incl. server-side role checks |
| Claim race condition (two staff approving different claims for one item) | **Verified** | real two-process test; guarded by app re-check, `BEGIN IMMEDIATE`, and unique index |
| Schema, migrations, constraints, `docs/sql-examples.sql` (30 sections) | **Verified** | `npm run explain` → 30/30 behave as documented; plans in `docs/query-plans.md` |
| Client validation logic | **Verified** | 10 unit tests (`npm run test:client:unit`) |
| UI behaviour end-to-end (register → report → match → claim → handover, admin, mobile layout) | **Partially verified** | 23/23 Playwright checks passed, but against a *stub harness* (React bundled with esbuild + a minimal router stub + a plain `node:http` server around the real route table) — **not** the real Vite / React Router / Express |
| Express adapter `server/src/app.js` (helmet, rate limits, multer, cookies, static) | **UNVERIFIED** | syntax-checked only; never executed |
| `vite build`, real `react-router-dom` | **UNVERIFIED** | not installed |
| Vitest + Testing Library component tests (`client/tests/components`) | **Written, NEVER RUN** | dependencies unavailable |
| `better-sqlite3` driver path | **UNVERIFIED** | tests ran on `node:sqlite` (Node ≥ 22.13 built in) |
| PostgreSQL | **UNVERIFIED** | design notes only, see `docs/postgres-notes.md` |
| `package-lock.json` | **Missing** | cannot be generated offline; `npm install` creates it |
| Accessibility | Keyboard/skip-link/labels checked in the stub harness only; no screen reader or automated axe audit | — |

Expect that the first real `npm install && npm test && npm run build` on your machine may reveal fixable integration problems in the unverified rows. Please run the commands below and treat failures there as expected-possible, not as proof the logic layer is wrong.

**Dependency declaration:** all packages imported by the code are declared (server: express, helmet, cookie-parser, express-rate-limit, multer, optional better-sqlite3; client: react, react-dom, react-router-dom, vite, @vitejs/plugin-react, vitest, jsdom, @testing-library/{react,dom,jest-dom,user-event}, playwright). This was checked by comparing imports with `package.json` — the packages themselves were never installed here, so version ranges are **unresolved** until your first `npm install`. No `package-lock.json` is included on purpose (it cannot be generated offline and must not be fabricated); commit the one `npm install` creates.

## Run locally (Windows PowerShell / VS Code)

Requires **Node.js 22.13+** (declared in `engines`) and npm.

```powershell
cd luna
npm install
Copy-Item .env.example .env
# edit .env: set SESSION_SECRET (32+ chars). Generate one:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
npm run migrate
$env:LUNA_ADMIN_PASSWORD="ChangeMe-Long-Passw0rd"; npm run create-admin -- --email admin@example.edu --name "Site Admin"
npm run seed          # optional: clearly labelled [DEMO] data (accounts demo-admin@luna.demo, demo-staff@luna.demo, demo-student@luna.demo; password DemoPass123) — refuses to run in production without `--force`; never use it there
```

Development (two terminals):

```powershell
npm run dev:server    # API on http://localhost:3000
npm run dev:client    # UI on http://localhost:5173 (proxies /api and /uploads)
```

Production-style (single process serves the built UI):

```powershell
npm run build
$env:NODE_ENV="production"; npm run start
```

## Scripts

| Command | Purpose |
|---|---|
| `npm test` | server tests + client unit + client component tests |
| `npm run test:server` / `test:client:unit` / `test:client` | individual suites |
| `npm run test:e2e` | Playwright walkthrough against a **running** app (`E2E_BASE_URL`, `E2E_STAFF_EMAIL`, `E2E_ADMIN_EMAIL`; needs `npx playwright install chromium`) |
| `npm run migrate` / `migrate:status` | apply / inspect migrations (checksummed) |
| `npm run explain` | run `docs/sql-examples.sql`, assert expectations, regenerate `docs/query-plans.md` |
| `npm run docs:generate` | regenerate data dictionary, ER diagram, route table from the real schema/routes |
| `npm run backup` / `restore` | consistent SQLite backup; restore needs `--yes`, checks integrity, keeps a safety copy |

## Roles
- **student** – report lost/found, browse, claim, manage own reports.
- **staff** – everything above plus review found items, matches, claims, record handovers.
- **admin** – staff plus users, catalogues, moderation, insights, audit log.
Enforced server-side per route (`server/src/lib/access.js`), not just by hiding UI.

## Documentation
`docs/architecture.md` · `docs/api.md` + `docs/api-routes.md` · `docs/data-dictionary.md` · `docs/er-diagram.md` · `docs/sql-examples.sql` · `docs/query-plans.md` · `docs/security.md` · `docs/deployment.md` · `docs/postgres-notes.md` · `docs/requirements-checklist.md`

## Known limitations
- No email/SMS delivery: notifications are in-app only.
- Photo storage is local disk behind a `LocalDiskStorage` abstraction (swap for S3 etc. in production).
- Matching is rule-based and deterministic by design (no ML); scores are suggestions only.
- Rate limiting is per-process (in-memory); behind multiple instances use a shared store.
- No self-service password reset (needs email); admins can deactivate accounts.
