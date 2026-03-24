import http from 'http';
import { exec } from 'child_process';
import https from 'https';
import fs from 'fs';

const CLIENT_ID = '215721';
const CLIENT_SECRET = 'd47281e1f96758dc9591bae5542647a81aa1a1fe';
const REDIRECT_URI = 'http://localhost:8080/callback';
const AUTH_URL = `https://www.strava.com/oauth/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${REDIRECT_URI}&approval_prompt=force&scope=activity:read_all`;

function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
    }, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => resolve(JSON.parse(raw)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpsGet(url, token) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Authorization: `Bearer ${token}` } }, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => resolve(JSON.parse(raw)));
    }).on('error', reject);
  });
}

async function fetchAllActivities(token) {
  let page = 1, all = [];
  while (true) {
    const batch = await httpsGet(
      `https://www.strava.com/api/v3/athlete/activities?per_page=100&page=${page}`,
      token
    );
    if (!batch.length) break;
    all = all.concat(batch);
    console.log(`  Fetched page ${page} (${batch.length} activities)...`);
    page++;
  }
  return all;
}

async function fetchAthlete(token) {
  return httpsGet('https://www.strava.com/api/v3/athlete', token);
}

function waitForCode() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost:8080');
      const code = url.searchParams.get('code');
      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h2>Authorization successful! You can close this tab.</h2>');
        server.close();
        resolve(code);
      } else {
        res.writeHead(400);
        res.end('Missing code');
      }
    });
    server.listen(8080, () => {
      console.log('\nOpening Strava authorization in your browser...');
      exec(`open "${AUTH_URL}"`);
      console.log('If the browser does not open, visit:\n' + AUTH_URL);
    });
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function metersToMiles(m) { return parseFloat((m / 1609.344).toFixed(2)); }

function secondsToPace(seconds, meters) {
  const secsPerMile = seconds / (meters / 1609.344);
  const m = Math.floor(secsPerMile / 60);
  const s = Math.round(secsPerMile % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function speedMph(seconds, meters) {
  const miles = meters / 1609.344;
  const hours = seconds / 3600;
  return parseFloat((miles / hours).toFixed(1));
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = (seconds % 60).toString().padStart(2, '0');
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function classifyRunDistance(meters) {
  const miles = meters / 1609.344;
  if (miles >= 25) return 'marathon';
  if (miles >= 12) return 'half_marathon';
  if (miles >= 9) return '15k';
  if (miles >= 5.5) return '10k';
  if (miles >= 2.8) return '5k';
  return 'other';
}

function classifyRideDistance(meters) {
  const miles = meters / 1609.344;
  if (miles >= 100) return 'century';
  if (miles >= 50) return 'gran_fondo';
  if (miles >= 25) return 'long';
  if (miles >= 10) return 'medium';
  return 'short';
}

function formatActivity(a, type) {
  const base = {
    id: a.id,
    name: a.name,
    type,
    date: a.start_date.split('T')[0],
    distance_miles: metersToMiles(a.distance),
    distance_meters: a.distance,
    moving_time: a.moving_time,
    elapsed_time: a.elapsed_time,
    time_formatted: formatTime(a.moving_time),
    elevation_gain_ft: Math.round(a.total_elevation_gain * 3.28084),
    average_heartrate: a.average_heartrate || null,
    max_heartrate: a.max_heartrate || null,
    is_race: a.workout_type === 1,
    location: a.location_city ? `${a.location_city}, ${a.location_state || a.location_country}` : null,
    start_lat: a.start_latlng?.[0] || null,
    start_lng: a.start_latlng?.[1] || null,
    kudos: a.kudos_count,
    photos: a.total_photo_count,
    strava_url: `https://www.strava.com/activities/${a.id}`
  };

  if (type === 'run') {
    return {
      ...base,
      pace: secondsToPace(a.moving_time, a.distance),
      distance_category: classifyRunDistance(a.distance),
    };
  } else {
    return {
      ...base,
      speed_mph: speedMph(a.moving_time, a.distance),
      distance_category: classifyRideDistance(a.distance),
    };
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────
(async () => {
  const code = await waitForCode();
  console.log('\nExchanging code for token...');

  const tokenRes = await httpsPost('https://www.strava.com/oauth/token', {
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    code, grant_type: 'authorization_code'
  });

  if (!tokenRes.access_token) {
    console.error('Token error:', tokenRes);
    process.exit(1);
  }

  const token = tokenRes.access_token;
  console.log('Token obtained!\n');

  console.log('Fetching athlete profile...');
  const athlete = await fetchAthlete(token);

  console.log('Fetching all activities...');
  const activities = await fetchAllActivities(token);

  // Separate runs and rides by sport_type (authoritative), fall back to type
  const RUN_TYPES  = new Set(['Run', 'TrailRun', 'VirtualRun']);
  const RIDE_TYPES = new Set(['Ride', 'VirtualRide', 'EBikeRide', 'MountainBikeRide', 'GravelRide', 'Handcycle', 'Velomobile']);

  const rawRuns  = activities.filter(a => RUN_TYPES.has(a.sport_type  || a.type));
  const rawRides = activities.filter(a => RIDE_TYPES.has(a.sport_type || a.type));

  console.log(`\nTotal activities: ${activities.length}`);
  console.log(`  Runs:  ${rawRuns.length}`);
  console.log(`  Rides: ${rawRides.length}`);

  // Run PRs
  const prCategories = { '5k': [], '10k': [], 'half_marathon': [], 'marathon': [] };
  rawRuns.forEach(r => {
    const cat = classifyRunDistance(r.distance);
    if (prCategories[cat]) {
      prCategories[cat].push({ time: r.moving_time, date: r.start_date, name: r.name });
    }
  });
  const prs = {};
  for (const [dist, efforts] of Object.entries(prCategories)) {
    if (efforts.length) {
      const best = efforts.reduce((a, b) => a.time < b.time ? a : b);
      prs[dist] = { time: formatTime(best.time), date: best.date.split('T')[0], name: best.name };
    }
  }

  // Stats
  const runMiles  = rawRuns.reduce((s, r)  => s + r.distance, 0) / 1609.344;
  const rideMiles = rawRides.reduce((s, r) => s + r.distance, 0) / 1609.344;

  const output = {
    athlete: {
      name: `${athlete.firstname} ${athlete.lastname}`,
      username: athlete.username,
      profile_photo: athlete.profile,
      city: athlete.city,
      state: athlete.state,
      country: athlete.country,
    },
    run_stats: {
      total_runs: rawRuns.length,
      total_miles: parseFloat(runMiles.toFixed(1)),
      total_races: rawRuns.filter(r => r.workout_type === 1).length,
      years_active: [...new Set(rawRuns.map(r => r.start_date.split('-')[0]))].length,
    },
    ride_stats: {
      total_rides: rawRides.length,
      total_miles: parseFloat(rideMiles.toFixed(1)),
      years_active: [...new Set(rawRides.map(r => r.start_date.split('-')[0]))].length,
    },
    prs,
    runs:  rawRuns.map(a  => formatActivity(a, 'run')),
    rides: rawRides.map(a => formatActivity(a, 'ride')),
  };

  fs.writeFileSync('strava-data.json', JSON.stringify(output, null, 2));
  console.log('\nDone! Data saved to strava-data.json');
  console.log(`  Athlete:     ${output.athlete.name}`);
  console.log(`  Run miles:   ${output.run_stats.total_miles}`);
  console.log(`  Ride miles:  ${output.ride_stats.total_miles}`);
  console.log(`  Run PRs:     ${Object.keys(prs).map(k => `${k}: ${prs[k].time}`).join(', ')}`);
})();
