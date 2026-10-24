// Claim workflow. Every state change runs inside ONE transaction that re-reads the rows it depends on,
// so two staff members approving at the same time cannot both succeed, and an item can be returned only once.
// Defence in depth: partial unique indexes (ux_claims_single_winner, handovers.found_report_id UNIQUE)
// make the database itself reject a second winner even if application logic were wrong.
import { HttpError, forbidden, notFound } from '../lib/errors.js';
import { isStaff } from '../lib/access.js';
import { isConstraintError } from '../lib/db.js';
import { validate, v } from '../lib/validate.js';
import { ACTIVE_CLAIM, CLAIMABLE_FOUND, assertTransition } from './transitions.js';
import { recordStatus } from './reports.js';
import { notify, notifyStaff, audit } from './notifications.js';

function recordClaim(db, claimId, from, to, userId, note = null) {
  db.run('INSERT INTO claim_status_history (claim_id, from_status, to_status, changed_by, note) VALUES (?, ?, ?, ?, ?)', claimId, from, to, userId, note);
}
const setClaim = (db, id, from, to, userId, note, extra = {}) => {
  const cols = Object.keys(extra);
  db.run(`UPDATE claims SET status = ?${cols.map((c) => `, ${c} = ?`).join('')} WHERE id = ?`, to, ...cols.map((c) => extra[c]), id);
  recordClaim(db, id, from, to, userId, note);
};
const activeList = ACTIVE_CLAIM.map(() => '?').join(',');

/** After a claim ends (rejected/withdrawn), release the found item back to "stored" if nobody else is claiming it. */
function releaseIfNoLiveClaims(db, foundId, userId) {
  const found = db.get('SELECT status FROM found_reports WHERE id = ?', foundId);
  if (found?.status !== 'claim_pending') return;
  const live = db.get(`SELECT COUNT(*) n FROM claims WHERE found_report_id = ? AND status IN (${activeList})`, foundId, ...ACTIVE_CLAIM).n;
  if (live === 0) {
    db.run("UPDATE found_reports SET status = 'stored' WHERE id = ?", foundId);
    recordStatus(db, 'found', foundId, 'claim_pending', 'stored', userId, 'No active claims remain');
  }
}

export function submitClaim(db, user, foundId, body) {
  const input = validate(body, { explanation: v.str({ min: 10, max: 2000 }), lost_report_id: v.id({ optional: true }) });
  try {
    return db.tx(() => {
      const found = db.get('SELECT id, user_id, title, status, is_hidden FROM found_reports WHERE id = ?', foundId);
      if (!found || found.is_hidden) throw notFound('Found report not found');
      if (found.user_id === user.id) throw new HttpError(409, 'You cannot claim an item you reported as found');
      if (!CLAIMABLE_FOUND.includes(found.status)) throw new HttpError(409, 'This item is no longer available to claim');
      if (input.lost_report_id) {
        const lost = db.get('SELECT user_id FROM lost_reports WHERE id = ?', input.lost_report_id);
        if (!lost || lost.user_id !== user.id) throw new HttpError(422, 'Please correct the highlighted fields', { lost_report_id: 'Choose one of your own lost reports' });
      }
      const id = Number(db.run('INSERT INTO claims (found_report_id, claimant_id, lost_report_id, explanation) VALUES (?, ?, ?, ?)', foundId, user.id, input.lost_report_id, input.explanation).lastInsertRowid);
      recordClaim(db, id, null, 'submitted', user.id, 'Claim submitted');
      if (found.status === 'stored') {
        db.run("UPDATE found_reports SET status = 'claim_pending' WHERE id = ?", foundId);
        recordStatus(db, 'found', foundId, 'stored', 'claim_pending', user.id, 'Claim submitted');
      }
      notifyStaff(db, `New claim submitted for "${found.title}".`, `/claims/${id}`);
      return getClaim(db, user, id);
    });
  } catch (e) {
    if (isConstraintError(e, 'UNIQUE')) throw new HttpError(409, 'You already have an active claim for this item');
    throw e;
  }
}

