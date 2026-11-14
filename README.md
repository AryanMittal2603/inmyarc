# In My Arc — InnovativeView Daily Log

A replica of [inmyarc.com](https://www.inmyarc.com), grown from one team to many. Each manager has a team. The team logs its days on an open board, the manager rates each person's whole day, and a super admin runs the teams and sees everyone at once.

| Address | Who | What |
| --- | --- | --- |
| `/` | everyone | Home: every team, with how many have logged today, and links to its board and manager page |
| `/task/<team>` | the team (no sign-in) | The team's board: pick your name, log attendance and tasks, assign tasks to teammates |
| `/rating/<team>` | that team's manager (password) | Verdicts and brownies, full edit access for any day, report PDF, graph |
| `/admin` | super admin (`ADMIN_PASSCODE`) | Create managers and their passwords, add and move employees, every team on one board, combined stats, backfill window |

`<team>` is the manager's link name, like `manager1`. Only the super admin creates managers and sets their passwords.

Same fields, limits, validations, verdict logic and colours as the original. The backend runs on **Vercel**:

| Piece | Original | Replica |
| --- | --- | --- |
| Frontend | Vite + React + Tailwind v4 | same (Vite 8, React 19, Tailwind 4.3, GSAP, jsPDF), fonts self-hosted |
| API | Supabase PostgREST + RPCs + row-level security | one Vercel Function (`api/index.ts` → `server/`) that enforces the rules |
| Database | Supabase Postgres | **Neon Postgres** from the Vercel Marketplace (`DATABASE_URL`) |
| Attachments | Supabase Storage `task-files` | **Vercel Blob**, private store (`BLOB_READ_WRITE_TOKEN`) |
| Sign-in | one passcode for `/rating` | super admin password (`ADMIN_PASSCODE`) and one password per manager (stored as scrypt hashes), kept in signed HttpOnly cookies |
| "Live" | Supabase Realtime | polling every 10 s while the tab is visible, plus a refresh on focus |

## Set up on Vercel

The repo deploys from `main`. Until these are done the pages show an "A few steps left" checklist:

1. **Database:** Project → **Storage** → **Create Database** → **Neon** → connect it to this project (Production). Vercel adds `DATABASE_URL`. Tables are created (and upgraded) automatically on first use.
2. **File storage:** **Storage** → **Create** → **Blob** → access **Private** → connect it to this project (Production). Vercel adds `BLOB_READ_WRITE_TOKEN` (browser uploads need it).

   A custom prefix is fine: `INMYARCSTORAGE_DATABASE_URL` and `INMYARCSTORAGE_READ_WRITE_TOKEN` are found too. Storage connected after the last deploy only shows up after a redeploy.
3. **Super admin password:** **Settings** → **Environment Variables** → `ADMIN_PASSCODE`.
4. **Redeploy**, open `/admin` and sign in.
5. **Managers** tab: add each manager with a name, a link name and a password (or **Generate** one). Copy the sign-in details it shows and send them to the manager privately — the password isn't shown again, but you can set a new one any time.
6. **Employees** tab: add people under each manager (one name per line), or **Import from the old site** with the old Supabase project's anon key and the team to put them on. *Employees only* starts with a clean history; *Employees + history* also copies attendance, entries, verdicts and attachments.

## Rules

- **Team board (`/task/<team>`)**
  - Anyone opens the link and picks their name; it's remembered in this browser, per team. Only that team's employees appear, and the board can only change their days.
  - Each person logs attendance, an optional day note (140 characters) and any number of tasks. Each task has a title (180), a detail (400), time taken (0–24 h, 0–59 m, capped at a day), a status (Done / Not done / Rework required) and one file of up to 10 MB.
  - A working day needs at least one entry. Leave and week off don't.
  - **Assign to someone:** the task goes into that teammate's row as *Not done*, with a brief of up to 600 characters.
  - Status, remarks (500 characters) and attendance can be changed straight from the table. A status change records who changed it and when.
  - Only today is open, unless the super admin opens a backfill window. Other days are **View only**. A past day with nothing logged counts as *Leave*, or *Week off* at weekends, and is marked "by default".
- **Manager page (`/rating/<team>`)**
  - Signed in for 7 days. A manager only sees and rates their own team; another team's page asks for that team's password.
  - Full edit access for any past day.
  - The verdict on each person's whole day: Not up to the mark (1 point), Can be better (2), Up to the mark (3), Over performed (4), Extraordinary (5). Clicking the active verdict clears it.
  - Brownies, +1 point each: Overtime, Holiday and Hero. They only unlock once the day is judged.
  - Rows rank by verdict, then brownies. Everyone in the same verdict shares a place, and the order holds still while you judge.
  - **Report** downloads an A4 landscape PDF of the team's day. **Graph** shows standings by verdict or points, per week or month, and each person's record.
- **Super admin (`/admin`)**
  - Signed in for 12 hours. Changing `ADMIN_PASSCODE` signs every super admin out.
  - **Overview:** every team on one board for any day, a per-team summary (logged, judged, brownies), a team filter, combined Graph and Report. The super admin can rate and edit anyone.
  - **Managers:** create, rename, change link names, set new passwords (signs the manager out), turn a team off (hides its links, keeps its history) or delete it (its employees keep their history and move to *No team*).
  - **Employees:** add several at once, move between teams, rename, deactivate. People with logged days can't be deleted, only deactivated.
  - **Settings:** the backfill window for team boards (today only, the last 7 days, or from a date), and what's connected.

## Develop

```bash
npm install
npx vercel link && npx vercel env pull .env.local   # pulls DATABASE_URL, BLOB_READ_WRITE_TOKEN, ADMIN_PASSCODE
npm run dev          # vercel dev: Vite + the /api function together
npm test             # API tests against an in-memory Postgres (PGlite)
npm run typecheck
```

## API

All routes live in `server/router.ts`. `vercel.json` rewrites `/api/*` to the single function. Writes must be JSON; sign-in cookies are `HttpOnly`, `SameSite=Lax` and `Secure` on HTTPS.

| Method | Route | Who |
| --- | --- | --- |
| GET | `/api/teams` | anyone: active teams, sizes and how many logged today |
| GET | `/api/day?date=&team=&sig=` | anyone for a team; `team=*` (every team) for the super admin. With `sig` it answers `unchanged` when nothing moved |
| GET | `/api/history?from=&team=` | same as `/day` |
| GET | `/api/setup` | anyone: what's configured |
| GET | `/api/auth/session?team=` | who's signed in |
| POST | `/api/auth/admin`, `/api/auth/manager`, `/api/auth/logout` | sign in and out |
| POST | `/api/day/submit` | the team's board (`team=`) within the window, its manager, or the super admin |
| POST | `/api/entries` | same (assign = `assigned: true`) |
| PATCH / DELETE | `/api/entries/:id` | same |
| PUT | `/api/attendance` | same |
| PUT | `/api/marks` | the person's manager, or the super admin |
| GET | `/api/admin/overview` | super admin |
| POST / PATCH / DELETE | `/api/admin/managers(/:id)`, `/api/admin/members(/:id)` | super admin |
| PUT | `/api/admin/settings` | super admin: `{ editableFrom }` |
| POST | `/api/admin/import` | super admin: `{ sourceUrl, sourceKey, scope: 'team' \| 'all', managerId }` |
| POST | `/api/files/upload` | client-upload tokens for Vercel Blob |
| GET | `/api/files?entry=` | streams a private attachment |
