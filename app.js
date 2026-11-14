'use strict';

/* =========================================================================
   Right Time — track a train live on a map, and log punctuality.
   ========================================================================= */

/* ---------- Storage ---------- */
const STORE_KEY = 'righttime.runs.v1';
const SETTINGS_KEY = 'righttime.settings.v1';

function load(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { toast('Could not save. Storage may be full.'); return false; }
}

let runs = load(STORE_KEY, []);
let settings = Object.assign({
  tolerance: 0, period: 'month', relay: '', railOverlay: true, recentStations: [], tracked: null
}, load(SETTINGS_KEY, {}));
const persistRuns = () => save(STORE_KEY, runs);
const persistSettings = () => save(SETTINGS_KEY, settings);

/* ---------- Generic helpers ---------- */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => isoDate(new Date());
const nowHHMM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const toMins = t => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const hhmm = mins => { if (mins == null) return ''; const m = ((Math.floor(mins) % 1440) + 1440) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
}

// Minutes late (+) or early (−) between two "HH:MM" strings, across midnight.
function diffMins(booked, actual) {
  const b = toMins(booked), a = toMins(actual);
  if (b == null || a == null) return null;
  let d = a - b;
  if (d > 720) d -= 1440;
  if (d < -720) d += 1440;
  return d;
}
function classify(d) {
  if (d == null) return null;
  if (d < 0) return 'early';
  if (d <= Number(settings.tolerance)) return 'ontime';
  return 'late';
}
function describe(d) {
  if (d == null) return '';
  if (d === 0) return 'Right time';
  const n = Math.abs(d);
  return `${n} min${n === 1 ? '' : 's'} ${d < 0 ? 'early' : 'late'}`;
}
function shortDiff(d) {
  if (d == null) return '–';
  if (d === 0) return 'RT';
  return d < 0 ? `${d}` : `+${d}`;
}
const fmtDate = iso => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtDateShort = iso => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/* ---------- Stations ---------- */
let STATIONS = {};          // CRS -> [name, lat, lon]
let STATION_LIST = [];      // [{crs, name, lc}]
const stationsReady = fetch('data/stations.json')
  .then(r => r.json())
  .then(data => {
    STATIONS = data;
    STATION_LIST = Object.entries(data).map(([crs, [name]]) => ({ crs, name, lc: name.toLowerCase() }))
      .sort((a, b) => a.name.localeCompare(b.name));
  })
  .catch(() => {});

/* =========================================================================
   Navigation
   ========================================================================= */
const TITLES = { find: 'Find a train', stats: 'Stats', runs: 'Runs', log: 'Log a run', settings: 'Settings' };
let currentView = 'map';
let lastTab = 'map';

function show(view) {
  currentView = view;
  if (['map', 'find', 'stats', 'runs'].includes(view)) lastTab = view;
  document.body.dataset.view = view;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
  const tab = view === 'log' ? 'runs' : view === 'settings' ? lastTab : view;
  $$('.tabbar button').forEach(b => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const editing = view === 'log' && $('#log-form').id.value;
  $('#screen-title').textContent = editing ? 'Edit run' : (TITLES[view] || '');
  $('#back-btn').hidden = !(view === 'log' || view === 'settings');
  $('#settings-btn').hidden = view === 'log' || view === 'settings';

  if (view === 'map') { requestAnimationFrame(() => { map.invalidateSize(); updateSheetHeight(); }); }
  if (view === 'find') renderRecentStations();
  if (view === 'stats') renderStats();
  if (view === 'runs') renderHistory();
  if (view === 'settings') renderSettings();
  if (view !== 'map') window.scrollTo(0, 0);
}

$$('.tabbar button').forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
$('#back-btn').addEventListener('click', () => show(currentView === 'log' ? 'runs' : lastTab));
$('#settings-btn').addEventListener('click', () => show('settings'));
$('#map-settings').addEventListener('click', () => show('settings'));
$('#map-search').addEventListener('click', () => show('find'));
$('#idle-find').addEventListener('click', () => show('find'));

/* =========================================================================
   Map
   ========================================================================= */
const map = L.map('map', { zoomControl: false, attributionControl: true }).setView([54.3, -2.3], 6);
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  subdomains: 'abcd', maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
}).addTo(map);
const railLayer = L.tileLayer('https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', {
  subdomains: 'abc', maxZoom: 19, opacity: 0.7,
  attribution: '&copy; <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a>'
});
if (settings.railOverlay) railLayer.addTo(map);

const routeLayer = L.layerGroup().addTo(map);
let trainMarker = null;
let following = true;
let fittedFor = null;

map.on('dragstart', () => { following = false; $('#follow-btn').hidden = !live.svc; });
$('#follow-btn').addEventListener('click', () => {
  following = true; $('#follow-btn').hidden = true;
  if (live.pos) map.flyTo(live.pos.latlng, Math.max(map.getZoom(), 11), { duration: 0.6 });
});

function updateSheetHeight() {
  const h = $('#sheet').offsetHeight;
  document.documentElement.style.setProperty('--sheet-h', `${h}px`);
  $$('.leaflet-bottom').forEach(el => { el.style.bottom = `${h}px`; });
  return h;
}
window.addEventListener('resize', () => { if (currentView === 'map') updateSheetHeight(); });

/* =========================================================================
   Live data (Realtime Trains via the relay)
   ========================================================================= */
class ApiError extends Error {
  constructor(kind, status) { super(kind); this.kind = kind; this.status = status; }
}
async function api(path) {
  const base = (settings.relay || '').trim().replace(/\/+$/, '');
  if (!base) throw new ApiError('norelay');
  let res;
  try { res = await fetch(base + path, { cache: 'no-store' }); }
  catch { throw new ApiError(navigator.onLine === false ? 'offline' : 'network'); }
  let body = null;
  try { body = await res.json(); } catch { /* ignore */ }
  if (!res.ok || (body && body.error)) {
    throw new ApiError(res.status === 401 || res.status === 403 ? 'auth' : res.status === 404 ? 'notfound' : 'http', res.status);
  }
  return body;
}
function apiErrorText(err) {
  switch (err && err.kind) {
    case 'norelay': return 'Live data isn\'t set up on this phone yet. Add your relay address in Settings, or try the demo.';
    case 'offline': return 'No internet connection. It will try again shortly.';
    case 'network': return 'Couldn\'t reach the relay. Check the address in Settings.';
    case 'auth': return 'The relay\'s Realtime Trains login was rejected. Check the username and password secrets on the relay.';
    case 'notfound': return 'Realtime Trains has no data for that.';
    default: return 'Something went wrong getting live data. It will try again shortly.';
  }
}

// RTT times: "1015", "101530", or working-timetable "1015H" (half minute).
function rttMins(t) {
  if (!t || typeof t !== 'string') return null;
  const h = +t.slice(0, 2), m = +t.slice(2, 4);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  let v = h * 60 + m;
  if (/^\d{6}$/.test(t)) v += +t.slice(4, 6) / 60;
  if (t.endsWith('H')) v += 0.5;
  return v;
}

/* Turn an RTT service into something easy to draw. Times become minutes from
   the run date's midnight, so trains that run past midnight still work. */
