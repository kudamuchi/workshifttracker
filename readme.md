# ShiftTracker

A static (no build step) work-hours tracker: landing page, email/password auth, and an
employee dashboard with shift start/break/end, a live timer, geolocation, and hours stats.
Backend is Supabase (Postgres + Auth). Hosting is Netlify.

## Files

```
index.html               Landing page
login.html                Sign in (redirects by role)
register.html              Create account — choose Employee or Manager
dashboard.html              Employee dashboard (protected)
manager-dashboard.html       Manager dashboard — team roster (protected, managers only)
css/styles.css                All styling
js/supabase-client.js          Supabase connection (URL + anon key)
js/auth.js                      Session guard, role helpers, logout
js/theme.js                      Light/dark toggle
js/dashboard.js                   Employee shift logic, timer, map, stats
js/manager-dashboard.js            Team roster, live status, today's hours
sql/schema.sql                      Database schema — run this in Supabase first
```

## Roles

Every account has a `role` of `employee` or `manager`, chosen at registration:

- **Employees** land on `dashboard.html` — track their own shifts, breaks, and location.
- **Managers** land on `manager-dashboard.html` — a live roster of every employee's
  name, surname, current status (Working / On Break / Not Working), shift start time,
  hours worked today, and last reported location. A "My Shifts" link lets a manager
  also track their own time on `dashboard.html` if they want to.

To promote an existing account to manager without re-registering, run in the SQL editor:
```sql
update public.profiles set role = 'manager' where email = 'someone@example.com';
```

## 1. Set up the database

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Paste the contents of `sql/schema.sql` and run it.
   This creates:
   - `public.profiles` — display name per user, auto-filled on signup via a trigger.
   - `public.shifts` — one row per shift (start/end time, break time, status, lat/lng).
   - `public.shift_summaries` — a view used for the Today/Week/Month stats.
   - Row Level Security policies so each user can only read/write their own rows.
3. Confirm **Authentication → Providers → Email** is enabled (it is by default).
   - For quick local testing you can turn **off** "Confirm email" under
     Authentication → Settings, so `register.html` logs the user straight in.
     Leave it on for production.

The app is already pointed at your project:
- URL: `https://ftrvwsqmmltciedymcmz.supabase.co`
- anon key: set in `js/supabase-client.js`

The anon key is meant to be public — Row Level Security in `schema.sql` is what actually
protects the data, so nothing else needs to be hidden.

## 2. Run it locally

No build step needed. From this folder:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## 3. Deploy to Netlify

**Option A — drag and drop**
Go to [app.netlify.com/drop](https://app.netlify.com/drop) and drag this whole folder in.

**Option B — Netlify CLI**
```bash
npm install -g netlify-cli
netlify deploy --prod --dir .
```

**Option C — Git**
Push this folder to a GitHub repo, then in Netlify: **Add new site → Import an existing
project**, pick the repo, leave the build command empty and the publish directory as `.`.

No environment variables are required — the Supabase URL/key are already in
`js/supabase-client.js`.

## How the dashboard works

- **Start Shift** grabs your browser geolocation (if allowed) and inserts a `shifts` row
  with `status = 'working'`.
- **Take Break** sets `status = 'on_break'` and stamps `break_started_at`; the working
  timer freezes and the break timer starts counting.
- **Resume Shift** folds the elapsed break time into `total_break_seconds` and goes back
  to `working`.
- **End Shift** stamps `ended_at` (folding in any in-progress break first) and sets
  `status = 'ended'`. Completed shifts feed the Today/This Week/This Month stats via the
  `shift_summaries` view (`worked_seconds = (ended_at - started_at) - total_break_seconds`).
- **Update Location** re-reads your position and updates the map/lat/lng, and the shift
  row if one is active.
- The theme toggle (sun icon) switches a `data-theme` attribute between light/dark,
  remembered in `localStorage`.

## How the manager dashboard works

- `sql/schema.sql` adds an `employee_status` view that joins each profile to its most
  recent shift, and a `shift_summaries` view for completed-shift hours — both respect
  Row Level Security, so a manager sees every row and an employee still only sees their own.
- `manager-dashboard.html` is guarded by `requireRole("manager")`; anyone else who opens
  it is redirected straight to their own `dashboard.html`.
- The roster refreshes every 20 seconds (and on the Refresh button) with each employee's
  name, surname, live status, shift start time, hours worked today, and a link to their
  last reported location on Google Maps.
