#!/usr/bin/env node
/**
 * Adds one profile to FanDirectory/FansLeak from a JSON payload.
 *
 *   npm run add-profile -- path/to/profile.json [--dry-run] [--force]
 *
 * What it does:
 *   1. validates every field against the Profile/Image contract in types.ts
 *   2. normalises images (ids, thumbnail fallback, mediaType, dimensions)
 *   3. writes services/<id>Data.json
 *   4. registers the import + profile entry in services/mockData.tsx
 *
 * Sitemap, prerendered HTML, canonicals and JSON-LD all derive from the
 * PROFILES array, so a rebuild picks the new profile up automatically:
 *   npm run build
 *
 * The payload is the only thing this script knows about; it never fetches
 * anything. Feed it data you are allowed to publish (creator-supplied media
 * kits, profiles submitted by the creator, or your own content).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  MOCK_DATA_FILE,
  ROOT,
  sanitizeText,
} from './lib/site.mjs';

const SERVICES_DIR = path.join(ROOT, 'services');
const MAX_IMAGES_WARN = 500;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const file = args.find((arg) => !arg.startsWith('--'));

if (!file) {
  console.error('Usage: npm run add-profile -- path/to/profile.json [--dry-run] [--force]');
  process.exit(1);
}

const fail = (message) => {
  console.error(`[add-profile] ERROR ${message}`);
  process.exit(1);
};
const warn = (message) => console.warn(`[add-profile] WARN  ${message}`);

/* ---------------------------------------------------------------- payload */
let payload;
try {
  payload = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
} catch (error) {
  fail(`could not read ${file}: ${error.message}`);
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const RESERVED_IDS = new Set([
  'admin', 'auth', 'favorites', 'search', 'hashtags', 'more', 'api',
  'profile', 'sitemap', 'robots', 'assets', 'favicon', 'index',
]);
const PLACEHOLDER_PATTERN = /^(profile|demo|test|sample|new)[-_]?\d*$/i;

const errors = [];

/* id ---------------------------------------------------------------------- */
const id = String(payload.id || '').trim().toLowerCase();
if (!ID_PATTERN.test(id)) {
  errors.push(`id "${payload.id}" must be a url slug: a-z, 0-9, dot, dash, underscore (2-64 chars)`);
} else if (RESERVED_IDS.has(id)) {
  errors.push(`id "${id}" collides with an app route (/admin, /search, ...)`);
} else if (PLACEHOLDER_PATTERN.test(id)) {
  warn(`id "${id}" looks like a placeholder; it becomes the public URL /profile/${id}/`);
}

/* text fields ------------------------------------------------------------- */
const name = sanitizeText(payload.name, 60);
const bio = sanitizeText(payload.bio, 400);
const category = sanitizeText(payload.category, 40) || 'Creator';
let handle = String(payload.handle || '').trim();
if (!handle) handle = `@${id}`;
if (!handle.startsWith('@')) handle = `@${handle}`;

if (!name) errors.push('name is required');
if (bio.length < 10) errors.push('bio is required (at least 10 characters)');

/* media urls -------------------------------------------------------------- */
const isHttpUrl = (value) => typeof value === 'string' && /^https?:\/\/[^\s]+$/i.test(value);
const avatarUrl = payload.avatarUrl || '';
const heroUrl = payload.heroUrl || avatarUrl;

if (!isHttpUrl(avatarUrl)) errors.push('avatarUrl must be an absolute http(s) URL');
if (!isHttpUrl(heroUrl)) errors.push('heroUrl must be an absolute http(s) URL');

/* tags / stats ------------------------------------------------------------ */
const tags = Array.isArray(payload.tags)
  ? [...new Set(payload.tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))].slice(0, 12)
  : [];
if (!tags.length) warn('no tags supplied; profile will not appear in hashtag browsing');

const statsInput = payload.stats || {};
const stats = {
  posts: Number(statsInput.posts) || 0,
  likes: Number(statsInput.likes) || 0,
  views: Number(statsInput.views) || 0,
  followers: Number(statsInput.followers) || 0,
};
for (const [key, value] of Object.entries(stats)) {
  if (!Number.isFinite(value) || value < 0) errors.push(`stats.${key} must be a number >= 0`);
}
if (!Number.isFinite(Number(statsInput.subscribers)) && statsInput.subscribers !== undefined) {
  errors.push('stats.subscribers must be a number');
}

/* images ------------------------------------------------------------------ */
const rawImages = Array.isArray(payload.images) ? payload.images : [];
if (!rawImages.length) errors.push('images must contain at least one item');

const seenUrls = new Set();
const images = [];

