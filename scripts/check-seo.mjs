#!/usr/bin/env node
/**
 * Post-build guard: fails the build if the Google Search Console verification
 * meta tag (or a canonical page title) is missing from the generated HTML.
 *
 * Runs automatically via `postbuild`. This exists because the deployed HTML is
 * what Google reads - if a template change or a different build config drops
 * the tag, the build should break loudly instead of silently failing
 * verification weeks later.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'eOzKZgDLPg020gOMwI5bstWMPEg7ARMfzdCwQQ132Fo';
const DIST = path.join(ROOT, 'dist');

const candidates = [path.join(DIST, 'index.html'), path.join(ROOT, 'index.html')];

const failures = [];

for (const file of candidates) {
  if (!fs.existsSync(file)) continue;

  const html = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  const hasTag = new RegExp(
    `<meta[^>]+name=["']google-site-verification["'][^>]*content=["']${TOKEN}["']`,
    'i'
  ).test(html);
  const inHead = hasTag && html.indexOf('google-site-verification') < html.indexOf('</head>');

  if (!hasTag) failures.push(`${rel}: verification meta tag missing`);
  else if (!inHead) failures.push(`${rel}: verification meta tag is outside <head>`);
  else console.log(`[check-seo] OK  ${rel}: google-site-verification present in <head>`);

  if (!/<title>[^<]*FansLeak[^<]*<\/title>/i.test(html)) {
    failures.push(`${rel}: expected a FansLeak <title>`);
  }
}

if (!candidates.some((file) => fs.existsSync(file))) {
  failures.push('no index.html found in dist/ or the project root');
}

if (failures.length) {
  console.error('[check-seo] FAILED');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('[check-seo] All checks passed.');