function parseService(raw) {
  if (!raw || !Array.isArray(raw.locations) || !raw.locations.length) throw new ApiError('notfound');
  let base = null;
  const norm = v => {
    if (v == null) return null;
    if (base == null) base = v;
    return v < base - 360 ? v + 1440 : v;
  };
  const locs = raw.locations.map(l => {
    const bArrRaw = rttMins(l.gbttBookedArrival || l.wttBookedArrival);
    const bDepRaw = rttMins(l.gbttBookedDeparture || l.wttBookedDeparture || l.wttBookedPass);
    const pass = l.displayAs === 'PASS' || (bArrRaw == null && !l.gbttBookedDeparture && !l.wttBookedDeparture && !!l.wttBookedPass);
    const st = l.crs && STATIONS[l.crs];
    const L0 = {
      name: l.description || l.tiploc || '?',
      crs: l.crs || null,
      coord: st ? [st[1], st[2]] : null,
      pass,
      cancelled: /CANCEL/.test(l.displayAs || ''),
      platform: l.platform || '',
      serviceLocation: l.serviceLocation || null,
      bArr: norm(bArrRaw),
      bDep: norm(bDepRaw),
      rArr: norm(rttMins(l.realtimeArrival)),
      rDep: norm(rttMins(l.realtimeDeparture || l.realtimePass)),
      aArr: !!l.realtimeArrivalActual,
      aDep: !!(l.realtimeDepartureActual || l.realtimePassActual),
    };
    if (L0.rArr == null) L0.rArr = L0.bArr;
    if (L0.rDep == null) L0.rDep = L0.bDep;
    return L0;
  });
  const first = locs[0], last = locs[locs.length - 1];
  return {
    uid: raw.serviceUid,
    date: raw.runDate,
    headcode: raw.trainIdentity || raw.runningIdentity || '',
    operator: raw.atocName || '',
    origin: (raw.origin && raw.origin[0] && raw.origin[0].description) || first.name,
    destination: (raw.destination && raw.destination[0] && raw.destination[0].description) || last.name,
    locs,
  };
}

// Delay (minutes) at a calling point, using the most meaningful pair of times.
// [booked, real] for a stop: departure once it has left (or at the origin),
// otherwise arrival.
function stopTimes(L, i, n) {
  if (i === n - 1) return [L.bArr ?? L.bDep, L.bArr != null ? L.rArr : L.rDep];
  if (i === 0 || L.pass || L.aDep || L.bArr == null) return [L.bDep ?? L.bArr, L.bDep != null ? L.rDep : L.rArr];
  return [L.bArr, L.rArr];
}
function locDelay(L, i, n) {
  const [bk, rt] = stopTimes(L, i, n);
  return bk != null && rt != null ? Math.round(rt - bk) : null;
}

function minsSinceRunDate(dateISO) {
  const mid = new Date(dateISO + 'T00:00:00');
  return (Date.now() - mid.getTime()) / 60000;
}

/* Work out where the train is now. */
function trainState(svc) {
  const locs = svc.locs, n = locs.length;
  const now = minsSinceRunDate(svc.date);
  const geoBefore = i => { for (let k = i; k >= 0; k--) if (locs[k].coord && !locs[k].cancelled) return k; return -1; };
  const geoAfter = i => { for (let k = i; k < n; k++) if (locs[k].coord && !locs[k].cancelled) return k; return -1; };
  const between = (a, b, fixed) => {
    const ga = geoBefore(a), gb = geoAfter(b);
    if (ga < 0 && gb < 0) return { kind: 'unknown' };
    if (ga < 0) return { kind: 'between', from: a, to: b, latlng: locs[gb].coord, geoFrom: gb, geoTo: gb };
    if (gb < 0) return { kind: 'between', from: a, to: b, latlng: locs[ga].coord, geoFrom: ga, geoTo: ga };
    let p = fixed;
    if (p == null) {
      const t0 = locs[ga].rDep ?? locs[ga].rArr, t1 = locs[gb].rArr ?? locs[gb].rDep;
      p = (t0 != null && t1 != null && t1 > t0) ? (now - t0) / (t1 - t0) : 0.5;
    }
    p = Math.min(0.97, Math.max(0.03, p));
    const [la, lo] = locs[ga].coord, [lb, lob] = locs[gb].coord;
    return { kind: 'between', from: a, to: b, geoFrom: ga, geoTo: gb, latlng: [la + (lb - la) * p, lo + (lob - lo) * p] };
  };
  const at = i => {
    const g = locs[i].coord ? i : geoBefore(i);
    return { kind: 'at', idx: i, latlng: g >= 0 ? locs[g].coord : null, geoFrom: g, geoTo: g };
  };

  if (locs.every(l => l.cancelled || l.pass)) return { kind: 'cancelled' };

  // Prefer the live "where is it" marker if Realtime Trains gives one.
  const here = locs.findIndex(l => l.serviceLocation);
  if (here >= 0) {
    const sl = locs[here].serviceLocation;
    if (/^APPR/.test(sl)) {
      let prev = here - 1; while (prev > 0 && !(locs[prev].aDep || locs[prev].aArr)) prev--;
      return between(Math.max(prev, 0), here, 0.85);
    }
    return at(here);
  }

  let last = -1;
  locs.forEach((l, i) => { if (l.aArr || l.aDep) last = i; });
  if (last < 0) return Object.assign(at(0), { kind: 'notstarted' });
  if (last === n - 1 && locs[last].aArr) return Object.assign(at(last), { kind: 'arrived' });
  const L0 = locs[last];
  if (L0.aDep || (L0.pass && L0.aArr)) {
    let next = last + 1;
    while (next < n - 1 && (locs[next].cancelled)) next++;
    return between(last, next);
  }
  return at(last);
}

/* ---------- Demo service (works without any setup) ---------- */
let demoStart = null;
function demoService() {
  if (demoStart == null) demoStart = minsSinceRunDate(todayISO()) - 37;
  const now = minsSinceRunDate(todayISO());
  const stops = [
    // crs, name, booked arr offset, booked dep offset, delay arr, delay dep, platform
    ['LDS', 'Leeds', null, 0, null, 1, '12'],
    ['YRK', 'York', 23, 25, 2, 3, '5'],
    ['NTR', 'Northallerton', 44, 45, 4, 4, '1'],
    ['DAR', 'Darlington', 56, 58, 3, 3, '1'],
    ['DHM', 'Durham', 75, 76, 2, 2, '2'],
    ['NCL', 'Newcastle', 90, null, 1, null, '3'],
  ];
  const T = m => { const v = ((Math.round(m) % 1440) + 1440) % 1440; return `${pad(Math.floor(v / 60))}${pad(v % 60)}`; };
  const locations = stops.map(([crs, name, ba, bd, da, dd, plat], i) => {
    const l = { tiploc: crs, crs, description: name, platform: plat, isPublicCall: true,
      displayAs: i === 0 ? 'ORIGIN' : i === stops.length - 1 ? 'DESTINATION' : 'CALL' };
    if (ba != null) {
      const real = demoStart + ba + da;
      Object.assign(l, { gbttBookedArrival: T(demoStart + ba), realtimeArrival: T(real), realtimeArrivalActual: real <= now });
    }
    if (bd != null) {
      const real = demoStart + bd + dd;
      Object.assign(l, { gbttBookedDeparture: T(demoStart + bd), realtimeDeparture: T(real), realtimeDepartureActual: real <= now });
    }
    return l;
  });
  return {
    serviceUid: 'DEMO', runDate: todayISO(), trainIdentity: '1N99', atocName: 'Demo service',
    origin: [{ description: 'Leeds' }], destination: [{ description: 'Newcastle' }], locations
  };
}

