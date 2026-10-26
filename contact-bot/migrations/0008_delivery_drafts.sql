-- Request-bound Telegram delivery drafts. Drafts do not approve or deliver by themselves.
CREATE TABLE IF NOT EXISTS delivery_drafts (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  admin_telegram_id TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_delivery_drafts_admin_status ON delivery_drafts(admin_telegram_id,status,updated_at);
CREATE INDEX IF NOT EXISTS idx_delivery_drafts_request_status ON delivery_drafts(request_id,status);
