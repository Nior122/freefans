#!/usr/bin/env node
/**
 * Writes crawlable HTML for every public route.
 *
 * The app is a client-rendered SPA, so without this every URL returns the same
 * empty shell with one shared <title>. After `vite build` this script takes the
 * built shell and emits a real file per route:
 *
 *   dist/index.html
 *   dist/search/index.html
 *   dist/hashtags/index.html
 *   dist/more/index.html
 *   dist/profile/<id>/index.html   (one per visible profile)
 *
 * Each file gets its own <title>, meta description, canonical, Open Graph /
 * Twitter tags and Person JSON-LD, so Google can read unique metadata without
 * executing 14 MB of JavaScript. The SPA still boots normally from the shell and
 * takes over routing (Cloudflare Pages serves these files for clean URLs like
 * /profile/emmafiore, and `public/_redirects` handles anything else).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  DIST_DIR,
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
const siteName = 'FansLeak';

function jsonLdFor(data) {
  if (!data.jsonLd) return '';
  const json = JSON.stringify(data.jsonLd).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}

function renderShell(meta) {
  // Values are already sanitized by the caller; only escape them here so the
  // typography (em dash, ellipsis) survives.
  const title = escapeHtml(meta.title || siteName);
  const description = escapeHtml(meta.description);

  const head = [
    `<link rel="canonical" href="${escapeHtml(meta.url)}" />`,
    `<meta name="robots" content="${meta.noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large'}" />`,
    `<meta property="og:type" content="${meta.type || 'website'}" />`,
    `<meta property="og:site_name" content="${siteName}" />`,
    `<meta property="og:url" content="${escapeHtml(meta.url)}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    meta.image ? `<meta property="og:image" content="${escapeHtml(meta.image)}" />` : '',
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    meta.image ? `<meta name="twitter:image" content="${escapeHtml(meta.image)}" />` : '',
    jsonLdFor(meta),
  ]
    .filter(Boolean)
    .join('\n    ');

  let html = shell
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`)
    .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${description}" />`)
    // Strip shell-level og tags so the per-page ones are the only ones present.
    .replace(/\s*<meta property="og:(?!site_name)[^>]*>/g, '')
    .replace(/\s*<meta name="twitter:[^>]*>/g, '');

  if (!/<meta name="description"/.test(html)) {
    html = html.replace('</title>', `</title>\n    <meta name="description" content="${description}" />`);
  }

  return html.replace('</head>', `  ${head}\n  </head>`);
}

function writePage(relativePath, meta) {
  const target = path.join(DIST_DIR, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, renderShell(meta), 'utf8');
  return target;
}

const profiles = readProfiles().filter((profile) => profile.isVisible);
const uniqueIds = [...new Set(profiles.map((profile) => profile.id))];

const written = [];

// Home
written.push(
  writePage('index.html', {
    url: `${siteUrl}/`,
    title: `${siteName} — Creator Profiles & Exclusive Previews`,
    description:
      'Browse creator profiles, photo galleries and exclusive free previews on FansLeak. Discover trending creators, hashtags and new profiles daily.',
    type: 'website',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: siteName,
      url: `${siteUrl}/`,
      potentialAction: {
        '@type': 'SearchAction',
        target: `${siteUrl}/search?q={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    },
  })
);

const staticPages = [
  {
    path: 'search/index.html',
    url: '/search',
    title: `Search creators — ${siteName}`,
    description: 'Search creator profiles by name, handle or hashtag on FansLeak.',
  },
  {
    path: 'hashtags/index.html',
    url: '/hashtags',
    title: `Creator hashtags & categories — ${siteName}`,
    description: 'Browse creators by hashtag and category on FansLeak.',
  },
  {
    path: 'more/index.html',
    url: '/more',
    title: `More — ${siteName}`,
    description: 'About, support and extra pages for FansLeak.',
  },
];

for (const page of staticPages) {
  written.push(
    writePage(page.path, {
      url: `${siteUrl}${page.url}`,
      title: page.title,
      description: page.description,
    })
  );
}

// Private routes: keep the SPA working but never let them be indexed.
for (const page of [
  { path: 'auth/index.html', url: '/auth', title: `Sign in - ${siteName}` },
  { path: 'favorites/index.html', url: '/favorites', title: `Favorites - ${siteName}` },
  { path: 'admin/index.html', url: '/admin', title: `Admin - ${siteName}` },
]) {
  written.push(
    writePage(page.path, {
      url: `${siteUrl}${page.url}`,
      title: page.title,
      description: 'This page is private and is not indexed.',
      noindex: true,
    })
  );
}

// Profile pages
for (const id of uniqueIds) {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    console.warn(`[prerender] Skipping profile with unsafe id: ${id}`);
    continue;
  }

  const profile = profiles.find((candidate) => candidate.id === id);
  const displayName = sanitizeText(profile.name || profile.handle.replace(/^@/, '') || id, 60);
  const description =
    sanitizeText(profile.bio, 150) ||
    `${displayName} on ${siteName} - creator profile, photo gallery and free previews.`;

  written.push(
    writePage(`profile/${id}/index.html`, {
      url: `${siteUrl}/profile/${id}`,
      title: `${displayName} — profile & gallery | ${siteName}`,
      description,
      type: 'profile',
      image: profile.avatarUrl,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'ProfilePage',
        url: `${siteUrl}/profile/${id}`,
        mainEntity: {
          '@type': 'Person',
          name: displayName,
          alternateName: profile.handle,
          description: sanitizeText(profile.bio, 200),
          ...(profile.avatarUrl ? { image: profile.avatarUrl } : {}),
          ...(profile.category ? { knowsAbout: profile.category } : {}),
        },
      },
    })
  );
}

console.log(
  `[prerender] Wrote ${written.length} HTML files to dist/ for ${siteUrl} ` +
    `(${uniqueIds.length} profile pages)`
);
