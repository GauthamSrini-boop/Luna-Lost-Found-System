// DEVELOPMENT-ONLY demo data. Run deliberately with: npm run seed
// Everything created here is labelled "[DEMO]" and goes through the real services, so it follows all business rules.
import { makeConfig } from '../server/src/config.js';
import { Db } from '../server/src/lib/db.js';
import { migrate } from '../server/src/db/migrate.js';
import { hashPassword } from '../server/src/lib/password.js';
import { createReport, changeStatus } from '../server/src/services/reports.js';
import { submitClaim, claimAction } from '../server/src/services/claims.js';

const config = makeConfig();
if (config.nodeEnv === 'production' && !process.argv.includes('--force')) {
  console.error('Refusing to seed demo data when NODE_ENV=production (use --force if you really mean it).');
  process.exit(1);
}
const db = new Db(config.databasePath);
migrate(db);
if (db.get("SELECT 1 x FROM users WHERE email = 'demo-student@luna.demo'")) {
  console.log('Demo data already present. Nothing to do.');
  db.close();
  process.exit(0);
}
const PASSWORD = 'DemoPass123';
const hash = await hashPassword(PASSWORD);
const mk = (email, name, role) => {
  const id = Number(db.run('INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, ?, ?)', email, hash, name, role).lastInsertRowid);
  return { id, role, email, full_name: name, is_active: 1 };
};
const admin = mk('demo-admin@luna.demo', '[DEMO] Admin Ada', 'admin');
const staff = mk('demo-staff@luna.demo', '[DEMO] Staff Sam', 'staff');
const s1 = mk('demo-student@luna.demo', '[DEMO] Student Asha', 'student');
const s2 = mk('demo-student2@luna.demo', '[DEMO] Student Ravi', 'student');
const cat = (n) => db.get('SELECT id FROM categories WHERE name = ?', n).id;
const loc = (n) => db.get('SELECT id FROM campus_locations WHERE name = ?', n).id;
const day = (back) => new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);

createReport(db, s1, 'lost', { title: '[DEMO] Black laptop bag', category_id: cat('Bags & Backpacks'), description: 'Black laptop bag with a red zipper pull, left on a table', distinguishing_details: 'Keychain shaped like a fox', last_seen_date: day(2), location_id: loc('Main Library'), contact_preference: 'email' });
createReport(db, s1, 'lost', { title: '[DEMO] Blue water bottle', category_id: cat('Water Bottles'), description: 'Blue steel water bottle with university sticker', last_seen_date: day(4), location_id: loc('Sports Complex') });
const f1 = createReport(db, s2, 'found', { title: '[DEMO] Black bag found', category_id: cat('Bags & Backpacks'), description: 'Black bag with red zipper found on a library table', distinguishing_details: 'Fox keychain, textbook inside', found_date: day(1), location_id: loc('Main Library'), storage_status: 'handed_to_security' });
changeStatus(db, staff, 'found', f1.id, { to: 'stored', note: 'Held at security office' });
const f2 = createReport(db, s2, 'found', { title: '[DEMO] Calculus textbook', category_id: cat('Books & Stationery'), description: 'Calculus textbook with highlighted pages', found_date: day(3), location_id: loc('Science Block') });
changeStatus(db, staff, 'found', f2.id, { to: 'stored' });
const claim = submitClaim(db, s1, f1.id, { explanation: 'It is my bag. It has a fox keychain and my physics textbook inside.' });
claimAction(db, staff, claim.id, { action: 'start_review' });
const f3 = createReport(db, s1, 'found', { title: '[DEMO] Silver keys', category_id: cat('Keys'), description: 'Set of silver keys on a ring', found_date: day(9), location_id: loc('Cafeteria') });
void admin; void f3;
console.log('Demo data created. Sign in with password "' + PASSWORD + '":');
for (const u of [admin, staff, s1, s2]) console.log(`  ${u.role.padEnd(8)} ${u.email}`);
db.close();
