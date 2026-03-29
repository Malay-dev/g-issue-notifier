-- ─────────────────────────────────────────────────────
-- FUTURE: only used when MULTI_TENANT=true
-- Today: empty, never queried, exists only for migration
-- readiness
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  chat_id      INTEGER UNIQUE NOT NULL,
  gh_username  TEXT,
  gh_pat       TEXT,
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────
-- SUBSCRIPTIONS
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo        TEXT NOT NULL,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(user_id, repo)
);

-- ─────────────────────────────────────────────────────
-- LABEL FILTERS
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS label_filters (
  id              TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,

  UNIQUE(subscription_id, label)
);

-- ─────────────────────────────────────────────────────
-- TEMPLATES
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS templates (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(user_id, name)
);

-- ─────────────────────────────────────────────────────
-- CLAIMS (audit log)
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS claims (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
  repo            TEXT NOT NULL,
  issue_number    INTEGER NOT NULL,
  gh_comment_id   INTEGER,
  claimed_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_subscriptions_user   ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_repo   ON subscriptions(repo);
CREATE INDEX IF NOT EXISTS idx_label_filters_sub    ON label_filters(subscription_id);
CREATE INDEX IF NOT EXISTS idx_label_filters_user   ON label_filters(user_id);
CREATE INDEX IF NOT EXISTS idx_templates_user       ON templates(user_id);
CREATE INDEX IF NOT EXISTS idx_claims_user          ON claims(user_id);
CREATE INDEX IF NOT EXISTS idx_claims_repo_issue    ON claims(repo, issue_number);