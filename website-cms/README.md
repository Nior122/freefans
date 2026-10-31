# FansLeak website admin CMS

This is the website-only content system behind `https://fansleak.pages.dev/admin/`.
It manages public profiles and adverts in a **separate Cloudflare Pages D1
database**. It does not use, modify, migrate, or deploy the Telegram bot or the
bot database.

## What the owner can manage

- Built-in bundled profiles through D1 overlays (publish, draft, hide, restorable delete).
- New D1 profiles using the normal FansLeak `Profile`/`Image` standard.
- Profile identity, avatar/hero URLs, bio, tags, category, price, stats and media.
- Media order, captions, dimensions, image/video type, locked and visible flags.
- Authorized URL imports from public Coomer profiles/posts, generic public webpages,
  and direct image/video URLs. Every scrape opens as a reviewable draft first.
- Complete profile JSON and batch-media JSON imports.
- Managed image/video/link banners.
- Trusted third-party script slots, HTML slots, native banners, social bars, and popunders.
- Advert status, placement, priority and optional start/end dates.

Media is referenced by URL; this CMS does not upload or copy media into R2 or D1.
If a source host removes or blocks a hotlinked file, that media can stop loading.

## One-time Cloudflare setup

Do these steps **in order** after the code containing `functions/` is merged to
the production branch used by Cloudflare Pages.

### 1. Create the separate D1 database

In Cloudflare Dashboard:

1. Open **Workers & Pages → D1 SQL database**.
2. Create a database named **`fansleak-site-cms`**.
3. Do **not** select the fansleak-contact-requests database used by the bot.

### 2. Bind it to the FansLeak Pages project

In the FansLeak Pages project:

1. Open **Settings → Bindings**.
2. Add a **D1 database** binding.
3. Set the variable/binding name to exactly **`SITE_DB`**.
4. Select `fansleak-site-cms`.
5. Add it to **Production**. Add the same binding to Preview only if preview
   deployments should use the same live CMS data; normally, use a separate
   preview database if you do not want preview edits to affect production data.

`SITE_DB` is a binding, not a password and not a normal text variable.

### 3. Create the tables

The Pages Functions automatically run `CREATE TABLE IF NOT EXISTS` statements
on first use, so this step is optional. If you prefer to create them yourself,
open the new D1 database console and run the contents of
[`schema.sql`](schema.sql), or run:

```bash
npx --yes wrangler@4 d1 execute fansleak-site-cms --remote --file=website-cms/schema.sql
```

Do not run the bot migration scripts for this website database.

### 4. Add Pages variables and secrets

Open the FansLeak Pages project → **Settings → Environment variables**.
Add these for Production. Use Cloudflare's secret/encrypted option where shown.

| Name | Type | Required | What to enter |
| --- | --- | --- | --- |
| `SITE_DB` | D1 binding | Yes | Binding to `fansleak-site-cms`; add under **Bindings**, not here. |
| `ADMIN_USERNAME` | Secret / encrypted text | Yes | A new website-admin username chosen by the owner. |
| `ADMIN_PASSWORD` | Secret | Yes, unless hash is used | A new strong website-admin password. |
| `ADMIN_PASSWORD_SHA256` | Secret | Optional alternative | Lowercase/uppercase SHA-256 hex of the password. If set, it takes precedence over `ADMIN_PASSWORD`. |
| `ADMIN_SESSION_SECRET` | Secret | Yes | At least 32 random characters; use a password generator. |
| `ADMIN_SESSION_HOURS` | Text variable | No | Admin session length. Default `8`. |
| `SCRAPER_MAX_ITEMS` | Text variable | No | Max media per scrape. Default `300`, max `1000`. |
| `SCRAPER_MAX_PAGES` | Text variable | No | Max Coomer profile pages per scrape. Default `3`, max `10`. |
| `SCRAPER_USER_AGENT` | Text variable | No | Custom fetcher user agent for public-page scraping. |
| `SITE_URL` | Text variable | Already used | Keep `https://fansleak.pages.dev` unless the public custom domain changes. |

Never put real admin passwords or session secrets in GitHub, `.env.example`,
screenshots, issues, or chat.

### 5. Redeploy and sign in

1. Retry/redeploy the latest Cloudflare Pages production deployment, or push a
   new commit to the Pages production branch.
