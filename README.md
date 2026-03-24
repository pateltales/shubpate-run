# run.pateltales.com

Personal running & riding portfolio built on Strava data. Static site hosted on GitHub Pages.

---

## Syncing Data from Strava

Data is fetched via the Strava API using `fetch-strava.mjs`. This script handles the full OAuth flow locally — you run it once, authorize in your browser, and it writes everything to `strava-data.json`.

### Prerequisites

- Node.js 18+
- A Strava API app (already configured — client ID `215721` is in the script)

### Steps

```bash
node fetch-strava.mjs
```

1. A local server starts on port 8080 and your browser opens the Strava authorization page automatically.
2. Click **Authorize** in Strava.
3. The script exchanges the auth code for a token, then fetches:
   - Your athlete profile (name, photo, city)
   - Every activity you've ever recorded (paginated, 100 per request)
4. Output is written to `strava-data.json`.

### Then commit and push

```bash
git add strava-data.json
git commit -m "Sync Strava data $(date +%Y-%m-%d)"
git push
```

GitHub Pages picks up the new JSON and the site updates automatically. No build step needed.

### What gets fetched

| Field | Description |
|---|---|
| `athlete` | Name, profile photo URL, city/state/country |
| `run_stats` | Total runs, total miles, total races, years active |
| `ride_stats` | Total rides, total miles, years active |
| `prs` | Best pace projected to standard distances (5K, 10K, HM, Marathon) |
| `runs` | All runs — id, name, date, distance, pace, HR, elevation, race flag, etc. |
| `rides` | All rides — id, name, date, distance, speed, elevation, etc. |

**Activity type filtering:**
- Runs: `Run`, `TrailRun`, `VirtualRun`
- Rides: `Ride`, `VirtualRide`, `EBikeRide`, `MountainBikeRide`, `GravelRide`, `Handcycle`, `Velomobile`

**PR calculation:** Uses pace (sec/mile), not raw time. The fastest pace from all runs in a distance category is projected to the exact standard distance. This matches how Strava calculates PRs.

---

## Project Structure

```
shubpate-run/
├── index.html          # Entire website (HTML + CSS + JS, single file)
├── strava-data.json    # Fetched Strava data — source of truth for the site
├── fetch-strava.mjs    # Node.js script to pull fresh data from Strava API
├── CNAME               # run.pateltales.com — GitHub Pages custom domain
└── README.md           # This file
```

---

## Site Architecture

The site is a **single static HTML file** — no framework, no build tooling. It loads `strava-data.json` at runtime via `fetch()` and renders everything in the browser.

### Dependencies (CDN only)

| Library | Version | Purpose |
|---|---|---|
| Chart.js | 4.4.0 | All charts |
| Google Fonts | — | Playfair Display, Space Grotesk, Inter, IBM Plex Mono |

### Page Sections (top → bottom)

| Section | ID | Description |
|---|---|---|
| Nav | `nav` | Logo, page links, last-run pill |
| Hero | `#hero` | Full-bleed race photo background, name, headline stats, run/ride mode toggle |
| Fun Facts | `#facts` | Computed trivia — marathons equivalent, coast-to-coast crossings, Everest climbs, days on feet |
| Gallery | `#gallery` | Race photos from S3, masonry grid, full-screen lightbox |
| PRs | `#prs` | Personal records (5K / 10K / Half / Full) — hidden in ride mode |
| Progress Charts | `#progress` | 6 charts (see below) — all update on mode/period change |
| Activity Calendar | `#activity` | GitHub-style heatmap, last 52 weeks, shows runs + rides simultaneously |
| Achievements | `#achievements` | Auto-computed milestone badges |
| Run / Ride Log | `#log` | Full paginated table with search, year filter, distance filter, sortable columns |
| Footer | — | Links to pateltales.com and Strava |

### Charts

All charts respond to the **Run / Ride mode toggle**. The first row also responds to the **period tabs** (Last 60 Days / Last 12 Months / Last 10 Years).

| Chart | Type | What it shows |
|---|---|---|
| Miles + Elevation | Bar + Line (dual axis) | Volume bars (left axis) overlaid with elevation gain line (right axis) |
| Cumulative Miles by Year | Multi-line | Running total of miles per day-of-year, one line per year — current year highlighted |
| Pace / Speed Over Time | Scatter + Line | Every run as a dot, 25-run rolling average as a smooth line. Y-axis inverted so faster = higher |
| Heart Rate Zones | Doughnut | Distribution of runs across Z1–Z5 HR zones (runs with HR data only) |
| Distance Distribution | Horizontal Bar | Count of runs/rides per distance category |

### JavaScript State

```js
let app      // the full strava-data.json object
let mode     // 'run' | 'ride' — toggled by the mode buttons
let period   // 'daily' | 'monthly' | 'yearly' — toggled by period tabs
```

`setMode(m)` switches between run and ride views — updates body class (CSS accent color), chart colors, log columns, and all chart data.

`setPeriod(p)` rebuilds the volume + elevation chart for the selected time window.

### Photo Gallery

Race photos are hosted on AWS S3 (`pateltales-photography` bucket, `us-east-run/` prefix, public read). The `PHOTOS` array in `index.html` lists each filename and caption. To add a new photo:

1. Upload the image to `s3://pateltales-photography/shubpate-run/`
2. Add an entry to the `PHOTOS` array in `index.html`:
   ```js
   { file: 'your-photo.jpg', caption: 'Race Name · Year' }
   ```
3. URL-encode any spaces or parentheses in the filename (space → `%20`, `(` → `%28`, `)` → `%29`).
4. Commit and push.

The gallery grid layout adjusts automatically — the first photo spans the full height (good for portrait/vertical shots), remaining photos fill the grid.

---

## Hosting

- **Platform:** GitHub Pages (`pateltales/shubpate-run` repo, `main` branch)
- **Domain:** `run.pateltales.com` (CNAME → `pateltales.github.io`)
- **DNS:** Managed at Namecheap
- **No CI/CD needed** — push to `main` and GitHub Pages deploys in ~30 seconds
