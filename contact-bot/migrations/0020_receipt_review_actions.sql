ALTER TABLE admin_message_drafts
  ADD COLUMN purpose TEXT NOT NULL DEFAULT 'support'
  CHECK (purpose IN ('support', 'rejection'));

CREATE TABLE IF NOT EXISTS admin_receipt_verify_prompts (
  admin_telegram_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  order_kind TEXT NOT NULL CHECK (order_kind IN ('contact', 'service')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_receipt_verify_prompts_order
  ON admin_receipt_verify_prompts(order_kind, order_id);
