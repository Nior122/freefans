import type { Advert, CmsProfileRecord, Image, Profile } from '../../types';
import {
  CmsConfigError,
  clampInteger,
  ensureSiteCmsSchema,
  loadCmsAdverts,
  loadCmsProfileRecord,
  loadCmsProfileRecords,
  sanitizePublicProfileRecord,
  siteCmsConfig,
  advertIsLive,
  writeCmsAudit,
  type SiteCmsEnv,
} from '../_lib/siteCms';
import { assertPublicHttpUrl, ScrapeError, scrapeProfileSource } from '../_lib/scraper';

interface PagesContext {
  request: Request;
  env: SiteCmsEnv;
  params?: { path?: string | string[] };
}

class HttpError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = 'bad_request') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const PROFILE_STATUSES = new Set(['published', 'draft', 'hidden', 'deleted']);
const PROFILE_ORIGINS = new Set(['builtin', 'cms']);
const ADVERT_STATUSES = new Set(['active', 'draft', 'disabled']);
const ADVERT_KINDS = new Set(['managed', 'script', 'html', 'popunder', 'social_bar', 'native_banner']);
const ADVERT_PLACEMENTS = new Set(['global', 'sidebar', 'home_top', 'home_inline', 'home_bottom', 'profile_top', 'profile_inline', 'profile_bottom']);
const RESERVED_PROFILE_IDS = new Set(['admin', 'auth', 'favorites', 'search', 'hashtags', 'more', 'api', 'profile', 'sitemap', 'robots', 'assets', 'favicon', 'index']);
const SESSION_COOKIE = 'fansleak_admin_session';

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
      ...headers,
    },
  });
}

function errorJson(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.code, message: error.message }, error.status);
  if (error instanceof CmsConfigError) return json({ error: error.code, message: error.message }, 503);
  if (error instanceof ScrapeError) return json({ error: error.code, message: error.message }, error.status);
  console.error('Website CMS API error', error);
  return json({ error: 'internal_error', message: 'The website CMS API could not complete that request.' }, 500);
}

