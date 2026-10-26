-- Add the second Selar product's separate order and fulfilment records.
CREATE TABLE IF NOT EXISTS service_orders (
 id TEXT PRIMARY KEY,
 service_id TEXT NOT NULL,
 telegram_user_id TEXT NOT NULL,
 telegram_chat_id TEXT NOT NULL,
 telegram_username TEXT,
 request_text TEXT,
 buyer_email TEXT,
 status TEXT NOT NULL CHECK(status IN ('awaiting_request','awaiting_email','pending_payment','payment_verified','fulfilled','cancelled','payment_review')),
 payment_method TEXT,
 payment_reference TEXT UNIQUE,
 payment_amount_minor INTEGER,
 payment_currency TEXT,
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_service_orders_user_status ON service_orders(telegram_user_id,status);
CREATE INDEX IF NOT EXISTS idx_service_orders_email_status ON service_orders(buyer_email,status);
