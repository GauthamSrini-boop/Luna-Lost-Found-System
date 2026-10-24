-- LUNA core schema (SQLite). See docs/data-dictionary.md and docs/er-diagram.md.
-- Timestamps are UTC ISO-8601 text. Booleans are INTEGER 0/1 with CHECK constraints.

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE
                CHECK (length(email) BETWEEN 5 AND 254 AND email LIKE '%_@_%.__%'),
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL CHECK (length(trim(full_name)) BETWEEN 2 AND 100),
  student_id    TEXT UNIQUE CHECK (student_id IS NULL OR length(student_id) BETWEEN 3 AND 30),
  phone         TEXT CHECK (phone IS NULL OR length(phone) BETWEEN 5 AND 20),
  role          TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','staff','admin')),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,            -- HMAC of the random cookie token; the raw token is never stored
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE login_attempts (                 -- failed logins, used for per-account throttling
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL COLLATE NOCASE,
  ip         TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE categories (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(trim(name)) BETWEEN 2 AND 60),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
);

CREATE TABLE campus_locations (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(trim(name)) BETWEEN 2 AND 80),
  zone      TEXT NOT NULL DEFAULT 'general' CHECK (length(trim(zone)) BETWEEN 2 AND 40), -- "nearby" = same zone
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
);

CREATE TABLE lost_reports (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title                  TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 120),
  category_id            INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  description            TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 10 AND 2000),  -- public
  distinguishing_details TEXT CHECK (distinguishing_details IS NULL OR length(distinguishing_details) <= 1000), -- PRIVATE
  last_seen_date         TEXT NOT NULL CHECK (date(last_seen_date) = last_seen_date AND last_seen_date >= '2000-01-01'),
  location_id            INTEGER NOT NULL REFERENCES campus_locations(id) ON DELETE RESTRICT,
  contact_preference     TEXT NOT NULL DEFAULT 'in_app' CHECK (contact_preference IN ('email','phone','in_app')),
  status                 TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','withdrawn')),
  is_hidden              INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0,1)),
  hidden_reason          TEXT,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE found_reports (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,   -- reporter (finder)
  title                  TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 120),
  category_id            INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  description            TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 10 AND 2000),  -- public, non-identifying
  distinguishing_details TEXT CHECK (distinguishing_details IS NULL OR length(distinguishing_details) <= 1000), -- PRIVATE: used by staff to verify claims
  found_date             TEXT NOT NULL CHECK (date(found_date) = found_date AND found_date >= '2000-01-01'),
  location_id            INTEGER NOT NULL REFERENCES campus_locations(id) ON DELETE RESTRICT,
  storage_status         TEXT NOT NULL DEFAULT 'with_finder'
                         CHECK (storage_status IN ('with_finder','handed_to_security','at_lost_found_desk')),
  status                 TEXT NOT NULL DEFAULT 'reported'
                         CHECK (status IN ('reported','under_review','stored','claim_pending','returned','archived')),
  is_hidden              INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0,1)),
  hidden_reason          TEXT,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- One optional photo per report; exactly one of the two foreign keys is set.
CREATE TABLE item_photos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  lost_report_id  INTEGER REFERENCES lost_reports(id) ON DELETE CASCADE,
  found_report_id INTEGER REFERENCES found_reports(id) ON DELETE CASCADE,
  stored_name     TEXT NOT NULL UNIQUE CHECK (stored_name GLOB '[0-9a-f]*' AND length(stored_name) BETWEEN 36 AND 40),
  mime_type       TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  size_bytes      INTEGER NOT NULL CHECK (size_bytes > 0),
  uploaded_by     INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((lost_report_id IS NULL) <> (found_report_id IS NULL))
);
CREATE UNIQUE INDEX ux_photo_lost  ON item_photos(lost_report_id)  WHERE lost_report_id  IS NOT NULL;
CREATE UNIQUE INDEX ux_photo_found ON item_photos(found_report_id) WHERE found_report_id IS NOT NULL;

CREATE TABLE claims (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  found_report_id       INTEGER NOT NULL REFERENCES found_reports(id) ON DELETE RESTRICT,
  claimant_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  lost_report_id        INTEGER REFERENCES lost_reports(id) ON DELETE SET NULL,  -- optional link to the claimant's own lost report
  explanation           TEXT NOT NULL CHECK (length(trim(explanation)) BETWEEN 10 AND 2000),   -- PRIVATE
  status                TEXT NOT NULL DEFAULT 'submitted'
                        CHECK (status IN ('submitted','under_review','info_requested','approved','rejected','withdrawn','completed')),
  verification_request  TEXT,
  verification_response TEXT,
  decision_reason       TEXT,
  reviewed_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (status <> 'rejected' OR (decision_reason IS NOT NULL AND length(trim(decision_reason)) >= 3))
);
-- A claimant can have only one live claim per found item.
CREATE UNIQUE INDEX ux_claims_one_live_per_claimant
  ON claims(found_report_id, claimant_id)
  WHERE status IN ('submitted','under_review','info_requested','approved');
-- DATABASE-LEVEL GUARD: at most one approved/completed claim per found item, so two staff
-- approving different claims at the same moment can never both succeed.
CREATE UNIQUE INDEX ux_claims_single_winner
  ON claims(found_report_id)
  WHERE status IN ('approved','completed');

CREATE TABLE handovers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id        INTEGER NOT NULL UNIQUE REFERENCES claims(id) ON DELETE RESTRICT,
  found_report_id INTEGER NOT NULL UNIQUE REFERENCES found_reports(id) ON DELETE RESTRICT, -- an item can be returned once
  handed_by       INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recipient_name  TEXT NOT NULL CHECK (length(trim(recipient_name)) BETWEEN 2 AND 100),
  notes           TEXT CHECK (notes IS NULL OR length(notes) <= 1000),
  handed_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE match_suggestions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  lost_report_id  INTEGER NOT NULL REFERENCES lost_reports(id) ON DELETE CASCADE,
  found_report_id INTEGER NOT NULL REFERENCES found_reports(id) ON DELETE CASCADE,
  score           INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  reasons         TEXT NOT NULL,              -- JSON array of human-readable strings
  status          TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested','reviewed','dismissed','confirmed')),
  reviewed_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (lost_report_id, found_report_id)    -- prevents duplicate suggestions
);

CREATE TABLE report_flags (                   -- user-submitted "inappropriate / duplicate" flags for admin review
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  report_type TEXT NOT NULL CHECK (report_type IN ('lost','found')),
  report_id   INTEGER NOT NULL,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 5 AND 500),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (report_type, report_id, reporter_id)
);

-- report_id is polymorphic (lost or found), so it cannot carry a foreign key; the application
-- validates it. Trade-off documented in docs/architecture.md.
CREATE TABLE report_status_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  report_type TEXT NOT NULL CHECK (report_type IN ('lost','found')),
  report_id   INTEGER NOT NULL,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  changed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE claim_status_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id    INTEGER NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  changed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message    TEXT NOT NULL,
  link       TEXT,
  is_read    INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER,
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Keep updated_at correct even if application code forgets to set it.
CREATE TRIGGER trg_users_updated AFTER UPDATE ON users FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER trg_lost_updated AFTER UPDATE ON lost_reports FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE lost_reports SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER trg_found_updated AFTER UPDATE ON found_reports FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE found_reports SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER trg_claims_updated AFTER UPDATE ON claims FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE claims SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER trg_match_updated AFTER UPDATE ON match_suggestions FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE match_suggestions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