/* =========================================================================
   Live tracking
   ========================================================================= */
const live = { svc: null, pos: null, timer: null, updatedAt: 0, error: null, loading: false };

function startTracking(uid, date) {
  settings.tracked = { uid, date };
  persistSettings();
  live.svc = null; live.pos = null; live.error = null;
  fittedFor = null; following = true;
  if (uid !== 'DEMO') demoStart = null;
  show('map');
  renderSheet();
  refreshLive();
}

function stopTracking() {
  settings.tracked = null; persistSettings();
  clearTimeout(live.timer);
  live.svc = null; live.pos = null; live.error = null;
  routeLayer.clearLayers();
  if (trainMarker) { trainMarker.remove(); trainMarker = null; }
  $('#follow-btn').hidden = true;
  $('#map-search-label').textContent = 'Find a train';
  renderSheet();
}

async function refreshLive() {
  clearTimeout(live.timer);
  const t = settings.tracked;
  if (!t) return;
  live.loading = true; renderMeta();
  try {
    await stationsReady;
    let raw;
    if (t.uid === 'DEMO') raw = demoService();
    else {
      const [y, m, d] = t.date.split('-');
      raw = await api(`/service/${encodeURIComponent(t.uid)}/${y}/${m}/${d}`);
    }
    live.svc = parseService(raw);
    live.error = null;
    live.updatedAt = Date.now();
  } catch (err) {
    live.error = err;
  }
  live.loading = false;
  drawLive();
  renderSheet();
  scheduleRefresh();
}

function scheduleRefresh() {
  clearTimeout(live.timer);
  if (!settings.tracked) return;
  const arrived = live.pos && (live.pos.kind === 'arrived' || live.pos.kind === 'cancelled');
  const ms = settings.tracked.uid === 'DEMO' ? 10000 : arrived ? 120000 : 30000;
  live.timer = setTimeout(() => { if (document.visibilityState === 'visible') refreshLive(); else scheduleRefresh(); }, ms);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && settings.tracked && Date.now() - live.updatedAt > 15000) refreshLive();
});
$('#live-refresh').addEventListener('click', refreshLive);

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function drawLive() {
  routeLayer.clearLayers();
  const svc = live.svc;
  if (!svc) return;
  const state = trainState(svc);
  live.pos = state;
  const locs = svc.locs, n = locs.length;
  const geo = locs.map((l, i) => ({ l, i })).filter(x => x.l.coord && !x.l.cancelled);
  if (!geo.length) return;

  const doneColor = cssVar('--brand-line') || '#14365c';
  const todoColor = '#8a8984';
  const splitAt = state.geoFrom != null && state.geoFrom >= 0 ? state.geoFrom : (state.kind === 'notstarted' ? 0 : -1);

  const donePts = geo.filter(x => x.i <= splitAt).map(x => x.l.coord);
  const todoPts = geo.filter(x => x.i > splitAt).map(x => x.l.coord);
  if (state.latlng && state.kind === 'between') { donePts.push(state.latlng); todoPts.unshift(state.latlng); }
  else if (donePts.length && todoPts.length) todoPts.unshift(donePts[donePts.length - 1]);

  if (todoPts.length > 1) L.polyline(todoPts, { color: todoColor, weight: 4, opacity: 0.8, dashArray: '2 8', lineCap: 'round' }).addTo(routeLayer);
  if (donePts.length > 1) L.polyline(donePts, { color: doneColor, weight: 5, opacity: 0.95, lineCap: 'round' }).addTo(routeLayer);

  const colors = { early: cssVar('--early'), ontime: cssVar('--ontime'), late: cssVar('--late') };
  geo.forEach(({ l, i }) => {
    if (l.pass) return;
    const reached = l.aArr || l.aDep;
    const d = locDelay(l, i, n);
    const fill = reached ? colors[classify(d)] || colors.ontime : '#ffffff';
    const end = i === 0 || i === n - 1;
    L.circleMarker(l.coord, {
      radius: end ? 8 : 6, weight: 2.5, color: reached ? '#ffffff' : todoColor, fillColor: fill, fillOpacity: 1
    }).bindPopup(stationPopup(l, i, n), { closeButton: false, className: 'station-tip' }).addTo(routeLayer);
  });

  if (state.latlng) {
    const d = currentDelay(svc, state);
    const late = classify(d) === 'late';
    const html = `<div class="train-pin${late ? ' late' : ''}"><span class="train-dot"><svg viewBox="0 0 24 24"><path d="M12 2c-4 0-7 .5-7 4v9.5A3.5 3.5 0 008.5 19L7 20.5v.5h2.2l2-2h1.6l2 2H17v-.5L15.5 19a3.5 3.5 0 003.5-3.5V6c0-3.5-3-4-7-4zM8 15a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm8 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm1-6H7V6h10v3z"/></svg></span><span class="train-tag">${esc(svc.headcode || 'Train')}</span></div>`;
    const icon = L.divIcon({ className: 'train-icon', html, iconSize: [0, 0] });
    if (!trainMarker) trainMarker = L.marker(state.latlng, { icon, zIndexOffset: 1000 }).addTo(map);
    else { trainMarker.setLatLng(state.latlng); trainMarker.setIcon(icon); }
  } else if (trainMarker) { trainMarker.remove(); trainMarker = null; }

  const key = svc.uid + svc.date;
  updateSheetHeight();
  const sheetH = $('#sheet').offsetHeight;
  if (fittedFor !== key) {
    fittedFor = key;
    map.fitBounds(L.latLngBounds(geo.map(x => x.l.coord)), { paddingTopLeft: [30, 90], paddingBottomRight: [30, sheetH + 30], maxZoom: 13 });
  } else if (following && state.latlng) {
    map.panTo(state.latlng, { animate: true });
  }
}

function stationPopup(l, i, n) {
  const d = locDelay(l, i, n);
  const reached = l.aArr || l.aDep;
  const [bk, rt] = stopTimes(l, i, n);
  return `<strong>${esc(l.name)}</strong>${l.platform ? ` · plat ${esc(l.platform)}` : ''}<br>` +
    `Booked ${hhmm(bk)} · ${reached ? 'actual' : 'expected'} ${hhmm(rt)}` +
    (d != null ? `<br>${esc(describe(d))}` : '');
}

function currentDelay(svc, state) {
  const n = svc.locs.length;
  let idx = state.idx ?? state.from ?? 0;
  if (state.kind === 'between') idx = state.from;
  if (state.kind === 'arrived') idx = n - 1;
  const L0 = svc.locs[idx];
  return L0 ? locDelay(L0, idx, n) : null;
}

function nextStop(svc, state) {
  const locs = svc.locs;
  let start = 0;
  if (state.kind === 'at') start = state.idx + 1;
  else if (state.kind === 'between') start = state.to;
  else if (state.kind === 'notstarted') start = 1;
  for (let i = start; i < locs.length; i++) if (!locs[i].pass && !locs[i].cancelled) return i;
  return -1;
}

