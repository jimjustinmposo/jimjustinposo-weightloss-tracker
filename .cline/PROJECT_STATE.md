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
- [x] Notes list rows copy the full entry title and text to the clipboard before the Edit action.
- [x] Notes editor uses a professional, auto-growing entry box with visible caret, placeholder, and focus styling.
- [x] Notes supports pasting/adding compressed inline photos with safe rendering, search exclusions, offline support, and API validation.
- [x] Notes search and offline lifecycle tests pass.
- [x] Route modules are lazy-loaded; boot-critical modules are preloaded (removes the all-views first-load cost).
- [x] Security headers (CSP, HSTS, nosniff, DENY framing, referrer + permissions policies) on Worker and static responses; API responses are `no-store`.
- [x] Non-GET /api requests with a mismatching `Origin` are rejected (403); login/register/verify-admin/nutrition are rate-limited per IP (429 + Retry-After).
- [x] Session cookie sets `Secure` whenever the request arrived over HTTPS.

## Current Focus
- D1 usage optimization: minimize row reads/writes per user session without changing features.

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
- D1 optimization: GET /api/dashboard reduced from 9 queries (3 recursive CTE joins + duplicate scans) to 6 plain selects; each table read once, zero-fill done in JS; identical JSON output.
- seedAll() no longer full-table pulls: limits aligned to UI (weights 90, logs 500, steps/pushups 180) and a freshWindowMs throttle skips re-seeding when nothing changed.
- sync.js seeds only when ops were pushed (or cache is >5 min stale); notifyDataChanged fires only after a real seed.
- Notes edit reuses the already-fetched note object (no folder-wide re-download incl. photo blobs).
- Notes list copy uses the already-fetched entry and copies its full plain-text content.
- Service worker bumped to v8 to evict stale bundles.

## D1 Usage Model (single user, <500 records)
- Before: every boot/reload ran seedAll (9 endpoints ≈ up to ~2,300 row reads incl. /api/auth/me duplicate, 1000-log + 365-day pulls) plus 9-query dashboard (~150–300 reads). A stale cached sync.js (pre hasPending guard, served cache-first by SW) re-ran seedAll every 60s ≈ 3.3M reads/day — the main limit breaker.
- After: dashboard ~6 queries; seed throttled to ≥5 min when idle and ~1,000 reads when it runs; normal session ≈ a few thousand reads.

## Next Steps
- Check the UI in a browser (login → dashboard → notes → offline reload) after deploying the new service worker.
- Consider a durable (D1/KV-backed) rate limiter if stronger abuse protection is needed.

## Known Limitations
- Browser visual validation was not performed; UI checks use a DOM double.
- Rate limiting is per isolate — Cloudflare may run many isolates, so it is a deterrent only.
- /js and /css cache windows are deliberately short (5 min + stale-while-revalidate) since filenames are not content-hashed.
