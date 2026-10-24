import { HttpError, notFound } from '../lib/errors.js';
import { isConstraintError } from '../lib/db.js';
import { validate, v, likeEscape } from '../lib/validate.js';
import { hashPassword } from '../lib/password.js';
import { destroyUserSessions } from './sessions.js';
import { audit, notify } from './notifications.js';
import { parseType, REPORT, browse, recordStatus } from './reports.js';
import { refreshMatchesForLost, refreshMatchesForFound } from './matching.js';

export function listUsers(db, query = {}) {
  const q = validate(
    { q: query.q, role: query.role, active: query.active, page: query.page ?? 1, page_size: query.page_size ?? 20 },
    { q: v.str({ max: 100, optional: true }), role: v.oneOf(['student', 'staff', 'admin'], { optional: true }), active: v.oneOf(['0', '1'], { optional: true }), page: v.int({ min: 1, max: 10000 }), page_size: v.int({ min: 1, max: 50 }) },
  );
  const where = [];
  const params = [];
  if (q.q) { where.push("(full_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR student_id LIKE ? ESCAPE '\\')"); const l = `%${likeEscape(q.q)}%`; params.push(l, l, l); }
  if (q.role) { where.push('role = ?'); params.push(q.role); }
  if (q.active) { where.push('is_active = ?'); params.push(Number(q.active)); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.get(`SELECT COUNT(*) n FROM users ${w}`, ...params).n;
  const items = db.all(`SELECT id, email, full_name, student_id, role, is_active, created_at FROM users ${w} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, ...params, q.page_size, (q.page - 1) * q.page_size);
  return { items, total, page: q.page, page_size: q.page_size, total_pages: Math.max(1, Math.ceil(total / q.page_size)) };
}

export async function createUser(db, actor, body) {
  const input = validate(body, { email: v.email(), password: v.password(), full_name: v.str({ min: 2, max: 100 }), role: v.oneOf(['student', 'staff', 'admin']) });
  const hash = await hashPassword(input.password);
  try {
    const id = Number(db.run('INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, ?, ?)', input.email, hash, input.full_name, input.role).lastInsertRowid);
    audit(db, actor.id, 'user.create', 'user', id, `role=${input.role}`);
    return db.get('SELECT id, email, full_name, role, is_active, created_at FROM users WHERE id = ?', id);
  } catch (e) {
    if (isConstraintError(e, 'UNIQUE')) throw new HttpError(409, 'An account with this email already exists', { email: 'Already in use' });
    throw e;
  }
}

export function updateUser(db, actor, id, body) {
  const input = validate(body, { role: v.oneOf(['student', 'staff', 'admin']), is_active: v.bool() }, { partial: true });
  if (Object.keys(input).length === 0) throw new HttpError(400, 'No changes supplied');
  return db.tx(() => {
    const target = db.get('SELECT id, role, is_active FROM users WHERE id = ?', id);
    if (!target) throw notFound('User not found');
    if (target.id === actor.id && (input.is_active === false || (input.role && input.role !== 'admin'))) {
      throw new HttpError(409, 'You cannot deactivate or demote your own account');
    }
    const newRole = input.role ?? target.role;
    const newActive = input.is_active === undefined ? target.is_active : input.is_active ? 1 : 0;
    const losesAdmin = target.role === 'admin' && target.is_active && (newRole !== 'admin' || !newActive);
    if (losesAdmin && db.get("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND is_active = 1").n <= 1) {
      throw new HttpError(409, 'At least one active administrator must remain');
    }
    db.run('UPDATE users SET role = ?, is_active = ? WHERE id = ?', newRole, newActive, id);
    if (!newActive) destroyUserSessions(db, id); // deactivation signs the user out everywhere immediately
    audit(db, actor.id, 'user.update', 'user', id, JSON.stringify(input));
    return db.get('SELECT id, email, full_name, student_id, role, is_active, created_at FROM users WHERE id = ?', id);
  });
}

// ----- categories & locations (deactivate instead of delete so history stays intact) -----
const REF = {
  categories: { table: 'categories', schema: { name: v.str({ min: 2, max: 60 }) } },
  locations: { table: 'campus_locations', schema: { name: v.str({ min: 2, max: 80 }), zone: v.str({ min: 2, max: 40 }) } },
};
export function listRef(db, kind, { includeInactive = false } = {}) {
  const t = REF[kind].table;
  return db.all(`SELECT * FROM ${t} ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY name COLLATE NOCASE`);
}
export function createRef(db, actor, kind, body) {
  const schema = kind === 'locations' ? { ...REF[kind].schema, zone: v.str({ min: 2, max: 40, optional: true }) } : REF[kind].schema;
  const input = validate(body, schema);
  try {
    const cols = Object.keys(input).filter((k) => input[k] != null);
    const id = Number(db.run(`INSERT INTO ${REF[kind].table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map((c) => input[c])).lastInsertRowid);
    audit(db, actor.id, `${kind}.create`, kind, id, input.name);
    return db.get(`SELECT * FROM ${REF[kind].table} WHERE id = ?`, id);
  } catch (e) {
    if (isConstraintError(e, 'UNIQUE')) throw new HttpError(409, 'That name already exists', { name: 'Already exists' });
    throw e;
  }
}
export function updateRef(db, actor, kind, id, body) {
  const input = validate(body, { ...REF[kind].schema, is_active: v.bool() }, { partial: true });
  const cols = Object.keys(input);
  if (!cols.length) throw new HttpError(400, 'No changes supplied');
  if (!db.get(`SELECT 1 x FROM ${REF[kind].table} WHERE id = ?`, id)) throw notFound('Not found');
  try {
    db.run(`UPDATE ${REF[kind].table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...cols.map((c) => (typeof input[c] === 'boolean' ? Number(input[c]) : input[c])), id);
  } catch (e) {
    if (isConstraintError(e, 'UNIQUE')) throw new HttpError(409, 'That name already exists', { name: 'Already exists' });
    throw e;
  }
  audit(db, actor.id, `${kind}.update`, kind, id, JSON.stringify(input));
  return db.get(`SELECT * FROM ${REF[kind].table} WHERE id = ?`, id);
}

// ----- moderation -----
export function moderationQueue(db, user, query) {
  const flagged = db.all(
    `SELECT f.report_type AS type, f.report_id AS id, COUNT(*) AS flags, MAX(f.created_at) AS last_flagged, GROUP_CONCAT(f.reason, ' | ') AS reasons,
            COALESCE(l.title, fr.title) AS title, COALESCE(l.is_hidden, fr.is_hidden) AS is_hidden
       FROM report_flags f LEFT JOIN lost_reports l ON f.report_type = 'lost' AND l.id = f.report_id
       LEFT JOIN found_reports fr ON f.report_type = 'found' AND fr.id = f.report_id
      WHERE f.status = 'open' GROUP BY f.report_type, f.report_id ORDER BY flags DESC, last_flagged DESC`);
  return { flagged, reports: browse(db, user, { ...query, status: query?.status }, { includeHidden: true }) };
}
export function moderateReport(db, actor, type, id, body) {
  parseType(type);
  const input = validate(body, { hidden: v.bool(), reason: v.str({ min: 3, max: 500, optional: true }) });
  if (input.hidden && !input.reason) throw new HttpError(422, 'Please correct the highlighted fields', { reason: 'A reason is required when hiding a report' });
  const cfg = REPORT[type];
  return db.tx(() => {
    const r = db.get(`SELECT id, user_id, title, status, is_hidden FROM ${cfg.table} WHERE id = ?`, id);
    if (!r) throw notFound('Report not found');
    db.run(`UPDATE ${cfg.table} SET is_hidden = ?, hidden_reason = ? WHERE id = ?`, input.hidden ? 1 : 0, input.hidden ? input.reason : null, id);
    db.run("UPDATE report_flags SET status = 'resolved' WHERE report_type = ? AND report_id = ? AND status = 'open'", type, id);
    recordStatus(db, type, id, r.status, r.status, actor.id, input.hidden ? `Hidden by admin: ${input.reason}` : 'Restored by admin');
    if (type === 'lost') refreshMatchesForLost(db, id); else refreshMatchesForFound(db, id);
    audit(db, actor.id, input.hidden ? 'report.hide' : 'report.restore', `${type}_report`, id, input.reason ?? null);
    if (input.hidden) notify(db, r.user_id, `Your ${type} report "${r.title}" was hidden by an administrator: ${input.reason}`, `/reports/${type}/${id}`);
    return { type, id, is_hidden: input.hidden };
  });
}

export function listAudit(db, query = {}) {
  const q = validate({ page: query.page ?? 1, page_size: query.page_size ?? 25 }, { page: v.int({ min: 1, max: 10000 }), page_size: v.int({ min: 1, max: 100 }) });
  const total = db.get('SELECT COUNT(*) n FROM audit_logs').n;
  const items = db.all(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.detail, a.created_at, u.full_name AS actor
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT ? OFFSET ?`, q.page_size, (q.page - 1) * q.page_size);
  return { items, total, page: q.page, page_size: q.page_size, total_pages: Math.max(1, Math.ceil(total / q.page_size)) };
}
