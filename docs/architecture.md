# Architecture

```
React (Vite)  --/api-->  Express adapter (server/src/app.js)
                              │  guard: CSRF header → session → authorize(access, user)
                              ▼
                    Route table (server/src/routes/index.js)   ← also driven directly by the tests
                              ▼
                    Services (server/src/services/*)  — all business rules, transactions
                              ▼
                    Db wrapper (server/src/lib/db.js) → better-sqlite3 (preferred) | node:sqlite
```

- **Framework-neutral route table**: each route is `{method, path, access, handler}`. Both the Express adapter and the test dispatcher call the same `authorize()` and `checkCsrf()`, so role and CSRF enforcement are exercised by the automated tests even though Express itself could not be installed in the build sandbox.
- **Services** hold rules and state machines; routes only translate HTTP ⇄ service calls.
- **Transactions**: `Db.tx` uses `BEGIN IMMEDIATE` (nested → SAVEPOINT). Approving a claim + handover + status changes + notifications + audit happen atomically.
- **Race protection (claims)**: application re-check inside the transaction, write lock via `BEGIN IMMEDIATE`, and DB constraints (`ux_claims_single_winner` partial unique index; `handovers.found_report_id UNIQUE`).
- **PostgreSQL readiness**: plain SQL, positional parameters, TEXT ISO timestamps, no SQLite-only features in services except `strftime` defaults and `INSERT … RETURNING`-style helpers listed in `postgres-notes.md`.

## State machines
- Lost: `open → resolved | withdrawn`, `withdrawn → open`.
- Found: `reported → under_review → stored → claim_pending → returned → archived`; `claim_pending` and `returned` are set only by the claim workflow.
- Claim: `submitted → under_review → info_requested | approved | rejected | withdrawn`, `approved → completed` (handover).

## Matching
Deterministic score (0–100): category 25, keywords 30, date proximity 15, location 20 (10 same zone), colour 10. Minimum 40; incompatible if found before last-seen or >30 days apart. Only public fields are compared; each match stores its reasons. A match never grants access to private details.

## Privacy model
Private distinguishing details, claim explanations and reporter identity are visible only to the owner/claimant and staff; unrelated users receive 404 (not 403) to avoid confirming existence.
