-- =====================================================================================
-- LUNA - SQL examples demonstrating DBMS concepts (SQLite dialect)
-- Run them all against a scratch database with:  node scripts/explain.js
-- That script executes every section below against a temporary, synthetic dataset,
-- checks that each one behaves as documented, and writes real EXPLAIN QUERY PLAN output
-- to docs/query-plans.md. Nothing here touches your development database.
--
-- Section markers read by the runner:
--   -- ### <title>        starts a section
--   -- @explain           also record EXPLAIN QUERY PLAN for the first SELECT in the section
--   -- @expect-error <t>  earlier statements are setup; the LAST statement must FAIL with an error containing <t>
--   -- @expect-rows <n>   the last SELECT must return exactly n rows ("@expect-min <n>" = at least n)
-- =====================================================================================

-- ### 01 SELECT / INSERT / UPDATE / DELETE (CRUD) on a scratch table
-- @expect-rows 1
CREATE TEMP TABLE scratch_note (id INTEGER PRIMARY KEY, body TEXT NOT NULL);
INSERT INTO scratch_note (body) VALUES ('first'), ('second'), ('third');
UPDATE scratch_note SET body = 'second (edited)' WHERE id = 2;
DELETE FROM scratch_note WHERE body = 'third';
SELECT id, body FROM scratch_note WHERE id = 2;

-- ### 02 INNER JOIN: lost reports with their category, location and owner
-- @explain
-- @expect-min 1
SELECT r.id, r.title, c.name AS category, l.name AS location, u.full_name AS owner
  FROM lost_reports r
  JOIN categories c       ON c.id = r.category_id
  JOIN campus_locations l ON l.id = r.location_id
  JOIN users u            ON u.id = r.user_id
 WHERE r.status = 'open'
 ORDER BY r.created_at DESC
 LIMIT 10;

-- ### 03 LEFT JOIN: every found report with its photo if any (NULL when none) and its claim count
-- @expect-min 1
SELECT f.id, f.title, p.stored_name AS photo, COUNT(c.id) AS claims
  FROM found_reports f
  LEFT JOIN item_photos p ON p.found_report_id = f.id
  LEFT JOIN claims c      ON c.found_report_id = f.id
 GROUP BY f.id, p.stored_name
 ORDER BY claims DESC, f.id
 LIMIT 10;

-- ### 04 LEFT JOIN anti-join: categories that have NO reports at all
-- @expect-min 0
SELECT c.name
  FROM categories c
  LEFT JOIN lost_reports l ON l.category_id = c.id
 WHERE l.id IS NULL;

-- ### 05 GROUP BY + aggregates: lost reports per status
-- @expect-min 1
SELECT status, COUNT(*) AS reports, MIN(last_seen_date) AS earliest, MAX(last_seen_date) AS latest
  FROM lost_reports
 GROUP BY status
HAVING COUNT(*) >= 1
 ORDER BY reports DESC;

-- ### 06 Reports grouped by category AND status (lost + found combined with UNION ALL)
-- @expect-min 1
SELECT c.name AS category, t.type, t.status, COUNT(*) AS n
  FROM (SELECT 'lost' AS type, category_id, status FROM lost_reports
        UNION ALL
        SELECT 'found', category_id, status FROM found_reports) t
  JOIN categories c ON c.id = t.category_id
 GROUP BY c.name, t.type, t.status
 ORDER BY c.name, t.type, t.status;

