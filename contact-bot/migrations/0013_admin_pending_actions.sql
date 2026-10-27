-- Durable admin confirmation state so a reply like "yes" executes the pending action.
CREATE TABLE IF NOT EXISTS admin_pending_actions (
  id TEXT PRIMARY KEY,
  admin_telegram_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('hide_profile','close_pending_orders')),
  payload TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','executing','completed','cancelled','expired','failed')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_pending_actions_one_pending_per_admin
  ON admin_pending_actions(admin_telegram_id) WHERE status='pending';