const CLAIM_SELECT = `SELECT c.*, f.title AS found_title, f.status AS found_status, f.user_id AS finder_id, f.found_date, fc.name AS found_category, fl.name AS found_location,
    u.full_name AS claimant_name, u.email AS claimant_email, rv.full_name AS reviewer_name, f.distinguishing_details AS found_private_details
  FROM claims c JOIN found_reports f ON f.id = c.found_report_id JOIN categories fc ON fc.id = f.category_id JOIN campus_locations fl ON fl.id = f.location_id
  JOIN users u ON u.id = c.claimant_id LEFT JOIN users rv ON rv.id = c.reviewed_by`;

function allowedActions(user, c) {
  const staff = isStaff(user);
  const mine = c.claimant_id === user.id;
  const a = [];
  if (staff) {
    if (c.status === 'submitted') a.push('start_review', 'reject');
    if (c.status === 'under_review') a.push('request_info', 'approve', 'reject');
    if (c.status === 'info_requested') a.push('reject');
    if (c.status === 'approved') a.push('handover', 'reject');
  }
  if (mine) {
    if (c.status === 'info_requested') a.push('respond');
    if (['submitted', 'under_review', 'info_requested', 'approved'].includes(c.status)) a.push('withdraw');
  }
  return a;
}

export function getClaim(db, user, id) {
  const c = db.get(`${CLAIM_SELECT} WHERE c.id = ?`, id);
  // Private claim content is visible ONLY to the claimant and staff. Everyone else (including the finder) gets a 404.
  if (!c || (c.claimant_id !== user.id && !isStaff(user))) throw notFound('Claim not found');
  const staff = isStaff(user);
  const out = {
    id: c.id, status: c.status, created_at: c.created_at, updated_at: c.updated_at,
    explanation: c.explanation, verification_request: c.verification_request, verification_response: c.verification_response,
    decision_reason: c.decision_reason, lost_report_id: c.lost_report_id,
    found_report: { id: c.found_report_id, title: c.found_title, status: c.found_status, category: c.found_category, location: c.found_location, date: c.found_date },
    allowed_actions: allowedActions(user, c),
    history: db.all('SELECT h.from_status, h.to_status, h.note, h.created_at FROM claim_status_history h WHERE h.claim_id = ? ORDER BY h.id', id),
  };
  if (staff) {
    out.claimant = { id: c.claimant_id, name: c.claimant_name, email: c.claimant_email };
    out.reviewer = c.reviewer_name;
    out.found_private_details = c.found_private_details; // lets staff compare against the claimant's explanation
    out.handover = db.get('SELECT h.recipient_name, h.notes, h.handed_at, u.full_name AS handed_by FROM handovers h JOIN users u ON u.id = h.handed_by WHERE h.claim_id = ?', id) || null;
    out.competing_claims = db.get(`SELECT COUNT(*) n FROM claims WHERE found_report_id = ? AND id <> ? AND status IN (${activeList})`, c.found_report_id, id, ...ACTIVE_CLAIM).n;
  } else if (c.status === 'completed') {
    out.handover = db.get('SELECT recipient_name, handed_at FROM handovers WHERE claim_id = ?', id) || null;
  }
  return out;
}

