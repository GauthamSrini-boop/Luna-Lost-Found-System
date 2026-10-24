// Lost/found report CRUD, permissions, status changes, search and flagging.
import { HttpError, forbidden, notFound } from '../lib/errors.js';
import { isStaff, isAdmin } from '../lib/access.js';
import { validate, v, likeEscape } from '../lib/validate.js';
import { LOST_TRANSITIONS, FOUND_TRANSITIONS, FOUND_SYSTEM_ONLY, CLAIMABLE_FOUND, ACTIVE_CLAIM, assertTransition } from './transitions.js';
import { refreshMatchesForLost, refreshMatchesForFound } from './matching.js';
import { notify, audit } from './notifications.js';

// Table and column names come ONLY from this whitelist, never from user input.
export const REPORT = {
  lost: { table: 'lost_reports', dateCol: 'last_seen_date', photoCol: 'lost_report_id', transitions: LOST_TRANSITIONS },
  found: { table: 'found_reports', dateCol: 'found_date', photoCol: 'found_report_id', transitions: FOUND_TRANSITIONS },
};
export function parseType(t) {
  if (!REPORT[t]) throw notFound('Unknown report type');
  return t;
}

const LOST_SCHEMA = {
  title: v.str({ min: 3, max: 120 }),
  category_id: v.id(),
  description: v.str({ min: 10, max: 2000 }),
  distinguishing_details: v.str({ max: 1000, optional: true }),
  last_seen_date: v.date({ noFuture: true }),
  location_id: v.id(),
  contact_preference: v.oneOf(['email', 'phone', 'in_app'], { fallback: 'in_app' }),
};
const FOUND_SCHEMA = {
  title: v.str({ min: 3, max: 120 }),
  category_id: v.id(),
  description: v.str({ min: 10, max: 2000 }),
  distinguishing_details: v.str({ max: 1000, optional: true }),
  found_date: v.date({ noFuture: true }),
  location_id: v.id(),
  storage_status: v.oneOf(['with_finder', 'handed_to_security', 'at_lost_found_desk'], { fallback: 'with_finder' }),
};
const SCHEMA = { lost: LOST_SCHEMA, found: FOUND_SCHEMA };

function assertRefs(db, input) {
  const errors = {};
  if (input.category_id !== undefined && !db.get('SELECT 1 x FROM categories WHERE id = ? AND is_active = 1', input.category_id)) errors.category_id = 'Choose a valid category';
  if (input.location_id !== undefined && !db.get('SELECT 1 x FROM campus_locations WHERE id = ? AND is_active = 1', input.location_id)) errors.location_id = 'Choose a valid campus location';
  if (Object.keys(errors).length) throw new HttpError(422, 'Please correct the highlighted fields', errors);
}

export function recordStatus(db, type, reportId, from, to, userId, note = null) {
  db.run('INSERT INTO report_status_history (report_type, report_id, from_status, to_status, changed_by, note) VALUES (?, ?, ?, ?, ?, ?)', type, reportId, from, to, userId, note);
}

export function createReport(db, user, type, body) {
  parseType(type);
  const input = validate(body, SCHEMA[type]);
  assertRefs(db, input);
  const cfg = REPORT[type];
  const cols = Object.keys(input);
  const id = db.tx(() => {
    const newId = db.run(
      `INSERT INTO ${cfg.table} (user_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`,
      user.id, ...cols.map((c) => input[c]),
    ).lastInsertRowid;
    recordStatus(db, type, Number(newId), null, type === 'lost' ? 'open' : 'reported', user.id, 'Report created');
    if (type === 'lost') refreshMatchesForLost(db, Number(newId)); else refreshMatchesForFound(db, Number(newId));
    return Number(newId);
  });
  return getReport(db, user, type, id);
}

function loadReport(db, type, id) {
  const cfg = REPORT[type];
  return db.get(
    `SELECT r.*, r.${cfg.dateCol} AS event_date, c.name AS category_name, l.name AS location_name, l.zone AS location_zone,
            p.stored_name AS photo_name, u.full_name AS reporter_name, u.email AS reporter_email
       FROM ${cfg.table} r JOIN categories c ON c.id = r.category_id JOIN campus_locations l ON l.id = r.location_id
       JOIN users u ON u.id = r.user_id LEFT JOIN item_photos p ON p.${cfg.photoCol} = r.id WHERE r.id = ?`, id);
}

