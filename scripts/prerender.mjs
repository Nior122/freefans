#!/usr/bin/env node
/**
 * Writes crawlable HTML for every public route.
 *
 * The app is a client-rendered SPA, so without this every URL returned the same
 * empty shell with one shared <title>. After `vite build` this script takes the
 * built shell and emits a real file per route:
 *
 *   dist/index.html                      -> /
 *   dist/search/index.html               -> /search/
 *   dist/hashtags/index.html             -> /hashtags/
 *   dist/more/index.html                 -> /more/
 *   dist/profile/<id>/index.html         -> /profile/<id>/
 *   dist/auth|favorites|admin/index.html -> noindex app pages
 *   dist/404.html                        -> real 404 (no soft-404 catch-all)
 *
 * Cloudflare Pages serves `<route>/index.html` for `<route>/` and 308-redirects
 * `<route>` to `<route>/`, so every <link rel="canonical">, og:url and JSON-LD
 * URL is emitted in the trailing-slash form to match the URL actually served.
 *
 * Each page gets its own <title>, meta description, canonical, robots directive,
 * Open Graph / Twitter tags and JSON-LD (WebSite, Organization, ItemList,
 * ProfilePage + Person + BreadcrumbList), so Google can read unique metadata
 * without executing the 14 MB application bundle.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_OG_IMAGE,
  DIST_DIR,
  SITE_NAME,
  absoluteUrl,
  escapeHtml,
  readProfiles,
  resolveSiteUrl,
  sanitizeText,
} from './lib/site.mjs';

const siteUrl = resolveSiteUrl();
const shellPath = path.join(DIST_DIR, 'index.html');

if (!fs.existsSync(shellPath)) {
  console.error(`[prerender] ${shellPath} not found - run vite build first.`);
  process.exit(1);
}

const shell = fs.readFileSync(shellPath, 'utf8');

function jsonLdScript(data) {
  if (!data) return '';
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}

function renderShell(meta) {
  const title = escapeHtml(meta.title || SITE_NAME);
  const description = escapeHtml(meta.description || '');
  const robots = meta.noindex
    ? 'noindex, follow'
    : 'index, follow, max-image-preview:large, max-snippet:-1';

  const image = meta.image
    ? meta.image.startsWith('http')
      ? meta.image
      : `${siteUrl}${meta.image}`
    : `${siteUrl}${DEFAULT_OG_IMAGE}`;

  const head = [
    meta.url ? `<link rel="canonical" href="${escapeHtml(meta.url)}" />` : '',
    `<meta name="robots" content="${robots}" />`,
    `<meta property="og:type" content="${meta.type || 'website'}" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    meta.url ? `<meta property="og:url" content="${escapeHtml(meta.url)}" />` : '',
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta property="og:image:alt" content="${title}" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
    jsonLdScript(meta.jsonLd),
  ]
    .filter(Boolean)
    .join('\n    ');

  let html = shell
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`)
    .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${description}" />`)
    // Drop shell-level social tags so per-page tags are the only ones present.
    .replace(/\s*<meta property="og:(?!site_name)[^>]*>/g, '')
    .replace(/\s*<meta name="twitter:[^>]*>/g, '');

  if (!/<meta name="description"/.test(html)) {
    html = html.replace('</title>', `</title>\n    <meta name="description" content="${description}" />`);
  }

  return html.replace('</head>', `  ${head}\n  </head>`);
}

const written = [];

/**
 * Meta descriptions should be unique and ~50-160 characters. Profiles with a
 * very short (or empty) bio get a descriptive fallback instead of a thin one.
 */
function buildDescription(candidates, fallback) {
  for (const candidate of candidates) {
    const text = sanitizeText(candidate, 155);
    if (text.length >= 50) return text;
  }
  return sanitizeText(fallback, 155);
}

function writePage(relativePath, meta) {
  const target = path.join(DIST_DIR, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, renderShell(meta), 'utf8');
  written.push(target);
  return target;
}

const allProfiles = readProfiles().filter(
  (profile) => profile.isVisible && /^[A-Za-z0-9._-]+$/.test(profile.id)
);

const profiles = [];
const seen = new Set();
for (const profile of allProfiles) {
  if (seen.has(profile.id)) continue; // duplicate ids would fight over one URL
  seen.add(profile.id);
  profiles.push(profile);
}

const homeUrl = absoluteUrl(siteUrl, '/');
const homeDescription =
  'Browse creator profiles, photo galleries and exclusive free previews on FansLeak. ' +
  'Discover trending creators and new profiles daily.';

