#!/usr/bin/env node
/**
 * Fill a bundled profile's media array from its public source listing.
 *
 *   node scripts/fetch-coomer-media.mjs [--limit 200] [--ids a,b,c] [--dry-run]
 *
 * Why this exists: `npm run add-profile` only knows about a payload you hand
 * it. A profile added from a listing page usually contributes a handful of
 * thumbnails, while the creator has hundreds of public posts. This script
 * tops the media array up to `--limit` items (default 200) using the JSON API
 * first and the server-rendered HTML listing as a fallback.
 *
 * Rules it follows:
 *   - images only; videos (mp4/webm/mov) are never written to the media array
 *   - never shrinks an existing array: it only replaces a file when the crawl
 *     found more usable images than the profile already has
 *   - a failure for one artist never aborts the others
 *
 * Requires outbound network access to the source host; it is skipped (exit 0)
 * when the host is unreachable so offline builds keep working.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
const SERVICES_DIR = path.join(ROOT, 'services');
const TARGETS_FILE = path.join(SERVICES_DIR, '.coomer-targets.json');

const DEFAULT_HOST = 'https://coomer.st';
const IMAGE_HOST = 'https://img.coomer.st';
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
const PAGE_SIZE = 50;
const DEFAULT_LIMIT = 200;
const MAX_PAGES = 20;

/* ------------------------------------------------------------------ helpers */

export function isImagePath(value) {
  if (typeof value !== 'string' || !value) return false;
  const clean = value.split('?')[0];
  return IMAGE_EXTENSIONS.has(path.extname(clean).toLowerCase());
}

/** Collapse source text into a short single-line caption (or '' if empty). */
export function toCaption(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const text = candidate
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) return text.slice(0, 140);
  }
  return '';
}

function toIso(value) {
  if (typeof value !== 'string') return null;
  const normalised = /Z$|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
  const time = Date.parse(normalised);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** `{root}/data{path}` for originals, `{root}/thumbnail/data{path}` for posters. */
export function mediaUrls(filePath) {
  const clean = String(filePath || '').split('?')[0];
  const normalised = clean.startsWith('/') ? clean : `/${clean}`;
  return {
    url: `${IMAGE_HOST}/thumbnail/data${normalised}`,
    thumbnailUrl: `${IMAGE_HOST}/thumbnail/data${normalised}`,
  };
}

/** Flatten API posts into image-only entries, newest first. */
export function postsToEntries(posts) {
  const entries = [];
  for (const post of Array.isArray(posts) ? posts : []) {
    if (!post || typeof post !== 'object') continue;
    const caption = toCaption(post.title, post.content);
    const createdAt = toIso(post.published) || toIso(post.added) || toIso(post.edited) || null;
    const files = [post.file, ...(Array.isArray(post.attachments) ? post.attachments : [])];
    for (const file of files) {
      const filePath = typeof file === 'string' ? file : file && file.path;
      if (!isImagePath(filePath)) continue;
      entries.push({ path: filePath, caption, createdAt });
    }
  }
  return entries;
}

/**
 * Build the Image[] written to services/<id>Data.json.
 * Dedupes by path, keeps source order, and stops at `limit`.
 */
export function buildMediaItems(profileId, entries, limit = DEFAULT_LIMIT) {
  const seen = new Set();
  const items = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (items.length >= limit) break;
    const filePath = typeof entry === 'string' ? entry : entry && entry.path;
    if (!isImagePath(filePath)) continue;
    const key = filePath.split('?')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    const { url, thumbnailUrl } = mediaUrls(key);
    const createdAt = (entry && entry.createdAt) || new Date().toISOString();
    items.push({
      id: `${profileId}-${String(items.length + 1).padStart(3, '0')}`,
      url,
      thumbnailUrl,
      caption: (entry && entry.caption) || '',
      width: 1080,
      height: 1350,
      isLocked: true,
      isVisible: true,
      mediaType: 'image',
      createdAt,
    });
  }
  return items;
}

/** Pull image URLs out of the server-rendered listing HTML. */
export function extractHtmlThumbnails(html) {
  const found = [];
  const pattern = /https:\/\/img\.coomer\.st\/thumbnail\/data(\/[^"'\s\\)]+\.(?:jpe?g|png|webp|gif|avif))/gi;
  for (const match of String(html || '').matchAll(pattern)) {
    found.push(match[1]);
  }
  return found;
}

/* ------------------------------------------------------------------- source */

const API_HEADERS = {
  accept: 'text/css',
  'user-agent': process.env.COOMER_USER_AGENT || 'Mozilla/5.0 (compatible; FansLeakCms/1.0)',
};

async function fetchJson(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: API_HEADERS });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.json();
}

