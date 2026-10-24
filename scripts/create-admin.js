// Create (or promote) an administrator account.
// Usage (PowerShell): $env:LUNA_ADMIN_PASSWORD="ChangeMe123"; npm run create-admin -- --email you@campus.edu --name "Your Name"
import { makeConfig } from '../server/src/config.js';
import { Db } from '../server/src/lib/db.js';
import { migrate } from '../server/src/db/migrate.js';
import { hashPassword } from '../server/src/lib/password.js';
import { validate, v } from '../server/src/lib/validate.js';

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; };
const password = process.env.LUNA_ADMIN_PASSWORD || arg('password');
let input;
try {
  input = validate({ email: arg('email'), full_name: arg('name'), password }, { email: v.email(), full_name: v.str({ min: 2, max: 100 }), password: v.password() });
} catch (e) {
  console.error('Invalid input:', JSON.stringify(e.fields || e.message));
  console.error('Usage: npm run create-admin -- --email you@campus.edu --name "Your Name"   (password via LUNA_ADMIN_PASSWORD env var)');
  process.exit(1);
}
const db = new Db(makeConfig().databasePath);
migrate(db);
const hash = await hashPassword(input.password);
const existing = db.get('SELECT id FROM users WHERE email = ?', input.email);
if (existing) {
  db.run("UPDATE users SET role = 'admin', is_active = 1, password_hash = ? WHERE id = ?", hash, existing.id);
  console.log(`Existing account ${input.email} promoted to admin and password reset.`);
} else {
  db.run("INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, ?, 'admin')", input.email, hash, input.full_name);
  console.log(`Admin account created for ${input.email}.`);
}
db.close();