-- ### 07 Multi-condition search (what the Browse page runs): keyword AND category AND location AND date range AND status
-- @explain
-- @expect-min 0
SELECT 'lost' AS type, r.id, r.title, r.last_seen_date
  FROM lost_reports r
 WHERE r.is_hidden = 0
   AND r.status = 'open'
   AND r.category_id = 1
   AND r.location_id = 1
   AND r.last_seen_date BETWEEN '2026-01-01' AND '2026-12-31'
   AND (r.title LIKE '%phone%' ESCAPE '\' OR r.description LIKE '%phone%' ESCAPE '\')
 ORDER BY r.created_at DESC
 LIMIT 12 OFFSET 0;

-- ### 08 Date-range query: found items per month in the last 12 months (strftime)
-- @expect-min 1
SELECT strftime('%Y-%m', found_date) AS month, COUNT(*) AS found_items
  FROM found_reports
 WHERE found_date >= date('now', '-12 months')
 GROUP BY month
 ORDER BY month;

-- ### 09 CTE (WITH): the most active categories, then their share of all reports
-- @expect-min 1
WITH all_reports AS (
  SELECT category_id FROM lost_reports
  UNION ALL
  SELECT category_id FROM found_reports
), per_category AS (
  SELECT category_id, COUNT(*) AS n FROM all_reports GROUP BY category_id
)
SELECT c.name, p.n, ROUND(100.0 * p.n / (SELECT SUM(n) FROM per_category), 1) AS percent
  FROM per_category p JOIN categories c ON c.id = p.category_id
 ORDER BY p.n DESC
 LIMIT 5;

-- ### 10 Recursive CTE: last 12 months, including months with zero activity
-- @expect-rows 12
WITH RECURSIVE m(n, month) AS (
  SELECT 0, strftime('%Y-%m', 'now')
  UNION ALL
  SELECT n + 1, strftime('%Y-%m', date('now', 'start of month', '-' || (n + 1) || ' months')) FROM m WHERE n < 11
)
SELECT month,
       (SELECT COUNT(*) FROM lost_reports  WHERE strftime('%Y-%m', created_at) = m.month) AS lost,
       (SELECT COUNT(*) FROM found_reports WHERE strftime('%Y-%m', created_at) = m.month) AS found
  FROM m ORDER BY month;

-- ### 11 Subquery: lost reports that have at least one pending (suggested) match, with the best score
-- @expect-min 0
SELECT r.id, r.title,
       (SELECT MAX(m.score) FROM match_suggestions m WHERE m.lost_report_id = r.id AND m.status = 'suggested') AS best_score
  FROM lost_reports r
 WHERE EXISTS (SELECT 1 FROM match_suggestions m WHERE m.lost_report_id = r.id AND m.status = 'suggested')
 ORDER BY best_score DESC;

-- ### 12 Overdue / unresolved: found items unprocessed 7+ days, claims waiting 3+ days
-- @explain
-- @expect-min 0
SELECT id, title, status, created_at
  FROM found_reports
 WHERE status IN ('reported', 'under_review')
   AND created_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')
 ORDER BY created_at;

-- ### 13 Frequent categories and locations (hot spots)
-- @expect-min 1
SELECT l.name AS location, COUNT(*) AS reports
  FROM (SELECT location_id FROM lost_reports UNION ALL SELECT location_id FROM found_reports) t
  JOIN campus_locations l ON l.id = t.location_id
 GROUP BY l.id ORDER BY reports DESC, l.name LIMIT 5;

-- ### 14 Item-return success rate
-- @expect-rows 1
SELECT COUNT(*) AS found_total,
       SUM(CASE WHEN status = 'returned' THEN 1 ELSE 0 END) AS returned,
       ROUND(100.0 * SUM(CASE WHEN status = 'returned' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) AS rate_percent
  FROM found_reports
 WHERE is_hidden = 0;

-- ### 15 Average time-to-return in days (JOIN handovers to found reports)
-- @expect-rows 1
SELECT ROUND(AVG(julianday(h.handed_at) - julianday(f.created_at)), 2) AS avg_days_to_return, COUNT(*) AS returns
  FROM handovers h JOIN found_reports f ON f.id = h.found_report_id;

-- ### 16 Window function: rank each user's reports by recency (SQLite 3.25+)
-- @expect-min 1
SELECT user_id, title, created_at,
       ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS recency_rank
  FROM lost_reports
 ORDER BY user_id, recency_rank
 LIMIT 20;

-- ### 17 Index use: primary-key and secondary-index lookups (see query-plans.md for the real plans)
-- @explain
-- @expect-min 0
SELECT id, title FROM found_reports WHERE category_id = 3 AND status = 'stored';

-- ### 18 Index use: a claimant's active claims (partial unique index + ix_claims_claimant)
-- @explain
-- @expect-min 0
SELECT id, status FROM claims WHERE claimant_id = 5 AND status IN ('submitted','under_review','info_requested','approved');

-- ### 19 Transaction COMMIT: two writes succeed together
-- @expect-rows 1
BEGIN;
INSERT INTO categories (name) VALUES ('Txn demo A');
INSERT INTO categories (name) VALUES ('Txn demo B');
COMMIT;
SELECT COUNT(*) AS committed_rows FROM categories WHERE name LIKE 'Txn demo %';

-- ### 20 Transaction ROLLBACK: nothing from the failed unit of work remains
-- @expect-rows 1
BEGIN;
INSERT INTO categories (name) VALUES ('Rolled back item');
ROLLBACK;
SELECT COUNT(*) AS should_be_zero FROM categories WHERE name = 'Rolled back item';

-- ### 21 Constraint: CHECK rejects an impossible calendar date
-- @expect-error CHECK constraint failed
UPDATE lost_reports SET last_seen_date = '2026-02-30' WHERE id = 1;

-- ### 22 Constraint: CHECK rejects an unknown status (the state machine's last line of defence)
-- @expect-error CHECK constraint failed
UPDATE found_reports SET status = 'teleported' WHERE id = 1;

-- ### 23 Constraint: FOREIGN KEY rejects a report for a non-existent user
-- @expect-error FOREIGN KEY constraint failed
INSERT INTO lost_reports (user_id, title, category_id, description, last_seen_date, location_id)
VALUES (999999, 'Ghost report', 1, 'A report from a user that does not exist', '2026-01-01', 1);

-- ### 24 Constraint: UNIQUE (case-insensitive) rejects duplicate category names
-- @expect-error UNIQUE constraint failed
INSERT INTO categories (name) VALUES ('ELECTRONICS');

-- ### 25 Constraint: ON DELETE RESTRICT protects history (users with reports cannot be deleted)
-- @expect-error FOREIGN KEY constraint failed
DELETE FROM users WHERE id = (SELECT user_id FROM lost_reports LIMIT 1);

-- ### 26 Concurrent-claim protection, layer 1: BEGIN IMMEDIATE takes the write lock before the check
-- (the application does: BEGIN IMMEDIATE; SELECT competing approved claim; UPDATE ...; COMMIT)
-- @expect-rows 1
BEGIN IMMEDIATE;
SELECT COUNT(*) AS competing_winners FROM claims WHERE found_report_id = 1 AND status IN ('approved','completed');
COMMIT;

-- ### 27 Concurrent-claim protection, layer 2: the partial unique index makes a second winner impossible
-- Two claims on the same found item; approving both must fail on the second UPDATE.
-- @expect-error UNIQUE constraint failed
UPDATE claims SET status = 'approved' WHERE id IN (SELECT id FROM claims WHERE found_report_id = (SELECT found_report_id FROM claims GROUP BY found_report_id HAVING COUNT(*) > 1 LIMIT 1));

-- ### 28 One return per item: handovers.found_report_id is UNIQUE (setup adds a second, withdrawn claim, then tries a second handover)
-- @expect-error UNIQUE constraint failed
INSERT INTO claims (found_report_id, claimant_id, explanation, status)
SELECT found_report_id, 6, 'Another person says it is theirs', 'withdrawn' FROM handovers LIMIT 1;
INSERT INTO handovers (claim_id, found_report_id, handed_by, recipient_name)
SELECT (SELECT MAX(id) FROM claims), found_report_id, handed_by, 'Second recipient' FROM handovers LIMIT 1;

-- ### 29 Access restriction by role (SQLite has no GRANT): a VIEW exposes only PUBLIC columns
-- LUNA enforces roles in the application layer; this view shows the least-privilege idea.
-- On PostgreSQL the same idea is GRANT SELECT ON public_found_reports TO luna_readonly.
-- @expect-min 1
CREATE TEMP VIEW public_found_reports AS
SELECT f.id, f.title, c.name AS category, l.name AS location, f.found_date, f.status
  FROM found_reports f JOIN categories c ON c.id = f.category_id JOIN campus_locations l ON l.id = f.location_id
 WHERE f.is_hidden = 0;
SELECT * FROM public_found_reports LIMIT 5;

-- ### 30 Audit trail query: who did what, newest first
-- @expect-min 0
SELECT a.created_at, u.full_name AS actor, a.action, a.entity_type, a.entity_id
  FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
 ORDER BY a.id DESC LIMIT 20;
