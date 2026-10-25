ALTER TABLE contact_requests ADD COLUMN checkout_code TEXT;
ALTER TABLE contact_requests ADD COLUMN checkout_name TEXT;
ALTER TABLE service_orders ADD COLUMN checkout_code TEXT;
ALTER TABLE service_orders ADD COLUMN checkout_name TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_requests_checkout_code ON contact_requests(checkout_code) WHERE checkout_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_orders_checkout_code ON service_orders(checkout_code) WHERE checkout_code IS NOT NULL;
CREATE TABLE IF NOT EXISTS checkout_name_prompts (
 telegram_user_id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL,
 order_kind TEXT NOT NULL CHECK(order_kind IN ('contact','service')),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
