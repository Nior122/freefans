/**
 * Shared helpers for the build-time SEO scripts (sitemap, prerender, check).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MOCK_DATA_FILE = path.join(ROOT, 'services', 'mockData.tsx');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const DIST_DIR = path.join(ROOT, 'dist');

export const DEFAULT_SITE_URL = 'https://fansleak.pages.dev';
export const VERIFICATION_TOKEN = 'W8NUKGvl4cHSmctRzfmeO4Gw1zYinIrgFafJi_mMNa0';
export const SITE_NAME = 'FansLeak';
export const DEFAULT_OG_IMAGE = '/og-image.png';

/**
 * Cloudflare Pages serves `dist/<route>/index.html` and 308-redirects
 * `/route` to `/route/`. Every canonical, sitemap entry and internal link must
 * therefore use the trailing-slash form so the indexed URL is the one actually
 * served (no redirects, no canonical/URL mismatch).
 */
// Only real asset types are treated as files: a profile id may legitimately
// contain a dot (e.g. "emanuela.ebony") and must still get a trailing slash.
const FILE_EXTENSIONS = new Set([
  'xml', 'txt', 'json', 'webmanifest', 'html', 'js', 'mjs', 'css',
  'png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'svg', 'ico', 'mp4', 'webm', 'woff', 'woff2',
]);

export function isFilePath(routePath) {
  const match = routePath.match(/\.([a-z0-9]+)$/i);
  return Boolean(match && FILE_EXTENSIONS.has(match[1].toLowerCase()));
}

export function canonicalPath(routePath) {
  const withLeadingSlash = routePath.startsWith('/') ? routePath : `/${routePath}`;
  if (withLeadingSlash === '/') return '/';
  if (isFilePath(withLeadingSlash)) return withLeadingSlash;
  return withLeadingSlash.replace(/\/+$/, '') + '/';
}

/** Absolute, trailing-slash-normalised URL for a route. */
export function absoluteUrl(siteUrl, routePath) {
  return `${siteUrl}${canonicalPath(routePath)}`;
}

/** Maps a canonical URL path to the file Cloudflare Pages will serve. */
export function distFileForPath(routePath) {
  const clean = canonicalPath(routePath);
  if (clean === '/') return 'index.html';
  if (isFilePath(clean)) return clean.replace(/^\//, '');
  return `${clean.replace(/^\//, '')}index.html`;
}

/**
 * Canonical origin used for absolute URLs.
 *
 * CF_PAGES_URL is deliberately NOT used: on Cloudflare Pages it resolves to a
 * per-deployment alias (https://ab9feb2a.fansleak.pages.dev), which is not the
 * domain the site is verified/indexed under.
 */
export function resolveSiteUrl() {
  const candidates = [process.argv[2], process.env.SITE_URL, process.env.VITE_SITE_URL];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const trimmed = candidate.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^/\s]+$/i.test(trimmed)) continue;
    if (/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(trimmed)) continue;
    return trimmed;
  }

  return DEFAULT_SITE_URL;
}

/** Reads the PROFILES array out of services/mockData.tsx. */
export function readProfiles() {
  const source = fs.readFileSync(MOCK_DATA_FILE, 'utf8');
  const start = source.indexOf('const PROFILES: Profile[] = [');
  if (start === -1) throw new Error(`Could not find the PROFILES array in ${MOCK_DATA_FILE}`);
  const end = source.indexOf('\n];', start);
  if (end === -1) throw new Error('Could not find the end of the PROFILES array');

  const body = source.slice(start, end);
  const unquote = (value) => value.replace(/\\(['"`\\])/g, '$1');
  const field = (block, key) => {
    const match = block.match(new RegExp(`^ {4}${key}:\\s*'((?:[^'\\\\]|\\\\.)*)'`, 'm'));
    return match ? unquote(match[1]) : '';
  };

  const profiles = [];
  for (const block of body.split(/\n {2}\{\n/).slice(1)) {
    const id = field(block, 'id');
    if (!id) continue;

    profiles.push({
      id,
      name: field(block, 'name'),
      handle: field(block, 'handle'),
      bio: field(block, 'bio'),
      avatarUrl: field(block, 'avatarUrl'),
      category: field(block, 'category'),
      isVisible: !/^ {4}isVisible:\s*false\b/m.test(block),
    });
  }

  return profiles;
}

export function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Cleans profile data for <meta>/sitemap text. The source data contains
 * mojibake (emoji decoded as CJK garbage), which would look broken in Google
 * results, so only printable ASCII survives. Templates used by the scripts
 * themselves are escaped separately and keep their typography.
 */
export function sanitizeText(value, maxLength) {
  const cleaned = String(value || '')
    .replace(/[\u0000-\u001f\u007f-\u009f\ufffd]/g, ' ')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!maxLength || cleaned.length <= maxLength) return cleaned;

  const cut = cleaned.slice(0, maxLength - 3);
  const lastSpace = cut.lastIndexOf(' ');
  const truncated = (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim();
  return `${truncated.replace(/[\s,;:|.\-]+$/, '')}...`;
}
