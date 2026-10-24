// Restore a backup made by `npm run backup`. STOP THE SERVER FIRST.
// Usage: npm run restore -- backups/luna-2026-10-24T10-00-00 --yes
import fs from 'node:fs';
import path from 'node:path';
import { makeConfig } from '../server/src/config.js';
import { Db } from '../server/src/lib/db.js';

const config = makeConfig();
const src = process.argv[2];
if (!src || !process.argv.includes('--yes')) {
  console.error('Usage: npm run restore -- <backup-folder> --yes   (this REPLACES the current database; stop the server first)');
  process.exit(1);
}
if (!fs.existsSync(src)) { console.error(`Not found: ${src}`); process.exit(1); }
const dbFile = fs.statSync(src).isDirectory() ? path.join(src, 'luna.db') : src;
if (!fs.existsSync(dbFile)) { console.error(`Backup database not found: ${dbFile}`); process.exit(1); }
// integrity check of the backup before touching anything
const probe = new Db(dbFile);
const check = probe.get('PRAGMA integrity_check');
probe.close();
if (Object.values(check)[0] !== 'ok') { console.error('Backup failed integrity_check; aborting.'); process.exit(1); }
if (fs.existsSync(config.databasePath)) {
  const safety = `${config.databasePath}.before-restore-${Date.now()}`;
  fs.copyFileSync(config.databasePath, safety);
  console.log(`Current database saved to ${safety}`);
}
for (const ext of ['-wal', '-shm']) fs.rmSync(config.databasePath + ext, { force: true });
fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
fs.copyFileSync(dbFile, config.databasePath);
const uploads = path.join(path.dirname(dbFile), 'uploads');
if (fs.statSync(src).isDirectory() && fs.existsSync(uploads)) fs.cpSync(uploads, config.uploadDir, { recursive: true });
console.log(`Restored ${dbFile} -> ${config.databasePath}`);