/* ---------- Bottom sheet ---------- */
function renderSheet() {
  const tracking = !!settings.tracked;
  $('#sheet-idle').hidden = tracking;
  $('#sheet-live').hidden = !tracking;
  if (!tracking) { updateSheetHeight(); return; }

  const svc = live.svc;
  if (!svc) {
    $('#live-title').textContent = live.error ? 'Can\'t load train' : 'Loading train…';
    $('#live-sub').textContent = settings.tracked.uid === 'DEMO' ? 'Demo' : `${settings.tracked.uid} · ${fmtDateShort(settings.tracked.date)}`;
    $('#live-pill').className = 'pill pill-ontime'; $('#live-pill').textContent = '–';
    $('#live-status').textContent = live.error ? apiErrorText(live.error) : '';
    $('#live-next').textContent = '';
    $('#live-save').disabled = true; $('#live-share').disabled = true;
    $('#stops-list').hidden = true; $('#live-stops').setAttribute('aria-expanded', 'false');
    renderMeta(); updateSheetHeight();
    return;
  }

  const state = live.pos || trainState(svc);
  const locs = svc.locs, n = locs.length;
  const d = currentDelay(svc, state);
  const c = classify(d) || 'ontime';

  $('#live-title').textContent = `${svc.headcode} · ${svc.origin} → ${svc.destination}`;
  $('#live-sub').textContent = [svc.operator, fmtDate(svc.date)].filter(Boolean).join(' · ');
  $('#map-search-label').textContent = `${svc.headcode} to ${svc.destination}`;
  const pill = $('#live-pill');
  pill.className = `pill pill-${state.kind === 'cancelled' ? 'late' : c}`;
  pill.textContent = state.kind === 'cancelled' ? 'Cancelled' : d == null ? '–' : d === 0 ? 'Right time' : `${Math.abs(d)} min ${d < 0 ? 'early' : 'late'}`;

  let status = '', next = '';
  const plat = L0 => L0.platform ? ` · platform ${L0.platform}` : '';
  if (state.kind === 'cancelled') status = 'This train is cancelled';
  else if (state.kind === 'notstarted') {
    const o = locs[0];
    status = `Waiting to leave ${o.name}${plat(o)}`;
    next = `Booked ${hhmm(o.bDep)}${o.rDep !== o.bDep ? ` · expected ${hhmm(o.rDep)}` : ''}`;
  } else if (state.kind === 'arrived') {
    const z = locs[n - 1];
    status = `Arrived at ${z.name} at ${hhmm(z.rArr)}`;
    next = `Booked ${hhmm(z.bArr)} · ${describe(d)}`;
  } else if (state.kind === 'at') {
    const h = locs[state.idx];
    status = `At ${h.name}${plat(h)}`;
  } else if (state.kind === 'between') {
    const a = locs[state.geoFrom >= 0 ? state.geoFrom : state.from], b = locs[state.geoTo >= 0 ? state.geoTo : state.to];
    status = a === b ? `Near ${a.name}` : `Between ${a.name} and ${b.name}`;
  } else status = 'Position unknown';

  if (state.kind === 'at' || state.kind === 'between') {
    const ni = nextStop(svc, state);
    if (ni >= 0) {
      const L1 = locs[ni];
      const bk = L1.bArr ?? L1.bDep, ex = L1.rArr ?? L1.rDep;
      next = `Next: ${L1.name}, arriving ${hhmm(bk)}${ex != null && Math.round(ex) !== Math.round(bk) ? ` (expected ${hhmm(ex)})` : ''}`;
    }
  }
  $('#live-status').textContent = status;
  $('#live-next').textContent = live.error ? apiErrorText(live.error) : next;
  $('#live-save').disabled = false;
  $('#live-share').disabled = false;

  renderStops(svc, state);
  renderMeta();
  updateSheetHeight();
}

function renderStops(svc, state) {
  const locs = svc.locs, n = locs.length;
  const hereIdx = state.kind === 'at' || state.kind === 'arrived' || state.kind === 'notstarted' ? state.idx : -1;
  $('#stops-list').innerHTML = locs.map((l, i) => {
    if (l.pass && !l.coord) return '';
    const done = l.aDep || (l.aArr && i === n - 1) || (state.kind === 'between' && i <= state.from);
    const d = locDelay(l, i, n);
    const reached = l.aArr || l.aDep;
    const [bk, rt] = stopTimes(l, i, n);
    const cls = ['stop', done ? 'done' : '', i === hereIdx ? 'here' : '', l.pass ? 'pass' : '', l.cancelled ? 'cancelled' : ''].join(' ');
    const times = l.cancelled ? 'Cancelled'
      : `${hhmm(bk)}${rt != null && Math.round(rt) !== Math.round(bk) ? ` → ${reached ? '' : 'exp '}${hhmm(rt)}` : ''}` +
        (reached && d != null ? `<span class="pill pill-${classify(d)}">${esc(shortDiff(d))}</span>` : '');
    return `<li class="${cls}"><span class="stop-dot"></span>
      <span><div class="stop-name">${esc(l.name)}</div>${l.platform && !l.pass ? `<div class="stop-plat">Platform ${esc(l.platform)}</div>` : ''}</span>
      <span class="stop-times">${times}</span></li>`;
  }).join('');
}

function renderMeta() {
  const el = $('#live-updated');
  if (!el) return;
  if (live.loading) { el.textContent = 'Updating…'; return; }
  if (!live.updatedAt) { el.textContent = ''; return; }
  const s = Math.round((Date.now() - live.updatedAt) / 1000);
  el.textContent = s < 10 ? 'Updated just now' : s < 60 ? `Updated ${s}s ago` : `Updated ${Math.round(s / 60)} min ago`;
}
setInterval(renderMeta, 5000);

$('#live-stops').addEventListener('click', () => {
  const list = $('#stops-list');
  list.hidden = !list.hidden;
  $('#live-stops').setAttribute('aria-expanded', String(!list.hidden));
  updateSheetHeight();
});
$('#live-stop').addEventListener('click', stopTracking);
$('#idle-demo').addEventListener('click', () => { demoStart = null; startTracking('DEMO', todayISO()); });

