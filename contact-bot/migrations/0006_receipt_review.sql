-- Adds the manual receipt-review fallback used only after the bot has checked
-- for an existing Selar/backend sale record and found none attached to the
-- customer's pending order. A submission is evidence for an administrator to
-- compare with Selar; these tables never verify, approve, or fulfil an order.
--
-- The prompt table follows the checkout-name prompt pattern. The submission
-- table stores only Telegram file identifiers and delivery state, never receipt
-- contents, captions, or OCR text. Unique indexes make duplicate Telegram
-- updates and repeated delivery of the same file retry-safe.

CREATE TABLE IF NOT EXISTS receipt_review_prompts (
  telegram_user_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  order_kind TEXT NOT NULL CHECK(order_kind IN ('contact','service')),
  created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS payment_receipt_submissions (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  order_kind TEXT NOT NULL CHECK(order_kind IN ('contact','service')),
  telegram_user_id TEXT NOT NULL,
  telegram_chat_id TEXT NOT NULL,
  telegram_message_id INTEGER,
  media_kind TEXT NOT NULL CHECK(media_kind IN ('photo','document')),
  telegram_file_id TEXT NOT NULL,
  telegram_file_unique_id TEXT,
  mime_type TEXT,
  file_size INTEGER,
  status TEXT NOT NULL CHECK(status IN ('forwarding','forwarded','delivery_failed','superseded')),
  admin_telegram_id TEXT,
  created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_receipt_submissions_telegram_message
  ON payment_receipt_submissions(telegram_user_id, telegram_message_id)
  WHERE telegram_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_receipt_submissions_order_file
  ON payment_receipt_submissions(order_id, telegram_file_unique_id)
  WHERE telegram_file_unique_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_receipt_submissions_order_status
  ON payment_receipt_submissions(order_id, status);
