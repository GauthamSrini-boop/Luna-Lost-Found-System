// Every number on every dashboard is computed from the database at request time.
import { isStaff, isAdmin } from '../lib/access.js';
import { ACTIVE_CLAIM } from './transitions.js';
import { insights } from './insights.js';

const activeList = ACTIVE_CLAIM.map(() => '?').join(',');
const NOW_MINUS = (days) => `strftime('%Y-%m-%dT%H:%M:%fZ','now','-${Number(days)} days')`;

export function dashboardFor(db, user) {
  const out = { role: user.role, student: studentDashboard(db, user) };
  if (isStaff(user)) out.staff = staffDashboard(db, user);
  if (isAdmin(user)) out.admin = adminDashboard(db);
  return out;
}

function studentDashboard(db, user) {
  const lost = db.all('SELECT status, COUNT(*) n FROM lost_reports WHERE user_id = ? GROUP BY status', user.id);
  const found = db.all('SELECT status, COUNT(*) n FROM found_reports WHERE user_id = ? GROUP BY status', user.id);
  const sum = (rows) => rows.reduce((a, r) => a + r.n, 0);
  const pick = (rows, s) => rows.find((r) => r.status === s)?.n || 0;
  return {
    lost_reports: sum(lost), lost_open: pick(lost, 'open'),
    found_reports: sum(found),
    active_claims: db.get(`SELECT COUNT(*) n FROM claims WHERE claimant_id = ? AND status IN (${activeList})`, user.id, ...ACTIVE_CLAIM).n,
    awaiting_action: db.get("SELECT COUNT(*) n FROM claims WHERE claimant_id = ? AND status = 'info_requested'", user.id).n,
    potential_matches: db.get(
      `SELECT COUNT(*) n FROM match_suggestions m JOIN lost_reports l ON l.id = m.lost_report_id
        WHERE l.user_id = ? AND l.status = 'open' AND m.status IN ('suggested','reviewed')`, user.id).n,
    unread_notifications: db.get('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND is_read = 0', user.id).n,
    recent: db.all(
      `SELECT * FROM (
         SELECT 'lost' AS type, id, title, status, updated_at FROM lost_reports WHERE user_id = ?
         UNION ALL SELECT 'found', id, title, status, updated_at FROM found_reports WHERE user_id = ?
       ) ORDER BY updated_at DESC LIMIT 8`, user.id, user.id),
  };
}

function staffDashboard(db, user) {
  return {
    reports_needing_review: db.get("SELECT COUNT(*) n FROM found_reports WHERE status IN ('reported','under_review') AND is_hidden = 0").n,
    pending_claims: db.get("SELECT COUNT(*) n FROM claims WHERE status IN ('submitted','under_review','info_requested')").n,
    awaiting_return: db.get("SELECT COUNT(*) n FROM claims WHERE status = 'approved'").n,
    unreviewed_claims: db.get("SELECT COUNT(*) n FROM claims WHERE status = 'submitted'").n,
    my_active_reviews: db.get("SELECT COUNT(*) n FROM claims WHERE reviewed_by = ? AND status IN ('under_review','info_requested','approved')", user.id).n,
    open_flags: db.get("SELECT COUNT(*) n FROM report_flags WHERE status = 'open'").n,
    oldest_pending_claims: db.all(
      `SELECT c.id, c.status, c.created_at, f.title AS found_title FROM claims c JOIN found_reports f ON f.id = c.found_report_id
        WHERE c.status IN ('submitted','under_review','info_requested') ORDER BY c.created_at ASC LIMIT 5`),
    recent_status_changes: db.all(
      `SELECT h.report_type AS type, h.report_id AS id, h.from_status, h.to_status, h.created_at,
              COALESCE(l.title, f.title) AS title
         FROM report_status_history h
         LEFT JOIN lost_reports l ON h.report_type = 'lost' AND l.id = h.report_id
         LEFT JOIN found_reports f ON h.report_type = 'found' AND f.id = h.report_id
        ORDER BY h.id DESC LIMIT 8`),
  };
}

function adminDashboard(db) {
  const ins = insights(db);
  return {
    active_users: db.get('SELECT COUNT(*) n FROM users WHERE is_active = 1').n,
    users_by_role: db.all('SELECT role, COUNT(*) n FROM users WHERE is_active = 1 GROUP BY role'),
    lost_total: db.get('SELECT COUNT(*) n FROM lost_reports').n,
    found_total: db.get('SELECT COUNT(*) n FROM found_reports').n,
    open_claims: db.get(`SELECT COUNT(*) n FROM claims WHERE status IN (${activeList})`, ...ACTIVE_CLAIM).n,
    returned_items: db.get('SELECT COUNT(*) n FROM handovers').n,
    open_flags: db.get("SELECT COUNT(*) n FROM report_flags WHERE status = 'open'").n,
    by_category_status: ins.by_category_status,
    monthly: ins.monthly,
  };
}
export { NOW_MINUS };