async function readJson(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new HttpError('Request body is too large.', 413, 'payload_too_large');
  try {
    const parsed = JSON.parse(text || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError('Request body must be a JSON object.', 400, 'invalid_json');
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function sha256Bytes(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function sha256Hex(value: string): Promise<string> {
  return [...await sha256Bytes(value)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) diff |= (a[i] || 0) ^ (b[i] || 0);
  return diff === 0;
}

async function textMatches(candidate: string, expected: string): Promise<boolean> {
  return timingSafeEqual(await sha256Bytes(candidate), await sha256Bytes(expected));
}

async function passwordMatches(candidate: string, env: SiteCmsEnv): Promise<boolean> {
  const candidateHash = await sha256Bytes(candidate);
  if (/^[a-f0-9]{64}$/i.test(env.ADMIN_PASSWORD_SHA256 || '')) {
    const expected = Uint8Array.from((env.ADMIN_PASSWORD_SHA256 || '').match(/.{2}/g) || [], pair => parseInt(pair, 16));
    return timingSafeEqual(candidateHash, expected);
  }
  if (!env.ADMIN_PASSWORD) return false;
  return timingSafeEqual(candidateHash, await sha256Bytes(env.ADMIN_PASSWORD));
}

async function hmac(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

function sessionHours(env: SiteCmsEnv): number {
  return clampInteger(env.ADMIN_SESSION_HOURS, 8, 1, 72);
}

async function createSessionToken(username: string, env: SiteCmsEnv): Promise<{ token: string; maxAge: number }> {
  const now = Math.floor(Date.now() / 1000);
  const maxAge = sessionHours(env) * 3600;
  const payload = { sub: username, role: 'admin', iat: now, exp: now + maxAge };
  const encoded = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = base64UrlEncode(await hmac(env.ADMIN_SESSION_SECRET || '', encoded));
  return { token: `${encoded}.${signature}`, maxAge };
}

function readCookie(request: Request, name: string): string {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

async function currentAdmin(request: Request, env: SiteCmsEnv): Promise<string | null> {
  const config = siteCmsConfig(env);
  if (!config.authConfigured || !env.ADMIN_SESSION_SECRET) return null;
  const token = readCookie(request, SESSION_COOKIE);
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  try {
    const expected = await hmac(env.ADMIN_SESSION_SECRET, encoded);
    if (!timingSafeEqual(expected, base64UrlDecode(signature))) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded))) as { sub?: unknown; role?: unknown; exp?: unknown };
    if (payload.role !== 'admin' || typeof payload.sub !== 'string') return null;
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!(await textMatches(payload.sub, env.ADMIN_USERNAME || ''))) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

async function requireAdmin(request: Request, env: SiteCmsEnv): Promise<string> {
  const config = siteCmsConfig(env);
  if (!config.databaseConfigured || !config.authConfigured) {
    throw new CmsConfigError('Website admin is not configured. Bind SITE_DB and set ADMIN_USERNAME, ADMIN_PASSWORD, and ADMIN_SESSION_SECRET in Cloudflare Pages.');
  }
  const username = await currentAdmin(request, env);
  if (!username) throw new HttpError('Admin login required.', 401, 'unauthorised');
  return username;
}

function sessionCookie(request: Request, token: string, maxAge: number): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function clearedSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

function requireAdminMutationHeader(request: Request) {
  if (request.headers.get('x-admin-request') !== '1') {
    throw new HttpError('Missing admin request header.', 403, 'admin_header_required');
  }
}

async function clientIpHash(request: Request, env: SiteCmsEnv): Promise<string> {
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  return sha256Hex(`${ip}:${env.ADMIN_SESSION_SECRET || ''}`);
}

async function handleLogin(request: Request, env: SiteCmsEnv): Promise<Response> {
  requireAdminMutationHeader(request);
  const config = siteCmsConfig(env);
  if (!config.databaseConfigured || !config.authConfigured) {
    throw new CmsConfigError('Website admin is not configured. Bind SITE_DB and set ADMIN_USERNAME, ADMIN_PASSWORD, and ADMIN_SESSION_SECRET in Cloudflare Pages.');
  }
  const db = await ensureSiteCmsSchema(env);
  const body = await readJson(request, 8192);
  const username = String(body.username || '').trim().slice(0, 120);
  const password = String(body.password || '').slice(0, 512);
  const ipHash = await clientIpHash(request, env);
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const attempts = await db.prepare(`
    SELECT COUNT(*) AS count FROM cms_login_attempts
    WHERE ip_hash=? AND success=0 AND created_at>=?
  `).bind(ipHash, cutoff).first<{ count: number }>();
  if (Number(attempts?.count || 0) >= 10) {
    throw new HttpError('Too many failed login attempts. Wait 15 minutes and try again.', 429, 'login_rate_limited');
  }

  const usernameOk = await textMatches(username, env.ADMIN_USERNAME || '');
  const passwordOk = await passwordMatches(password, env);
  const success = usernameOk && passwordOk;
  await db.prepare('INSERT INTO cms_login_attempts(ip_hash,username,success) VALUES(?,?,?)').bind(ipHash, username || 'unknown', success ? 1 : 0).run();

  if (!success) {
    await new Promise(resolve => setTimeout(resolve, 250));
    throw new HttpError('Invalid admin username or password.', 401, 'invalid_credentials');
  }

  const { token, maxAge } = await createSessionToken(env.ADMIN_USERNAME || username, env);
  await writeCmsAudit(env, env.ADMIN_USERNAME || username, 'login', 'session');
  return json({ authenticated: true, username: env.ADMIN_USERNAME, config }, 200, { 'set-cookie': sessionCookie(request, token, maxAge) });
}

function cleanString(value: unknown, max: number, fallback = ''): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : fallback;
}

function optionalString(value: unknown, max: number): string | undefined {
  const cleaned = cleanString(value, max);
  return cleaned || undefined;
}

function publicUrl(value: unknown, max = 2048): string {
  const cleaned = cleanString(value, max);
  if (!cleaned) return '';
  try { return assertPublicHttpUrl(cleaned).toString(); } catch { return ''; }
}

function assetUrl(value: unknown, max = 2048): string {
  const cleaned = cleanString(value, max);
  if (!cleaned) return '';
  if (cleaned.startsWith('/')) {
    try {
      const parsed = new URL(cleaned, 'https://fansleak.invalid');
      // Reject //host and slash/backslash tricks that URL parsing turns into
      // a different origin. Normal same-origin assets such as
      // /media/ruri/ruri-001.jpg remain valid.
      if (parsed.origin !== 'https://fansleak.invalid' || parsed.username || parsed.password) return '';
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return '';
    }
  }
  return publicUrl(cleaned, max);
}

function requiredAssetUrl(value: unknown, label: string): string {
  const parsed = assetUrl(value);
  if (!parsed) throw new HttpError(`${label} must use a public http(s) URL or a same-origin path starting with /.`);
  return parsed;
}

function optionalAssetUrl(value: unknown, label: string): string {
  const cleaned = cleanString(value, 2048);
  if (!cleaned) return '';
  return requiredAssetUrl(cleaned, label);
}

function validDate(value: unknown): string | undefined {
  const cleaned = cleanString(value, 80);
  if (!cleaned) return undefined;
  const date = new Date(cleaned);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function validateMedia(raw: unknown, index: number): Image {
  if (!raw || typeof raw !== 'object') throw new HttpError(`Media item ${index + 1} is invalid.`);
  const item = raw as Record<string, unknown>;
  const id = cleanString(item.id, 120);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(id)) throw new HttpError(`Media item ${index + 1} has an invalid ID.`);
  const url = requiredAssetUrl(item.url, `Media item ${index + 1}`);
  const thumbnailUrl = item.thumbnailUrl ? requiredAssetUrl(item.thumbnailUrl, `Media item ${index + 1} thumbnail`) : url;
  const sourceUrl = optionalAssetUrl(item.sourceUrl, `Media item ${index + 1} source`);
  return {
    id,
    url,
    thumbnailUrl,
    caption: cleanString(item.caption, 140),
    width: clampInteger(item.width, 800, 1, 10000),
    height: clampInteger(item.height, 1000, 1, 10000),
    isLocked: item.isLocked !== false,
    isVisible: item.isVisible !== false,
    mediaType: item.mediaType === 'video' ? 'video' : 'image',
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(cleanString(item.sha256, 160) ? { sha256: cleanString(item.sha256, 160) } : {}),
    ...(validDate(item.createdAt) ? { createdAt: validDate(item.createdAt) } : {}),
  };
}

function validateProfile(raw: unknown, strict: boolean): Profile {
  if (!raw || typeof raw !== 'object') throw new HttpError('Profile data is required.');
  const item = raw as Record<string, unknown>;
  const id = cleanString(item.id, 64).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(id) || RESERVED_PROFILE_IDS.has(id)) {
    throw new HttpError('Profile ID must be a valid non-reserved website slug.');
  }
  const name = cleanString(item.name, 60);
  const bio = cleanString(item.bio, 400);
  if (strict && !name) throw new HttpError('Published profiles require a display name.');
  if (strict && bio.length < 10) throw new HttpError('Published profiles require a bio of at least 10 characters.');

  const imagesRaw = Array.isArray(item.images) ? item.images : [];
  if (imagesRaw.length > 2000) throw new HttpError('A CMS profile can contain at most 2,000 media items per save.', 413, 'too_many_media');
  if (strict && !imagesRaw.length) throw new HttpError('Published profiles require at least one media item.');
  const images = imagesRaw.map(validateMedia);
  if (new Set(images.map(image => image.id)).size !== images.length) throw new HttpError('Profile media IDs must be unique.');

  const statsRaw = item.stats && typeof item.stats === 'object' ? item.stats as Record<string, unknown> : {};
  const avatarUrl = optionalAssetUrl(item.avatarUrl, 'Avatar');
  const heroUrl = optionalAssetUrl(item.heroUrl, 'Hero') || avatarUrl || images.find(image => image.mediaType === 'image')?.url || '';
  if (strict && (!avatarUrl || !heroUrl)) throw new HttpError('Published profiles require avatar and hero URLs (public http(s) or same-origin /path).');

  let handle = cleanString(item.handle, 80) || `@${id}`;
  if (!handle.startsWith('@')) handle = `@${handle}`;

  return {
    id,
    name,
    handle,
    bio,
    avatarUrl,
    heroUrl,
    tags: Array.isArray(item.tags) ? [...new Set(item.tags.map(tag => cleanString(tag, 40).toLowerCase()).filter(Boolean))].slice(0, 12) : [],
    category: cleanString(item.category, 40) || 'Creator',
    images,
    stats: {
      posts: clampInteger(statsRaw.posts, images.length, 0, 100000000),
      likes: clampInteger(statsRaw.likes, 0, 0, 1000000000),
      views: clampInteger(statsRaw.views, 0, 0, 10000000000),
      followers: clampInteger(statsRaw.followers, 0, 0, 1000000000),
      ...(statsRaw.subscribers !== undefined ? { subscribers: clampInteger(statsRaw.subscribers, 0, 0, 1000000000) } : {}),
    },
    isVerified: item.isVerified === true,
    isVisible: item.isVisible !== false,
    pricePerMonth: clampInteger(Math.round(Number(item.pricePerMonth || 0) * 100), 0, 0, 1000000) / 100,
    ...(cleanString(item.access_mode, 60) ? { access_mode: cleanString(item.access_mode, 60) } : {}),
  };
}

function validatePatch(raw: unknown): CmsProfileRecord['patch'] {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError('Built-in profile patch must be an object.');
  const item = raw as Record<string, unknown>;
  const patch: NonNullable<CmsProfileRecord['patch']> = {};
  if (item.name !== undefined) patch.name = cleanString(item.name, 60);
  if (item.handle !== undefined) patch.handle = cleanString(item.handle, 80);
  if (item.bio !== undefined) patch.bio = cleanString(item.bio, 400);
  if (item.avatarUrl !== undefined) patch.avatarUrl = optionalAssetUrl(item.avatarUrl, 'Avatar');
  if (item.heroUrl !== undefined) patch.heroUrl = optionalAssetUrl(item.heroUrl, 'Hero');
  if (item.category !== undefined) patch.category = cleanString(item.category, 40);
  if (Array.isArray(item.tags)) patch.tags = [...new Set(item.tags.map(tag => cleanString(tag, 40).toLowerCase()).filter(Boolean))].slice(0, 12);
  if (item.stats && typeof item.stats === 'object') {
    const stats = item.stats as Record<string, unknown>;
    patch.stats = {
      posts: clampInteger(stats.posts, 0, 0, 100000000),
      likes: clampInteger(stats.likes, 0, 0, 1000000000),
      views: clampInteger(stats.views, 0, 0, 10000000000),
      followers: clampInteger(stats.followers, 0, 0, 1000000000),
      ...(stats.subscribers !== undefined ? { subscribers: clampInteger(stats.subscribers, 0, 0, 1000000000) } : {}),
    };
  }
  if (item.isVerified !== undefined) patch.isVerified = item.isVerified === true;
  if (item.isVisible !== undefined) patch.isVisible = item.isVisible !== false;
  if (item.pricePerMonth !== undefined) patch.pricePerMonth = clampInteger(Math.round(Number(item.pricePerMonth || 0) * 100), 0, 0, 1000000) / 100;
  if (item.access_mode !== undefined) patch.access_mode = cleanString(item.access_mode, 60);
  return patch;
}

function validateRecord(raw: Record<string, unknown>, routeId: string): CmsProfileRecord {
  const id = cleanString(raw.id, 64).toLowerCase();
  if (id !== routeId.toLowerCase()) throw new HttpError('Profile ID in the URL and body must match.');
  const status = cleanString(raw.status, 20);
  const origin = cleanString(raw.origin, 20);
  if (!PROFILE_STATUSES.has(status)) throw new HttpError('Invalid profile status.');
  if (!PROFILE_ORIGINS.has(origin)) throw new HttpError('Invalid profile origin.');

  if (origin === 'cms') {
    return { id, status: status as CmsProfileRecord['status'], origin, profile: validateProfile(raw.profile, status === 'published') };
  }

  const addedRaw = Array.isArray(raw.addedMedia) ? raw.addedMedia : [];
  if (addedRaw.length > 2000) throw new HttpError('At most 2,000 added media items can be saved at once.', 413, 'too_many_media');
  const stringList = (value: unknown, max: number) => Array.isArray(value) ? value.map(item => cleanString(item, 160)).filter(Boolean).slice(0, max) : [];
  const mediaPatches: CmsProfileRecord['mediaPatches'] = {};
  if (raw.mediaPatches && typeof raw.mediaPatches === 'object' && !Array.isArray(raw.mediaPatches)) {
    for (const [mediaId, patchRaw] of Object.entries(raw.mediaPatches as Record<string, unknown>).slice(0, 20000)) {
      if (!patchRaw || typeof patchRaw !== 'object') continue;
      const patch = patchRaw as Record<string, unknown>;
      const validated: Partial<Omit<Image, 'id'>> = {};
      if (patch.url !== undefined) validated.url = requiredAssetUrl(patch.url, 'Patched media');
      if (patch.thumbnailUrl !== undefined) validated.thumbnailUrl = requiredAssetUrl(patch.thumbnailUrl, 'Patched media thumbnail');
      if (patch.caption !== undefined) validated.caption = cleanString(patch.caption, 140);
      if (patch.width !== undefined) validated.width = clampInteger(patch.width, 800, 1, 10000);
      if (patch.height !== undefined) validated.height = clampInteger(patch.height, 1000, 1, 10000);
      if (patch.isLocked !== undefined) validated.isLocked = patch.isLocked !== false;
      if (patch.isVisible !== undefined) validated.isVisible = patch.isVisible !== false;
      if (patch.mediaType !== undefined) validated.mediaType = patch.mediaType === 'video' ? 'video' : 'image';
      if (patch.sourceUrl !== undefined) validated.sourceUrl = optionalAssetUrl(patch.sourceUrl, 'Patched media source');
      if (patch.sha256 !== undefined) validated.sha256 = cleanString(patch.sha256, 160);
      if (patch.createdAt !== undefined) validated.createdAt = validDate(patch.createdAt);
      mediaPatches[cleanString(mediaId, 160)] = validated;
    }
  }

  return {
    id,
    status: status as CmsProfileRecord['status'],
    origin: origin as CmsProfileRecord['origin'],
    ...(validatePatch(raw.patch) ? { patch: validatePatch(raw.patch) } : {}),
    ...(addedRaw.length ? { addedMedia: addedRaw.map(validateMedia) } : {}),
    ...(stringList(raw.removedMediaIds, 20000).length ? { removedMediaIds: stringList(raw.removedMediaIds, 20000) } : {}),
    ...(Object.keys(mediaPatches).length ? { mediaPatches } : {}),
    ...(stringList(raw.mediaOrder, 20000).length ? { mediaOrder: stringList(raw.mediaOrder, 20000) } : {}),
  };
}

function validateAdvert(raw: Record<string, unknown>, routeId: string): Advert {
  const id = cleanString(raw.id, 80).toLowerCase();
  if (id !== routeId.toLowerCase() || !/^[a-z0-9][a-z0-9._-]{1,79}$/.test(id)) throw new HttpError('Advert ID must be a valid slug and match the URL.');
  const status = cleanString(raw.status, 20);
  const kind = cleanString(raw.kind, 30);
  const placement = cleanString(raw.placement, 30);
  if (!ADVERT_STATUSES.has(status)) throw new HttpError('Invalid advert status.');
  if (!ADVERT_KINDS.has(kind)) throw new HttpError('Invalid advert type.');
  if (!ADVERT_PLACEMENTS.has(placement)) throw new HttpError('Invalid advert placement.');
  if ((kind === 'popunder' || kind === 'social_bar') && placement !== 'global') throw new HttpError('Popunder and social-bar adverts must use the global placement.');
  if (kind === 'managed' && placement === 'global') throw new HttpError('Managed banners need a visible placement, not global.');
  if (kind === 'native_banner' && placement === 'global') throw new HttpError('Native banners need a visible placement, not global.');

  const startsAt = validDate(raw.startsAt);
  const endsAt = validDate(raw.endsAt);
  if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) throw new HttpError('Advert end date must be after its start date.');

  const advert: Advert = {
    id,
    title: cleanString(raw.title, 120),
    kind: kind as Advert['kind'],
    placement: placement as Advert['placement'],
    status: status as Advert['status'],
    priority: clampInteger(raw.priority, 50, -1000, 1000),
    ...(startsAt ? { startsAt } : {}),
    ...(endsAt ? { endsAt } : {}),
    ...(optionalString(raw.headline, 160) ? { headline: optionalString(raw.headline, 160) } : {}),
    ...(optionalString(raw.description, 500) ? { description: optionalString(raw.description, 500) } : {}),
    ...(assetUrl(raw.imageUrl) ? { imageUrl: assetUrl(raw.imageUrl) } : {}),
    ...(assetUrl(raw.videoUrl) ? { videoUrl: assetUrl(raw.videoUrl) } : {}),
    ...(assetUrl(raw.destinationUrl) ? { destinationUrl: assetUrl(raw.destinationUrl) } : {}),
    ...(optionalString(raw.ctaLabel, 60) ? { ctaLabel: optionalString(raw.ctaLabel, 60) } : {}),
    ...(publicUrl(raw.scriptUrl) ? { scriptUrl: publicUrl(raw.scriptUrl) } : {}),
    ...(typeof raw.code === 'string' && raw.code.trim() ? { code: raw.code.slice(0, 100000) } : {}),
  };

  if (!advert.title) throw new HttpError('Adverts require an internal title.');
  if (advert.scriptUrl && !advert.scriptUrl.startsWith('https://')) throw new HttpError('Third-party advert scripts must use HTTPS.');
  if (advert.status === 'active' && advert.kind === 'managed' && (!advert.destinationUrl || (!advert.imageUrl && !advert.videoUrl))) {
    throw new HttpError('Active managed banners require a destination and an image or video URL.');
  }
  if (advert.status === 'active' && advert.kind !== 'managed' && !advert.scriptUrl && !advert.code) {
    throw new HttpError('Active network adverts require a script URL or provider code.');
  }
  return advert;
}

async function saveProfile(request: Request, env: SiteCmsEnv, id: string, actor: string): Promise<Response> {
  requireAdminMutationHeader(request);
  const record = validateRecord(await readJson(request, 5 * 1024 * 1024), id);
  const db = await ensureSiteCmsSchema(env);
  await db.prepare(`
    INSERT INTO cms_profiles(id,status,origin,record_json)
    VALUES(?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      status=excluded.status,
      origin=excluded.origin,
      record_json=excluded.record_json,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `).bind(record.id, record.status, record.origin, JSON.stringify(record)).run();
  const saved = await loadCmsProfileRecord(env, record.id);
  await writeCmsAudit(env, actor, 'save_profile', 'profile', record.id, { status: record.status, origin: record.origin });
  return json({ record: saved });
}

async function saveAdvert(request: Request, env: SiteCmsEnv, id: string, actor: string): Promise<Response> {
  requireAdminMutationHeader(request);
  const advert = validateAdvert(await readJson(request, 256 * 1024), id);
  const db = await ensureSiteCmsSchema(env);
  await db.prepare(`
    INSERT INTO cms_adverts(id,status,kind,placement,priority,starts_at,ends_at,advert_json)
    VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      status=excluded.status,
      kind=excluded.kind,
      placement=excluded.placement,
      priority=excluded.priority,
      starts_at=excluded.starts_at,
      ends_at=excluded.ends_at,
      advert_json=excluded.advert_json,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `).bind(advert.id, advert.status, advert.kind, advert.placement, advert.priority, advert.startsAt || null, advert.endsAt || null, JSON.stringify(advert)).run();
  const saved = (await loadCmsAdverts(env)).find(item => item.id === advert.id) || advert;
  await writeCmsAudit(env, actor, 'save_advert', 'advert', advert.id, { status: advert.status, kind: advert.kind, placement: advert.placement });
  return json({ advert: saved });
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean).map(part => {
    try { return decodeURIComponent(part); } catch { return part; }
  });

  try {
    if (parts[0] !== 'api') throw new HttpError('Not found.', 404, 'not_found');
    const config = siteCmsConfig(env);

    if (request.method === 'GET' && parts.length === 2 && parts[1] === 'health') {
      return json({ ok: true, databaseConfigured: config.databaseConfigured, authConfigured: config.authConfigured });
    }

    if (request.method === 'GET' && parts[1] === 'public' && parts[2] === 'content') {
      if (!config.databaseConfigured) {
        return json({ profileRecords: [], adverts: [], generatedAt: new Date().toISOString() }, 200, { 'cache-control': 'public, max-age=30', 'x-fansleak-cms-configured': 'false' });
      }
      const records = (await loadCmsProfileRecords(env)).map(sanitizePublicProfileRecord).filter((item): item is CmsProfileRecord => Boolean(item));
      const adverts = (await loadCmsAdverts(env)).filter(advert => advertIsLive(advert));
      return json({ profileRecords: records, adverts, generatedAt: new Date().toISOString() }, 200, { 'cache-control': 'public, max-age=30, stale-while-revalidate=60', 'x-fansleak-cms-configured': 'true' });
    }

    if (parts[1] !== 'admin') throw new HttpError('Not found.', 404, 'not_found');

    if (request.method === 'POST' && parts[2] === 'login' && parts.length === 3) return await handleLogin(request, env);

    if (request.method === 'GET' && parts[2] === 'session' && parts.length === 3) {
      const username = await currentAdmin(request, env);
      return json({ authenticated: Boolean(username), ...(username ? { username } : {}), config });
    }

    const actor = await requireAdmin(request, env);

    if (request.method === 'POST' && parts[2] === 'logout' && parts.length === 3) {
      requireAdminMutationHeader(request);
      await writeCmsAudit(env, actor, 'logout', 'session');
      return json({ ok: true }, 200, { 'set-cookie': clearedSessionCookie(request) });
    }

    if (request.method === 'GET' && (parts[2] === 'content' || parts[2] === 'export') && parts.length === 3) {
      const [profileRecords, adverts] = await Promise.all([loadCmsProfileRecords(env), loadCmsAdverts(env)]);
      return json({ profileRecords, adverts, generatedAt: new Date().toISOString(), username: actor, config });
    }

    if (parts[2] === 'profiles' && parts.length === 4) {
      if (request.method === 'PUT') return await saveProfile(request, env, parts[3], actor);
      if (request.method === 'DELETE') {
        requireAdminMutationHeader(request);
        const db = await ensureSiteCmsSchema(env);
        await db.prepare('DELETE FROM cms_profiles WHERE id=?').bind(parts[3]).run();
        await writeCmsAudit(env, actor, 'hard_delete_profile_record', 'profile', parts[3]);
        return json({ ok: true });
      }
    }

    if (parts[2] === 'adverts' && parts.length === 4) {
      if (request.method === 'PUT') return await saveAdvert(request, env, parts[3], actor);
      if (request.method === 'DELETE') {
        requireAdminMutationHeader(request);
        const db = await ensureSiteCmsSchema(env);
        await db.prepare('DELETE FROM cms_adverts WHERE id=?').bind(parts[3]).run();
        await writeCmsAudit(env, actor, 'delete_advert', 'advert', parts[3]);
        return json({ ok: true });
      }
    }

    if (request.method === 'POST' && parts[2] === 'scrape' && parts.length === 3) {
      requireAdminMutationHeader(request);
      const body = await readJson(request, 128 * 1024);
      if (body.rightsConfirmed !== true) {
        throw new HttpError('Confirm that you own this content or have permission to publish it before scraping.', 400, 'rights_confirmation_required');
      }
      const result = await scrapeProfileSource(body, env);
      await writeCmsAudit(env, actor, 'scrape_profile_source', 'profile', result.draftProfile.id, { sourceType: result.sourceType, media: result.draftProfile.images.length });
      return json(result);
    }

    throw new HttpError('Not found.', 404, 'not_found');
  } catch (error) {
    return errorJson(error);
  }
}
