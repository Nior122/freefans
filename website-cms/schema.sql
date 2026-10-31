-- FansLeak website CMS schema for the separate Cloudflare Pages D1 database.
-- Bind this database in Cloudflare Pages as SITE_DB.
-- Do not use the Telegram bot database for this website CMS.

CREATE TABLE IF NOT EXISTS cms_profiles (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('published','draft','hidden','deleted')),
  origin TEXT NOT NULL CHECK(origin IN ('builtin','cms')),
  record_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_cms_profiles_status_updated
  ON cms_profiles(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS cms_adverts (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('active','draft','disabled')),
  kind TEXT NOT NULL CHECK(kind IN ('managed','script','html','popunder','social_bar','native_banner')),
  placement TEXT NOT NULL CHECK(placement IN ('global','sidebar','home_top','home_inline','home_bottom','profile_top','profile_inline','profile_bottom')),
  priority INTEGER NOT NULL DEFAULT 50,
  starts_at TEXT,
  ends_at TEXT,
  advert_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_cms_adverts_public
  ON cms_adverts(status, placement, priority, updated_at DESC);

CREATE TABLE IF NOT EXISTS cms_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS cms_login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT NOT NULL,
  username TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 0 CHECK(success IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_cms_login_attempts_recent
  ON cms_login_attempts(ip_hash, created_at DESC);
