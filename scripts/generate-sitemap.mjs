#!/usr/bin/env node
/**
 * Generates public/sitemap.xml and public/robots.txt.
 *
 * Every profile declared in `services/mockData.tsx` (the PROFILES array) is
 * picked up automatically, so adding a new profile and rebuilding keeps the
 * sitemap in sync. Hidden profiles (isVisible: false) are skipped and duplicate
 * ids are emitted once.
 *
 * Usage:
 *   SITE_URL=https://fansleak.pages.dev npm run sitemap
 *   npm run build            # runs automatically via prebuild
 *
 * URLs use the trailing-slash form (Cloudflare Pages serves `<route>/index.html`
 * for `<route>/` and 308-redirects `<route>` to it), so every sitemap entry is
 * also the page's <link rel="canonical"> - no redirects, no mismatches.
 *
 * SITE_URL can also be passed as the first CLI argument. On Cloudflare Pages set
 * SITE_URL as a Production build environment variable. CF_PAGES_URL is NOT used
 * because it resolves to a per-deployment alias, not the canonical domain.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_SITE_URL,
  PUBLIC_DIR,
  absoluteUrl,
  escapeXml,
  readProfiles,
  resolveSiteUrl,
} from './lib/site.mjs';

const SITEMAP_FILE = path.join(PUBLIC_DIR, 'sitemap.xml');
const ROBOTS_FILE = path.join(PUBLIC_DIR, 'robots.txt');

function buildSitemap(siteUrl, profiles, lastmod) {
  const pages = [
    { path: '/', priority: '1.0', changefreq: 'daily' },
    { path: '/search', priority: '0.6', changefreq: 'weekly' },
    { path: '/hashtags', priority: '0.5', changefreq: 'weekly' },
    { path: '/more', priority: '0.3', changefreq: 'monthly' },
    ...profiles.map((profile) => ({
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
    <loc>${escapeXml(absoluteUrl(siteUrl, page.path))}</loc>
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
  return `# crawlers: everything public is allowed, private app routes are not
User-agent: *
Allow: /
Disallow: /admin
Disallow: /auth
Disallow: /favorites
Disallow: /api/

User-agent: Googlebot
Allow: /
Disallow: /admin
Disallow: /auth
Disallow: /favorites

User-agent: Bingbot
Allow: /
Disallow: /admin
Disallow: /auth
Disallow: /favorites

Sitemap: ${siteUrl}/sitemap.xml
`;
}

const siteUrl = resolveSiteUrl();
const profiles = readProfiles().filter((profile) => profile.isVisible && /^[A-Za-z0-9._-]+$/.test(profile.id));
const hidden = readProfiles().filter((profile) => !profile.isVisible).length;
const lastmod = new Date().toISOString().slice(0, 10);

fs.mkdirSync(PUBLIC_DIR, { recursive: true });
fs.writeFileSync(SITEMAP_FILE, buildSitemap(siteUrl, profiles, lastmod), 'utf8');
fs.writeFileSync(ROBOTS_FILE, buildRobots(siteUrl), 'utf8');

if (siteUrl === DEFAULT_SITE_URL && !process.env.SITE_URL) {
  console.log(`[sitemap] SITE_URL not set - using default ${DEFAULT_SITE_URL}`);
}

console.log(
  `[sitemap] Wrote sitemap.xml + robots.txt for ${siteUrl} ` +
    `(${profiles.length} profiles, ${hidden} hidden skipped)`
);
