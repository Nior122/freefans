-- Service fulfilment must be previewed and explicitly confirmed before customer delivery.
CREATE TABLE IF NOT EXISTS service_delivery_drafts (
  id TEXT PRIMARY KEY,
  service_order_id TEXT NOT NULL UNIQUE,
  admin_telegram_id TEXT NOT NULL,
  message_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','sending','sent','cancelled','expired')),
  expires_at TEXT NOT NULL,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_service_delivery_drafts_admin_status
  ON service_delivery_drafts(admin_telegram_id,status,updated_at);
