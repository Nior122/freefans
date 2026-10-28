-- Persistent customer language preferences for the Telegram bot.
-- A row may exist before a language is chosen so the original /start payload
-- (profile or service link) can be resumed after the picker callback.
CREATE TABLE IF NOT EXISTS user_language_preferences (
  telegram_user_id TEXT PRIMARY KEY,
  telegram_chat_id TEXT NOT NULL,
  language_code TEXT CHECK(language_code IS NULL OR language_code IN ('en','es','de','fr','ar','pt')),
  pending_start_payload TEXT,
  created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_user_language_preferences_chat
  ON user_language_preferences(telegram_chat_id);