/** What the given user may do with this report (computed on the server, used for both UI hints and enforcement). */
export function permissionsFor(user, type, r) {
  const owner = !!user && r.user_id === user.id;
  const staff = isStaff(user);
  let canEdit = false;
  let nextStatuses = [];
  if (type === 'lost') {
    canEdit = owner && r.status === 'open';
    if (owner || staff) nextStatuses = LOST_TRANSITIONS[r.status] || [];
    if (!owner && staff) nextStatuses = nextStatuses.filter((s) => s !== 'open'); // only the owner reopens
  } else {
    if (staff) {
      canEdit = !['returned', 'archived'].includes(r.status);
      nextStatuses = (FOUND_TRANSITIONS[r.status] || []).filter((s) => !FOUND_SYSTEM_ONLY.has(s));
    } else if (owner) {
      canEdit = ['reported', 'under_review'].includes(r.status);
      nextStatuses = r.status === 'reported' ? ['archived'] : [];
    }
  }
  return { is_owner: owner, can_edit: canEdit, next_statuses: nextStatuses, can_view_private: owner || staff };
}

export function getReport(db, user, type, id) {
  parseType(type);
  const r = loadReport(db, type, id);
  if (!r) throw notFound('Report not found');
  const perms = permissionsFor(user, type, r);
  if (r.is_hidden && !perms.can_view_private) throw notFound('Report not found'); // hidden reports look nonexistent
  const out = {
    type, id: r.id, title: r.title, description: r.description,
    category: { id: r.category_id, name: r.category_name },
    location: { id: r.location_id, name: r.location_name, zone: r.location_zone },
    date: r.event_date, status: r.status, created_at: r.created_at, updated_at: r.updated_at,
    photo_url: r.photo_name ? `/uploads/${r.photo_name}` : null,
    is_hidden: !!r.is_hidden, is_mine: perms.is_owner,
    permissions: { can_edit: perms.can_edit, next_statuses: perms.next_statuses },
  };
  if (type === 'found') out.storage_status = r.storage_status;
  if (perms.can_view_private) {
    out.private = { distinguishing_details: r.distinguishing_details };
    if (type === 'lost') out.private.contact_preference = r.contact_preference;
    if (r.is_hidden) out.hidden_reason = r.hidden_reason;
    out.history = db.all(
      `SELECT h.from_status, h.to_status, h.note, h.created_at, ${isStaff(user) ? 'u.full_name' : 'NULL'} AS changed_by
         FROM report_status_history h LEFT JOIN users u ON u.id = h.changed_by WHERE h.report_type = ? AND h.report_id = ? ORDER BY h.id`, type, id);
  }
  if (isStaff(user)) out.reporter = { id: r.user_id, name: r.reporter_name, email: r.reporter_email };
  if (type === 'found' && user) {
    const mine = db.get(`SELECT id, status FROM claims WHERE found_report_id = ? AND claimant_id = ? ORDER BY id DESC LIMIT 1`, id, user.id);
    out.my_claim = mine || null;
    const live = db.get(`SELECT 1 x FROM claims WHERE found_report_id = ? AND claimant_id = ? AND status IN (${ACTIVE_CLAIM.map(() => '?').join(',')})`, id, user.id, ...ACTIVE_CLAIM);
    out.can_claim = !perms.is_owner && !live && CLAIMABLE_FOUND.includes(r.status) && !r.is_hidden;
  }
  if (user && !perms.is_owner) {
    out.already_flagged = !!db.get('SELECT 1 x FROM report_flags WHERE report_type = ? AND report_id = ? AND reporter_id = ?', type, id, user.id);
  }
  return out;
}

