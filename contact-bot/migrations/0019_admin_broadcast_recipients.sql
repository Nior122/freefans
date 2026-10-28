-- Durable per-recipient ledger for admin broadcasts. A broadcast snapshots its
-- audience when the admin confirms sending, then processes recipients in
-- batches. The composite primary key prevents the same client chat from being
-- queued twice for one broadcast.
CREATE TABLE IF NOT EXISTS admin_broadcast_recipients (
  broadcast_id TEXT NOT NULL,
  telegram_chat_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','uncertain','cancelled')),
  attempted_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (broadcast_id, telegram_chat_id)
);
CREATE INDEX IF NOT EXISTS idx_admin_broadcast_recipients_status
  ON admin_broadcast_recipients(broadcast_id, status, telegram_chat_id);
