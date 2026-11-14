'use strict';

/* ---------- Storage ---------- */
const STORE_KEY = 'righttime.runs.v1';
const SETTINGS_KEY = 'righttime.settings.v1';

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { toast('Could not save. Storage may be full.'); return false; }
}

let runs = load(STORE_KEY, []);
let settings = Object.assign({ tolerance: 0, period: 'month' }, load(SETTINGS_KEY, {}));

const persistRuns = () => save(STORE_KEY, runs);
const persistSettings = () => save(SETTINGS_KEY, settings);

/* ---------- Time helpers ---------- */
const pad = n => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const nowHHMM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const toMins = t => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; };

// Difference in minutes (positive = late). Handles running across midnight.
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

const arrDiff = r => diffMins(r.schedArr, r.actArr);
const sortRuns = list => list.slice().sort((a, b) =>
  (a.date + (a.schedArr || '')) < (b.date + (b.schedArr || '')) ? 1 : -1);
const routeName = r => (r.from && r.to) ? `${r.from} → ${r.to}` : (r.to || r.from || '');
const runTitle = r => [r.headcode, routeName(r)].filter(Boolean).join(' · ') || 'Run';

/* ---------- DOM helpers ---------- */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

/* ---------- Navigation ---------- */
const TITLES = { stats: 'Stats', log: 'Log a run', history: 'History', settings: 'Settings' };
function show(view) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
  $$('.tabbar button').forEach(b => {
    if (b.dataset.view === view) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  const editing = view === 'log' && $('#log-form').id.value;
  $('#screen-title').textContent = editing ? 'Edit run' : TITLES[view];
  if (view === 'stats') renderStats();
  if (view === 'history') renderHistory();
  if (view === 'settings') renderSettings();
  window.scrollTo(0, 0);
}
$$('.tabbar button').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.view === 'log' && $('#log-form').id.value) resetForm();
  show(b.dataset.view);
}));

