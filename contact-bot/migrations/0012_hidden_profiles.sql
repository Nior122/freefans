-- Persistent profile visibility overrides controlled by the private Telegram Admin Desk.
CREATE TABLE IF NOT EXISTS hidden_profiles (
  profile_id TEXT PRIMARY KEY,
  hidden_by_admin TEXT NOT NULL,
  reason TEXT,
  hidden_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
