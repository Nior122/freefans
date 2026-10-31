# FansLeak

A React/TypeScript creator profile directory: browse profiles, galleries and exclusive
previews, with search, hashtags, favorites, and an admin panel.

## Tech Stack
- **Frontend**: React 18, TypeScript, Vite (port 5000), Tailwind CSS via CDN
- **Routing**: React Router v6 (`BrowserRouter`, clean URLs such as `/profile/emmafiore`)
- **Backend**: Express.js (port 3001) — `/api/generate-bio` powered by Google Gemini AI
- **Data**: Bundled JSON/TS profiles in `services/`, plus an optional separate Cloudflare Pages D1 website CMS for admin-managed profile overlays, new profiles, and adverts

## Run Locally
```bash
npm install
npm run start     # frontend (5000) + API (3001) together
```

Or separately:
```bash
npm run dev       # Vite frontend only
npm run server    # Express API only
```

The website admin API uses Cloudflare Pages Functions + D1, so Vite alone shows
an admin setup/API-unavailable screen. For a full local admin test, build and
run Wrangler Pages as described in [`website-cms/README.md`](website-cms/README.md).

## Environment Variables
| Variable | Purpose |
| --- | --- |
| `SITE_URL` | Public base URL (no trailing slash) used to build absolute URLs in `sitemap.xml` / `robots.txt`, set to `https://fansleak.pages.dev`. **Set this in Cloudflare Pages.** |
| `AI_INTEGRATIONS_GEMINI_API_KEY` | Gemini API key for the bio generator (optional) |
| `AI_INTEGRATIONS_GEMINI_BASE_URL` | Gemini base URL (optional) |
| `ADMIN_USERNAME` | Website-admin username secret for `/admin/` (Cloudflare Pages) |
| `ADMIN_PASSWORD` | Website-admin password secret; alternatively use `ADMIN_PASSWORD_SHA256` |
| `ADMIN_SESSION_SECRET` | At least 32 random characters; signs the admin session cookie |
| `ADMIN_SESSION_HOURS` | Optional admin session length (default 8) |
| `SCRAPER_MAX_ITEMS` / `SCRAPER_MAX_PAGES` | Optional admin scraper limits (defaults 300 / 3) |
| `SCRAPER_USER_AGENT` | Optional public-page scraper user agent |

See `.env.example`.

## SEO / Google Search Console

Build pipeline (all automatic with `npm run build`):

1. `prebuild` → `scripts/generate-sitemap.mjs` writes `public/sitemap.xml` + `public/robots.txt`
   from the `PROFILES` array in `services/mockData.tsx`. **Every new profile is added
   automatically**; hidden profiles (`isVisible: false`) are skipped and duplicate ids are
   emitted once.
2. `vite build` → `dist/`.
3. `postbuild` → `scripts/prerender.mjs` writes a real HTML file per route with its own
   `<title>`, meta description, `canonical`, robots directive, Open Graph/Twitter tags and
   JSON-LD (`WebSite` + `Organization` + `CollectionPage`/`ItemList` on the home page,
   `ProfilePage` + `Person` + `BreadcrumbList` on profiles), plus `404.html`.
4. `postbuild` → `scripts/check-seo.mjs` **fails the build** on any of: missing/misplaced
   verification tag, sitemap host or trailing-slash mistakes, duplicate sitemap URLs,
   missing prerendered page, canonical that doesn't match its sitemap URL, thin
   titles/descriptions, a `noindex` page inside the sitemap, robots.txt problems, a
   soft-404 catch-all, or missing icons/social image.

### URL format: trailing slash everywhere

Cloudflare Pages serves `<route>/index.html` for `<route>/` and **308-redirects
`<route>` → `<route>/`**. Canonicals, sitemap entries, `og:url` and internal `<Link>`s all
use the trailing-slash form (`/profile/emmafiore/`), so the indexed URL is exactly the one
served — no redirects, no canonical/URL mismatch. `scripts/lib/site.mjs` (`canonicalPath`,
`absoluteUrl`, `distFileForPath`) is the single source of truth for this.

