#!/usr/bin/env node
/**
 * Post-build SEO guard. Fails the build (exit 1) when something that Google
 * needs is missing or wrong in dist/, so a broken deploy never reaches
 * Search Console:
 *
 *   1. the Google Search Console verification meta tag is inside <head>
 *   2. sitemap.xml exists, is well-formed, and only lists the canonical host
 *   3. robots.txt points at the canonical sitemap URL
 *   4. every sitemap URL has a prerendered HTML file with a matching canonical
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  DIST_DIR,
  PUBLIC_DIR,
  VERIFICATION_TOKEN,
  resolveSiteUrl,
} from './lib/site.mjs';

const siteUrl = resolveSiteUrl();
const failures = [];
const notes = [];

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

/* 1. Verification tag ------------------------------------------------------ */
const indexHtml = read(path.join(DIST_DIR, 'index.html'));
const sourceHtml = read(path.join(process.cwd(), 'index.html'));

for (const [label, html] of [
  ['dist/index.html', indexHtml],
  ['index.html', sourceHtml],
]) {
  if (html === null) {
    failures.push(`${label}: file not found`);
    continue;
  }

  const tagPattern = new RegExp(
    `<meta[^>]+name=["']google-site-verification["'][^>]*content=["']${VERIFICATION_TOKEN}["']`,
    'i'
  );

  if (!tagPattern.test(html)) {
    failures.push(`${label}: verification meta tag missing or has the wrong token`);
    continue;
  }

  const tagIndex = html.search(/google-site-verification/i);
  const headEnd = html.search(/<\/head>/i);
  if (headEnd !== -1 && tagIndex > headEnd) {
    failures.push(`${label}: verification meta tag is outside <head>`);
    continue;
  }

  notes.push(`${label}: google-site-verification OK`);
}

/* 2. Sitemap --------------------------------------------------------------- */
const sitemap = read(path.join(DIST_DIR, 'sitemap.xml')) ?? read(path.join(PUBLIC_DIR, 'sitemap.xml'));

if (!sitemap) {
  failures.push('sitemap.xml not found in dist/ or public/');
} else {
  if (!/^<\?xml[^>]*\?>\s*<urlset[^>]*xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/m.test(sitemap)) {
    failures.push('sitemap.xml: missing XML declaration or sitemap urlset namespace');
  }

  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim());

  if (locs.length === 0) failures.push('sitemap.xml: contains no <loc> entries');

  const duplicates = locs.filter((loc, index) => locs.indexOf(loc) !== index);
  if (duplicates.length) failures.push(`sitemap.xml: duplicate URLs (${duplicates.slice(0, 3).join(', ')})`);

  const offHost = locs.filter((loc) => !loc.startsWith(`${siteUrl}/`));
  if (offHost.length) {
    failures.push(
      `sitemap.xml: ${offHost.length} URL(s) are not on ${siteUrl} (e.g. ${offHost[0]}). ` +
        'Set SITE_URL to the domain you verified in Search Console and rebuild.'
    );
  }

  notes.push(`sitemap.xml: ${locs.length} URLs on ${siteUrl}`);

  /* 4. Prerendered pages --------------------------------------------------- */
  const missingPages = [];
  const badCanonicals = [];

  for (const loc of locs) {
    const urlPath = loc.slice(siteUrl.length) || '/';
    const relative = urlPath === '/' ? 'index.html' : path.join(urlPath.replace(/^\//, ''), 'index.html');
    const file = path.join(DIST_DIR, relative);
    const html = read(file);

    if (html === null) {
      missingPages.push(relative);
      continue;
    }

    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/);
    if (!canonical || canonical[1] !== loc) {
      badCanonicals.push(`${relative} -> ${canonical ? canonical[1] : '(none)'}`);
    }
  }

  if (missingPages.length) {
    failures.push(
      `prerender: ${missingPages.length} sitemap URL(s) have no HTML file ` +
        `(e.g. ${missingPages.slice(0, 3).join(', ')}) - run scripts/prerender.mjs`
    );
  }
  if (badCanonicals.length) {
    failures.push(
      `prerender: ${badCanonicals.length} page(s) have a wrong/missing canonical ` +
        `(e.g. ${badCanonicals.slice(0, 3).join(', ')})`
    );
  }
  if (!missingPages.length && !badCanonicals.length) {
    notes.push(`prerender: ${locs.length} pages have matching canonicals`);
  }
}

/* 3. robots.txt ------------------------------------------------------------ */
const robots = read(path.join(DIST_DIR, 'robots.txt')) ?? read(path.join(PUBLIC_DIR, 'robots.txt'));

if (!robots) {
  failures.push('robots.txt not found');
} else {
  if (!robots.includes(`Sitemap: ${siteUrl}/sitemap.xml`)) {
    failures.push(`robots.txt: missing "Sitemap: ${siteUrl}/sitemap.xml"`);
  }
  if (/^\s*Disallow:\s*\/\s*$/m.test(robots)) {
    failures.push('robots.txt: contains "Disallow: /" which blocks every crawler');
  }
  notes.push('robots.txt OK');
}

/* Report ------------------------------------------------------------------- */
for (const note of notes) console.log(`[check-seo] OK  ${note}`);

if (failures.length) {
  console.error('[check-seo] FAILED');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('[check-seo] All checks passed.');
