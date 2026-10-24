// Deterministic, explainable lost<->found matching. No AI, no external services.
// A score is only a SUGGESTION: it never authorises a claim and never reveals private details.
// Only PUBLIC fields (title, public description, category, location, date) are compared.
import { daysBetween } from '../lib/time.js';
import { HttpError, forbidden, notFound } from '../lib/errors.js';
import { isStaff } from '../lib/access.js';
import { validate, v } from '../lib/validate.js';
import { notify } from './notifications.js';

export const MIN_SCORE = 40;
export const MAX_GAP_DAYS = 30;
export const WEIGHTS = { category: 25, keywords: 30, date: 15, location: 20, colour: 10 };
const STOP = new Set('the and for with was were are has have had that this from near left lost found black white item small large very one two its his her their our your you not but any all can been just some into over under onto out off put got get'.split(' '));
// colours are matched separately (below), so they are excluded from the keyword bucket to avoid double counting
const COLOURS = ['black', 'white', 'red', 'blue', 'green', 'yellow', 'grey', 'gray', 'silver', 'gold', 'brown', 'pink', 'purple', 'orange', 'navy', 'beige'];
const COLOUR_SET = new Set(COLOURS);

export function tokenize(text) {
  return [...new Set(String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t) && !COLOUR_SET.has(t)))];
}
const colours = (text) => [...new Set(String(text || '').toLowerCase().split(/[^a-z]+/).filter((t) => COLOUR_SET.has(t)).map((c) => (c === 'gray' ? 'grey' : c)))];

/**
 * Score one lost/found pair. Each side: {title, description, category_id, category_name, location_id, zone, date}.
 * Returns {compatible:false, reason} or {compatible:true, score, reasons[]}.
 */
export function scorePair(lost, found) {
  const gap = daysBetween(lost.date, found.date);
  if (gap < 0) return { compatible: false, reason: 'Found before the item was last seen' };
  if (gap > MAX_GAP_DAYS) return { compatible: false, reason: `More than ${MAX_GAP_DAYS} days apart` };
  let score = 0;
  const reasons = [];

  if (lost.category_id === found.category_id) {
    score += WEIGHTS.category;
    reasons.push(`Same category (${found.category_name}) +${WEIGHTS.category}`);
  }
  const a = tokenize(`${lost.title} ${lost.description}`);
  const b = new Set(tokenize(`${found.title} ${found.description}`));
  const shared = a.filter((t) => b.has(t));
  if (shared.length) {
    const pts = Math.min(WEIGHTS.keywords, shared.length * 10);
    score += pts;
    reasons.push(`Shared keywords: ${shared.slice(0, 6).join(', ')} +${pts}`);
  }
  if (gap <= 3) { score += WEIGHTS.date; reasons.push(`Found ${gap === 0 ? 'on the same day' : `${gap} day(s) after`} it was last seen +${WEIGHTS.date}`); }
  else if (gap <= 14) { score += 8; reasons.push(`Found ${gap} days after it was last seen +8`); }
  else reasons.push(`Found ${gap} days after it was last seen (+0)`);

  if (lost.location_id === found.location_id) { score += WEIGHTS.location; reasons.push(`Same location (${found.location_name}) +${WEIGHTS.location}`); }
  else if (lost.zone && lost.zone === found.zone) { score += 10; reasons.push(`Nearby location (same area: ${found.zone}) +10`); }

  const fc = new Set(colours(`${found.title} ${found.description}`));
  const sharedColours = colours(`${lost.title} ${lost.description}`).filter((c) => fc.has(c));
  if (sharedColours.length) { score += WEIGHTS.colour; reasons.push(`Matching colour: ${sharedColours.join(', ')} +${WEIGHTS.colour}`); }

  return { compatible: true, score: Math.min(100, score), reasons };
}

const LOST_SQL = `SELECT r.id, r.user_id, r.title, r.description, r.category_id, c.name AS category_name, r.location_id, l.name AS location_name,
  l.zone, r.last_seen_date AS date, r.status, r.is_hidden FROM lost_reports r JOIN categories c ON c.id = r.category_id JOIN campus_locations l ON l.id = r.location_id`;
const FOUND_SQL = `SELECT r.id, r.user_id, r.title, r.description, r.category_id, c.name AS category_name, r.location_id, l.name AS location_name,
  l.zone, r.found_date AS date, r.status, r.is_hidden FROM found_reports r JOIN categories c ON c.id = r.category_id JOIN campus_locations l ON l.id = r.location_id`;
const MATCHABLE_FOUND = ['reported', 'under_review', 'stored', 'claim_pending'];

const isMatchable = (type, r) => !r.is_hidden && (type === 'lost' ? r.status === 'open' : MATCHABLE_FOUND.includes(r.status));

function upsertPair(db, lost, found) {
  const res = scorePair(lost, found);
  const existing = db.get('SELECT id, status FROM match_suggestions WHERE lost_report_id = ? AND found_report_id = ?', lost.id, found.id);
  if (!res.compatible || res.score < MIN_SCORE) {
    if (existing && existing.status === 'suggested') db.run('DELETE FROM match_suggestions WHERE id = ?', existing.id);
    return false;
  }
  if (!existing) {
    db.run('INSERT INTO match_suggestions (lost_report_id, found_report_id, score, reasons) VALUES (?, ?, ?, ?)', lost.id, found.id, res.score, JSON.stringify(res.reasons));
    notify(db, lost.user_id, `Possible match for your lost item "${lost.title}" (suggestion only). Review it to see whether it is yours.`, '/matches');
    return true;
  }
  // refresh score/reasons only while still undecided; reviewed/dismissed/confirmed outcomes are preserved
  db.run("UPDATE match_suggestions SET score = ?, reasons = ? WHERE id = ? AND status = 'suggested'", res.score, JSON.stringify(res.reasons), existing.id);
  return false;
}