$('#live-share').addEventListener('click', async () => {
  const t = settings.tracked; if (!t) return;
  const url = new URL(location.href.split('#')[0]);
  const params = new URLSearchParams({ track: `${t.uid}/${t.date}` });
  if (settings.relay && t.uid !== 'DEMO') params.set('relay', settings.relay);
  url.hash = params.toString();
  const svc = live.svc;
  const text = svc ? `Follow ${svc.headcode} ${svc.origin} → ${svc.destination} live` : 'Follow this train live';
  if (navigator.share) {
    try { await navigator.share({ title: 'Right Time', text, url: url.toString() }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url.toString()); toast('Link copied'); }
  catch { prompt('Copy this link:', url.toString()); }
});

$('#live-save').addEventListener('click', () => {
  if (!live.svc) return;
  resetForm();
  fillFromService(live.svc);
  show('log');
});

/* =========================================================================
   Find a train
   ========================================================================= */
let selectedCrs = null;
let suggestIdx = -1;

function stationMatches(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const up = q.toUpperCase();
  const exact = STATIONS[up] && q.length === 3 ? [{ crs: up, name: STATIONS[up][0] }] : [];
  const starts = STATION_LIST.filter(s => s.lc.startsWith(q));
  const contains = STATION_LIST.filter(s => !s.lc.startsWith(q) && s.lc.includes(q));
  const seen = new Set();
  return [...exact, ...starts, ...contains].filter(s => !seen.has(s.crs) && seen.add(s.crs)).slice(0, 8);
}

function renderSuggest() {
  const box = $('#find-suggest');
  const items = stationMatches($('#find-station').value);
  if (!items.length || selectedCrs) { box.hidden = true; return; }
  box.innerHTML = items.map((s, i) =>
    `<li><button type="button" data-crs="${s.crs}" class="${i === suggestIdx ? 'hl' : ''}"><span>${esc(s.name)}</span><span class="crs">${s.crs}</span></button></li>`).join('');
  box.hidden = false;
}
function pickStation(crs) {
  selectedCrs = crs;
  $('#find-station').value = `${STATIONS[crs][0]} (${crs})`;
  $('#find-suggest').hidden = true;
  $('#find-station').blur();
  searchDepartures();
}
$('#find-station').addEventListener('input', () => { selectedCrs = null; suggestIdx = -1; renderSuggest(); });
$('#find-station').addEventListener('focus', () => { if (selectedCrs) { $('#find-station').select(); } });
$('#find-station').addEventListener('keydown', e => {
  const items = $$('#find-suggest button');
  if (e.key === 'ArrowDown' && items.length) { suggestIdx = Math.min(items.length - 1, suggestIdx + 1); renderSuggest(); e.preventDefault(); }
  else if (e.key === 'ArrowUp' && items.length) { suggestIdx = Math.max(0, suggestIdx - 1); renderSuggest(); e.preventDefault(); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    const pick = items[Math.max(0, suggestIdx)];
    if (pick) pickStation(pick.dataset.crs); else searchDepartures();
  }
});
$('#find-suggest').addEventListener('pointerdown', e => e.preventDefault());
$('#find-suggest').addEventListener('click', e => {
  const b = e.target.closest('button[data-crs]'); if (b) pickStation(b.dataset.crs);
});
document.addEventListener('click', e => { if (!e.target.closest('.station-picker')) $('#find-suggest').hidden = true; });

function renderRecentStations() {
  if (!$('#find-date').value) $('#find-date').value = todayISO();
  $('#recent-stations').innerHTML = (settings.recentStations || [])
    .filter(c => STATIONS[c])
    .map(c => `<button class="chip" data-crs="${c}">${esc(STATIONS[c][0])}</button>`).join('');
}
$('#recent-stations').addEventListener('click', e => {
  const b = e.target.closest('[data-crs]'); if (b) pickStation(b.dataset.crs);
});
$('#find-go').addEventListener('click', () => {
  if (!selectedCrs) {
    const m = stationMatches($('#find-station').value);
    if (m.length) return pickStation(m[0].crs);
    return findStatus('Type a station name or 3-letter code first.', 'error');
  }
  searchDepartures();
});
$('#find-headcode').addEventListener('input', () => { if (lastResults) renderResults(); });

function findStatus(msg, kind) {
  const el = $('#find-status');
  if (!msg) { el.hidden = true; return; }
  el.className = `find-status${kind ? ' ' + kind : ''}`;
  el.innerHTML = msg;
  el.hidden = false;
}

let lastResults = null;
async function searchDepartures() {
  const crs = selectedCrs; if (!crs) return;
  settings.recentStations = [crs, ...(settings.recentStations || []).filter(c => c !== crs)].slice(0, 6);
  persistSettings(); renderRecentStations();

  const date = $('#find-date').value || todayISO();
  const [y, m, d] = date.split('-');
  let path = `/search/${crs}/${y}/${m}/${d}`;
  if (date === todayISO()) {
    const t = new Date(Date.now() - 60 * 60000);
    if (isoDate(t) === date) path += `/${pad(t.getHours())}${pad(t.getMinutes())}`;
  }
  $('#find-results').innerHTML = '';
  findStatus('Loading trains…');
  try {
    const data = await api(path);
    lastResults = { crs, services: (data && data.services) || [] };
    renderResults();
  } catch (err) {
    lastResults = null;
    const extra = err.kind === 'norelay'
      ? ` <button class="link-btn" id="goto-settings">Open Settings</button> · <button class="link-btn" id="goto-demo">Try the demo</button>` : '';
    findStatus(esc(apiErrorText(err)) + extra, 'error');
    const gs = $('#goto-settings'), gd = $('#goto-demo');
    if (gs) gs.addEventListener('click', () => show('settings'));
    if (gd) gd.addEventListener('click', () => { demoStart = null; startTracking('DEMO', todayISO()); });
  }
}

function renderResults() {
  if (!lastResults) return;
  const hc = $('#find-headcode').value.trim().toUpperCase();
  const list = lastResults.services.filter(s => !hc || (s.trainIdentity || '').toUpperCase().includes(hc) || (s.runningIdentity || '').toUpperCase().includes(hc));
  const name = STATIONS[lastResults.crs] ? STATIONS[lastResults.crs][0] : lastResults.crs;
  if (!list.length) {
    findStatus(hc ? `No trains matching ${esc(hc)} at ${esc(name)}. Check the date, or clear the headcode to see everything.` : `No trains found at ${esc(name)} for this time.`);
    $('#find-results').innerHTML = '';
    return;
  }
  findStatus(`${list.length} train${list.length === 1 ? '' : 's'} at ${esc(name)}. Tap one to track it on the map.`);
  $('#find-results').innerHTML = list.map(s => {
    const ld = s.locationDetail || {};
    const terminating = ld.displayAs === 'DESTINATION' || (!ld.gbttBookedDeparture && !ld.wttBookedDeparture && (ld.gbttBookedArrival || ld.wttBookedArrival));
    const bk = rttMins(terminating ? (ld.gbttBookedArrival || ld.wttBookedArrival) : (ld.gbttBookedDeparture || ld.wttBookedDeparture || ld.wttBookedPass));
    const rt = rttMins(terminating ? ld.realtimeArrival : (ld.realtimeDeparture || ld.realtimePass));
    let delay = bk != null && rt != null ? Math.round(rt - bk) : null;
    if (delay != null && delay < -720) delay += 1440;
    const cancelled = /CANCEL/.test(ld.displayAs || '');
    const dest = terminating
      ? `from ${(ld.origin && ld.origin[0] && ld.origin[0].description) || '?'}`
      : (ld.destination && ld.destination[0] && ld.destination[0].description) || '?';
    const sub = cancelled ? '<span class="txt-late">Cancelled</span>'
      : delay == null ? 'No live times yet'
      : delay === 0 ? '<span class="txt-ok">On time</span>'
      : `<span class="${delay > 0 ? 'txt-late' : 'txt-early'}">${describe(delay)}${rt != null ? ` · ${hhmm(rt)}` : ''}</span>`;
    const meta = [s.atocName, ld.platform ? `plat ${ld.platform}` : '', terminating ? 'arrives' : ''].filter(Boolean).join(' · ');
    return `<button class="dep" data-uid="${esc(s.serviceUid)}" data-date="${esc(s.runDate)}">
      <span class="dep-time">${hhmm(bk)}</span>
      <span class="dep-dest">${esc(dest)}</span>
      <span class="dep-hc">${esc(s.trainIdentity || s.runningIdentity || '')}</span>
      <span class="dep-meta">${sub}${meta ? ' · ' + esc(meta) : ''}</span>
    </button>`;
  }).join('');
}
$('#find-results').addEventListener('click', e => {
  const b = e.target.closest('.dep'); if (b) startTracking(b.dataset.uid, b.dataset.date);
});

/* =========================================================================
   Stats
   ========================================================================= */
const arrDiff = r => diffMins(r.schedArr, r.actArr);
const sortRuns = list => list.slice().sort((a, b) =>
  (a.date + (a.schedArr || '')) < (b.date + (b.schedArr || '')) ? 1 : -1);
const routeName = r => (r.from && r.to) ? `${r.from} → ${r.to}` : (r.to || r.from || '');
const runTitle = r => [r.headcode, routeName(r)].filter(Boolean).join(' · ') || 'Run';

function inPeriod(r, period) {
  if (period === 'all') return true;
  const d = new Date(r.date + 'T12:00:00');
  const now = new Date();
  if (period === 'week') {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return d >= start;
  }
  if (period === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  if (period === 'year') return d.getFullYear() === now.getFullYear();
  return true;
}
const periodLabel = p => ({ week: 'this week', month: 'this month', year: 'this year', all: 'all time' }[p]);

function renderStats() {
  $$('.segmented button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.period === settings.period)));
  const list = sortRuns(runs.filter(r => inPeriod(r, settings.period) && arrDiff(r) != null));
  const empty = list.length === 0;
  $('#stats-empty').hidden = !empty;
  $('#stats-body').hidden = empty;
  if (empty) {
    $('#stats-empty .empty-title').textContent = runs.length ? 'No runs in this period' : 'No runs saved yet';
    return;
  }
  const diffs = list.map(arrDiff);
  const counts = { early: 0, ontime: 0, late: 0 };
  diffs.forEach(d => counts[classify(d)]++);
  const n = list.length;
  const pct = x => Math.round((x / n) * 100);

  $('#stat-ontime-pct').textContent = `${pct(counts.early + counts.ontime)}%`;
  $('#stat-total').textContent = `${n} run${n === 1 ? '' : 's'} · ${periodLabel(settings.period)}`;
  $('#stat-early').textContent = `${counts.early} · ${pct(counts.early)}%`;
  $('#stat-ontime').textContent = `${counts.ontime} · ${pct(counts.ontime)}%`;
  $('#stat-late').textContent = `${counts.late} · ${pct(counts.late)}%`;

  const bar = $('#split-bar');
  bar.innerHTML = ['early', 'ontime', 'late'].filter(k => counts[k] > 0)
    .map(k => `<span class="seg-${k}" style="flex:${counts[k]}"></span>`).join('');
  bar.setAttribute('aria-label', `Early ${counts.early}, on time ${counts.ontime}, late ${counts.late}`);

  const avg = Math.round(diffs.reduce((a, b) => a + b, 0) / n * 10) / 10;
  $('#stat-avg').textContent = avg === 0 ? 'Right time' : `${Math.abs(avg)}m ${avg < 0 ? 'early' : 'late'}`;

  let streak = 0;
  for (const r of sortRuns(runs)) {
    const c = classify(arrDiff(r));
    if (c == null) continue;
    if (c === 'late') break;
    streak++;
  }
  $('#stat-streak').textContent = `${streak} run${streak === 1 ? '' : 's'}`;

  const minD = Math.min(...diffs), maxD = Math.max(...diffs);
  const best = list[diffs.indexOf(minD)], worst = list[diffs.indexOf(maxD)];
  $('#stat-best').textContent = minD < 0 ? `${-minD} min${minD === -1 ? '' : 's'}` : '–';
  $('#stat-best-sub').textContent = minD < 0 ? `${fmtDateShort(best.date)} · ${runTitle(best)}` : '';
  $('#stat-worst').textContent = maxD > 0 ? `${maxD} min${maxD === 1 ? '' : 's'}` : '–';
  $('#stat-worst-sub').textContent = maxD > 0 ? `${fmtDateShort(worst.date)} · ${runTitle(worst)}` : '';
  $('#stat-mins-early').textContent = diffs.filter(d => d < 0).reduce((a, d) => a - d, 0);
  $('#stat-mins-late').textContent = diffs.filter(d => d > 0).reduce((a, d) => a + d, 0);

  renderChart(list.slice(0, 30).reverse());

  const reasons = {};
  list.forEach(r => { if (classify(arrDiff(r)) === 'late') { const k = r.reason || 'Not recorded'; reasons[k] = (reasons[k] || 0) + 1; } });
  const reasonRows = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
  $('#reasons-card').hidden = reasonRows.length === 0;
  $('#reasons-list').innerHTML = reasonRows.map(([k, v]) =>
    `<li><span class="r-name">${esc(k)}</span><span class="r-val">${v}×</span></li>`).join('');

  const routes = {};
  list.forEach(r => { const k = routeName(r); if (k) (routes[k] ||= []).push(arrDiff(r)); });
  const routeRows = Object.entries(routes)
    .map(([k, ds]) => [k, ds.length, ds.reduce((a, b) => a + b, 0) / ds.length])
    .sort((a, b) => b[1] - a[1]).slice(0, 6);
  $('#routes-card').hidden = routeRows.length === 0;
  $('#routes-list').innerHTML = routeRows.map(([k, c, a]) => {
    const ar = Math.round(a * 10) / 10;
    const txt = ar === 0 ? 'avg right time' : `avg ${Math.abs(ar)}m ${ar < 0 ? 'early' : 'late'}`;
    return `<li><span class="r-name">${esc(k)}</span><span class="r-val">${c}× · ${txt}</span></li>`;
  }).join('');
}
$$('.segmented button').forEach(b => b.addEventListener('click', () => {
  settings.period = b.dataset.period; persistSettings(); renderStats();
}));

function renderChart(list) {
  const svg = $('#runs-chart');
  const tip = $('#chart-tip');
  tip.hidden = true;
  const W = svg.clientWidth || 320, H = 180;
  const padL = 26, padR = 4, padT = 8, padB = 8;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const diffs = list.map(arrDiff);
  const hiRaw = Math.max(2, ...diffs), loRaw = Math.min(-2, ...diffs);
  const step = niceStep(Math.max(hiRaw, -loRaw));
  const hi = Math.ceil(hiRaw / step) * step, lo = Math.floor(loRaw / step) * step;
  const y = v => padT + (hi - v) / (hi - lo) * (H - padT - padB);
  const plotW = W - padL - padR;
  const slot = plotW / Math.max(list.length, 1);
  const bw = Math.max(3, Math.min(18, slot - 2));

  let out = '';
  for (let v = lo; v <= hi; v += step) {
    const yy = y(v).toFixed(1);
    out += `<line class="${v === 0 ? 'zero' : 'grid'}" x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}"/>`;
    out += `<text class="axis-label" x="${padL - 6}" y="${(+yy + 4).toFixed(1)}" text-anchor="end">${v > 0 ? '+' + v : v}</text>`;
  }
  list.forEach((r, i) => {
    const d = diffs[i], c = classify(d);
    const cx = padL + slot * i + slot / 2;
    const y0 = y(0);
    let shape;
    if (d === 0) shape = `<circle class="bar-ontime mark" cx="${cx.toFixed(1)}" cy="${y0.toFixed(1)}" r="${Math.min(4, bw / 2 + 1).toFixed(1)}"/>`;
    else {
      const h = Math.abs(y(d) - y0);
      shape = barPath(cx - bw / 2, y0, bw, h, d > 0, Math.min(4, bw / 2, h), `bar-${c} mark`);
    }
    out += `<g data-i="${i}">${shape}<rect class="hit" x="${(padL + slot * i).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${H}"/></g>`;
  });
  svg.innerHTML = out;
  svg.setAttribute('aria-label', `Last ${list.length} runs: ` + list.map(r => describe(arrDiff(r))).join(', '));
  svg.querySelectorAll('g[data-i]').forEach(g => g.addEventListener('click', e => {
    e.stopPropagation();
    const i = +g.dataset.i, r = list[i];
    svg.querySelectorAll('.mark').forEach(m => m.classList.remove('sel'));
    g.querySelector('.mark').classList.add('sel');
    tip.innerHTML = `<strong>${esc(describe(arrDiff(r)))}</strong><br>${esc(fmtDateShort(r.date))} · ${esc(runTitle(r))}`;
    tip.hidden = false;
    const cx = (padL + slot * i + slot / 2) / W * svg.clientWidth;
    const half = tip.offsetWidth / 2;
    tip.style.left = `${Math.min(Math.max(cx, half), svg.clientWidth - half)}px`;
    tip.style.top = `-${tip.offsetHeight + 6}px`;
  }));
}
document.addEventListener('click', () => {
  $('#chart-tip').hidden = true;
  $$('#runs-chart .mark').forEach(m => m.classList.remove('sel'));
});
function niceStep(maxAbs) {
  for (const s of [1, 2, 5, 10, 15, 30, 60]) if (maxAbs / s <= 3) return s;
  return 120;
}
function barPath(x, y0, w, h, up, r, cls) {
  const f = n => n.toFixed(1);
  if (up) {
    const top = y0 - h;
    return `<path class="${cls}" d="M${f(x)},${f(y0)} V${f(top + r)} Q${f(x)},${f(top)} ${f(x + r)},${f(top)} H${f(x + w - r)} Q${f(x + w)},${f(top)} ${f(x + w)},${f(top + r)} V${f(y0)} Z"/>`;
  }
  const bot = y0 + h;
  return `<path class="${cls}" d="M${f(x)},${f(y0)} V${f(bot - r)} Q${f(x)},${f(bot)} ${f(x + r)},${f(bot)} H${f(x + w - r)} Q${f(x + w)},${f(bot)} ${f(x + w)},${f(bot - r)} V${f(y0)} Z"/>`;
}
let resizeT;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { if (currentView === 'stats') renderStats(); }, 150);
});

