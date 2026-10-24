// Consistent online backup of the SQLite database (VACUUM INTO is safe while the server is running) + uploaded photos.
// Usage: npm run backup            -> backups/luna-<timestamp>/{luna.db, uploads/}
import fs from 'node:fs';
import path from 'node:path';
import { makeConfig, ROOT } from '../server/src/config.js';
import { Db } from '../server/src/lib/db.js';

const config = makeConfig();
if (!fs.existsSync(config.databasePath)) { console.error(`No database at ${config.databasePath}`); process.exit(1); }
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dir = path.join(ROOT, 'backups', `luna-${stamp}`);
fs.mkdirSync(dir, { recursive: true });
const db = new Db(config.databasePath);
db.exec(`VACUUM INTO '${path.join(dir, 'luna.db').replace(/'/g, "''")}'`);
db.close();
if (fs.existsSync(config.uploadDir)) fs.cpSync(config.uploadDir, path.join(dir, 'uploads'), { recursive: true });
console.log(`Backup written to ${dir}`);
