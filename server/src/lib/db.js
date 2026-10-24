// Thin wrapper over node:sqlite (Node's built-in SQLite). All SQL in LUNA uses
// positional "?" parameters, never string concatenation of user input.
import fs from 'node:fs';
import path from 'node:path';

// Driver selection: prefer better-sqlite3 (declared as an optional dependency, best choice for
// Windows/production) and fall back to Node's built-in node:sqlite (Node >= 22.13).
// Both expose prepare().get/all/run and exec(), so the rest of the app is driver-agnostic.
let BetterSqlite3 = null;
try { BetterSqlite3 = (await import('better-sqlite3')).default; } catch { /* not installed */ }
let NodeSqlite = null;
if (!BetterSqlite3) {
  try { NodeSqlite = (await import('node:sqlite')).DatabaseSync; } catch { /* unavailable */ }
}
export const driverName = BetterSqlite3 ? 'better-sqlite3' : NodeSqlite ? 'node:sqlite' : 'none';

const clean = (params) => params.map((p) => (p === undefined ? null : p));

export class Db {
  constructor(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.file = file;
    if (BetterSqlite3) this.raw = new BetterSqlite3(file);
    else if (NodeSqlite) this.raw = new NodeSqlite(file);
    else throw new Error('No SQLite driver available: install better-sqlite3 or use Node >= 22.13');
    // Referential integrity is OFF by default in SQLite, so enable it per connection.
    this.raw.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (file !== ':memory:') this.raw.exec('PRAGMA journal_mode = WAL;');
    this.depth = 0;
    this.cache = new Map();
  }
  stmt(sql) {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }
  get(sql, ...p) { return this.stmt(sql).get(...clean(p)); }
  all(sql, ...p) { return this.stmt(sql).all(...clean(p)); }
  run(sql, ...p) { return this.stmt(sql).run(...clean(p)); }
  exec(sql) { this.raw.exec(sql); }
  /**
   * Run fn inside a transaction. BEGIN IMMEDIATE takes the write lock up front so
   * check-then-write sequences (e.g. approving a claim) cannot interleave with another writer.
   * Nested calls use SAVEPOINTs. Any thrown error rolls everything back.
   */
  tx(fn) {
    if (this.depth === 0) {
      this.raw.exec('BEGIN IMMEDIATE');
      this.depth = 1;
      try {
        const r = fn();
        this.raw.exec('COMMIT');
        return r;
      } catch (e) {
        try { this.raw.exec('ROLLBACK'); } catch { /* already rolled back */ }
        throw e;
      } finally {
        this.depth = 0;
      }
    }
    const name = `sp_${this.depth++}`;
    this.raw.exec(`SAVEPOINT ${name}`);
    try {
      const r = fn();
      this.raw.exec(`RELEASE ${name}`);
      return r;
    } catch (e) {
      this.raw.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
      throw e;
    } finally {
      this.depth--;
    }
  }
  close() {
    this.cache.clear();
    this.raw.close();
  }
}

export const isConstraintError = (e, kind) =>
  typeof e?.message === 'string' && e.message.includes(`${kind} constraint failed`);