/* =========================================================================
   Log / edit a run
   ========================================================================= */
const form = $('#log-form');
let formSvc = null;   // live service the form was opened from, if any

function resetForm() {
  form.reset();
  form.id.value = '';
  form.serviceUid.value = '';
  form.date.value = todayISO();
  formSvc = null;
  $('#leg-pick').hidden = true;
  $('#dep-details').open = false;
  $('#save-btn').textContent = 'Save run';
  $('#delete-btn').hidden = true;
  updatePreviews();
  refreshDatalists();
}

function fillForm(r) {
  resetForm();
  ['id', 'serviceUid', 'date', 'headcode', 'from', 'to', 'schedArr', 'actArr', 'schedDep', 'actDep', 'reason', 'notes']
    .forEach(k => { form[k].value = r[k] || ''; });
  $('#dep-details').open = !!(r.schedDep || r.actDep);
  $('#save-btn').textContent = 'Save changes';
  $('#delete-btn').hidden = false;
  updatePreviews();
}

// Pre-fill from a tracked train. She can narrow it to the part she drove.
function fillFromService(svc) {
  formSvc = svc;
  const calls = svc.locs.map((l, i) => ({ l, i })).filter(x => !x.l.pass && !x.l.cancelled);
  const opts = calls.map(x => `<option value="${x.i}">${esc(x.l.name)}</option>`).join('');
  $('#leg-from').innerHTML = opts;
  $('#leg-to').innerHTML = opts;
  $('#leg-from').value = String(calls[0].i);
  $('#leg-to').value = String(calls[calls.length - 1].i);
  $('#leg-pick').hidden = false;
  form.serviceUid.value = svc.uid === 'DEMO' ? '' : svc.uid;
  form.date.value = svc.date;
  form.headcode.value = svc.headcode;
  applyLeg();
}
function applyLeg() {
  if (!formSvc) return;
  const a = formSvc.locs[+$('#leg-from').value], b = formSvc.locs[+$('#leg-to').value];
  form.from.value = a.name;
  form.to.value = b.name;
  form.schedDep.value = hhmm(a.bDep ?? a.bArr);
  form.actDep.value = a.aDep ? hhmm(a.rDep) : '';
  form.schedArr.value = hhmm(b.bArr ?? b.bDep);
  form.actArr.value = b.aArr ? hhmm(b.rArr) : '';
  $('#dep-details').open = true;
  updatePreviews();
}
$('#leg-from').addEventListener('change', applyLeg);
$('#leg-to').addEventListener('change', applyLeg);

