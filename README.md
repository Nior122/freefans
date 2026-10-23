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
| `SITE_URL` | Public base URL (no trailing slash) used to build absolute URLs in `sitemap.xml` / `robots.txt`, e.g. `https://fansleak.com`. **Required for production builds.** |
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
  SITE_URL=https://your-domain.com npm run sitemap
  ```
- Submit `https://your-domain.com/sitemap.xml` in Search Console, using the exact same URL
  as `SITE_URL`.

## Deploy (Cloudflare Pages)
| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variable | `SITE_URL=https://your-domain.com` (Production) |

`public/_redirects` (`/* /index.html 200`) gives Cloudflare Pages the SPA fallback so deep
links like `/profile/emmafiore` resolve to the app instead of a 404. If `SITE_URL` is not
set, the sitemap generator falls back to `CF_PAGES_URL`, then to a `https://your-domain.com`
placeholder.

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