/* ---------- Stats ---------- */
function inPeriod(r, period) {
  if (period === 'all') return true;
  const d = new Date(r.date + 'T12:00:00');
  const now = new Date();
  if (period === 'week') {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // Monday
    return d >= start;
  }
  if (period === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  if (period === 'year') return d.getFullYear() === now.getFullYear();
  return true;
}

function renderStats() {
  $$('.segmented button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.period === settings.period)));
  const list = sortRuns(runs.filter(r => inPeriod(r, settings.period) && arrDiff(r) != null));
  const empty = list.length === 0;
  $('#stats-empty').hidden = !empty;
  $('#stats-body').hidden = empty;
  if (empty) {
    $('#stats-empty .empty-title').textContent = runs.length ? 'No runs in this period' : 'No trains logged yet';
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
  bar.innerHTML = ['early', 'ontime', 'late']
    .filter(k => counts[k] > 0)
    .map(k => `<span class="seg-${k}" style="flex:${counts[k]}"></span>`).join('');
  bar.setAttribute('aria-label', `Early ${counts.early}, on time ${counts.ontime}, late ${counts.late}`);

  const avg = diffs.reduce((a, b) => a + b, 0) / n;
  const avgR = Math.round(avg * 10) / 10;
  $('#stat-avg').textContent = avgR === 0 ? 'Right time' : `${Math.abs(avgR)}m ${avgR < 0 ? 'early' : 'late'}`;

  // Streak: consecutive most-recent runs that were early/on time (across all runs, newest first).
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

  // Late reasons
  const reasons = {};
  list.forEach(r => { if (classify(arrDiff(r)) === 'late') { const k = r.reason || 'Not recorded'; reasons[k] = (reasons[k] || 0) + 1; } });
  const reasonRows = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
  $('#reasons-card').hidden = reasonRows.length === 0;
  $('#reasons-list').innerHTML = reasonRows.map(([k, v]) =>
    `<li><span class="r-name">${esc(k)}</span><span class="r-val">${v}×</span></li>`).join('');

  // Routes
  const routes = {};
  list.forEach(r => {
    const k = routeName(r); if (!k) return;
    (routes[k] ||= []).push(arrDiff(r));
  });
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

function periodLabel(p) {
  return { week: 'this week', month: 'this month', year: 'this year', all: 'all time' }[p];
}

$$('.segmented button').forEach(b => b.addEventListener('click', () => {
  settings.period = b.dataset.period; persistSettings(); renderStats();
}));

/* ---------- Chart: diverging bars, early below / late above ---------- */
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
    const x = cx - bw / 2;
    const y0 = y(0);
    let shape;
    if (d === 0) {
      shape = `<circle class="bar-ontime mark" cx="${cx.toFixed(1)}" cy="${y0.toFixed(1)}" r="${Math.min(4, bw / 2 + 1).toFixed(1)}"/>`;
    } else {
      const h = Math.abs(y(d) - y0);
      const r4 = Math.min(4, bw / 2, h);
      shape = barPath(x, y0, bw, h, d > 0, r4, `bar-${c} mark`);
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
// Bar anchored on the zero line with only the data end rounded.
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
  resizeT = setTimeout(() => { if ($('#view-stats').classList.contains('active')) renderStats(); }, 150);
});

/* ---------- Log form ---------- */
const form = $('#log-form');

function resetForm() {
  form.reset();
  form.id.value = '';
  form.date.value = todayISO();
  $('#dep-details').open = false;
  $('#save-btn').textContent = 'Save run';
  $('#cancel-edit').hidden = true;
  $('#delete-btn').hidden = true;
  updatePreviews();
  refreshDatalists();
}

function fillForm(r) {
  form.reset();
  ['id', 'date', 'headcode', 'from', 'to', 'schedArr', 'actArr', 'schedDep', 'actDep', 'reason', 'notes']
    .forEach(k => { form[k].value = r[k] || ''; });
  $('#dep-details').open = !!(r.schedDep || r.actDep);
  $('#save-btn').textContent = 'Save changes';
  $('#cancel-edit').hidden = false;
  $('#delete-btn').hidden = false;
  updatePreviews();
}

function previewHTML(d) {
  if (d == null) return '';
  const c = classify(d);
  return `<span class="pill pill-${c}">${esc(describe(d))}</span>`;
}
function updatePreviews() {
  const a = diffMins(form.schedArr.value, form.actArr.value);
  const dd = diffMins(form.schedDep.value, form.actDep.value);
  $('#arr-preview').innerHTML = previewHTML(a);
  $('#dep-preview').innerHTML = previewHTML(dd);
  $('#reason-field').hidden = !(classify(a) === 'late' || classify(dd) === 'late');
}
form.addEventListener('input', updatePreviews);

$$('.now-btn').forEach(b => b.addEventListener('click', () => {
  form[b.dataset.now].value = nowHHMM();
  updatePreviews();
}));

// Typing a headcode you've run before fills in the route and booked times.
form.headcode.addEventListener('change', () => {
  const hc = form.headcode.value.trim().toUpperCase();
  form.headcode.value = hc;
  if (!hc || form.id.value) return;
  const prev = sortRuns(runs).find(r => (r.headcode || '').toUpperCase() === hc);
  if (!prev) return;
  let filled = false;
  for (const k of ['from', 'to', 'schedArr', 'schedDep']) {
    if (!form[k].value && prev[k]) { form[k].value = prev[k]; filled = true; }
  }
  if (prev.schedDep) $('#dep-details').open = true;
  if (filled) { toast(`Filled from your last ${hc}`); updatePreviews(); }
});

form.addEventListener('submit', e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  for (const k in data) data[k] = String(data[k]).trim();
  data.headcode = data.headcode.toUpperCase();
  const late = classify(diffMins(data.schedArr, data.actArr)) === 'late' ||
               classify(diffMins(data.schedDep, data.actDep)) === 'late';
  if (!late) data.reason = '';

  if (data.id) {
    const i = runs.findIndex(r => r.id === data.id);
    if (i >= 0) runs[i] = Object.assign({}, runs[i], data, { updatedAt: Date.now() });
    persistRuns();
    toast('Run updated');
    resetForm();
    show('history');
  } else {
    data.id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random().toString(16).slice(2);
    data.createdAt = Date.now();
    runs.push(data);
    persistRuns();
    toast(`Saved · ${describe(diffMins(data.schedArr, data.actArr))}`);
    const keepDate = data.date;
    resetForm();
    form.date.value = keepDate;
  }
});

$('#cancel-edit').addEventListener('click', () => { resetForm(); show('history'); });
$('#delete-btn').addEventListener('click', () => {
  const id = form.id.value;
  if (!id || !confirm('Delete this run?')) return;
  runs = runs.filter(r => r.id !== id);
  persistRuns();
  toast('Run deleted');
  resetForm();
  show('history');
});

function refreshDatalists() {
  const uniq = arr => [...new Set(arr.filter(Boolean))].sort();
  $('#dl-headcodes').innerHTML = uniq(runs.map(r => r.headcode)).map(v => `<option value="${esc(v)}">`).join('');
  $('#dl-stations').innerHTML = uniq(runs.flatMap(r => [r.from, r.to])).map(v => `<option value="${esc(v)}">`).join('');
}

/* ---------- History ---------- */
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
    const meta = [
      `Arr ${r.actArr || '–'} (bkd ${r.schedArr || '–'})`,
      dep != null ? `dep ${shortDiff(dep)}` : '',
      r.reason || ''
    ].filter(Boolean).join(' · ');
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

/* ---------- Settings, backup ---------- */
function renderSettings() {
  $('#set-tolerance').value = String(settings.tolerance);
  $('#run-count').textContent = runs.length;
}
$('#set-tolerance').addEventListener('change', e => {
  settings.tolerance = Number(e.target.value); persistSettings(); toast('On-time rule updated');
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
  const payload = JSON.stringify({ app: 'right-time', version: 1, exportedAt: new Date().toISOString(), settings, runs }, null, 2);
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
    persistRuns(); persistSettings();
    renderSettings();
    toast(`Restored ${valid.length} runs (${added} new)`);
  } catch {
    toast("That file doesn't look like a Right Time backup");
  }
});

$('#wipe-all').addEventListener('click', () => {
  if (!runs.length) return toast('Nothing to delete');
  if (!confirm(`Delete all ${runs.length} runs? Export a backup first if you might want them.`)) return;
  if (!confirm('Are you sure? This cannot be undone.')) return;
  runs = []; persistRuns(); renderSettings(); toast('All runs deleted');
});

/* ---------- Start ---------- */
resetForm();
show('stats');

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
