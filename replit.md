# FansLeak

A React/TypeScript creator profile directory app for browsing content creators, with search, image galleries, favorites, and an admin panel.

## Tech Stack
- **Frontend**: React 18, TypeScript, Vite (port 5000), Tailwind CSS via CDN
- **Backend**: Express.js (port 3001) — serves a `/api/generate-bio` endpoint powered by Google Gemini AI
- **Data**: Local JSON files in `services/` (mock data, no database required)
- **Routing**: React Router v6 (BrowserRouter, clean URLs)

## Running the App
```bash
npm install
npm run start        # starts both frontend (port 5000) and backend (port 3001) concurrently
```

Or separately:
```bash
npm run dev          # Vite frontend only
npm run server       # Express API only
```

## Project Structure
- `index.tsx` — React entry point
- `components/` — All React components (App, HomePage, ProfilePage, AdminPanel, AuthPage, etc.)
- `services/` — Mock data provider + per-profile JSON data files
- `api/` — Additional API helpers
- `server.ts` — Express backend (Gemini bio generation)
- `vite.config.ts` — Vite config (port 5000, proxies `/api` to port 3001)

## Environment Variables
- `AI_INTEGRATIONS_GEMINI_API_KEY` — Gemini API key for bio generation (optional; set via Replit integration)
- `AI_INTEGRATIONS_GEMINI_BASE_URL` — Gemini base URL (set via Replit integration)
- `SESSION_SECRET` — Session secret (already configured)

## SEO & Sitemap
- Google Search Console verification meta tag lives in `index.html`.
- `npm run build` regenerates `public/sitemap.xml` + `public/robots.txt` from the `PROFILES` array (`prebuild`); set `SITE_URL` in the environment.

## Notes
- `DOCUMENTATION.md` and `NEXT_JS_BLUEPRINT.md` describe a planned Next.js + Supabase rebuild — not yet implemented
- `package.json` includes `overrides` for `tar`, `shell-quote`, and `protobufjs` to satisfy Replit's security policy

## User Preferences
<!-- User preferences go here -->
