# PROJECT STATE

## Project
- Name: justin-weightloss-tracker
- Purpose: Personal weight-loss tracker.
- Status: Existing application; this snapshot covers the Notes task only.

## Current Stack
- Frontend: Browser JavaScript modules in public/js (ES modules; view modules loaded on demand).
- Backend: Hono; Cloudflare Workers (package configuration).
- Database: D1 (package configuration).
- Hosting: Cloudflare deployment script; live deployment not verified.
- AI/External Services: Not inspected for this task.

## Architecture
- Notes UI uses the existing API client and offline cache, with shared modal helpers.
- Router (public/js/app.js) dynamic-imports each view module; boot modules are preloaded in index.html.
- Security headers are defined once in src/index.ts (Worker responses) and mirrored in public/_headers, because Cloudflare's asset server answers static files without running the Worker.

## Implemented Features
- [x] Notes entry previews and search results open full read-only details with an Edit action; verified using DOM-double tests.
- [x] Notes editor uses a professional, auto-growing entry box with visible caret, placeholder, and focus styling.
- [x] Notes supports pasting/adding compressed inline photos with safe rendering, search exclusions, offline support, and API validation.
- [x] Notes search and offline lifecycle tests pass.
- [x] Route modules are lazy-loaded; boot-critical modules are preloaded (removes the all-views first-load cost).
- [x] Security headers (CSP, HSTS, nosniff, DENY framing, referrer + permissions policies) on Worker and static responses; API responses are `no-store`.
- [x] Non-GET /api requests with a mismatching `Origin` are rejected (403); login/register/verify-admin/nutrition are rate-limited per IP (429 + Retry-After).
- [x] Session cookie sets `Secure` whenever the request arrived over HTTPS.

## Current Focus
- Performance + security hardening only; features and existing behaviour preserved.

## Current Problems
- No known failures. `npm test` (49 tests), `tsc --noEmit`, `wrangler deploy --dry-run` and a live `wrangler dev` smoke test all pass.

## Important Decisions
- Reuse existing modal and editor; escape note text and preserve line breaks.
- Keep pencil/delete controls separate from the clickable entry preview.
- SECURITY_HEADERS in src/index.ts MUST stay identical to the `/*` block in public/_headers (asset server can bypass the Worker).
- Rate limiter is in-memory per isolate (no D1 writes) — a deterrent, not a hard quota.
- No async/data-layer behaviour changes: api.js only skips a redundant IndexedDB read.

## Database
- No schema changes. Local dev D1 was migrated for smoke testing (`npm run db:migrate:local`); the temporary test account was deleted afterwards.

## API
- Notes UI uses /api/notes/folders and /api/notes, including folder_id filtering.
- Existing note create/update/delete endpoints unchanged.
- All /api responses are sent with `Cache-Control: no-store`; non-GET /api calls must come from the same origin (checked only when the browser sends `Origin`).
- Rate-limited endpoints: /api/auth/login (10 / 5 min), /api/auth/register (10 / 10 min), /api/auth/verify-admin (8 / 10 min), /api/nutrition/estimate (30 / 5 min) — per client IP.

## Environment
- Required environment variables not inspected for this task.

## Recent Changes
- Added CSP + security headers, API `no-store`, same-origin (CSRF) check and per-IP rate limiting on auth/nutrition endpoints.
- Lazy-loaded route modules + modulepreload hints; dashboard loads the food picker on demand.
- Removed a per-request IndexedDB read from api.js (uses the in-memory pending count).
- Service worker bumped to v7 and now precaches pushups.js; added public/_headers caching for /js, /css, /icon.svg, /manifest.webmanifest.
- Respect `prefers-reduced-motion` in CSS and skip the dashboard ring animation for those users.

## Next Steps
- Check the UI in a browser (login → dashboard → notes → offline reload) after deploying the new service worker.
- Consider a durable (D1/KV-backed) rate limiter if stronger abuse protection is needed.

## Known Limitations
- Browser visual validation was not performed; UI checks use a DOM double.
- Rate limiting is per isolate — Cloudflare may run many isolates, so it is a deterrent only.
- /js and /css cache windows are deliberately short (5 min + stale-while-revalidate) since filenames are not content-hashed.
