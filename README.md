# FansLeak

A React/TypeScript creator profile directory: browse profiles, galleries and exclusive
previews, with search, hashtags, favorites, and an admin panel.

## Tech Stack
- **Frontend**: React 18, TypeScript, Vite (port 5000), Tailwind CSS via CDN
- **Routing**: React Router v6 (`BrowserRouter`, clean URLs such as `/profile/emmafiore`)
- **Backend**: Express.js (port 3001) — `/api/generate-bio` powered by Google Gemini AI
- **Data**: Local JSON/TS files in `services/` (no database required)

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

## Environment Variables
| Variable | Purpose |
| --- | --- |
| `SITE_URL` | Public base URL (no trailing slash) used to build absolute URLs in `sitemap.xml` / `robots.txt`, set to `https://fansleak.pages.dev`. **Set this in Cloudflare Pages.** |
| `AI_INTEGRATIONS_GEMINI_API_KEY` | Gemini API key for the bio generator (optional) |
| `AI_INTEGRATIONS_GEMINI_BASE_URL` | Gemini base URL (optional) |

See `.env.example`.

## SEO / Google Search Console
- Verification meta tag: `index.html` → `<meta name="google-site-verification" ...>`.
- `scripts/generate-sitemap.mjs` writes `public/sitemap.xml` and `public/robots.txt`.
  It reads every entry in the `PROFILES` array in `services/mockData.tsx`, so **new profiles
  are added to the sitemap automatically** on the next build. Profiles with
  `isVisible: false` are skipped, and duplicate profile IDs are emitted once.
- `npm run build` runs it automatically (`prebuild`). Standalone:
  ```bash
  SITE_URL=https://fansleak.pages.dev npm run sitemap
  ```
- Submit `https://fansleak.pages.dev/sitemap.xml` in Search Console, using the exact same URL
  as `SITE_URL`.

### Verify the tag is live
Run this against the exact property URL you added to Search Console:
```bash
curl -s https://fansleak.pages.dev/ | grep -o '<meta name="google-site-verification"[^>]*>'
# expect: <meta name="google-site-verification" content="eOzKZgDLPg020gOMwI5bstWMPEg7ARMfzdCwQQ132Fo" />
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

`public/_redirects` (`/* /index.html 200`) gives Cloudflare Pages the SPA fallback so deep
links like `/profile/emmafiore` resolve to the app instead of a 404.

If `SITE_URL` is not set, the generator falls back to `https://fansleak.pages.dev`. It does
**not** use `CF_PAGES_URL`: on Pages that resolves to a per-deployment alias such as
`https://ab9feb2a.fansleak.pages.dev`, which is what earlier builds wrote into the sitemap
and robots.txt. Garbage like that makes Search Console reject or ignore the sitemap.

A `vercel.json` with equivalent rewrite config is kept for Vercel preview/test deploys.

## Project Structure
- `index.tsx` — React entry point
- `components/` — App, HomePage, ProfilePage, AdminPanel, AuthPage, ExtraPages, Lightbox
- `services/` — Data provider (`mockData.tsx`) + per-profile data files
- `scripts/generate-sitemap.mjs` — sitemap/robots generator
- `server.ts` — Express API (Gemini bio generation)
- `api/` — additional API helpers

## Notes
- `DOCUMENTATION.md` and `NEXT_JS_BLUEPRINT.md` describe a planned Next.js + Supabase
  rebuild — not implemented.
- Profiles created in the Admin panel are held in memory only (not persisted), so they are
  not indexable; add a profile to `PROFILES` in `services/mockData.tsx` to make it permanent.
