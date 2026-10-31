import type { Advert, CmsProfileRecord } from '../../types';

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<unknown[]>;
}

export interface SiteCmsEnv {
  SITE_DB?: D1DatabaseLike;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_PASSWORD_SHA256?: string;
  ADMIN_SESSION_SECRET?: string;
  ADMIN_SESSION_HOURS?: string;
  SCRAPER_USER_AGENT?: string;
  SCRAPER_MAX_ITEMS?: string;
  SCRAPER_MAX_PAGES?: string;
  SITE_URL?: string;
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

export class CmsConfigError extends Error {
  code: string;
  constructor(message: string, code = 'cms_not_configured') {
    super(message);
    this.code = code;
  }
}

export const SITE_CMS_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS cms_profiles (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK(status IN ('published','draft','hidden','deleted')),
    origin TEXT NOT NULL CHECK(origin IN ('builtin','cms')),
    record_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cms_profiles_status_updated
     ON cms_profiles(status, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS cms_adverts (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cms_adverts_public
     ON cms_adverts(status, placement, priority, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS cms_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    details_json TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,
  `CREATE TABLE IF NOT EXISTS cms_login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_hash TEXT NOT NULL,
    username TEXT NOT NULL,
    success INTEGER NOT NULL DEFAULT 0 CHECK(success IN (0,1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cms_login_attempts_recent
     ON cms_login_attempts(ip_hash, created_at DESC)`,
];

const schemaPromises = new WeakMap<object, Promise<void>>();

export function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

export function siteCmsConfig(env: SiteCmsEnv) {
  const passwordConfigured = Boolean(env.ADMIN_PASSWORD) || /^[a-f0-9]{64}$/i.test(env.ADMIN_PASSWORD_SHA256 || '');
  return {
    databaseConfigured: Boolean(env.SITE_DB),
    authConfigured: Boolean(env.ADMIN_USERNAME && passwordConfigured && (env.ADMIN_SESSION_SECRET || '').length >= 32),
    scraperMaxItems: clampInteger(env.SCRAPER_MAX_ITEMS, 300, 1, 1000),
    scraperMaxPages: clampInteger(env.SCRAPER_MAX_PAGES, 3, 1, 10),
  };
}

export function requireSiteDb(env: SiteCmsEnv): D1DatabaseLike {
  if (!env.SITE_DB) {
    throw new CmsConfigError('The website CMS database is not configured. Bind a separate Cloudflare D1 database as SITE_DB in Pages.');
  }
  return env.SITE_DB;
}

export async function ensureSiteCmsSchema(env: SiteCmsEnv): Promise<D1DatabaseLike> {
  const db = requireSiteDb(env);
  let pending = schemaPromises.get(db);
  if (!pending) {
    pending = (async () => {
      await db.batch(SITE_CMS_SCHEMA_STATEMENTS.map(sql => db.prepare(sql)));
    })().catch(error => {
      schemaPromises.delete(db);
      throw error;
    });
    schemaPromises.set(db, pending);
  }
  await pending;
  return db;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

interface ProfileRow {
  id: string;
  status: CmsProfileRecord['status'];
  origin: CmsProfileRecord['origin'];
  record_json: string;
  created_at: string;
  updated_at: string;
}

interface AdvertRow {
  id: string;
  advert_json: string;
  created_at: string;
  updated_at: string;
}

export async function loadCmsProfileRecords(env: SiteCmsEnv): Promise<CmsProfileRecord[]> {
  const db = await ensureSiteCmsSchema(env);
  const result = await db.prepare(`
    SELECT id,status,origin,record_json,created_at,updated_at
    FROM cms_profiles
    ORDER BY updated_at DESC
  `).all<ProfileRow>();

  return (result.results || []).map(row => {
    const record = parseJson<Partial<CmsProfileRecord>>(row.record_json, {});
    return {
      ...record,
      id: row.id,
      status: row.status,
      origin: row.origin,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } as CmsProfileRecord;
  });
}

export async function loadCmsProfileRecord(env: SiteCmsEnv, id: string): Promise<CmsProfileRecord | null> {
  const db = await ensureSiteCmsSchema(env);
  const row = await db.prepare(`
    SELECT id,status,origin,record_json,created_at,updated_at
    FROM cms_profiles WHERE id=?
  `).bind(id).first<ProfileRow>();
  if (!row) return null;
  const record = parseJson<Partial<CmsProfileRecord>>(row.record_json, {});
  return {
    ...record,
    id: row.id,
    status: row.status,
    origin: row.origin,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } as CmsProfileRecord;
}

export async function loadCmsAdverts(env: SiteCmsEnv): Promise<Advert[]> {
  const db = await ensureSiteCmsSchema(env);
  const result = await db.prepare(`
    SELECT id,advert_json,created_at,updated_at
    FROM cms_adverts
    ORDER BY priority ASC, updated_at DESC
  `).all<AdvertRow>();

  return (result.results || []).map(row => {
    const advert = parseJson<Partial<Advert>>(row.advert_json, {});
    return {
      ...advert,
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } as Advert;
  });
}

export function sanitizePublicProfileRecord(record: CmsProfileRecord): CmsProfileRecord | null {
  if (record.status === 'draft') return null;
  if (record.status === 'hidden' || record.status === 'deleted') {
    return {
      id: record.id,
      status: record.status,
      origin: record.origin,
      updatedAt: record.updatedAt,
    };
  }
  return record;
}

export function advertIsLive(advert: Advert, now = new Date()): boolean {
  if (advert.status !== 'active') return false;
  if (advert.startsAt && new Date(advert.startsAt).getTime() > now.getTime()) return false;
  if (advert.endsAt && new Date(advert.endsAt).getTime() < now.getTime()) return false;
  return true;
}

export async function writeCmsAudit(
  env: SiteCmsEnv,
  actor: string,
  action: string,
  entityType: string,
  entityId?: string,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    const db = await ensureSiteCmsSchema(env);
    await db.prepare(`
      INSERT INTO cms_audit_log(actor,action,entity_type,entity_id,details_json)
      VALUES(?,?,?,?,?)
    `).bind(actor, action, entityType, entityId || null, details ? JSON.stringify(details) : null).run();
  } catch {
    // Audit logging must never turn a completed CMS write into an ambiguous error.
  }
}
