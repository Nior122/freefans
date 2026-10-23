#!/usr/bin/env node
/**
 * Post-build SEO guard. Fails the build (exit 1) instead of letting a broken
 * deploy reach Search Console. Checks:
 *
 *   1. Google Search Console verification meta tag is inside <head>
 *   2. sitemap.xml is well-formed, on the canonical host, deduped, slash-form
 *   3. robots.txt points at the canonical sitemap and blocks nothing important
 *   4. every sitemap URL has a prerendered file whose canonical matches the URL
 *   5. index.html declares canonical/title/description/og tags
 *   6. no catch-all SPA rewrite (soft 404s), and dist/404.html exists
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  DIST_DIR,
  PUBLIC_DIR,
  VERIFICATION_TOKEN,
  canonicalPath,
  distFileForPath,
  resolveSiteUrl,
} from './lib/site.mjs';

const siteUrl = resolveSiteUrl();
const failures = [];
const notes = [];

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

/* 1. Verification tag ------------------------------------------------------ */
for (const [label, html] of [
  ['dist/index.html', read(path.join(DIST_DIR, 'index.html'))],
  ['index.html', read(path.join(process.cwd(), 'index.html'))],
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

/* 2 + 4. Sitemap and prerendered pages ------------------------------------ */
const sitemap =
  read(path.join(DIST_DIR, 'sitemap.xml')) ?? read(path.join(PUBLIC_DIR, 'sitemap.xml'));

if (!sitemap) {
  failures.push('sitemap.xml not found in dist/ or public/');
} else {
  if (
    !/^<\?xml[^>]*\?>\s*<urlset[^>]*xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/m.test(
      sitemap
    )
  ) {
    failures.push('sitemap.xml: missing XML declaration or sitemap urlset namespace');
  }

  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim());

  if (locs.length === 0) failures.push('sitemap.xml: contains no <loc> entries');

  const duplicates = locs.filter((loc, index) => locs.indexOf(loc) !== index);
  if (duplicates.length) {
    failures.push(`sitemap.xml: duplicate URLs (${duplicates.slice(0, 3).join(', ')})`);
  }

  const offHost = locs.filter((loc) => !loc.startsWith(`${siteUrl}/`));
  if (offHost.length) {
    failures.push(
      `sitemap.xml: ${offHost.length} URL(s) are not on ${siteUrl} (e.g. ${offHost[0]}). ` +
        'Set SITE_URL to the domain verified in Search Console and rebuild.'
    );
  }

  const notSlash = locs.filter((loc) => loc !== `${siteUrl}/` && !loc.endsWith('/'));
  if (notSlash.length) {
    failures.push(
      `sitemap.xml: ${notSlash.length} URL(s) are missing the trailing slash ` +
        `(e.g. ${notSlash[0]}). Cloudflare Pages 308-redirects these, which conflicts ` +
        'with the canonical URL.'
    );
  }

  notes.push(`sitemap.xml: ${locs.length} URLs on ${siteUrl}, trailing-slash form`);

  const missingPages = [];
  const badCanonicals = [];

  for (const loc of locs) {
    const routePath = loc.slice(siteUrl.length) || '/';
    const relative = distFileForPath(routePath);
    const html = read(path.join(DIST_DIR, relative));

    if (html === null) {
      missingPages.push(relative);
      continue;
    }

    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/);
    if (!canonical || canonical[1] !== loc) {
      badCanonicals.push(`${relative} -> ${canonical ? canonical[1] : '(none)'}`);
      continue;
    }

    if (!/<title>[^<]{10,70}<\/title>/.test(html)) {
      badCanonicals.push(`${relative} -> title missing or out of length`);
    }
    // Allow head-room for HTML entities (&amp;, &#39;) inflating the raw length.
    if (!/<meta name="description" content="[^"]{50,220}"/.test(html)) {
      badCanonicals.push(`${relative} -> description missing or out of length`);
    }
    if (/<meta name="robots" content="noindex/.test(html)) {
      badCanonicals.push(`${relative} -> is noindex but listed in the sitemap`);
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
      `prerender: ${badCanonicals.length} page(s) have wrong/missing metadata ` +
        `(e.g. ${badCanonicals.slice(0, 3).join(', ')})`
    );
  }
  if (!missingPages.length && !badCanonicals.length) {
    notes.push(`prerender: ${locs.length} pages have matching canonicals + metadata`);
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

/* 5. Home page metadata ---------------------------------------------------- */
const home = read(path.join(DIST_DIR, 'index.html'));
if (home) {
  if (!/<link rel="canonical" href="[^"]+\/"\s*\/?>/.test(home)) {
    failures.push('dist/index.html: missing trailing-slash canonical');
  }
  for (const required of [
    /<meta name="description" content="[^"]+"/,
    /<meta property="og:image" content="[^"]+"/,
    /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml"/,
    /<link rel="icon" href="\/favicon\.ico"/,
    /<link rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png"/,
  ]) {
    if (!required.test(home)) failures.push(`dist/index.html: missing ${required}`);
  }
  notes.push('dist/index.html: canonical, description, og:image, favicon OK');
}

/* 6. No soft-404 catch-all ------------------------------------------------- */
const redirects =
  read(path.join(DIST_DIR, '_redirects')) ?? read(path.join(PUBLIC_DIR, '_redirects'));

if (redirects) {
  const catchAll = redirects
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .find((line) => /^\S+\s+\S+\s+200\b/.test(line) && /^\*|^\/\*/.test(line));

  if (catchAll) {
    failures.push(
      `_redirects: catch-all SPA rewrite still present ("${catchAll}") - unknown URLs would ` +
        'return 200 and become soft 404s. All routes are prerendered, so remove it.'
    );
  } else {
    notes.push('_redirects: no soft-404 catch-all');
  }
}

if (!fs.existsSync(path.join(DIST_DIR, '404.html'))) {
  failures.push('dist/404.html: missing (Cloudflare Pages needs it to return real 404s)');
} else {
  const notFound = fs.readFileSync(path.join(DIST_DIR, '404.html'), 'utf8');
  if (!/noindex/.test(notFound)) failures.push('dist/404.html: must be noindex');
  else notes.push('dist/404.html: present and noindex');
}

/* Required static assets (icons, social image, manifest) ------------------ */
const REQUIRED_ASSETS = [
  'favicon.svg',
  'favicon.ico',
  'favicon-16.png',
  'favicon-32.png',
  'favicon-48.png',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'icon-512-maskable.png',
  'logo.svg',
  'og-image.png',
  'site.webmanifest',
];

for (const asset of REQUIRED_ASSETS) {
  const inDist = fs.existsSync(path.join(DIST_DIR, asset));
  const inPublic = fs.existsSync(path.join(PUBLIC_DIR, asset));
  if (!inDist && !inPublic) failures.push(`asset missing: ${asset} (needed for icons/social previews)`);
}
if (!failures.some((failure) => failure.startsWith('asset missing'))) {
  notes.push(`assets: ${REQUIRED_ASSETS.length} icons/manifest/social image present`);
}

/* Also make sure the canonical form is what we think it is. */
if (canonicalPath('/profile/example') !== '/profile/example/') {
  failures.push('canonicalPath() is not producing trailing-slash paths');
}

/* Report ------------------------------------------------------------------- */
for (const note of notes) console.log(`[check-seo] OK  ${note}`);

if (failures.length) {
  console.error('[check-seo] FAILED');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('[check-seo] All checks passed.');
