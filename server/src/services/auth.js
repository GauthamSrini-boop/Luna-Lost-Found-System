import { HttpError, forbidden } from '../lib/errors.js';
import { isConstraintError } from '../lib/db.js';
import { validate, v } from '../lib/validate.js';
import { hashPassword, verifyPassword, DUMMY_HASH } from '../lib/password.js';
import { createSession, destroyUserSessions } from './sessions.js';
import { audit } from './notifications.js';

const PUBLIC = 'id, email, full_name, student_id, phone, role, is_active, created_at';
export const publicUser = (db, id) => db.get(`SELECT ${PUBLIC} FROM users WHERE id = ?`, id);

const registerSchema = {
  email: v.email(),
  password: v.password(),
  full_name: v.str({ min: 2, max: 100 }),
  student_id: v.str({ min: 3, max: 30, optional: true }),
  phone: v.str({ min: 5, max: 20, optional: true }),
};

export async function register(db, config, body) {
  const input = validate(body, registerSchema);
  const hash = await hashPassword(input.password);
  let id;
  try {
    id = db.run(
      "INSERT INTO users (email, password_hash, full_name, student_id, phone, role) VALUES (?, ?, ?, ?, ?, 'student')",
      input.email, hash, input.full_name, input.student_id, input.phone,
    ).lastInsertRowid;
  } catch (e) {
    if (isConstraintError(e, 'UNIQUE')) {
      const field = String(e.message).includes('student_id') ? 'student_id' : 'email';
      throw new HttpError(409, field === 'email' ? 'An account with this email already exists' : 'That student ID is already registered', { [field]: 'Already in use' });
    }
    throw e;
  }
  audit(db, id, 'user.register', 'user', Number(id));
  return { user: publicUser(db, id), session: createSession(db, config, id) };
}

export async function login(db, config, body, ip = 'unknown') {
  const input = validate(body, { email: v.str({ min: 3, max: 254 }), password: v.str({ min: 1, max: 128 }) });
  const email = input.email.toLowerCase();
  const since = new Date(Date.now() - config.loginWindowMs).toISOString();
  const failures = db.get('SELECT COUNT(*) n FROM login_attempts WHERE email = ? AND created_at > ?', email, since).n;
  if (failures >= config.loginMaxAttempts) {
    throw new HttpError(429, 'Too many failed sign-in attempts. Please wait and try again later.');
  }
  const row = db.get('SELECT * FROM users WHERE email = ?', email);
  const ok = await verifyPassword(input.password, row ? row.password_hash : DUMMY_HASH);
  if (!row || !ok) {
    db.run('INSERT INTO login_attempts (email, ip) VALUES (?, ?)', email, ip);
    throw new HttpError(401, 'Invalid email or password');
  }
  if (!row.is_active) throw forbidden('This account has been deactivated. Contact an administrator.');
  db.run('DELETE FROM login_attempts WHERE email = ?', email);
  return { user: publicUser(db, row.id), session: createSession(db, config, row.id) };
}

export function updateProfile(db, user, body) {
  const input = validate(
    body,
    { full_name: v.str({ min: 2, max: 100 }), student_id: v.str({ min: 3, max: 30, optional: true }), phone: v.str({ min: 5, max: 20, optional: true }) },
    { partial: true },
  );
  const merged = { full_name: user.full_name, student_id: user.student_id, phone: user.phone, ...input };
  try {
    db.run('UPDATE users SET full_name = ?, student_id = ?, phone = ? WHERE id = ?', merged.full_name, merged.student_id, merged.phone, user.id);
  } catch (e) {
    if (isConstraintError(e, 'UNIQUE')) throw new HttpError(409, 'That student ID is already registered', { student_id: 'Already in use' });
    throw e;
  }
  return publicUser(db, user.id);
}

export async function changePassword(db, config, user, body, currentToken) {
  const input = validate(body, { current_password: v.str({ min: 1, max: 128 }), new_password: v.password() });
  const row = db.get('SELECT password_hash FROM users WHERE id = ?', user.id);
  if (!(await verifyPassword(input.current_password, row.password_hash))) {
    throw new HttpError(422, 'Current password is incorrect', { current_password: 'Incorrect password' });
  }
  db.run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(input.new_password), user.id);
  destroyUserSessions(db, user.id, currentToken, config); // sign out other devices
  audit(db, user.id, 'user.password_change', 'user', user.id);
}
