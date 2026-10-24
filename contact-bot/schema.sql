PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS contact_requests (
 id TEXT PRIMARY KEY, telegram_user_id TEXT NOT NULL, telegram_chat_id TEXT NOT NULL,
 telegram_username TEXT, profile_id TEXT NOT NULL, buyer_email TEXT,
 status TEXT NOT NULL CHECK(status IN ('awaiting_email','pending_payment','payment_verified','approved','rejected','expired')),
 payment_reference TEXT UNIQUE, payment_amount_minor INTEGER, payment_currency TEXT,
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_requests_user_status ON contact_requests(telegram_user_id,status);
CREATE INDEX IF NOT EXISTS idx_requests_email_status ON contact_requests(buyer_email,status);
CREATE TABLE IF NOT EXISTS creator_contacts (
 profile_id TEXT PRIMARY KEY, contact_value TEXT NOT NULL, contact_type TEXT NOT NULL DEFAULT 'telegram',
 sharing_enabled INTEGER NOT NULL DEFAULT 0 CHECK(sharing_enabled IN(0,1)), consent_confirmed_at TEXT,
 updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS processed_sales (
 provider_reference TEXT PRIMARY KEY, buyer_email TEXT NOT NULL, amount_minor INTEGER NOT NULL,
 currency TEXT NOT NULL, product_id TEXT, request_id TEXT,
 received_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS admin_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT, admin_telegram_id TEXT NOT NULL, action TEXT NOT NULL,
 profile_id TEXT, request_id TEXT, details TEXT,
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);