export function listClaims(db, user, query = {}) {
  const q = validate(
    { status: query.status, page: query.page ?? 1, page_size: query.page_size ?? 20, scope: query.scope },
    { status: v.oneOf(['submitted', 'under_review', 'info_requested', 'approved', 'rejected', 'withdrawn', 'completed', 'active'], { optional: true }),
      page: v.int({ min: 1, max: 10000 }), page_size: v.int({ min: 1, max: 50 }), scope: v.oneOf(['mine', 'all'], { optional: true }) },
  );
  const where = [];
  const params = [];
  if (!isStaff(user) || q.scope === 'mine') { where.push('c.claimant_id = ?'); params.push(user.id); }
  if (q.status === 'active') { where.push(`c.status IN (${activeList})`); params.push(...ACTIVE_CLAIM); }
  else if (q.status) { where.push('c.status = ?'); params.push(q.status); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = `FROM claims c JOIN found_reports f ON f.id = c.found_report_id JOIN users u ON u.id = c.claimant_id ${whereSql}`;
  const total = db.get(`SELECT COUNT(*) n ${from}`, ...params).n;
  const staff = isStaff(user);
  const items = db.all(
    `SELECT c.id, c.status, c.created_at, c.updated_at, c.found_report_id, f.title AS found_title ${staff ? ', u.full_name AS claimant_name' : ''}
       ${from} ORDER BY CASE c.status WHEN 'submitted' THEN 0 WHEN 'info_requested' THEN 1 WHEN 'under_review' THEN 2 WHEN 'approved' THEN 3 ELSE 4 END, c.created_at ASC LIMIT ? OFFSET ?`,
    ...params, q.page_size, (q.page - 1) * q.page_size);
  return { items, total, page: q.page, page_size: q.page_size, total_pages: Math.max(1, Math.ceil(total / q.page_size)) };
}

export function claimAction(db, user, claimId, body) {
  const input = validate(body, {
    action: v.oneOf(['start_review', 'request_info', 'approve', 'reject', 'respond', 'withdraw', 'handover']),
    reason: v.str({ min: 3, max: 1000, optional: true }),
    message: v.str({ min: 3, max: 2000, optional: true }),
    recipient_name: v.str({ min: 2, max: 100, optional: true }),
    notes: v.str({ max: 1000, optional: true }),
  });
  try {
    return db.tx(() => {
      const c = db.get('SELECT * FROM claims WHERE id = ?', claimId);
      if (!c || (c.claimant_id !== user.id && !isStaff(user))) throw notFound('Claim not found');
      const found = db.get('SELECT id, title, status, user_id FROM found_reports WHERE id = ?', c.found_report_id);
      const need = (field, label) => {
        if (!input[field]) throw new HttpError(422, 'Please correct the highlighted fields', { [field]: `${label} is required` });
      };
      const staffOnly = () => { if (!isStaff(user)) throw forbidden('Only staff can do this'); };
      const claimantOnly = () => { if (c.claimant_id !== user.id) throw forbidden('Only the claimant can do this'); };

      switch (input.action) {
        case 'start_review':
          staffOnly(); assertTransition('claim', c.status, 'under_review');
          setClaim(db, claimId, c.status, 'under_review', user.id, 'Review started', { reviewed_by: user.id });
          notify(db, c.claimant_id, `Your claim for "${found.title}" is now under review.`, `/claims/${claimId}`);
          break;
        case 'request_info':
          staffOnly(); need('message', 'A message to the claimant'); assertTransition('claim', c.status, 'info_requested');
          setClaim(db, claimId, c.status, 'info_requested', user.id, 'More information requested', { verification_request: input.message, reviewed_by: user.id });
          notify(db, c.claimant_id, `More information is needed for your claim on "${found.title}".`, `/claims/${claimId}`);
          break;
        case 'respond':
          claimantOnly(); need('message', 'Your response'); assertTransition('claim', c.status, 'under_review');
          setClaim(db, claimId, c.status, 'under_review', user.id, 'Claimant responded', { verification_response: input.message });
          notifyStaff(db, `Claimant responded on the claim for "${found.title}".`, `/claims/${claimId}`);
          break;
        case 'approve': {
          staffOnly(); assertTransition('claim', c.status, 'approved');
          // Re-check inside the transaction: nobody else may already hold this item.
          const winner = db.get("SELECT id FROM claims WHERE found_report_id = ? AND id <> ? AND status IN ('approved','completed')", c.found_report_id, claimId);
          if (winner) throw new HttpError(409, 'Another claim for this item has already been approved');
          if (['returned', 'archived'].includes(found.status)) throw new HttpError(409, 'This item has already been returned or archived');
          setClaim(db, claimId, c.status, 'approved', user.id, input.reason || 'Claim approved', { decision_reason: input.reason || null, reviewed_by: user.id });
          if (found.status !== 'claim_pending') {
            db.run("UPDATE found_reports SET status = 'claim_pending' WHERE id = ?", c.found_report_id);
            recordStatus(db, 'found', c.found_report_id, found.status, 'claim_pending', user.id, 'Claim approved');
          }
          notify(db, c.claimant_id, `Your claim for "${found.title}" was approved. Staff will arrange the handover.`, `/claims/${claimId}`);
          audit(db, user.id, 'claim.approve', 'claim', claimId);
          break;
        }
        case 'reject':
          staffOnly(); need('reason', 'A rejection reason'); assertTransition('claim', c.status, 'rejected');
          setClaim(db, claimId, c.status, 'rejected', user.id, input.reason, { decision_reason: input.reason, reviewed_by: user.id });
          releaseIfNoLiveClaims(db, c.found_report_id, user.id);
          notify(db, c.claimant_id, `Your claim for "${found.title}" was not approved. Reason: ${input.reason}`, `/claims/${claimId}`);
          audit(db, user.id, 'claim.reject', 'claim', claimId);
          break;
        case 'withdraw':
          claimantOnly(); assertTransition('claim', c.status, 'withdrawn');
          setClaim(db, claimId, c.status, 'withdrawn', user.id, 'Withdrawn by claimant');
          releaseIfNoLiveClaims(db, c.found_report_id, user.id);
          break;
        case 'handover': {
          staffOnly(); assertTransition('claim', c.status, 'completed');
          if (found.status === 'returned') throw new HttpError(409, 'This item has already been returned');
          const claimant = db.get('SELECT full_name FROM users WHERE id = ?', c.claimant_id);
          db.run('INSERT INTO handovers (claim_id, found_report_id, handed_by, recipient_name, notes) VALUES (?, ?, ?, ?, ?)', claimId, c.found_report_id, user.id, input.recipient_name || claimant.full_name, input.notes);
          setClaim(db, claimId, c.status, 'completed', user.id, 'Item handed over');
          db.run("UPDATE found_reports SET status = 'returned' WHERE id = ?", c.found_report_id);
          recordStatus(db, 'found', c.found_report_id, found.status, 'returned', user.id, 'Handed over to claimant');
          // every other live claim on this item is closed with an explanation
          for (const other of db.all(`SELECT id, claimant_id, status FROM claims WHERE found_report_id = ? AND id <> ? AND status IN (${activeList})`, c.found_report_id, claimId, ...ACTIVE_CLAIM)) {
            setClaim(db, other.id, other.status, 'rejected', user.id, 'Item was returned to another claimant', { decision_reason: 'Item was returned to another verified claimant', reviewed_by: user.id });
            notify(db, other.claimant_id, `The item "${found.title}" has been returned to another claimant, so your claim was closed.`, `/claims/${other.id}`);
          }
          if (c.lost_report_id) {
            const lost = db.get('SELECT status FROM lost_reports WHERE id = ?', c.lost_report_id);
            if (lost?.status === 'open') {
              db.run("UPDATE lost_reports SET status = 'resolved' WHERE id = ?", c.lost_report_id);
              recordStatus(db, 'lost', c.lost_report_id, 'open', 'resolved', user.id, 'Item returned via claim');
            }
          }
          notify(db, c.claimant_id, `"${found.title}" has been handed over to you. Thank you for using LUNA.`, `/claims/${claimId}`);
          if (found.user_id !== c.claimant_id) notify(db, found.user_id, `The item you found ("${found.title}") has been returned to its owner. Thank you!`, `/reports/found/${found.id}`);
          audit(db, user.id, 'claim.handover', 'claim', claimId);
          break;
        }
        default:
          throw new HttpError(400, 'Unknown action');
      }
      return getClaim(db, user, claimId);
    });
  } catch (e) {
    // Backstop: the database unique indexes reject a second winner / second handover even under a race.
    if (isConstraintError(e, 'UNIQUE') && /claims|handovers/.test(e.message)) throw new HttpError(409, 'Another claim for this item has already been approved or returned');
    throw e;
  }
}