### 404s

`public/_redirects` intentionally has **no** `/* /index.html 200` catch-all. Every public
route is prerendered, and unknown URLs get `dist/404.html` with a real `404` status and
`noindex` — otherwise Google treats every typo as a soft 404.

### Verify the tag is live
Run this against the exact property URL you added to Search Console:
```bash
curl -s https://fansleak.pages.dev/ | grep -o '<meta name="google-site-verification"[^>]*>'
# expect: <meta name="google-site-verification" content="W8NUKGvl4cHSmctRzfmeO4Gw1zYinIrgFafJi_mMNa0" />
```
`npm run build` also runs `scripts/check-seo.mjs` (`postbuild`), which **fails the build**
if the tag is missing from `dist/index.html` or sits outside `<head>`.

### If verification still fails
1. **Wrong property type** — the meta tag only works for a *URL-prefix* property. A *Domain*
   property can only be verified with a DNS TXT record.
2. **URL mismatch** — the property must match exactly: `https://` vs `http://`,
   `www.` vs apex, and `fansleak.com` vs `fansleak.pages.dev` are different properties.
   Verify the one you actually submitted.
3. **Stale deploy** — confirm Cloudflare Pages rebuilt after the merge (Deployments tab,
   commit hash should be the merge commit). If the production branch in Cloudflare is not
   `fan`, the merge never triggers a build.
6. **Sitemap host mismatch** — `https://fansleak.pages.dev/sitemap.xml` must list
   `https://fansleak.pages.dev/...` URLs, never `*.fansleak.pages.dev` deployment aliases.
   Set `SITE_URL` and redeploy; robots.txt has the same requirement.
4. **Cloudflare blocking Googlebot** — Bot Fight Mode / "I'm Under Attack" / WAF rules /
   Cloudflare Access return a challenge page with no meta tag. Allow `Googlebot` or turn
   those off for the site, then retry.
5. **Cached HTML** — `public/_headers` sets `max-age=0, must-revalidate` for `/`; if you had
   "Cache Everything" enabled, purge the Cloudflare cache after deploying.

## Deploy (Cloudflare Pages)
| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variable | `SITE_URL = https://fansleak.pages.dev` (Production) |
| Optional | `NODE_VERSION = 22` |
| D1 binding | `SITE_DB` → separate `fansleak-site-cms` database (Production) |
| Admin secrets | `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` |

`public/_redirects` (`/* /index.html 200`) gives Cloudflare Pages the SPA fallback so deep
links like `/profile/emmafiore` resolve to the app instead of a 404.

If `SITE_URL` is not set, the generator falls back to `https://fansleak.pages.dev`. It does
**not** use `CF_PAGES_URL`: on Pages that resolves to a per-deployment alias such as
`https://ab9feb2a.fansleak.pages.dev`, which is what earlier builds wrote into the sitemap
and robots.txt. Garbage like that makes Search Console reject or ignore the sitemap.

A `vercel.json` with equivalent rewrite config is kept for Vercel preview/test deploys.

## Crawling on Cloudflare Pages

The code side allows crawling: `robots.txt` is `Allow: /`, the sitemap and every route
return real HTML, `/admin`, `/auth` and `/favorites` are the only `noindex` pages.

Important: those settings are **zone-level**. A bare `*.pages.dev` hostname is not a zone
you own, so the dashboard has no Security → Settings / WAF rules for it — you cannot toggle
bot protection on a `pages.dev` site. "Couldn't fetch" on a `pages.dev` sitemap while Google's
live URL inspection succeeds is a widely reported Pages behavior, and some clients receive
Cloudflare `403 / error 1010` from the shared edge before the request reaches the project.