function previewHTML(d) {
  if (d == null) return '';
  return `<span class="pill pill-${classify(d)}">${esc(describe(d))}</span>`;
}
function updatePreviews() {
  const a = diffMins(form.schedArr.value, form.actArr.value);
  const dd = diffMins(form.schedDep.value, form.actDep.value);
  $('#arr-preview').innerHTML = previewHTML(a);
  $('#dep-preview').innerHTML = previewHTML(dd);
  $('#reason-field').hidden = !(classify(a) === 'late' || classify(dd) === 'late');
}
form.addEventListener('input', updatePreviews);
$$('.now-btn').forEach(b => b.addEventListener('click', () => { form[b.dataset.now].value = nowHHMM(); updatePreviews(); }));

form.headcode.addEventListener('change', () => {
  const hc = form.headcode.value.trim().toUpperCase();
  form.headcode.value = hc;
  if (!hc || form.id.value || formSvc) return;
  const prev = sortRuns(runs).find(r => (r.headcode || '').toUpperCase() === hc);
  if (!prev) return;
  let filled = false;
  for (const k of ['from', 'to', 'schedArr', 'schedDep']) if (!form[k].value && prev[k]) { form[k].value = prev[k]; filled = true; }
  if (prev.schedDep) $('#dep-details').open = true;
  if (filled) { toast(`Filled from your last ${hc}`); updatePreviews(); }
});

form.addEventListener('submit', e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  for (const k in data) data[k] = String(data[k]).trim();
  data.headcode = data.headcode.toUpperCase();
  const late = classify(diffMins(data.schedArr, data.actArr)) === 'late' || classify(diffMins(data.schedDep, data.actDep)) === 'late';
  if (!late) data.reason = '';
  if (data.id) {
    const i = runs.findIndex(r => r.id === data.id);
    if (i >= 0) runs[i] = Object.assign({}, runs[i], data, { updatedAt: Date.now() });
    persistRuns();
    toast('Run updated');
  } else {
    data.id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random().toString(16).slice(2);
    data.createdAt = Date.now();
    runs.push(data);
    persistRuns();
    toast(`Saved · ${describe(diffMins(data.schedArr, data.actArr))}`);
  }
  resetForm();
  show('runs');
});
$('#delete-btn').addEventListener('click', () => {
  const id = form.id.value;
  if (!id || !confirm('Delete this run?')) return;
  runs = runs.filter(r => r.id !== id);
  persistRuns();
  toast('Run deleted');
  resetForm();
  show('runs');
});
function refreshDatalists() {
  const uniq = arr => [...new Set(arr.filter(Boolean))].sort();
  $('#dl-headcodes').innerHTML = uniq(runs.map(r => r.headcode)).map(v => `<option value="${esc(v)}">`).join('');
  $('#dl-stations').innerHTML = uniq(runs.flatMap(r => [r.from, r.to])).map(v => `<option value="${esc(v)}">`).join('');
}

