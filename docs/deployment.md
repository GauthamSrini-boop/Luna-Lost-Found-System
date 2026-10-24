# Deployment guide

**Not deployed or tested on any hosting platform.** These are instructions, not evidence.

1. Node.js 22.13+, `npm ci` (after you commit the lockfile from your first `npm install`).
2. Set environment (see `.env.example`): `NODE_ENV=production`, `SESSION_SECRET` (32+ random chars; the server refuses to start otherwise), `DATABASE_PATH`, `UPLOAD_DIR` on persistent disk, `TRUST_PROXY=1` if behind a reverse proxy.
3. `npm run build` → `npm run migrate` → `npm run create-admin -- --email … --name …` → `npm run start`.
4. Put a TLS-terminating reverse proxy (nginx, Caddy, IIS ARR) in front; cookies are `Secure` in production. Same-origin serving (Express serves `client/dist`) means no CORS configuration is needed; if you host the UI separately you must add CORS with credentials and adjust SameSite — not implemented.
5. Back up: schedule `npm run backup`; test `npm run restore -- <file> --yes` on a copy.
6. Do not run `npm run seed` in production.

## Moving to PostgreSQL
See `postgres-notes.md`. It requires a new `Db` driver and migration review; it has not been attempted.
