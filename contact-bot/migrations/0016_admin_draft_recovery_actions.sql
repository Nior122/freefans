-- Allow durable admin confirmations to cancel a stale locked draft after the
-- admin has inspected Telegram. Existing pending-action history is preserved.
-- Intentionally do not pre-drop admin_pending_actions_new: if a prior run ever
-- stopped mid-rebuild, fail closed and inspect rather than destroying copied rows.
CREATE TABLE admin_pending_actions_new (
  id TEXT PRIMARY KEY,
  admin_telegram_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('hide_profile','close_pending_orders','recover_draft')),
  payload TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','executing','completed','cancelled','expired','failed')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO admin_pending_actions_new(id, admin_telegram_id, action, payload, status, expires_at, created_at, updated_at)
SELECT id, admin_telegram_id, action, payload, status, expires_at, created_at, updated_at
FROM admin_pending_actions;
DROP TABLE admin_pending_actions;
ALTER TABLE admin_pending_actions_new RENAME TO admin_pending_actions;
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_pending_actions_one_pending_per_admin
  ON admin_pending_actions(admin_telegram_id) WHERE status='pending';
