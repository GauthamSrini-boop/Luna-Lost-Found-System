// Minimal SQL migration runner. Applies server/migrations/*.sql in filename order,
// each inside a transaction, and records them in schema_migrations (with a checksum
// so edits to an already-applied migration are detected).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Db } from '../lib/db.js';
import { makeConfig, ROOT } from '../config.js';

export const MIGRATIONS_DIR = path.join(ROOT, 'server', 'migrations');

export function migrate(db, dir = MIGRATIONS_DIR, log = () => {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
  const applied = new Map(db.all('SELECT name, checksum FROM schema_migrations').map((r) => [r.name, r.checksum]));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const ran = [];
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    if (applied.has(file)) {
      if (applied.get(file) !== checksum) {
        throw new Error(`Migration ${file} was modified after being applied. Create a new migration instead.`);
      }
      continue;
    }
    db.tx(() => {
      db.exec(sql);
      db.run('INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)', file, checksum);
    });
    log(`applied ${file}`);
    ran.push(file);
  }
  return ran;
}

export function migrationStatus(db, dir = MIGRATIONS_DIR) {
  // Read-only: must not create schema_migrations (a differently-defined table would break migrate()).
  const has = db.get("SELECT 1 x FROM sqlite_master WHERE type='table' AND name='schema_migrations'");
  const applied = new Set(has ? db.all('SELECT name FROM schema_migrations').map((r) => r.name) : []);
  return fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => ({ name: f, applied: applied.has(f) }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cfg = makeConfig();
  const db = new Db(cfg.databasePath);
  try {
    if (process.argv.includes('--status')) {
      for (const m of migrationStatus(db)) console.log(`${m.applied ? '[x]' : '[ ]'} ${m.name}`);
    } else {
      const ran = migrate(db, MIGRATIONS_DIR, console.log);
      console.log(ran.length ? `Done. ${ran.length} migration(s) applied to ${cfg.databasePath}` : 'Database is up to date.');
    }
  } finally {
    db.close();
  }
}