function dropStale(db, column, id) {
  db.run(`DELETE FROM match_suggestions WHERE ${column} = ? AND status = 'suggested'`, id);
}

export function refreshMatchesForLost(db, lostId) {
  const lost = db.get(`${LOST_SQL} WHERE r.id = ?`, lostId);
  if (!lost) return 0;
  if (!isMatchable('lost', lost)) { dropStale(db, 'lost_report_id', lostId); return 0; }
  let created = 0;
  for (const f of db.all(`${FOUND_SQL} WHERE r.is_hidden = 0 AND r.status IN ('reported','under_review','stored','claim_pending') AND r.user_id <> ?`, lost.user_id)) {
    if (upsertPair(db, lost, f)) created++;
  }
  return created;
}

export function refreshMatchesForFound(db, foundId) {
  const found = db.get(`${FOUND_SQL} WHERE r.id = ?`, foundId);
  if (!found) return 0;
  if (!isMatchable('found', found)) { dropStale(db, 'found_report_id', foundId); return 0; }
  let created = 0;
  for (const l of db.all(`${LOST_SQL} WHERE r.is_hidden = 0 AND r.status = 'open' AND r.user_id <> ?`, found.user_id)) {
    if (upsertPair(db, l, found)) created++;
  }
  return created;
}

// ---------- listing & review ----------
const REVIEW_ACTIONS = { reviewed: ['suggested'], dismissed: ['suggested', 'reviewed'], confirmed: ['suggested', 'reviewed'] };

export function listMatches(db, user, query = {}) {
  const q = validate(
    { status: query.status, lost_id: query.lost_id, page: query.page ?? 1, page_size: query.page_size ?? 20 },
    { status: v.oneOf(['suggested', 'reviewed', 'dismissed', 'confirmed'], { optional: true }), lost_id: v.id({ optional: true }), page: v.int({ min: 1, max: 10000 }), page_size: v.int({ min: 1, max: 50 }) },
  );
  const where = ['lr.is_hidden = 0', 'fr.is_hidden = 0'];
  const params = [];
  if (!isStaff(user)) { where.push('lr.user_id = ?'); params.push(user.id); }
  if (q.status) { where.push('m.status = ?'); params.push(q.status); } else where.push("m.status <> 'dismissed'");
  if (q.lost_id) { where.push('m.lost_report_id = ?'); params.push(q.lost_id); }
  const from = `FROM match_suggestions m JOIN lost_reports lr ON lr.id = m.lost_report_id JOIN found_reports fr ON fr.id = m.found_report_id
    JOIN categories fc ON fc.id = fr.category_id JOIN campus_locations fl ON fl.id = fr.location_id WHERE ${where.join(' AND ')}`;
  const total = db.get(`SELECT COUNT(*) n ${from}`, ...params).n;
  const rows = db.all(
    `SELECT m.id, m.score, m.reasons, m.status, m.created_at, m.lost_report_id, lr.title AS lost_title, m.found_report_id,
            fr.title AS found_title, fr.found_date, fc.name AS found_category, fl.name AS found_location, fr.status AS found_status
     ${from} ORDER BY m.score DESC, m.id DESC LIMIT ? OFFSET ?`,
    ...params, q.page_size, (q.page - 1) * q.page_size,
  );
  return {
    items: rows.map((r) => ({ ...r, reasons: JSON.parse(r.reasons), note: 'Suggestion only. A match is not confirmed ownership.' })),
    total, page: q.page, page_size: q.page_size, total_pages: Math.max(1, Math.ceil(total / q.page_size)),
  };
}

export function reviewMatch(db, user, matchId, body) {
  const { action } = validate(body, { action: v.oneOf(Object.keys(REVIEW_ACTIONS)) });
  return db.tx(() => {
    const m = db.get('SELECT m.*, lr.user_id AS lost_owner, lr.title AS lost_title FROM match_suggestions m JOIN lost_reports lr ON lr.id = m.lost_report_id WHERE m.id = ?', matchId);
    if (!m) throw notFound('Match suggestion not found');
    const owner = m.lost_owner === user.id;
    if (!owner && !isStaff(user)) throw notFound('Match suggestion not found'); // do not reveal existence
    if (action === 'confirmed' && !isStaff(user)) throw forbidden('Only staff can confirm a match');
    if (!REVIEW_ACTIONS[action].includes(m.status)) throw new HttpError(409, `Cannot mark a "${m.status}" suggestion as "${action}"`);
    db.run('UPDATE match_suggestions SET status = ?, reviewed_by = ?, reviewed_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?', action, user.id, matchId);
    if (action === 'confirmed') {
      notify(db, m.lost_owner, `Staff marked a suggested match for "${m.lost_title}" as likely. You still need to submit a claim and verify ownership.`, '/matches');
    }
    return { id: matchId, status: action };
  });
}