2. Open `https://fansleak.pages.dev/admin/`.
3. Sign in with the new `ADMIN_USERNAME` and `ADMIN_PASSWORD`.

## Forgotten password / reset

The previous site login was a demo check and did not store a real admin password,
so there is no old password to recover.

To reset access:

1. Replace `ADMIN_PASSWORD` (or `ADMIN_PASSWORD_SHA256`) in Cloudflare Pages.
2. Optionally replace `ADMIN_SESSION_SECRET` as well; this immediately signs
   out all existing admin sessions after redeployment.
3. Redeploy Pages.
4. Sign in at `/admin/` with the new password.

## How publishing works

### Built-in profiles

Profiles bundled in `services/mockData.tsx` stay in code. Editing one in the
admin panel stores a D1 overlay containing scalar changes, added media, removed
media IDs, media patches, and media order. Deleting a built-in profile creates a
restorable `deleted` overlay. **Reset overlay** removes the D1 row and makes
the bundled version public again.

### D1 profiles

Profiles created manually, from JSON, or from the scraper are stored as complete
D1 profile records when not based on a bundled profile.

Statuses behave as follows:

- `published`: public, subject to the profile's own `isVisible` flag.
- `draft`: admin-only; a built-in profile's previous public version remains live.
- `hidden`: removed from public profile lists/routes.
- `deleted`: removed publicly but restorable as a draft.

### Dynamic website routes

When `SITE_DB` is configured, Pages Functions also:

- serve the SPA shell for a published D1 profile that has no prerendered file;
- add published D1 profiles to `/sitemap.xml` and remove hidden/deleted profiles;
- merge published D1 profiles into `/contact-catalogue.json` and remove hidden/deleted entries.

These are website/Pages changes only. The bot code is unchanged and continues
to fetch the website catalogue dynamically.

D1 profiles are not part of the build-time static prerender/JSON-LD output. For a
profile that must become a permanent bundled SEO page, export its JSON from the
admin editor and use the existing permanent importer:

```bash
npm run add-profile -- path/to/profile.json --dry-run
npm run add-profile -- path/to/profile.json
npm run build
```

## Scraper rules

- Coomer/Kemono profile and post URLs (including the `.party`/`.su` mirrors) are
  imported through their public JSON API, which returns the real post image and
  video files, captions, dates, and tags. Coomer does not expose the creator's
  original platform bio, so the draft bio is generated from the scraped name,
  service, and post count and can be edited before publishing. If the API is
  unavailable, the scraper falls back to webpage extraction and says so in the
  scrape warnings.
- Only public `http(s)` URLs on standard ports are accepted.
- Local/private/reserved-network URLs and URLs with embedded credentials are rejected.
- Redirects are validated and page downloads are size/time limited.
- Login, paywall, CAPTCHA, and JavaScript-only protections are not bypassed.
- The owner must confirm they own the content or have permission to publish it.
- Generic extraction is best-effort and can include logos/adverts on some pages;
  deselect unrelated media during review.

## Adverts

Managed banners render in controlled slots. Network types support:

- `script`: trusted script URL and/or provider script code;
- `html`: provider markup;
- `native_banner`: provider native-banner tag in a visible slot;
- `social_bar`: provider code injected globally;
- `popunder`: provider code injected globally.

Only use code from providers you trust. Third-party scripts run in visitors'
browsers and can affect privacy, speed, and site reputation. Provider tags that
depend on `document.write` may not work inside this React application; prefer
the provider's async/container tag.

Global adverts and sidebar adverts are not injected on `/admin/` or `/auth/`.

## Local Pages/D1 test

Vite alone cannot run Pages Functions or D1. Build first, then run Wrangler
Pages with a local D1 database:

```bash
npm ci --ignore-scripts
npm run build
npx --yes wrangler@4 pages dev dist \
  --d1 SITE_DB=fansleak-site-cms-local \
  --persist-to .wrangler/state \
  --binding ADMIN_USERNAME=local-admin \
  --binding ADMIN_PASSWORD='use-a-local-test-password' \
  --binding ADMIN_SESSION_SECRET='use-at-least-32-random-characters-here' \
  --binding SITE_URL=http://localhost:8788 \
  --ip 127.0.0.1 \
  --port 8788
```

Open `http://localhost:8788/admin/`. The local function creates the D1 tables
automatically. Do not commit `.wrangler/` state or local credential files.
