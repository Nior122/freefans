-- General Admin Desk customer-support drafts. These are deliberately separate
-- from payment/consent-gated contact delivery and service fulfilment drafts.
CREATE TABLE IF NOT EXISTS admin_message_drafts (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  order_kind TEXT NOT NULL CHECK(order_kind IN ('contact','service')),
  admin_telegram_id TEXT NOT NULL,
  telegram_user_id TEXT NOT NULL,
  telegram_chat_id TEXT NOT NULL,
  checkout_code TEXT,
  message_text TEXT,
  media_kind TEXT CHECK(media_kind IS NULL OR media_kind IN ('photo','document')),
  media_file_id TEXT,
  media_mime_type TEXT,
  status TEXT NOT NULL CHECK(status IN ('draft','sending','sent','cancelled','expired')),
  expires_at TEXT NOT NULL,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_message_drafts_one_editable_per_admin
  ON admin_message_drafts(admin_telegram_id) WHERE status='draft';
CREATE INDEX IF NOT EXISTS idx_admin_message_drafts_admin_status
  ON admin_message_drafts(admin_telegram_id,status,updated_at);
CREATE INDEX IF NOT EXISTS idx_admin_message_drafts_order_status
  ON admin_message_drafts(order_kind,order_id,status,updated_at);