**The fix is a custom domain.** Workers & Pages → project → **Custom domains**: the domain
becomes your own zone, so Security settings apply and the shared edge is no longer in front
of the site. Then set `SITE_URL` to it and redeploy.

If you do attach a custom domain, these are the settings that matter:

1. **Security → Bots**: Bot Fight Mode / Super Bot Fight Mode off, or "Definitely automated"
   = Allow and **verified bots** allowed. Bot Fight Mode cannot be skipped by WAF rules —
   it is all-or-nothing.
2. **Security → Settings**: Security Level not *I'm Under Attack*.
3. **Security → Security rules**: no challenge/block rule matching `Googlebot`.
4. **Zero Trust → Access**: no Access application in front of the deployment (Google would
   get a 302 to a login page).
5. **Caching**: purge after deploys if "Cache Everything" is on.

Sitemap status is **not** an indexing blocker: the home page links to every profile, and
URL Inspection → *Request indexing* works today even while the sitemap reports "couldn't fetch".

## Project Structure
- `index.tsx` — React entry point
- `components/` — App, HomePage, ProfilePage, AdminPanel, AuthPage, ExtraPages, Lightbox
- `services/` — Bundled data provider (`mockData.tsx`), website CMS client (`cms.ts`), and per-profile data files
- `functions/` — Cloudflare Pages Functions for website admin auth/API/scraping and dynamic D1 profile/catalogue/sitemap routes
- `website-cms/` — Separate website D1 schema and owner setup guide (not the bot database)
- `public/og-image.svg` — source for `og-image.png` (1200×630 social card)
- `scripts/generate-sitemap.mjs` — sitemap + robots.txt generator (runs on prebuild)
- `scripts/prerender.mjs` — per-route HTML/metadata generation (runs on postbuild)
- `scripts/check-seo.mjs` — build-time SEO guard (runs on postbuild)
- `scripts/lib/site.mjs` — shared profile parsing, SITE_URL resolution, escaping
- `server.ts` — Express API (Gemini bio generation)
- `api/` — additional API helpers

## Notes
- `DOCUMENTATION.md` and `NEXT_JS_BLUEPRINT.md` describe a planned Next.js + Supabase
  rebuild — not implemented.
- Profiles created or edited in the website Admin panel persist in the separate
  Pages D1 CMS when `SITE_DB` and the admin secrets are configured. If the CMS
  is unavailable, the public site falls back to the bundled profiles. For a
  permanent build-time prerendered/JSON-LD profile, export the profile JSON and
  use `npm run add-profile` as described below.

## Brand assets

The logo (interlocking F/L monogram with a drip, red gradient on `#0a0a0a`) is generated
from vector sources in `public/`:

| File | Use |
| --- | --- |
| `favicon.svg`, `favicon.ico`, `favicon-16/32/48.png` | browser favicons (simplified flat mark so it stays legible at 16px) |
| `apple-touch-icon.png` (180) | iOS home screen |
| `icon-192.png`, `icon-512.png`, `icon-512-maskable.png` | manifest icons (`any` + `maskable`) |
| `logo.svg`, `logo-maskable.svg`, `logo-lockup.svg` | in-app mark and icon + wordmark lockup |
| `og-image.png` / `og-image.svg` (1200×630) | social preview card |
| `site.webmanifest` | PWA manifest |

Two mark variants are deliberate: the detailed artwork (gradient + glow + drip) is used at
180px and above, while 16/32px favicons use a flat, thickened version — the glow turns to
mush and the drip disappears at tab size. `scripts/check-seo.mjs` fails the build if any of
these files or their `<link>` tags go missing.

## Adding a profile

There are two supported profile paths:

1. **Website Admin panel (instant D1 publishing):** create/edit at `/admin/`, scrape
   an authorized public URL into a draft, review the normal FansLeak fields/media,
   then publish. Built-in edits are D1 overlays; new profiles are D1 records.
