# Requirements → implementation → evidence

Legend: ✅ implemented and verified by the stated evidence · 🟡 implemented, only partly verified · ⛔ written/unverified or not done.

| # | Requirement | Where | Status / evidence |
|---|---|---|---|
| 1 | React + Vite client | `client/` | 🟡 code complete; UI exercised through stub harness (23/23); **real `vite build` never run** |
| 2 | Node + Express server | `server/src/app.js` | ⛔ adapter never executed; logic layer ✅ (62 tests via shared route table) |
| 3 | SQLite, PostgreSQL-ready | `server/src/lib/db.js`, migrations | ✅ SQLite (node:sqlite); ⛔ better-sqlite3 and PostgreSQL untested |
| 4 | Register/login/logout, hashing, sessions | `services/auth.js`, `sessions.js` | ✅ `auth.test.js` |
| 5 | Student/staff/admin roles enforced server-side | `lib/access.js`, routes | ✅ role-matrix tests |
| 6 | Lost & found reports (CRUD, validation, status rules) | `services/reports.js` | ✅ `reports.test.js` |
| 7 | Search, filters, sort, pagination | `reports.browse` | ✅ tests; UI 🟡 |
| 8 | Photo upload with validation | `services/photos.js` | ✅ service tests; multer path ⛔ |
| 9 | Deterministic explainable matching | `services/matching.js` | ✅ `matching.test.js` |
| 10 | Claims, verification (info request), approval/rejection | `services/claims.js` | ✅ `claims.test.js` |
| 11 | Transactional handover / return tracking | `claims.js`, `handovers` | ✅ tests |
| 12 | Concurrency safety on claims | indexes + `BEGIN IMMEDIATE` | ✅ two-process test in `database.test.js` |
| 13 | Notifications | `services/notifications.js` | ✅ tests; in-app only |
| 14 | Dashboards (user, staff, admin) + insights | `dashboard.js`, `insights.js` | ✅ tests; UI 🟡 |
| 15 | Admin: users, catalogues, moderation, audit | `services/admin.js` | ✅ tests; UI 🟡 |
| 16 | Migrations | `server/migrations`, `db/migrate.js` | ✅ checksum-tracked, tested |
| 17 | ER diagram, data dictionary | `docs/er-diagram.md`, `docs/data-dictionary.md` | ✅ generated from real schema |
| 18 | SQL examples (joins, aggregates, CTE, subqueries, constraints) | `docs/sql-examples.sql` | ✅ 30/30 via `npm run explain` |
| 19 | Responsive, accessible UI | `client/src/styles`, components | 🟡 checked in stub harness (mobile no-overflow, skip link, keyboard, labels); no axe/screen-reader audit |
| 20 | Automated tests | `server/tests`, `client/tests` | ✅ 62 server + 10 unit pass; ⛔ vitest/RTL component tests unrun |
| 21 | Production build | `npm run build` | ⛔ not run (Vite unavailable) |
| 22 | README, API docs, deployment guide | `README.md`, `docs/` | ✅ written; API schemas not formal (no OpenAPI) |
| 23 | Security review | `docs/security.md` | 🟡 inspection + tests; no `npm audit`, no pen test |
| 24 | Windows/PowerShell run instructions | `README.md` | ⛔ never run on Windows |
| 25 | Backup/restore | `scripts/backup.js`, `restore.js` | ✅ script runs verified on Linux |
| 26 | Lockfile | — | ⛔ not generated (offline) |