rawImages.forEach((raw, index) => {
  const url = raw.url || raw.thumbnailUrl || '';
  if (!isHttpUrl(url)) {
    errors.push(`images[${index}].url must be an absolute http(s) URL`);
    return;
  }
  if (seenUrls.has(url)) return; // drop duplicates silently
  seenUrls.add(url);

  const mediaType = raw.mediaType === 'video' ? 'video' : 'image';
  const width = Number(raw.width);
  const height = Number(raw.height);

  images.push({
    id: `${id}-${String(images.length + 1).padStart(3, '0')}`,
    url,
    thumbnailUrl: isHttpUrl(raw.thumbnailUrl) ? raw.thumbnailUrl : url,
    caption: sanitizeText(raw.caption, 140),
    width: Number.isFinite(width) && width > 0 ? Math.round(width) : 1080,
    height: Number.isFinite(height) && height > 0 ? Math.round(height) : 1350,
    isLocked: raw.isLocked !== false,
    isVisible: raw.isVisible !== false,
    mediaType,
    ...(isHttpUrl(raw.sourceUrl) ? { sourceUrl: raw.sourceUrl } : {}),
    createdAt: raw.createdAt && !Number.isNaN(Date.parse(raw.createdAt))
      ? new Date(raw.createdAt).toISOString()
      : new Date().toISOString(),
  });
});

if (rawImages.length !== images.length && !errors.length) {
  warn(`${rawImages.length - images.length} duplicate image URL(s) dropped`);
}
if (images.length > MAX_IMAGES_WARN) {
  warn(
    `${images.length} images will be bundled into the client JS (all profile data is imported ` +
      'eagerly). Consider capping at a few hundred per profile.'
  );
}

/* existing data ----------------------------------------------------------- */
const mockSource = fs.readFileSync(MOCK_DATA_FILE, 'utf8');
const existingIds = [...mockSource.matchAll(/^ {4}id: '([^']+)'/gm)].map((match) => match[1]);
if (existingIds.includes(id)) {
  errors.push(`a profile with id "${id}" already exists in services/mockData.tsx`);
}

const dataFile = path.join(SERVICES_DIR, `${id}Data.json`);
if (fs.existsSync(dataFile) && !force) {
  errors.push(`services/${id}Data.json already exists (use --force to overwrite)`);
}

if (errors.length) {
  console.error('[add-profile] PAYLOAD INVALID');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

/* entry ------------------------------------------------------------------- */
const camel = id.replace(/[._-]+(.)/g, (_, chr) => chr.toUpperCase()).replace(/[^A-Za-z0-9]/g, '');
const dataVar = `${camel}Data`;
const q = (value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const statLines = [
  `      posts: ${stats.posts},`,
  `      likes: ${stats.likes},`,
  `      views: ${stats.views},`,
  `      followers: ${stats.followers},`,
];
if (statsInput.subscribers !== undefined) {
  statLines.push(`      subscribers: ${Number(statsInput.subscribers)},`);
}

const entry = `  {
    id: ${q(id)},
    name: ${q(name)},
    handle: ${q(handle)},
    bio: ${q(bio)},
    avatarUrl: ${q(avatarUrl)},
    heroUrl: ${q(heroUrl)},
    tags: [${tags.map((tag) => q(tag)).join(', ')}],
    category: ${q(category)},
    images: ${dataVar} as Image[],
    stats: {
${statLines.join('\n')}
    },
    isVerified: ${payload.isVerified === true},
    isVisible: ${payload.isVisible !== false},
${payload.pricePerMonth !== undefined ? `    pricePerMonth: ${Number(payload.pricePerMonth) || 0},\n` : ''}${payload.access_mode ? `    access_mode: ${q(payload.access_mode)},\n` : ''}  },`;

if (dryRun) {
  console.log(`[add-profile] DRY RUN - would write services/${id}Data.json with ${images.length} images`);
  console.log(`[add-profile] DRY RUN - would add to services/mockData.tsx:\n`);
  console.log(`import ${dataVar} from './${id}Data.json';\n`);
  console.log(entry);
  process.exit(0);
}

/* write + patch ----------------------------------------------------------- */
fs.writeFileSync(dataFile, `${JSON.stringify(images, null, 2)}\n`, 'utf8');

let next = mockSource;

// 1. import line, grouped with the other per-profile data imports
const importLine = `import ${dataVar} from './${id}Data.json';`;
if (!next.includes(importLine)) {
  const importRegex = /^import \w+ from '\.\/[\w.]+Data(?:\.json)?';$/gm;
  const matches = [...next.matchAll(importRegex)];
  if (!matches.length) fail('could not find the per-profile import block in services/mockData.tsx');
  const last = matches[matches.length - 1];
  const insertAt = last.index + last[0].length;
  next = `${next.slice(0, insertAt)}\n${importLine}${next.slice(insertAt)}`;
}

// 2. profile entry, inside PROFILES before its closing bracket
const profilesStart = next.indexOf('const PROFILES: Profile[] = [');
if (profilesStart === -1) fail('could not find the PROFILES array in services/mockData.tsx');
const profilesEnd = next.indexOf('\n];', profilesStart);
if (profilesEnd === -1) fail('could not find the end of the PROFILES array');
next = `${next.slice(0, profilesEnd)}\n${entry}${next.slice(profilesEnd)}`;

fs.writeFileSync(MOCK_DATA_FILE, next, 'utf8');

console.log(`[add-profile] Wrote services/${id}Data.json (${images.length} images)`);
console.log(`[add-profile] Registered "${name}" (${handle}) in services/mockData.tsx`);
console.log(`[add-profile] Public URL will be /profile/${id}/`);
console.log('[add-profile] Next: npm run build   (regenerates sitemap + prerendered pages)');
console.log(`[add-profile] Reminder: publish only media you have the right to distribute.`);