/* =========================================================================
   Runs (history)
   ========================================================================= */
function renderHistory() {
  const q = $('#history-search').value.trim().toLowerCase();
  const list = sortRuns(runs).filter(r => !q ||
    [r.headcode, r.from, r.to, r.notes, r.reason].some(v => (v || '').toLowerCase().includes(q)));
  $('#history-empty').hidden = list.length > 0;
  $('#history-empty .empty-title').textContent = runs.length ? 'No matches' : 'Nothing here yet';
  let html = '', lastDate = '';
  for (const r of list) {
    if (r.date !== lastDate) { html += `<div class="day-head">${esc(fmtDate(r.date))}</div>`; lastDate = r.date; }
    const d = arrDiff(r), c = classify(d) || 'ontime';
    const dep = diffMins(r.schedDep, r.actDep);
    const meta = [`Arr ${r.actArr || '–'} (bkd ${r.schedArr || '–'})`, dep != null ? `dep ${shortDiff(dep)}` : '', r.reason || '']
      .filter(Boolean).join(' · ');
    html += `<button class="run" data-id="${esc(r.id)}">
      <span class="run-title">${esc(runTitle(r))}</span>
      <span class="pill pill-${c}">${esc(shortDiff(d))}</span>
      <span class="run-meta">${esc(meta)}</span>
    </button>`;
  }
  $('#history-list').innerHTML = html;
}
$('#history-search').addEventListener('input', renderHistory);
$('#history-list').addEventListener('click', e => {
  const btn = e.target.closest('.run'); if (!btn) return;
  const r = runs.find(x => x.id === btn.dataset.id); if (!r) return;
  fillForm(r);
  show('log');
});
$('#add-run').addEventListener('click', () => { resetForm(); show('log'); });

/* =========================================================================
   Settings & backup
   ========================================================================= */
function renderSettings() {
  $('#set-tolerance').value = String(settings.tolerance);
  $('#set-relay').value = settings.relay || '';
  $('#set-rail-overlay').checked = !!settings.railOverlay;
  $('#run-count').textContent = runs.length;
}
$('#set-tolerance').addEventListener('change', e => {
  settings.tolerance = Number(e.target.value); persistSettings(); toast('On-time rule updated');
});
$('#set-rail-overlay').addEventListener('change', e => {
  settings.railOverlay = e.target.checked; persistSettings();
  if (settings.railOverlay) railLayer.addTo(map); else railLayer.remove();
});
$('#relay-save').addEventListener('click', async () => {
  let v = $('#set-relay').value.trim();
  if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
  settings.relay = v.replace(/\/+$/, '');
  $('#set-relay').value = settings.relay;
  persistSettings();
  const st = $('#relay-status');
  st.hidden = false;
  if (!settings.relay) { st.className = 'find-status'; st.textContent = 'Relay removed.'; return; }
  st.className = 'find-status'; st.textContent = 'Testing…';
  try {
    const res = await fetch(settings.relay + '/ping', { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok) { st.className = 'find-status ok'; st.textContent = 'Connected. Live data is ready.'; }
    else if (body.app === 'right-time-relay') { st.className = 'find-status error'; st.textContent = 'The relay is running but its Realtime Trains login isn\'t set. Add the RTT_USERNAME and RTT_PASSWORD secrets.'; }
    else { st.className = 'find-status error'; st.textContent = 'That address answered, but it isn\'t a Right Time relay.'; }
  } catch {
    st.className = 'find-status error'; st.textContent = 'Couldn\'t reach that address. Check it\'s typed correctly.';
  }
});

async function shareOrDownload(filename, text, type) {
  const blob = new Blob([text], { type });
  const file = new File([blob], filename, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; }
    catch (err) { if (err.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
$('#export-json').addEventListener('click', () => {
  const { tolerance } = settings;
  const payload = JSON.stringify({ app: 'right-time', version: 1, exportedAt: new Date().toISOString(), settings: { tolerance }, runs }, null, 2);
  shareOrDownload(`right-time-backup-${todayISO()}.json`, payload, 'application/json');
});
$('#export-csv').addEventListener('click', () => {
  const cols = ['date', 'headcode', 'from', 'to', 'schedDep', 'actDep', 'depDiffMins', 'schedArr', 'actArr', 'arrDiffMins', 'result', 'reason', 'notes'];
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = sortRuns(runs).map(r => {
    const a = arrDiff(r), d = diffMins(r.schedDep, r.actDep);
    const rec = Object.assign({}, r, { depDiffMins: d ?? '', arrDiffMins: a ?? '', result: { early: 'Early', ontime: 'On time', late: 'Late' }[classify(a)] || '' });
    return cols.map(c => q(rec[c])).join(',');
  });
  shareOrDownload(`right-time-${todayISO()}.csv`, [cols.join(','), ...rows].join('\n'), 'text/csv');
});
$('#import-json').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const incoming = Array.isArray(data) ? data : data.runs;
    if (!Array.isArray(incoming)) throw new Error('bad file');
    const valid = incoming.filter(r => r && r.id && r.date);
    const byId = new Map(runs.map(r => [r.id, r]));
    let added = 0;
    valid.forEach(r => { if (!byId.has(r.id)) added++; byId.set(r.id, r); });
    runs = [...byId.values()];
    if (data.settings && typeof data.settings.tolerance === 'number') settings.tolerance = data.settings.tolerance;
    persistRuns(); persistSettings(); renderSettings();
    toast(`Restored ${valid.length} runs (${added} new)`);
  } catch { toast("That file doesn't look like a Right Time backup"); }
});
$('#wipe-all').addEventListener('click', () => {
  if (!runs.length) return toast('Nothing to delete');
  if (!confirm(`Delete all ${runs.length} saved runs? Export a backup first if you might want them.`)) return;
  if (!confirm('Are you sure? This cannot be undone.')) return;
  runs = []; persistRuns(); renderSettings(); toast('All runs deleted');
});

/* =========================================================================
   Start-up: shared links look like  #track=P12345/2026-11-14&relay=https://…
   ========================================================================= */
function readLink() {
  const h = new URLSearchParams(location.hash.slice(1));
  const relay = h.get('relay');
  if (relay && /^https:\/\//i.test(relay) && !settings.relay) { settings.relay = relay.replace(/\/+$/, ''); persistSettings(); }
  const track = h.get('track');
  if (track) {
    const [uid, date] = track.split('/');
    if (uid && /^\d{4}-\d{2}-\d{2}$/.test(date || '')) settings.tracked = { uid, date };
    persistSettings();
    history.replaceState(null, '', location.pathname + location.search);
  }
}

readLink();
resetForm();
show('map');
renderSheet();
if (settings.tracked) {
  // Don't resume tracking an old train from days ago.
  const age = (Date.now() - new Date(settings.tracked.date + 'T00:00:00').getTime()) / 86400000;
  if (age > 2) stopTracking(); else refreshLive();
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
