# Right Time

A free iPhone app for train drivers to log each run and track how often they're early, on time or late.

It's a Progressive Web App (PWA): it installs from Safari onto the home screen, opens full-screen like a normal app, and works offline. No App Store, no account, no cost.

## What it does

- **Log a run**: date, headcode, from/to, and booked vs actual arrival (departure optional). A **Now** button fills in the current time. It shows instantly whether you were early, right time or late.
- **Remembers services**: type a headcode you've driven before and it fills in the route and booked times.
- **Delay reasons**: when a run is late, choose why (signalling, train in front, dispatch, etc.).
- **Stats** by week, month, year or all time:
  - % early or on time, with early / on time / late counts
  - average minutes early/late, and the current on-time streak
  - most early and most late runs, and total minutes early and late
  - a chart of recent runs (tap a bar for details)
  - top reasons for being late, and performance by route
- **History**: grouped by day and searchable. Tap a run to edit or delete it.
- **On-time rule**: choose what counts as on time (right time, or within 1, 2, 3, 5 or 10 minutes).
- **Backup**: export a JSON backup or a CSV for spreadsheets, and restore from a backup.

All data stays on the phone (browser storage). Nothing is sent anywhere.

## Putting it on the iPhone

The app is just static files (`index.html`, `app.js`, `style.css`, `sw.js`, `manifest.webmanifest`, `icons/`), so any free static host works. Pick one:

### Option A: GitHub Pages (needs the repo to be public)
GitHub Pages is only free for **public** repositories. The code contains no personal data, so making it public is safe; her logged runs stay on her phone.
1. Repo **Settings → General → Danger Zone → Change visibility → Public**.
2. **Settings → Pages**: under *Build and deployment*, choose **Deploy from a branch**, pick the branch (`main` once merged) and the `/ (root)` folder, then **Save**.
3. After a minute it's live at `https://cameronlarge-bloomreach.github.io/Cameron-Rail-App/`.

### Option B: Netlify or Cloudflare Pages (works with a private repo)
- **Netlify Drop** (quickest): download this repo as a ZIP, unzip it, and drag the folder onto <https://app.netlify.com/drop>. You get a free URL instantly.
- **Cloudflare Pages / Netlify** can also connect to the private GitHub repo (free) and redeploy automatically on every push. Use no build command, and set the output directory to `/`.

### Then on her iPhone
1. Open the URL in **Safari** (it must be Safari).
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open **Right Time** from the home screen.

## Good to know
- **Back up now and then** (Settings → Export backup), especially before changing phones. The data lives only on that phone.
- Log runs after stopping, never while driving.
- To try it on a computer: `python3 -m http.server` in this folder, then open <http://localhost:8000>.
