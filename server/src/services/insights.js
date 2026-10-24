// Reporting queries used by the admin dashboard / insights page. Also documented in docs/sql-examples.sql.
const NOW_MINUS = (days) => `strftime('%Y-%m-%dT%H:%M:%fZ','now','-${Number(days)} days')`;

export function insights(db) {
  return {
    // GROUP BY + aggregate over a UNION ALL of both report tables, joined to categories
    by_category_status: db.all(
      `SELECT c.name AS category, t.type, t.status, COUNT(*) AS n
         FROM (SELECT 'lost' AS type, category_id, status FROM lost_reports
               UNION ALL SELECT 'found', category_id, status FROM found_reports) t
         JOIN categories c ON c.id = t.category_id
        GROUP BY c.name, t.type, t.status ORDER BY c.name, t.type, t.status`),
    top_categories: db.all(
      `SELECT c.name AS category, COUNT(*) AS reports
         FROM (SELECT category_id FROM lost_reports UNION ALL SELECT category_id FROM found_reports) t
         JOIN categories c ON c.id = t.category_id GROUP BY c.id ORDER BY reports DESC, c.name LIMIT 5`),
    top_locations: db.all(
      `SELECT l.name AS location, COUNT(*) AS reports
         FROM (SELECT location_id FROM lost_reports UNION ALL SELECT location_id FROM found_reports) t
         JOIN campus_locations l ON l.id = t.location_id GROUP BY l.id ORDER BY reports DESC, l.name LIMIT 5`),
    return_rate: db.get(
      `SELECT COUNT(*) AS found_total, SUM(CASE WHEN status = 'returned' THEN 1 ELSE 0 END) AS returned,
              ROUND(100.0 * SUM(CASE WHEN status = 'returned' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) AS rate_percent
         FROM found_reports WHERE is_hidden = 0`),
    claim_outcomes: db.all('SELECT status, COUNT(*) AS n FROM claims GROUP BY status ORDER BY n DESC'),
    // "overdue / unresolved" definitions: found items unprocessed 7+ days, claims waiting 3+ days, lost reports open 30+ days
    overdue: {
      found_unprocessed: db.all(
        `SELECT id, title, status, created_at FROM found_reports WHERE status IN ('reported','under_review') AND is_hidden = 0 AND created_at <= ${NOW_MINUS(7)} ORDER BY created_at LIMIT 20`),
      claims_waiting: db.all(
        `SELECT c.id, f.title, c.status, c.created_at FROM claims c JOIN found_reports f ON f.id = c.found_report_id
          WHERE c.status IN ('submitted','under_review','info_requested') AND c.created_at <= ${NOW_MINUS(3)} ORDER BY c.created_at LIMIT 20`),
      lost_open_long: db.all(
        `SELECT id, title, created_at FROM lost_reports WHERE status = 'open' AND is_hidden = 0 AND created_at <= ${NOW_MINUS(30)} ORDER BY created_at LIMIT 20`),
    },
    // Recursive CTE generates the last 12 months so months with zero activity still appear
    monthly: db.all(
      `WITH RECURSIVE m(n, month) AS (
         SELECT 0, strftime('%Y-%m', 'now')
         UNION ALL SELECT n + 1, strftime('%Y-%m', date('now', 'start of month', '-' || (n + 1) || ' months')) FROM m WHERE n < 11)
       SELECT month,
              (SELECT COUNT(*) FROM lost_reports  WHERE strftime('%Y-%m', created_at) = m.month) AS lost,
              (SELECT COUNT(*) FROM found_reports WHERE strftime('%Y-%m', created_at) = m.month) AS found,
              (SELECT COUNT(*) FROM handovers     WHERE strftime('%Y-%m', handed_at)  = m.month) AS returned
         FROM m ORDER BY month`),
  };
}
