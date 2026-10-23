#!/usr/bin/env node
/**
 * Generates public/sitemap.xml and public/robots.txt.
 *
 * Every profile declared in `services/mockData.tsx` (the PROFILES array) is
 * picked up automatically, so adding a new profile and rebuilding keeps the
 * sitemap in sync. Hidden profiles (isVisible: false) are skipped.
 *
 * Usage:
 *   SITE_URL=https://your-domain.com npm run sitemap
 *   SITE_URL=https://your-domain.com npm run build   # runs automatically via prebuild
 *
 * SITE_URL can also be passed as the first CLI argument.
 * On Cloudflare Pages, set SITE_URL as a build environment variable
 * (Settings -> Environment variables -> Production).
 *
 * NOTE: CF_PAGES_URL is deliberately NOT used as a fallback. On Cloudflare Pages it
 * resolves to a per-deployment alias (e.g. https://ab9feb2a.fansleak.pages.dev), which
 * produced sitemap entries pointing at a deployment host instead of the real domain.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOCK_DATA_FILE = path.join(ROOT, 'services', 'mockData.tsx');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SITEMAP_FILE = path.join(PUBLIC_DIR, 'sitemap.xml');
const ROBOTS_FILE = path.join(PUBLIC_DIR, 'robots.txt');

const DEFAULT_SITE_URL = 'https://fansleak.pages.dev';

function resolveSiteUrl() {
  const candidates = [process.argv[2], process.env.SITE_URL, process.env.VITE_SITE_URL];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const trimmed = candidate.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^/\s]+$/i.test(trimmed)) continue;
    if (/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(trimmed)) continue;
    return trimmed;
  }

  console.warn(
    `[sitemap] SITE_URL is not set - defaulting to the production domain ${DEFAULT_SITE_URL}.\n` +
      `[sitemap] Set SITE_URL explicitly (e.g. SITE_URL=${DEFAULT_SITE_URL}) to override.`
  );
  return DEFAULT_SITE_URL;
}

/** Pulls the PROFILES array out of the mock data module and returns its entries. */
function readProfiles() {
  const source = fs.readFileSync(MOCK_DATA_FILE, 'utf8');
  const start = source.indexOf('const PROFILES: Profile[] = [');
  if (start === -1) {
    throw new Error(`Could not find the PROFILES array in ${MOCK_DATA_FILE}`);
  }

  const end = source.indexOf('\n];', start);
  if (end === -1) {
    throw new Error('Could not find the end of the PROFILES array');
  }

  const body = source.slice(start, end);
  const profiles = [];

  // Profile objects start with a `{` indented by two spaces.
  for (const chunk of body.split(/\n {2}\{\n/).slice(1)) {
    const idMatch = chunk.match(/^ {4}id:\s*['"`]([^'"`]+)['"`]/m);
    if (!idMatch) continue;

    const isVisible = !/^ {4}isVisible:\s*false\b/m.test(chunk);
    profiles.push({ id: idMatch[1], isVisible });
  }

  return profiles;
}

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSitemap(siteUrl, profiles, lastmod) {
  const pages = [
    { path: '/', priority: '1.0', changefreq: 'daily' },
    { path: '/search', priority: '0.6', changefreq: 'weekly' },
    { path: '/hashtags', priority: '0.5', changefreq: 'weekly' },
    { path: '/more', priority: '0.3', changefreq: 'monthly' },
    ...profiles
      .filter((profile) => profile.isVisible)
      .map((profile) => ({
        path: `/profile/${profile.id}`,
        priority: '0.8',
        changefreq: 'weekly',
      })),
  ];

  const seen = new Set();
  const urls = pages
    .filter((page) => {
      if (seen.has(page.path)) return false;
      seen.add(page.path);
      return true;
    })
    .map(
      (page) => `  <url>
    <loc>${escapeXml(`${siteUrl}${page.path}`)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

function buildRobots(siteUrl) {
  return `User-agent: *
Allow: /
Disallow: /admin
Disallow: /auth
Disallow: /favorites

Sitemap: ${siteUrl}/sitemap.xml
`;
}

const siteUrl = resolveSiteUrl();
const allProfiles = readProfiles();
const visibleProfiles = allProfiles.filter((profile) => profile.isVisible);
const lastmod = new Date().toISOString().slice(0, 10);

fs.mkdirSync(PUBLIC_DIR, { recursive: true });
fs.writeFileSync(SITEMAP_FILE, buildSitemap(siteUrl, allProfiles, lastmod), 'utf8');
fs.writeFileSync(ROBOTS_FILE, buildRobots(siteUrl), 'utf8');

console.log(
  `[sitemap] Wrote ${path.relative(ROOT, SITEMAP_FILE)} and ${path.relative(
    ROOT,
    ROBOTS_FILE
  )} for ${siteUrl} (${visibleProfiles.length} profiles, ${
    allProfiles.length - visibleProfiles.length
  } hidden skipped)`
);