async function fetchText(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: API_HEADERS });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.text();
}

/** Crawl one artist: API first, HTML listing fallback, images only. */
export async function fetchArtistEntries({
  id,
  service = 'onlyfans',
  limit = DEFAULT_LIMIT,
  host = DEFAULT_HOST,
  fetchImpl = fetch,
  log = () => {},
}) {
  const entries = [];
  const seen = new Set();
  const push = (entry) => {
    const key = entry.path.split('?')[0];
    if (seen.has(key)) return;
    seen.add(key);
    entries.push(entry);
  };

  try {
    for (let page = 0; page < MAX_PAGES && entries.length < limit; page += 1) {
      const offset = page * PAGE_SIZE;
      const url = `${host}/api/v1/${service}/user/${encodeURIComponent(id)}/posts?o=${offset}`;
      const posts = await fetchJson(url, fetchImpl);
      const batch = postsToEntries(posts);
      if (!batch.length) break;
      batch.forEach(push);
      log(`  api o=${offset}: +${batch.length} (total ${entries.length})`);
      if (batch.length < PAGE_SIZE) break;
    }
  } catch (error) {
    log(`  api failed (${error.message}); falling back to HTML listing`);
  }

  if (entries.length < limit) {
    try {
      for (let page = 0; page < MAX_PAGES && entries.length < limit; page += 1) {
        const offset = page * PAGE_SIZE;
        const url = `${host}/${service}/user/${encodeURIComponent(id)}?o=${offset}`;
        const html = await fetchText(url, fetchImpl);
        const paths = extractHtmlThumbnails(html);
        if (!paths.length) break;
        paths.forEach((filePath) => push({ path: filePath, caption: '', createdAt: null }));
        log(`  html o=${offset}: +${paths.length} (total ${entries.length})`);
        if (paths.length < PAGE_SIZE) break;
      }
    } catch (error) {
      log(`  html fallback failed (${error.message})`);
    }
  }

  return entries.slice(0, limit);
}

/* --------------------------------------------------------------------- main */

function readExisting(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readTargets() {
  try {
    const parsed = JSON.parse(fs.readFileSync(TARGETS_FILE, 'utf8'));
    const list = Array.isArray(parsed) ? parsed : parsed && parsed.ids;
    return Array.isArray(list) ? list.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry-run');
  const limitArg = argv.indexOf('--limit');
  const idsArg = argv.indexOf('--ids');
  const limit = limitArg >= 0 ? Number(argv[limitArg + 1]) || DEFAULT_LIMIT : DEFAULT_LIMIT;
  const ids = idsArg >= 0
    ? String(argv[idsArg + 1] || '').split(',').map((value) => value.trim()).filter(Boolean)
    : readTargets();

  if (!ids.length) {
    console.log('[coomer-media] No targets. Pass --ids a,b,c or add services/.coomer-targets.json');
    return 0;
  }

  const summary = [];
  for (const id of ids) {
    const file = path.join(SERVICES_DIR, `${id}Data.json`);
    const existing = readExisting(file);
    console.log(`[coomer-media] ${id}: has ${existing.length} media, crawling up to ${limit}`);
    let entries = [];
    try {
      entries = await fetchArtistEntries({ id, limit, log: (line) => console.log(line) });
    } catch (error) {
      console.log(`[coomer-media] ${id}: crawl error ${error.message}`);
    }
    const items = buildMediaItems(id, entries, limit);
    if (items.length <= existing.length) {
      console.log(`[coomer-media] ${id}: kept existing ${existing.length} (crawl produced ${items.length})`);
      summary.push({ id, before: existing.length, after: existing.length, written: false });
      continue;
    }
    if (!dryRun) {
      fs.writeFileSync(file, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
    }
    console.log(`[coomer-media] ${id}: ${existing.length} -> ${items.length}${dryRun ? ' (dry run)' : ''}`);
    summary.push({ id, before: existing.length, after: items.length, written: !dryRun });
  }

  console.log('\n[coomer-media] Summary');
  for (const row of summary) {
    console.log(`  ${row.id}: ${row.before} -> ${row.after}${row.written ? '' : ' (unchanged)'}`);
  }
  const total = summary.reduce((sum, row) => sum + row.after, 0);
  console.log(`  total media: ${total}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code)).catch((error) => {
    console.error('[coomer-media] fatal', error);
    process.exit(1);
  });
}