/* Home ------------------------------------------------------------------- */
writePage('index.html', {
  url: homeUrl,
  title: `${SITE_NAME} — Creator Profiles & Exclusive Previews`,
  description: homeDescription,
  type: 'website',
  jsonLd: [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE_NAME,
      url: homeUrl,
      description: homeDescription,
      potentialAction: {
        '@type': 'SearchAction',
        target: `${siteUrl}/search/?q={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: SITE_NAME,
      url: homeUrl,
      logo: `${siteUrl}/icon-512.png`,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: `Creator profiles on ${SITE_NAME}`,
      url: homeUrl,
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: profiles.length,
        itemListElement: profiles.map((profile, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: sanitizeText(profile.name || profile.id, 60),
          url: absoluteUrl(siteUrl, `/profile/${profile.id}`),
        })),
      },
    },
  ],
});

/* Static pages ----------------------------------------------------------- */
const staticPages = [
  {
    dir: 'search',
    url: '/search',
    title: `Search creator profiles — ${SITE_NAME}`,
    description:
      'Search creator profiles by name, handle or hashtag on FansLeak and open any gallery instantly.',
  },
  {
    dir: 'hashtags',
    url: '/hashtags',
    title: `Creator hashtags & categories — ${SITE_NAME}`,
    description:
      'Browse FansLeak creators by hashtag and category: premium, cosplay, latina, gothic, fitness and more.',
  },
  {
    dir: 'more',
    url: '/more',
    title: `More — ${SITE_NAME}`,
    description:
      'About FansLeak, support links and extra pages - how to browse creator profiles, ' +
      'use search and hashtags, and save favourites.',
  },
];

for (const page of staticPages) {
  writePage(`${page.dir}/index.html`, {
    url: absoluteUrl(siteUrl, page.url),
    title: page.title,
    description: page.description,
  });
}

/* Profile pages ---------------------------------------------------------- */
for (const profile of profiles) {
  const profilePath = `/profile/${profile.id}`;
  const url = absoluteUrl(siteUrl, profilePath);
  const displayName = sanitizeText(profile.name || profile.handle.replace(/^@/, '') || profile.id, 60);
  const description = buildDescription(
    [profile.bio],
    `${displayName} on ${SITE_NAME} - creator profile, photo gallery and free previews. ` +
      'Browse photos, videos and tags, then open the full gallery.'
  );

  writePage(`${profilePath.replace(/^\//, '')}/index.html`, {
    url,
    title: `${displayName} — profile & gallery | ${SITE_NAME}`,
    description,
    type: 'profile',
    image: profile.avatarUrl || DEFAULT_OG_IMAGE,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'ProfilePage',
        url,
        name: `${displayName} — profile & gallery`,
        isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: homeUrl },
        mainEntity: {
          '@type': 'Person',
          name: displayName,
          alternateName: profile.handle,
          description: sanitizeText(profile.bio, 200),
          ...(profile.avatarUrl ? { image: profile.avatarUrl } : {}),
          ...(profile.category ? { knowsAbout: profile.category } : {}),
          ...(profile.tags?.length ? { keywords: profile.tags.join(', ') } : {}),
        },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: homeUrl },
          { '@type': 'ListItem', position: 2, name: displayName, item: url },
        ],
      },
    ],
  });
}

/* Private app pages (reachable, never indexed) --------------------------- */
for (const page of [
  { dir: 'auth', url: '/auth', title: `Sign in — ${SITE_NAME}` },
  { dir: 'favorites', url: '/favorites', title: `Favorites — ${SITE_NAME}` },
  { dir: 'admin', url: '/admin', title: `Admin — ${SITE_NAME}` },
]) {
  writePage(`${page.dir}/index.html`, {
    url: absoluteUrl(siteUrl, page.url),
    title: page.title,
    description: 'This page is private and is not indexed.',
    noindex: true,
  });
}

/* Real 404 ---------------------------------------------------------------
 * Cloudflare Pages serves dist/404.html (status 404) for unknown paths. Without
 * it the old catch-all `_redirects` rule answered every typo with 200 + the
 * homepage, which Google records as an endless supply of soft 404s.
 */
writePage('404.html', {
  title: `Page not found — ${SITE_NAME}`,
  description: 'This page does not exist on FansLeak.',
  noindex: true,
});

console.log(
  `[prerender] Wrote ${written.length} HTML files to dist/ for ${siteUrl} ` +
    `(${profiles.length} profile pages, trailing-slash canonicals, 404 included)`
);
