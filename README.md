# In My Arc — InnovativeView Daily Log

A replica of [inmyarc.com](https://www.inmyarc.com): the team's daily log, where everyone marks attendance and logs their tasks, and the admin judges each person's whole day at `/rating`.

Same screens, fields, limits, validations, verdict logic and colours as the original. The difference is the backend: everything runs on **Vercel** instead of Supabase.

| Piece | Original | Replica |
| --- | --- | --- |
| Frontend | Vite + React + Tailwind v4 | same (Vite 8, React 19, Tailwind 4.3, GSAP, jsPDF) |
| API | Supabase PostgREST + RPCs + row-level security | one Vercel Function (`api/index.ts` → `server/`) that enforces the same rules |
| Database | Supabase Postgres | **Neon Postgres** from the Vercel Marketplace (`DATABASE_URL`) |
| Attachments | Supabase Storage `task-files` | **Vercel Blob**, private store (`BLOB_READ_WRITE_TOKEN`) |
| Admin passcode | `verify_passcode` RPC | `ADMIN_PASSCODE` environment variable, checked on every admin request |
| "Live" | Supabase Realtime | polling every 10 s while the tab is visible, plus a refresh on focus |

## Set up on Vercel

The repo deploys from `main`. The first deploy shows a "A few steps left" screen until these are done:

1. **Database:** Project → **Storage** → **Create Database** → **Neon** → connect it to this project. Vercel adds `DATABASE_URL`. Tables are created automatically on first use.
2. **File storage:** **Storage** → **Create** → **Blob** → access **Private** → connect. Make sure `BLOB_READ_WRITE_TOKEN` is in the project's environment variables (browser uploads need it).
3. **Admin passcode:** **Settings** → **Environment Variables** → `ADMIN_PASSCODE`.
4. *(Optional)* **Backfill window:** `EDITABLE_FROM=YYYY-MM-DD` lets the team log and edit days from that date to today. Without it, the team can only log **today**. A row in the `settings` table (`key = 'editable_from'`) overrides it without a redeploy.
5. **Redeploy**, then open `/rating`, sign in, and use **Import history**. Paste the old Supabase project's **anon** key (Supabase → Project Settings → API Keys). It copies the members, attendance, entries, verdicts and any attachments. Running it again updates rows instead of duplicating them.

## Rules (as in the original)

- **Board (`/`)**
  - Anyone picks their name. It's remembered in this browser (`iv.daily-log.identity`).
  - Each person logs attendance, an optional day note (140 characters) and any number of tasks. Each task has a title (180), a detail (400), time taken (0–24 h, 0–59 m, capped at a day), a status (Done / Not done / Rework required) and one file of up to 10 MB.
  - A working day needs at least one entry. Leave and week off don't.
  - **Assign to someone:** the task goes into that person's row as *Not done*, with a brief of up to 600 characters.
  - Status, remarks (500 characters) and attendance can be changed straight from the table. A status change records who changed it and when.
  - Days outside the editable window are **View only**. A past day with nothing logged counts as *Leave*, or *Week off* at weekends, and is marked "by default".
- **Admin (`/rating`)**
  - Full edit access for any past day.
  - The verdict on each person's whole day: Not up to the mark (1 point), Can be better (2), Up to the mark (3), Over performed (4), Extraordinary (5). Clicking the active verdict clears it.
  - Brownies, +1 point each: Overtime, Holiday and Hero. They only unlock once the day is judged.
  - Rows rank by verdict, then brownies. Everyone in the same verdict shares a place, and the order holds still while you judge.
  - **Report** downloads an A4 landscape PDF of the day.
- **Graph / Review:** standings by verdict or by points, per week (last 12 weeks) or month (last 6), the team's verdict mix over time, and a stats view per person with a monthly calendar.

## Develop

```bash
npm install
npx vercel link && npx vercel env pull .env.local   # pulls DATABASE_URL, BLOB_READ_WRITE_TOKEN, ADMIN_PASSCODE
npm run dev          # vercel dev: Vite + the /api function together
npm test             # API tests against an in-memory Postgres (PGlite)
npm run typecheck
```

## API

All routes live in `server/router.ts`. `vercel.json` rewrites `/api/*` to the single function.

| Method | Route | Who |
| --- | --- | --- |
| GET | `/api/day?date=&sig=` | anyone. With `sig` it answers `unchanged` when nothing moved |
| GET | `/api/history?from=` | anyone |
| GET | `/api/setup` | anyone: what's configured |
| POST | `/api/day/submit` | team within the window, or admin |
| POST | `/api/entries` | team within the window, or admin (assign = `assigned: true`) |
| PATCH / DELETE | `/api/entries/:id` | team within the window, or admin |
| PUT | `/api/attendance` | team within the window, or admin |
| PUT | `/api/marks` | admin |
| POST | `/api/admin/verify`, `/api/admin/import` | admin |
| POST | `/api/files/upload` | client-upload tokens for Vercel Blob |
| GET | `/api/files?entry=` | streams a private attachment |

The admin page sends the passcode in the `x-admin-passcode` header. It's kept in memory only, so reloading `/rating` locks it again.