export function updateReport(db, user, type, id, body) {
  parseType(type);
  const cfg = REPORT[type];
  const existing = db.get(`SELECT * FROM ${cfg.table} WHERE id = ?`, id);
  if (!existing) throw notFound('Report not found');
  const perms = permissionsFor(user, type, existing);
  if (!perms.can_view_private) throw notFound('Report not found'); // unrelated users cannot even confirm it exists
  if (!perms.can_edit) throw forbidden('This report can no longer be edited by you');
  const input = validate(body, SCHEMA[type], { partial: true });
  if (Object.keys(input).length === 0) throw new HttpError(400, 'No changes supplied');
  assertRefs(db, input);
  const cols = Object.keys(input);
  db.tx(() => {
    db.run(`UPDATE ${cfg.table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...cols.map((c) => input[c]), id);
    if (type === 'lost') refreshMatchesForLost(db, id); else refreshMatchesForFound(db, id);
    if (user.id !== existing.user_id) audit(db, user.id, `${type}.edit`, `${type}_report`, id);
  });
  return getReport(db, user, type, id);
}

export function changeStatus(db, user, type, id, body) {
  parseType(type);
  const { to, note } = validate(body, { to: v.str({ min: 2, max: 30 }), note: v.str({ max: 500, optional: true }) });
  const cfg = REPORT[type];
  return db.tx(() => {
    const r = db.get(`SELECT * FROM ${cfg.table} WHERE id = ?`, id);
    if (!r) throw notFound('Report not found');
    const perms = permissionsFor(user, type, r);
    if (!perms.can_view_private) throw notFound('Report not found');
    assertTransition(type, r.status, to); // 409 for any transition not in the state machine
    if (!perms.next_statuses.includes(to)) {
      throw forbidden(FOUND_SYSTEM_ONLY.has(to) && type === 'found' ? 'This status is set automatically by the claim process' : 'You are not allowed to make this status change');
    }
    db.run(`UPDATE ${cfg.table} SET status = ? WHERE id = ?`, to, id);
    recordStatus(db, type, id, r.status, to, user.id, note);
    if (type === 'lost') refreshMatchesForLost(db, id); else refreshMatchesForFound(db, id);
    if (r.user_id !== user.id) notify(db, r.user_id, `Your ${type} report "${r.title}" is now "${to.replace('_', ' ')}".`, `/reports/${type}/${id}`);
    return getReport(db, user, type, id);
  });
}

// ---------------- Browse / search ----------------
const BROWSE_SORTS = {
  newest: 'created_at DESC, id DESC',
  oldest: 'created_at ASC, id ASC',
  event_newest: 'event_date DESC, id DESC',
  event_oldest: 'event_date ASC, id ASC',
  title: 'title COLLATE NOCASE ASC, id ASC',
};
const BROWSE_SCHEMA = {
  q: v.str({ max: 100, optional: true }),
  type: v.oneOf(['all', 'lost', 'found'], { fallback: 'all' }),
  category_id: v.id({ optional: true }),
  location_id: v.id({ optional: true }),
  status: v.str({ max: 30, optional: true }),
  date_from: v.date({ optional: true }),
  date_to: v.date({ optional: true }),
  sort: v.oneOf(Object.keys(BROWSE_SORTS), { fallback: 'newest' }),
  page: v.int({ min: 1, max: 100000 }),
  page_size: v.int({ min: 1, max: 50 }),
};
const ALL_STATUSES = ['open', 'resolved', 'withdrawn', 'reported', 'under_review', 'stored', 'claim_pending', 'returned', 'archived'];

const UNION = `
  SELECT 'lost' AS type, r.id, r.title, r.description, r.category_id, c.name AS category, r.location_id, l.name AS location,
         r.last_seen_date AS event_date, r.status, r.created_at, r.updated_at, r.user_id, r.is_hidden,
         (SELECT p.stored_name FROM item_photos p WHERE p.lost_report_id = r.id) AS photo_name
    FROM lost_reports r JOIN categories c ON c.id = r.category_id JOIN campus_locations l ON l.id = r.location_id
  UNION ALL
  SELECT 'found', r.id, r.title, r.description, r.category_id, c.name, r.location_id, l.name,
         r.found_date, r.status, r.created_at, r.updated_at, r.user_id, r.is_hidden,
         (SELECT p.stored_name FROM item_photos p WHERE p.found_report_id = r.id)
    FROM found_reports r JOIN categories c ON c.id = r.category_id JOIN campus_locations l ON l.id = r.location_id`;

export function browse(db, user, query = {}, { includeHidden = false } = {}) {
  const q = validate({ page: 1, page_size: 12, ...query }, { ...BROWSE_SCHEMA, status: v.oneOf(ALL_STATUSES, { optional: true }) });
  if (q.date_from && q.date_to && q.date_from > q.date_to) throw new HttpError(422, 'Please correct the highlighted fields', { date_to: 'End date must be on or after the start date' });
  const where = [];
  const params = [];
  if (!includeHidden) where.push('is_hidden = 0');
  if (q.type !== 'all') { where.push('type = ?'); params.push(q.type); }
  if (q.category_id) { where.push('category_id = ?'); params.push(q.category_id); }
  if (q.location_id) { where.push('location_id = ?'); params.push(q.location_id); }
  if (q.status) { where.push('status = ?'); params.push(q.status); } else where.push("status NOT IN ('withdrawn','archived')");
  if (q.date_from) { where.push('event_date >= ?'); params.push(q.date_from); }
  if (q.date_to) { where.push('event_date <= ?'); params.push(q.date_to); }
  if (q.q) {
    // every word must appear in the title OR the (public) description
    for (const term of q.q.split(/\s+/).filter(Boolean).slice(0, 5)) {
      where.push("(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')");
      const like = `%${likeEscape(term)}%`;
      params.push(like, like);
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.get(`WITH reports AS (${UNION}) SELECT COUNT(*) n FROM reports ${whereSql}`, ...params).n;
  const rows = db.all(
    `WITH reports AS (${UNION}) SELECT type, id, title, description, category_id, category, location_id, location, event_date, status, created_at, updated_at, user_id, is_hidden, photo_name
       FROM reports ${whereSql} ORDER BY ${BROWSE_SORTS[q.sort]} LIMIT ? OFFSET ?`,
    ...params, q.page_size, (q.page - 1) * q.page_size);
  return {
    items: rows.map(({ user_id, photo_name, ...r }) => ({ ...r, has_photo: !!photo_name, photo_url: photo_name ? `/uploads/${photo_name}` : null, is_hidden: !!r.is_hidden, is_mine: !!user && user_id === user.id, description: r.description.length > 160 ? `${r.description.slice(0, 157)}...` : r.description })),
    total, page: q.page, page_size: q.page_size, total_pages: Math.max(1, Math.ceil(total / q.page_size)),
  };
}

export function myReports(db, user) {
  const pick = (table, type, dateCol) => db.all(
    `SELECT '${type}' AS type, r.id, r.title, r.status, r.${dateCol} AS event_date, c.name AS category, r.created_at, r.updated_at,
            (SELECT COUNT(*) FROM match_suggestions m WHERE m.${type}_report_id = r.id AND m.status IN ('suggested','reviewed')) AS open_matches
       FROM ${table} r JOIN categories c ON c.id = r.category_id WHERE r.user_id = ? ORDER BY r.updated_at DESC`, user.id);
  return { lost: pick('lost_reports', 'lost', 'last_seen_date'), found: pick('found_reports', 'found', 'found_date') };
}

export function flagReport(db, user, type, id, body) {
  parseType(type);
  const { reason } = validate(body, { reason: v.str({ min: 5, max: 500 }) });
  const r = db.get(`SELECT user_id, is_hidden FROM ${REPORT[type].table} WHERE id = ?`, id);
  if (!r || r.is_hidden) throw notFound('Report not found');
  if (r.user_id === user.id) throw new HttpError(409, 'You cannot flag your own report');
  try {
    db.run('INSERT INTO report_flags (report_type, report_id, reporter_id, reason) VALUES (?, ?, ?, ?)', type, id, user.id, reason);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'You have already flagged this report');
    throw e;
  }
  return { flagged: true };
}
export { isAdmin };
