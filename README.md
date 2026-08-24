# JustinPoso — Personal Weight Loss Tracker

A fullstack webapp built entirely on **Cloudflare**:

| Layer     | Technology |
|-----------|------------|
| Frontend  | Vanilla JS SPA (ES modules) served by **Cloudflare Workers Static Assets** — zero CDN dependencies, custom SVG charts |
| Backend   | **Cloudflare Workers** + [Hono](https://hono.dev) REST API |
| Database  | **Cloudflare D1** (serverless SQLite) with migrations |

## Features

- **Auth** — email/password accounts (PBKDF2-hashed), 30-day httpOnly cookie sessions
- **Profile & Targets** — age, gender, height, lifestyle/activity, current weight, weekly goal
  - **BMR** (Mifflin-St Jeor) → **TDEE** (activity factor) → **BMI** + category
  - Daily **calorie target** (7700 kcal per kg of weekly goal, safe floors) and **macros**
    (protein g/kg, fat ≈27% of kcal, carbs remainder)
- **Food database** — add foods once (per-serving values normalized to per-100 g),
  then search every time; edit/delete anytime; diary entries keep history snapshots
- **Food logging** — search catalog → pick grams + meal → macros auto-computed;
  daily record grouped into breakfast/lunch/dinner/snacks
- **Steps** — daily step entry with calories burned estimated from stride length
  (height × 0.414) × distance × body weight, subtracted from the day's intake
- **Weight log** — date + weight upserts, syncs profile weight, auto-recalculates targets,
  feeds the weight-trend chart
- **Dashboard** — calorie/steps rings, macro bars, eaten/burned/net/left balance,
  weight tracker line chart, 7-day steps bar chart, 7-day calories vs. goal chart,
  daily food intake record, BMI/TDEE badges
- **Mobile-first UX** — bottom nav on phones, responsive card grid, spec palette
  (`#1976D2 / #64B5F6 / #FAFBFF / #43A047 …`)

## Local development

```bash
npm install
npm run db:migrate:local   # apply D1 schema to the local database
npm run dev                # wrangler dev → http://localhost:8787
```

## Deploy to Cloudflare

```bash
npx wrangler login
npx wrangler d1 create weightloss-db
# → copy the "database_id" into wrangler.jsonc
npm run db:migrate:remote  # create tables in production D1
npm run deploy             # ship Worker + static assets
```

## Project layout

```
src/
  index.ts            Hono app, session guard, asset fallback
  auth.ts             PBKDF2 hashing, sessions, requireAuth middleware
  calc.ts             BMR/TDEE/BMI/macro/step-burn math
  routes/             auth · profile · foods · logs · steps · weights · dashboard
migrations/           D1 SQL schema
public/               SPA: index.html, css/, js/ (api · state · util · charts · views)
wrangler.jsonc        Workers config: assets binding + D1 binding
```

## API overview

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/auth/register` `/login` `/logout` | account & session management |
| GET | `/api/auth/me` | current user + profile |
| GET/PUT | `/api/profile` | read/update profile (recomputes targets) |
| GET/POST | `/api/foods?q=` | search/list/create catalog foods |
| PUT/DELETE | `/api/foods/:id` | update/remove a food |
| GET | `/api/logs?date=YYYY-MM-DD` | day's entries + totals |
| POST | `/api/logs` | log food (by `food_id` or custom) |
| DELETE | `/api/logs/:id` | remove entry |
| GET/POST | `/api/logs/recent`, `/api/steps`, `/api/weights` | history series |
| GET | `/api/dashboard?date=` | everything the dashboard needs in one call |
"# jimjustinposo-weightloss-tracker" 
