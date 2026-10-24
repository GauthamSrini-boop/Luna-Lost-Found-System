// Child process used by claims.test.js: its own SQLite connection, approves one claim, prints the HTTP-style status.
import { Db } from '../src/lib/db.js';
import { claimAction } from '../src/services/claims.js';
import { HttpError } from '../src/lib/errors.js';

const [, , dbPath, claimId, userId] = process.argv;
const db = new Db(dbPath);
const user = db.get('SELECT id, email, full_name, role, is_active FROM users WHERE id = ?', Number(userId));
// small shared start barrier so both processes hit the database at nearly the same instant
const startAt = Math.ceil(Date.now() / 1000) * 1000 + 400;
while (Date.now() < startAt) { /* spin */ }
try {
  claimAction(db, user, Number(claimId), { action: 'approve', reason: 'concurrent test' });
  console.log('200');
} catch (e) {
  console.log(e instanceof HttpError ? String(e.status) : `ERR:${e.message}`);
} finally {
  db.close();
}
