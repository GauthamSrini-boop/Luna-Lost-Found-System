# PostgreSQL notes (UNVERIFIED — nothing here has been run)

The SQL is deliberately conventional, but expect to change:
- `INTEGER PRIMARY KEY` → `GENERATED ALWAYS AS IDENTITY`; `strftime('%Y-%m-%dT%H:%M:%fZ','now')` defaults → `now()` / `timestamptz`.
- `updated_at` triggers → `plpgsql` trigger function.
- Partial unique index `ux_claims_single_winner` works as-is in PostgreSQL.
- `BEGIN IMMEDIATE` → `BEGIN` plus `SELECT … FOR UPDATE` on the found report row.
- `PRAGMA` calls in `Db`, `?` placeholders → `$1…`, `INSERT … lastInsertRowid` → `RETURNING id`.
- `docs/sql-examples.sql` uses SQLite date functions in places.
- `COLLATE NOCASE` (sorting) and `LIKE … ESCAPE` (search; SQLite LIKE is case-insensitive for ASCII, PostgreSQL's is not) → `ILIKE` or `citext`.
Add a `pg` driver implementing the `Db` interface (`get/all/run/exec/tx`) and run the whole backend suite against it before trusting it.
