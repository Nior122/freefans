-- Record Selar abandoned-cart events so repeated webhook deliveries do not repeat reminders.
CREATE TABLE IF NOT EXISTS processed_abandoned_carts (
 event_key TEXT PRIMARY KEY,
 product_code TEXT NOT NULL,
 request_id TEXT,
 abandoned_at TEXT NOT NULL,
 processed_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_processed_abandoned_carts_request ON processed_abandoned_carts(request_id);