2. **Permanent bundled profile (build-time SEO):** add one entry to `PROFILES`
   (`services/mockData.tsx`) plus an image array. Its `/profile/<id>/` URL, static
   sitemap entry, prerendered HTML, canonical, and JSON-LD are generated on rebuild.

The existing importer below is the permanent bundled path:

```bash
npm run add-profile -- path/to/profile.json --dry-run   # validates + prints the entry
npm run add-profile -- path/to/profile.json             # writes data file + registers profile
npm run build                                           # sitemap + prerendered pages
```

The payload:

```json
{
  "id": "creator_slug",
  "name": "Creator Name",
  "handle": "@creator_slug",
  "bio": "One or two sentences; used as the meta description (50-155 chars is ideal).",
  "avatarUrl": "https://…/avatar.jpg",
  "heroUrl": "https://…/banner.jpg",
  "tags": ["onlyfans", "cosplay"],
  "category": "Creator",
  "pricePerMonth": 9.99,
  "access_mode": "cached_preview",
  "stats": { "posts": 120, "likes": 5000, "views": 25000, "followers": 1200 },
  "images": [
    { "url": "https://…/a.jpg", "caption": "…", "width": 1080, "height": 1350, "mediaType": "image" }
  ]
}
```

The importer enforces what the build needs: slug-shaped `id` (2-64 chars, no reserved app
routes like `search`), name + bio, absolute http(s) media URLs, at least one image, numeric
stats, ≤12 tags. It de-duplicates image URLs, generates `<id>-001` image ids, defaults
`isLocked`/`isVisible`, drops oversized captions, refuses to overwrite an existing profile
unless `--force`, and warns when a profile exceeds ~500 images (all profile media is bundled
into the client JS, which is already the main bundle-size cost).

Only add media you have the right to distribute — creator-supplied media kits, profiles the
creator has submitted, or your own content. The importer never fetches anything; it only
validates and writes JSON you provide.


## Website admin panel and adverts

`/admin/` is protected by a real server-side Cloudflare Pages session. The old
public demo rule (any email containing “admin”) has been removed. The owner sets
a new username/password with `ADMIN_USERNAME` and `ADMIN_PASSWORD` in Cloudflare
Pages; `ADMIN_SESSION_SECRET` signs the HttpOnly session cookie. Replacing the
password and redeploying resets access. The public `/auth/` form never grants
admin access.

The panel includes:

- Dashboard counts and recent D1 activity.
- Search/filter, create, edit, publish, draft, hide, restorable delete, and
  media management for built-in and D1 profiles.
- A rights-confirmed scraper for public Coomer profiles/posts, generic public
  pages, direct media URLs, and profile/batch JSON. It creates a draft using the
  existing profile standard and does not bypass logins or paywalls.
- Managed image/video/link banners plus trusted script, HTML, native-banner,
  social-bar, and popunder slots with placement, status, priority, and dates.
- A Setup & Secrets tab listing the separate `SITE_DB` D1 binding and every
  Pages variable/secret name.

Full owner setup is in [`website-cms/README.md`](website-cms/README.md). This
website CMS deliberately uses a different D1 database from the Telegram bot.

## Telegram contact requests

The red **Subscribe** button on each profile opens `@KasiQueenbot` with that profile's ID and starts the selected profile's request flow. The site build generates the static `public/contact-catalogue.json` from bundled visible profiles. When the website CMS D1 binding is configured, a Pages Function also merges published D1 profiles into `/contact-catalogue.json` and removes hidden/deleted entries without changing any bot code. Optionally set `VITE_TELEGRAM_BOT_USERNAME` in Cloudflare Pages; it defaults to `KasiQueenbot`.

The configurable bot Worker, Selar payment webhooks, manual admin payment verification, creator-consent gating, D1 schema/migrations, tests, and deployment instructions are in [`contact-bot/README.md`](contact-bot/README.md). Payments are never verified automatically. The Worker must be separately deployed/configured; the website button alone does not activate payment processing.
