-- Expiring, admin-confirmed broadcasts to customers with active/recent order records.
CREATE TABLE IF NOT EXISTS admin_broadcast_drafts (
  id TEXT PRIMARY KEY,
  admin_telegram_id TEXT NOT NULL,
  message_text TEXT,
  media_kind TEXT CHECK(media_kind IS NULL OR media_kind IN ('photo','document')),
  media_file_id TEXT,
  media_mime_type TEXT,
  status TEXT NOT NULL CHECK(status IN ('draft','sending','sent','partial','cancelled','expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_broadcast_one_editable_per_admin
  ON admin_broadcast_drafts(admin_telegram_id) WHERE status='draft';
