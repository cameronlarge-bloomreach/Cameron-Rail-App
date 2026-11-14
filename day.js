'use strict';
/* =========================================================================
   Right Time: "My day". Upload a job card photo, check what was read,
   then follow every train of the shift and save each run automatically.
   Uses globals from app.js (settings, api, STATIONS, show, startTracking…).
   ========================================================================= */

const dayState = { mode: null, draft: null, reading: null, selected: todayISO(), month: todayISO().slice(0, 7) };
const selDay = () => dayForDate(dayState.selected);

/* ---------- Times on job cards: "0819½" ---------- */
function cardTimeLabel(s) { return s.time ? s.time.replace(':', '') + (s.half ? '½' : '') : '—'; }
function parseCardTime(text) {
  const t = String(text || '').trim().replace(/\s+/g, '');
  const m = /^(\d{1,2}):?(\d{2})(½|\.5|h|H|1\/2)?$/.exec(t);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return { time: `${pad(+m[1])}:${m[2]}`, half: !!m[3] };
}
const legStart = leg => leg.stops[0] && leg.stops[0].time;
const legEnd = leg => leg.stops.length && leg.stops[leg.stops.length - 1].time;
const legMins = (leg, which) => { const t = which === 'end' ? legEnd(leg) : legStart(leg); return t ? toMins(t) : null; };
const stationName = s => (s.crs && STATIONS[s.crs] ? STATIONS[s.crs][0] : s.name || '?');
const legTitle = leg => `${leg.headcode || '????'} · ${stationName(leg.stops[0] || {})} → ${stationName(leg.stops[leg.stops.length - 1] || {})}`;

/* ---------- Rendering ---------- */
function renderDay() {
  const el = $('#day-body');
  if (dayState.mode === 'reading') return renderReading(el);
  if (dayState.mode === 'review' && dayState.draft) return renderReview(el);
  el.innerHTML = '<div id="cal"></div><div id="day-detail"></div>';
  renderCalendar($('#cal'));
  const day = selDay();
  if (!day || !day.legs || !day.legs.length) return renderDayEmpty($('#day-detail'));
  renderPlan($('#day-detail'), day);
}

/* ---------- Calendar ---------- */
// How a date went: from runs saved that day (job card or added by hand).
function dateSummary(date) {
  const dayRuns = runs.filter(r => r.date === date && diffMins(r.schedArr, r.actArr) != null);
  const card = dayForDate(date);
  if (!dayRuns.length) return card ? { cls: 'pending', label: 'Job card, not saved yet' } : null;
  const late = dayRuns.filter(r => classify(diffMins(r.schedArr, r.actArr)) === 'late').length;
  const cls = late === 0 ? 'good' : late * 2 > dayRuns.length ? 'bad' : 'mixed';
  return { cls, label: `${dayRuns.length} run${dayRuns.length === 1 ? '' : 's'}, ${late} late` };
}

function renderCalendar(el) {
  const [y, m] = dayState.month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const daysIn = new Date(y, m, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // Monday first
  const today = todayISO();
  const title = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<span class="cal-cell cal-blank"></span>';
  for (let d = 1; d <= daysIn; d++) {
    const date = `${y}-${pad(m)}-${pad(d)}`;
    const sum = dateSummary(date);
    const cls = ['cal-cell', date === today ? 'cal-today' : '', date === dayState.selected ? 'cal-sel' : '', sum ? `cal-${sum.cls}` : ''].join(' ');
    cells += `<button class="${cls}" data-date="${date}" aria-label="${esc(fmtDate(date))}${sum ? ': ' + esc(sum.label) : ''}">
      <span class="cal-num">${d}</span>${sum ? '<span class="cal-dot"></span>' : ''}</button>`;
  }
  el.innerHTML = `
    <div class="card cal">
      <div class="cal-head">
        <button class="icon-btn cal-nav" data-step="-1" aria-label="Previous month"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
        <div class="cal-title">${esc(title)}</div>
        <button class="icon-btn cal-nav" data-step="1" aria-label="Next month"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
      </div>
      <div class="cal-grid cal-dow">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(x => `<span>${x}</span>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
      <div class="cal-key">
        <span><i class="cal-key-dot cal-good"></i>All on time</span>
        <span><i class="cal-key-dot cal-mixed"></i>Some late</span>
        <span><i class="cal-key-dot cal-bad"></i>Mostly late</span>
        <span><i class="cal-key-dot cal-pending"></i>Not saved</span>
      </div>
    </div>`;
  el.querySelectorAll('.cal-nav').forEach(b => b.addEventListener('click', () => {
    const d = new Date(y, m - 1 + Number(b.dataset.step), 1);
    dayState.month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    renderDay();
  }));
  el.querySelectorAll('.cal-cell[data-date]').forEach(b => b.addEventListener('click', () => {
    dayState.selected = b.dataset.date; dayState.notice = null;
    renderDay();
    const det = $('#day-detail'); if (det) det.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

function renderDayEmpty(el) {
  const date = dayState.selected;
  const ageDays = Math.round((new Date(todayISO() + 'T12:00:00') - new Date(date + 'T12:00:00')) / 86400000);
  el.innerHTML = `
    <div class="card">
      <h2 class="card-title">${date === todayISO() ? 'Load today\'s job card' : `Job card for ${esc(fmtDate(date))}`}</h2>
      ${ageDays > 14 ? '<p class="find-status">This is more than 14 days ago. The free live data only goes back 14 days, so trains can be saved but their actual times can\'t be filled in.</p>' : ''}
      <p class="card-hint">Take a photo of the job card (or pick one from Photos). The app reads each train (headcode, stations and times), then follows them through the day and saves how early or late each one was.</p>
      <label class="btn btn-primary full file-btn">
        Upload job card photo
        <input type="file" id="card-file" accept="image/*" hidden>
      </label>
      <button class="btn btn-ghost full" id="card-manual" style="margin-top:8px">Add trains by hand</button>
      <p class="card-hint" style="margin-top:12px">Tips: lay the card flat in good light, fill the frame, and keep it straight. Reading happens on this phone; the photo isn't uploaded anywhere.</p>
    </div>`;
  $('#card-file').addEventListener('change', onCardFile);
  $('#card-manual').addEventListener('click', () => {
    dayState.draft = { date: dayState.selected, name: '', legs: [blankLeg()] };
    dayState.mode = 'review';
    renderDay();
  });
}

function renderReading(el) {
  const r = dayState.reading || {};
  const pct = r.total ? Math.round((r.done / r.total) * 100) : 5;
  el.innerHTML = `
    <div class="card">
      <h2 class="card-title">Reading your job card…</h2>
      <p class="card-hint">${esc(r.label || 'Getting ready')}</p>
      <div class="progress"><span style="width:${pct}%"></span></div>
      <p class="card-hint" style="margin-top:10px">The first time takes a little longer while the reader downloads (about 7 MB). After that it works offline.</p>
    </div>`;
}

function blankLeg() { return { id: newId(), headcode: '', stops: [{ name: '', crs: '', time: '', half: false }, { name: '', crs: '', time: '', half: false }] }; }
function newId() { return (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random().toString(16).slice(2); }

function renderReview(el) {
  const d = dayState.draft;
  const checks = d.legs.reduce((n, l) => n + (l.verified ? 0 : l.stops.filter(s => s.check || !s.crs || !s.time).length + (/^\d[A-Z]\d\d$/.test(l.headcode) ? 0 : 1)), 0);
  el.innerHTML = `
    <div class="card form">
      <h2 class="card-title">Check your trains</h2>
      <p class="card-hint">${checks ? `<strong>${checks} thing${checks === 1 ? '' : 's'} to check</strong> (highlighted). ` : 'Everything was read. '}Fix anything that's wrong, then tap <strong>Save my day</strong>.</p>
      <div class="row">
        <label class="field"><span>Date</span><input type="date" id="rv-date" value="${esc(d.date)}"></label>
        <label class="field"><span>Job / diagram (optional)</span><input type="text" id="rv-name" value="${esc(d.name || '')}" placeholder="e.g. CE610"></label>
      </div>
    </div>
    ${d.legs.map((leg, li) => `
      <div class="card form leg-edit" data-leg="${li}">
        <div class="leg-edit-head">
          <label class="field hc-field ${/^\d[A-Z]\d\d$/.test(leg.headcode) ? '' : 'needs-check'}"><span>Headcode</span>
            <input type="text" class="rv-hc" value="${esc(leg.headcode)}" maxlength="4" autocapitalize="characters" spellcheck="false" placeholder="1A23"></label>
          <button type="button" class="link-btn rv-del-leg">Remove train</button>
        </div>
        ${leg.verified ? `<p class="tt-badge tt-ok">✓ Matched to the timetable${leg.corrected ? ': stations and times filled in from it' : ''}</p>`
          : d.timetableChecked ? '<p class="tt-badge tt-no">Couldn\'t match this train to the timetable. Please check it carefully.</p>' : ''}
        <div class="stop-edit-head"><span>Station</span><span>Time</span><span></span></div>
        ${leg.stops.map((s, si) => `
          <div class="stop-edit ${s.check || !s.crs || !s.time ? 'needs-check' : ''}" data-stop="${si}">
            <div class="stop-edit-name">
              <input type="text" class="rv-name" value="${esc(s.crs && STATIONS[s.crs] ? STATIONS[s.crs][0] : s.name)}" placeholder="Station" autocapitalize="words" spellcheck="false">
              <small class="rv-match">${s.crs ? `${esc(s.crs)}${s.name && STATIONS[s.crs] && s.name.toLowerCase() !== STATIONS[s.crs][0].toLowerCase() ? ` · read as “${esc(s.name)}”` : ''}` : '<span class="txt-late">Station not recognised</span>'}</small>
            </div>
            <input type="text" class="rv-time" inputmode="decimal" value="${esc(s.time ? cardTimeLabel(s) : '')}" placeholder="0819½">
            <button type="button" class="icon-x rv-del-stop" aria-label="Remove stop">×</button>
          </div>`).join('')}
        <button type="button" class="link-btn rv-add-stop">+ Add station</button>
      </div>`).join('')}
    <button type="button" class="btn btn-ghost full" id="rv-add-leg">+ Add another train</button>
    <div class="form-actions" style="margin-top:12px">
      <button type="button" class="btn btn-primary" id="rv-save">Save my day</button>
      <button type="button" class="btn btn-ghost" id="rv-cancel">Cancel</button>
    </div>
    <p class="card-hint" style="margin-top:8px">Times: type them as on the card, e.g. 0819½ (or 0819.5).</p>`;

  const legOf = e => d.legs[+e.target.closest('[data-leg]').dataset.leg];
  const stopOf = e => legOf(e).stops[+e.target.closest('[data-stop]').dataset.stop];
  el.querySelectorAll('.rv-hc').forEach(i => i.addEventListener('change', e => { const l = legOf(e); l.headcode = e.target.value.trim().toUpperCase(); l.uid = null; renderDay(); }));
  el.querySelectorAll('.rv-name').forEach(i => i.addEventListener('change', e => {
    const s = stopOf(e); s.name = e.target.value.trim();
    const leg = legOf(e);
    const resolved = JobCard.resolveStops(leg.stops.map(x => ({ name: x === s ? s.name : (x.crs && STATIONS[x.crs] ? STATIONS[x.crs][0] : x.name) })), STATIONS);
    s.crs = resolved[leg.stops.indexOf(s)].crs; s.check = false;
    renderDay();
  }));
  el.querySelectorAll('.rv-time').forEach(i => i.addEventListener('change', e => {
    const s = stopOf(e), p = parseCardTime(e.target.value);
    if (p) { s.time = p.time; s.half = p.half; s.check = false; } else { s.time = ''; toast('Type the time like 0819 or 0819½'); }
    renderDay();
  }));
  el.querySelectorAll('.rv-del-stop').forEach(b => b.addEventListener('click', e => { const leg = legOf(e); leg.stops.splice(+e.target.closest('[data-stop]').dataset.stop, 1); renderDay(); }));
  el.querySelectorAll('.rv-add-stop').forEach(b => b.addEventListener('click', e => { legOf(e).stops.push({ name: '', crs: '', time: '', half: false }); renderDay(); }));
  el.querySelectorAll('.rv-del-leg').forEach(b => b.addEventListener('click', e => { if (confirm('Remove this train?')) { d.legs.splice(+e.target.closest('[data-leg]').dataset.leg, 1); renderDay(); } }));
  $('#rv-add-leg').addEventListener('click', () => { d.legs.push(blankLeg()); renderDay(); });
  $('#rv-date').addEventListener('change', e => { d.date = e.target.value || todayISO(); });
  $('#rv-name').addEventListener('change', e => { d.name = e.target.value.trim(); });
  $('#rv-cancel').addEventListener('click', () => { dayState.mode = null; dayState.draft = null; renderDay(); });
  $('#rv-save').addEventListener('click', saveDraft);
}

function saveDraft() {
  const d = dayState.draft;
  const legs = d.legs
    .map(l => Object.assign({}, l, { stops: l.stops.filter(s => s.crs && s.time) }))
    .filter(l => l.stops.length >= 2);
  const bad = d.legs.filter(l => !/^\d[A-Z]\d\d$/.test(l.headcode));
  if (!legs.length) return toast('Add at least one train with two stations and times');
  if (bad.length && !confirm(`${bad.length} train${bad.length === 1 ? ' has' : 's have'} no valid headcode, so ${bad.length === 1 ? 'it' : 'they'} can't be tracked live. Save anyway?`)) return;
  const dropped = d.legs.reduce((n, l) => n + l.stops.filter(s => !(s.crs && s.time)).length, 0);
  legs.sort((a, b) => (legMins(a) ?? 0) - (legMins(b) ?? 0));
  const existing = dayForDate(d.date);
  if (existing && d.originalDate !== d.date && !confirm(`There's already a job card for ${fmtDate(d.date)}. Replace it?`)) return;
  if (d.originalDate && d.originalDate !== d.date) delete settings.days[d.originalDate];
  // Keep saved results for trains that are unchanged.
  const old = existing ? existing.legs : [];
  settings.days[d.date] = { date: d.date, name: d.name || '', legs: legs.map(l => {
    const prev = old.find(o => o.id === l.id && o.headcode === l.headcode);
    return { id: l.id || newId(), headcode: l.headcode, stops: l.stops.map(s => ({ crs: s.crs, name: stationName(s), time: s.time, half: !!s.half })), uid: l.uid || (prev ? prev.uid : null), runId: prev ? prev.runId : null };
  }) };
  dayState.selected = d.date; dayState.month = d.date.slice(0, 7);
  settings.followDay = true;
  persistSettings();
  dayState.mode = null; dayState.draft = null;
  toast(dropped ? `Day saved (${dropped} unfinished row${dropped === 1 ? '' : 's'} left out)` : 'Day saved');
  renderDay();
  followDayTick();
}

function legStatus(leg, day) {
  const now = minsSinceRunDate(day.date);
  const s = legMins(leg), e = legMins(leg, 'end');
  const tracking = settings.tracked && settings.tracked.legId === leg.id;
  if (leg.runId) {
    const r = runs.find(x => x.id === leg.runId);
    const dd = r ? diffMins(r.schedArr, r.actArr) : null;
    return { cls: classify(dd) || 'ontime', text: r ? `Saved · ${describe(dd)}` : 'Saved' };
  }
  if (tracking && live.svc && live.pos) {
    const d = currentDelay(live.svc, live.pos);
    return { cls: classify(d) || 'ontime', text: live.pos.kind === 'arrived' ? `Arrived · ${describe(d)}` : `Live · ${d == null ? 'on its way' : describe(d)}` };
  }
  if (e != null && now > e + 5) return { cls: 'ontime', text: 'Finished · tap Save' };
  if (s != null && now >= s - 15) return { cls: 'ontime', text: 'Due now' };
  return { cls: 'ontime', text: 'Later' };
}

function renderPlan(el, day) {
  const isToday = day.date === todayISO();
  const first = day.legs[0], last = day.legs[day.legs.length - 1];
  const unsaved = day.legs.filter(l => !l.runId && /^\d[A-Z]\d\d$/.test(l.headcode) && legMins(l, 'end') != null && minsSinceRunDate(day.date) > legMins(l, 'end') + 5);
  el.innerHTML = `
    <div class="card">
      <div class="plan-head">
        <div>
          <div class="plan-title">${esc(day.name ? `${day.name} · ` : '')}${esc(fmtDate(day.date))}</div>
          <div class="plan-sub">${day.legs.length} train${day.legs.length === 1 ? '' : 's'} · ${esc(cardTimeLabel(first.stops[0]))}–${esc(cardTimeLabel(last.stops[last.stops.length - 1]))}</div>
        </div>
      </div>
      ${day.date >= todayISO() ? `<label class="toggle"><input type="checkbox" id="follow-day" ${settings.followDay ? 'checked' : ''} ${isToday ? '' : 'disabled'}>
        <span>Follow my day on the map${isToday ? '' : ' (on the day)'}</span></label>` : ''}
      <p class="card-hint">${isToday ? 'The map switches to each train as the shift goes on, so it can be followed from either phone.'
        : day.date < todayISO() ? 'A past day: tap Save to fill in how early or late each train was from the live data.'
        : 'A future day: the map will follow these trains on the day.'}</p>
      <div class="sheet-actions">
        <button class="btn btn-ghost" id="day-share">Share day</button>
        <button class="btn btn-ghost" id="day-edit">Edit</button>
        <button class="btn btn-ghost" id="day-clear">Clear</button>
      </div>
    </div>
    ${dayState.notice ? `<div class="find-status" id="day-notice">${esc(dayState.notice)} <button class="link-btn" id="day-notice-x">OK</button></div>` : ''}
    ${unsaved.length ? `<button class="btn btn-primary full" id="day-save-all">Save ${unsaved.length} finished run${unsaved.length === 1 ? '' : 's'} to stats</button>` : ''}
    <div class="dlegs">
      ${day.legs.map((leg, i) => {
        const st = legStatus(leg, day);
        const tracking = settings.tracked && settings.tracked.legId === leg.id;
        return `<div class="dleg ${tracking ? 'dleg-live' : ''}" data-id="${esc(leg.id)}">
          <div class="dleg-top">
            <span class="dleg-hc">${esc(leg.headcode || '????')}</span>
            <span class="dleg-route">${esc(stationName(leg.stops[0]))} → ${esc(stationName(leg.stops[leg.stops.length - 1]))}</span>
          </div>
          <div class="dleg-times">${esc(cardTimeLabel(leg.stops[0]))} – ${esc(cardTimeLabel(leg.stops[leg.stops.length - 1]))} · ${leg.stops.length} stops</div>
          <div class="dleg-bottom">
            <span class="pill pill-${st.cls}">${esc(st.text)}</span>
            <span class="dleg-btns">
              ${/^\d[A-Z]\d\d$/.test(leg.headcode) ? `<button class="chip dleg-track">${tracking ? 'On map' : 'Track'}</button>` : ''}
              ${!leg.runId && /^\d[A-Z]\d\d$/.test(leg.headcode) ? '<button class="chip dleg-save">Save run</button>' : ''}
            </span>
          </div>
        </div>`;
      }).join('')}
    </div>`;

  const fd = $('#follow-day'); if (fd) fd.addEventListener('change', e => { settings.followDay = e.target.checked; persistSettings(); if (settings.followDay) followDayTick(); });
  $('#day-edit').addEventListener('click', () => {
    dayState.draft = JSON.parse(JSON.stringify({ date: day.date, originalDate: day.date, name: day.name, legs: day.legs }));
    dayState.mode = 'review'; renderDay();
  });
  $('#day-clear').addEventListener('click', () => {
    if (!confirm('Clear this day? Saved runs stay in your stats.')) return;
    if (settings.tracked && settings.tracked.legId) stopTracking();
    delete settings.days[day.date]; persistSettings(); renderDay();
  });
  $('#day-share').addEventListener('click', shareDay);
  const sa = $('#day-save-all'); if (sa) sa.addEventListener('click', () => { dayState.notice = null; sa.disabled = true; sa.textContent = 'Saving… (finding each train)'; saveFinishedLegs(unsaved); });
  const nx = $('#day-notice-x'); if (nx) nx.addEventListener('click', () => { dayState.notice = null; renderDay(); });
  el.querySelectorAll('.dleg-track').forEach(b => b.addEventListener('click', e => trackLeg(legById(e.target.closest('.dleg').dataset.id), true)));
  el.querySelectorAll('.dleg-save').forEach(b => b.addEventListener('click', e => saveFinishedLegs([legById(e.target.closest('.dleg').dataset.id)])));
}
const legById = id => { const f = findLegAnywhere(id); return f ? f.leg : null; };
const dayOfLeg = leg => { const f = leg && findLegAnywhere(leg.id); return f ? f.day : null; };

/* ---------- Upload & read ---------- */
async function onCardFile(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  dayState.mode = 'reading'; dayState.reading = { label: 'Opening photo', done: 0, total: 0 };
  renderDay();
  try {
    const legs = await readJobCard(file, (label, done, total) => { dayState.reading = { label, done, total }; renderDay(); });
    if (!legs.length) {
      toast("Couldn't find any trains on that photo. Try again closer and flatter, or add them by hand.");
      dayState.mode = null; renderDay(); return;
    }
    dayState.lastRead = JSON.parse(JSON.stringify(legs)); // what the photo said, before correcting
    // Correct what was read using the official timetable for that date.
    const date = dayState.selected;
    const age = (new Date(todayISO() + 'T12:00:00') - new Date(date + 'T12:00:00')) / 86400000;
    let tried = false;
    if (settings.relay && age <= 14) {
      tried = true;
      try { await verifyLegs(legs, date, (label, done, total) => { dayState.reading = { label, done, total }; renderDay(); }); }
      catch (err) { console.error(err); }
    }
    dayState.draft = { date, name: '', legs, timetableChecked: tried };
    dayState.mode = 'review';
  } catch (err) {
    console.error(err);
    toast('Something went wrong reading the photo. Try again, or add trains by hand.');
    dayState.mode = null;
  }
  renderDay();
}

let ocrWorker = null;
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}
async function getOcr(progress) {
  if (ocrWorker) return ocrWorker;
  progress('Downloading the reader (first time only)', 0, 0);
  if (!window.Tesseract) await loadScript('vendor/tesseract/tesseract.min.js');
  const base = new URL('vendor/tesseract/', location.href).href;
  ocrWorker = await Tesseract.createWorker('eng', 1 /* LSTM only */, {
    workerPath: base + 'worker.min.js',
    corePath: base,
    langPath: base.replace(/\/$/, ''),
    gzip: true,
  });
  return ocrWorker;
}

function toCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  return c;
}

async function readJobCard(file, progress) {
  await stationsReady;
  // Load the photo (Safari applies the camera's rotation automatically).
  const url = URL.createObjectURL(file);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const draw = maxSide => {
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const W = Math.round(img.naturalWidth * k), H = Math.round(img.naturalHeight * k);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    return { canvas: c, data: ctx.getImageData(0, 0, W, H).data, width: W, height: H };
  };
  // A small copy to find the tables, and a large one to read the text sharply.
  const small = draw(2000), full = draw(3200);
  URL.revokeObjectURL(url);

  const worker = await getOcr(progress);
  const rec = async (image, whitelist) => {
    await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: whitelist });
    return (await worker.recognize(toCanvas(image))).data.text;
  };
  const ocr = {
    header: im => rec(im, '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ '),
    name: im => rec(im, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz. '),
    time: im => rec(im, '0123456789%"'),
    line: im => rec(im, ''),
    nameScore: t => JobCard.nameScore(t, STATIONS),
  };
  const tables = await JobCardImage.readCard(small, full.width > small.width ? full : null, ocr,
    (i, n) => progress(`Reading train ${i + 1} of ${n}`, i, n));

  if (!tables) {
    // No yellow headers: read the whole page and look for station/time columns.
    progress('Reading the page', 0, 1);
    await worker.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '' });
    const { data } = await worker.recognize(small.canvas, {}, { blocks: true });
    const words = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words) words.push({ t: w.text, ...w.bbox });
    return JobCard.parseWords(words).map(t => ({
      id: newId(), headcode: t.headcode,
      stops: JobCard.resolveStops(JobCard.fixTimes(t.stops.map(s => ({ name: s.name, digits: s.time.replace(':', ''), half: s.half }))), STATIONS),
    }));
  }
  const legs = tables.map(t => ({
    id: newId(),
    headcode: JobCard.findHeadcode(t.headText) || '',
    stops: JobCard.resolveStops(JobCard.fixTimes(JobCardImage.parseTableText(t.lines.join('\n'), true)), STATIONS),
  })).filter(l => l.stops.some(st => st.crs || st.time));
  progress('Done', tables.length, tables.length);
  legs.sort((a, b) => (legMins(a) ?? 1e9) - (legMins(b) ?? 1e9));
  return legs;
}

/* ---------- Finding each train in the live data ---------- */
// The free API allows about 10 requests a minute. Space requests out, and if
// the limit is still hit, wait and try again rather than giving up.
let lastApiAt = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function pacedApi(path, onWait) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = lastApiAt + 6500 - Date.now();
    if (wait > 0) await sleep(wait);
    lastApiAt = Date.now();
    try { return await api(path); }
    catch (err) {
      if (!(err && err.kind === 'ratelimit') || attempt === 3) throw err;
      if (onWait) onWait();
      await sleep(30000);
    }
  }
}
async function resolveLeg(leg, date, onWait) {
  if (leg.uid) return leg.uid;
  const from = m => { const v = Math.max(0, Math.round(m)); return `${date}T${pad(Math.floor(v / 60) % 24)}:${pad(v % 60)}`; };
  // Look at the first stop, then the last, then one in the middle: each search
  // covers an hour from 20 minutes before the card's time at that stop.
  const n = leg.stops.length;
  const order = [0, n - 1, Math.floor(n / 2)].filter((v, i, a) => a.indexOf(v) === i);
  const hc = String(leg.headcode).toUpperCase();
  for (const k of order) {
    const st = leg.stops[k];
    if (!st || !st.crs || !st.time) continue;
    const data = await pacedApi(`/location?code=${encodeURIComponent(st.crs)}&timeFrom=${encodeURIComponent(from(toMins(st.time) - 20))}`, onWait);
    const hit = ((data && data.services) || []).find(s => s.scheduleMetadata && String(s.scheduleMetadata.trainReportingIdentity || '').toUpperCase() === hc);
    if (hit) {
      leg.uid = hit.scheduleMetadata.uniqueIdentity;
      persistSettings();
      return leg.uid;
    }
  }
  return null;
}

async function trackLeg(leg, navigate) {
  const day = dayOfLeg(leg);
  if (!leg || !day) return;
  try {
    const uid = await resolveLeg(leg, day.date);
    if (!uid) { toast(`Couldn't find ${leg.headcode} in the live data yet`); return; }
    startTracking(uid, day.date, { legId: leg.id, navigate });
  } catch (err) {
    toast(apiErrorText(err));
  }
}

/* Which leg should be on the map right now? The current one until it has
   arrived, then the next one from an hour before it starts. */
function legForNow(day) {
  const now = minsSinceRunDate(day.date);
  const trackable = day.legs.filter(l => /^\d[A-Z]\d\d$/.test(l.headcode) && legMins(l) != null)
    .sort((a, b) => legMins(a) - legMins(b));
  const cur = settings.tracked && trackable.find(l => l.id === settings.tracked.legId);
  if (cur) {
    const arrived = live.svc && live.pos && live.pos.kind === 'arrived';
    if (!arrived && now < legMins(cur, 'end') + 45) return cur;
    const next = trackable.find(l => legMins(l) > legMins(cur));
    if (next && now >= legMins(next) - 60) return next;
    return cur;
  }
  return trackable.find(l => now >= legMins(l) - 20 && now <= legMins(l, 'end') + 30)
    || trackable.find(l => now < legMins(l) && now >= legMins(l) - 60)
    || null;
}

let followBusy = false;
async function followDayTick() {
  const day = dayForDate(todayISO());
  if (!day || !settings.followDay || followBusy) return;
  followBusy = true;
  try {
    // Save the train that has just arrived (once).
    const cur = settings.tracked && legById(settings.tracked.legId);
    if (cur && !cur.runId && live.svc && live.pos && live.pos.kind === 'arrived') await saveFinishedLegs([cur], true);
    const leg = legForNow(day);
    if (leg && !(settings.tracked && settings.tracked.legId === leg.id)) await trackLeg(leg, false);
  } finally { followBusy = false; }
  if (currentView === 'day') renderDay();
}
setInterval(() => { if (document.visibilityState === 'visible') followDayTick(); }, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') followDayTick(); });

/* ---------- Checking a job card against the timetable ----------
   The photo reading isn't perfect, but the timetable is. Find each train
   (by headcode, or by the stations and times that were read), then take its
   stops and working-timetable times between where her part starts and ends. */
const minsToCard = m => {
  const whole = Math.floor(m + 1e-6), half = m - whole >= 0.25 && m - whole < 0.75;
  const v = ((whole % 1440) + 1440) % 1440;
  return { time: `${pad(Math.floor(v / 60))}:${pad(v % 60)}`, half };
};

async function findServiceForLeg(leg, date, onWait) {
  // 1. By headcode (searching at the stations that were read).
  if (/^\d[A-Z]\d\d$/.test(leg.headcode)) {
    try {
      const uid = await resolveLeg(leg, date, onWait);
      if (uid) return parseService(await pacedApi(dayServicePath(uid), onWait));
    } catch (err) { if (err && err.kind === 'ratelimit') throw err; }
  }
  // 2. Headcode unreadable: look for a train calling at the first stop at that time.
  const known = leg.stops.filter(st => st.crs && st.time);
  const first = known[0];
  if (!first) return null;
  // Only trains that also call at a later station from the card.
  const later = known.find(st => st.crs !== first.crs && toMins(st.time) > toMins(first.time));
  const from = Math.max(0, toMins(first.time) - 3);
  const data = await pacedApi(`/location?code=${encodeURIComponent(first.crs)}&timeFrom=${encodeURIComponent(`${date}T${pad(Math.floor(from / 60))}:${pad(from % 60)}`)}${later ? `&filterTo=${encodeURIComponent(later.crs)}` : ''}`, onWait);
  const base = new Date(date + 'T00:00:00').getTime();
  const near = ((data && data.services) || []).filter(sv => {
    const td = sv.temporalData || {}, ev = td.departure || td.arrival || {};
    const m = isoMins(ev.scheduleInternal || ev.scheduleAdvertised, base);
    return m != null && Math.abs(m - toMins(first.time)) <= 2;
  });
  if (near.length !== 1) return null; // none, or too many to be sure
  const uid = near[0].scheduleMetadata.uniqueIdentity;
  leg.uid = uid;
  return parseService(await pacedApi(dayServicePath(uid), onWait));
}

// Index of the stop in the service that matches a card stop (station and/or time).
function matchStop(svc, cardStop, which, fromIdx = 0) {
  const t = cardStop.time ? toMins(cardStop.time) + (cardStop.half ? 0.5 : 0) : null;
  const timeOf = L => which === 'arr' ? (L.bArr ?? L.bDep) : (L.bDep ?? L.bArr);
  let best = -1, bestD = Infinity;
  svc.locs.forEach((L, i) => {
    if (i < fromIdx || L.pass || L.cancelled) return;
    const sameStation = cardStop.crs && L.crs === cardStop.crs;
    const d = t != null && timeOf(L) != null ? Math.abs(timeOf(L) - t) : null;
    // Same station within 5 minutes, or (if the name was misread) the same time to the half minute.
    const ok = (sameStation && (d == null || d <= 5)) || (d != null && d <= 0.5);
    if (ok && (d ?? 0) < bestD) { best = i; bestD = d ?? 0; }
  });
  return best;
}

async function verifyLegs(legs, date, progress) {
  let checked = 0;
  for (const [n, leg] of legs.entries()) {
    progress(`Checking train ${n + 1} of ${legs.length} against the timetable`, n, legs.length);
    const onWait = () => progress(`Live-data limit reached. Waiting 30s… (train ${n + 1} of ${legs.length})`, n, legs.length);
    let svc = null;
    try { svc = await findServiceForLeg(leg, date, onWait); }
    catch (err) { if (err && (err.kind === 'ratelimit' || err.kind === 'norelay')) break; continue; }
    if (!svc) continue;
    // Where her part starts and ends: the first and last card stops that match.
    let a = -1, b = -1, ai = -1, bi = -1;
    for (let k = 0; k < leg.stops.length; k++) { a = matchStop(svc, leg.stops[k], 'dep'); if (a >= 0) { ai = k; break; } }
    for (let k = leg.stops.length - 1; k > ai; k--) { b = matchStop(svc, leg.stops[k], 'arr', Math.max(a, 0) + 1); if (b >= 0) { bi = k; break; } }
    if (a < 0 || b <= a) continue;
    const allCalls = svc.locs.map((L, i) => ({ L, i })).filter(x => !x.L.pass && !x.L.cancelled && x.L.crs);
    // Card rows before the first match / after the last match that weren't
    // recognised: take that many extra stops from the timetable.
    const ca = allCalls.findIndex(x => x.i === a), cb = allCalls.findIndex(x => x.i === b);
    // Only rows with something on them count at the end (a blank row there is
    // usually a mark below the table); at the start, blank rows count too.
    const after = leg.stops.slice(bi + 1).filter(st => st.name || st.time).length;
    const startC = Math.max(0, ca - ai), endC = Math.min(allCalls.length - 1, cb + after);
    const calls = allCalls.slice(startC, endC + 1);
    if (calls.length < 2) continue;
    const before = leg.stops.map(st => `${st.crs}|${st.time}|${st.half}`).join(',');
    leg.stops = calls.map((x, k) => {
      const m = k === calls.length - 1 ? (x.L.bArr ?? x.L.bDep) : (x.L.bDep ?? x.L.bArr);
      const t = minsToCard(m);
      const read = leg.stops.find(st => st.crs === x.L.crs);
      // The free timetable gives public times, which can differ from the card's
      // working times by a minute and drop the ½. Where the card was read
      // confidently at this station and is within a minute, keep the card's time.
      let time = t.time, half = t.half;
      if (read && read.time && !read.check && Math.abs(toMins(read.time) + (read.half ? 0.5 : 0) - m) <= 1) { time = read.time; half = !!read.half; }
      return { name: read ? read.name : x.L.name, crs: x.L.crs, time, half, check: false };
    });
    if (svc.headcode && svc.headcode !== leg.headcode) leg.headcode = svc.headcode;
    leg.uid = svc.uid;
    leg.verified = true;
    leg.corrected = before !== leg.stops.map(st => `${st.crs}|${st.time}|${st.half}`).join(',');
    checked++;
  }
  return checked;
}

/* ---------- Saving runs from the day ---------- */
function matchIndex(svc, crs, fromIdx = 0) {
  for (let i = fromIdx; i < svc.locs.length; i++) if (svc.locs[i].crs === crs) return i;
  return -1;
}

// Kept here too, so My day works even if the phone has an older app.js cached.
function dayServicePath(uid) {
  return `/service?uniqueIdentity=${encodeURIComponent(String(uid).split(':').slice(-2).join(':'))}`;
}

let savingNow = false;
async function saveFinishedLegs(legs, quiet) {
  if (savingNow) return;
  savingNow = true;
  try { await saveFinishedLegsInner(legs, quiet); } finally { savingNow = false; }
}
async function saveFinishedLegsInner(legs, quiet) {
  let saved = 0, waiting = 0, limited = false;
  const notFound = [], errored = [];
  const todo = legs.filter(l => l && !l.runId);
  const progress = (i, msg) => {
    const b = $('#day-save-all');
    if (b) b.textContent = msg || `Saving ${i + 1} of ${todo.length}… (spaced out for the live-data limit)`;
  };
  for (const [i, leg] of todo.entries()) {
    progress(i);
    const onWait = () => progress(i, `Live-data limit reached. Waiting 30s, then carrying on (${i + 1} of ${todo.length})…`);
    try {
      const legDay = dayOfLeg(leg);
      const uid = await resolveLeg(leg, legDay.date, onWait);
      if (!uid) { notFound.push(leg.headcode); continue; }
      const svc = parseService(await pacedApi(dayServicePath(uid), onWait));
      const first = leg.stops[0], last = leg.stops[leg.stops.length - 1];
      const ai = matchIndex(svc, first.crs), bi = matchIndex(svc, last.crs, Math.max(ai, 0));
      const A = ai >= 0 ? svc.locs[ai] : null, B = bi >= 0 ? svc.locs[bi] : null;
      if (!B || !B.aArr) { waiting++; continue; }
      const run = {
        id: newId(), createdAt: Date.now(), serviceUid: uid, date: legDay.date, headcode: leg.headcode,
        from: stationName(first), to: stationName(last),
        // Booked times come from the job card (the working timetable she drives to).
        schedDep: first.time, actDep: A && A.aDep ? hhmm(A.rDep) : '',
        schedArr: last.time, actArr: hhmm(B.rArr),
        reason: '', notes: [legDay.name ? `Job ${legDay.name}` : '', svc.reasons && svc.reasons.length ? `Official delay reason: ${svc.reasons.join('; ')}` : ''].filter(Boolean).join(' · '),
        fromCard: true,
      };
      runs.push(run);
      leg.runId = run.id;
      saved++;
    } catch (err) {
      if (err && err.kind === 'ratelimit') { limited = true; break; }
      if (err && err.kind === 'norelay') { dayState.notice = apiErrorText(err); break; }
      errored.push(`${leg.headcode} (${err && err.kind ? `${err.kind}${err.status ? ' ' + err.status : ''}` : (err && err.message) || 'error'})`);
      console.error('save', leg.headcode, err);
    }
  }
  persistRuns(); persistSettings();
  if (quiet && !saved) return;
  const parts = [
    saved ? `Saved ${saved} run${saved === 1 ? '' : 's'}` : '',
    waiting ? `${waiting} not arrived yet` : '',
    notFound.length ? `${notFound.join(', ')} not found in the live data. Check the headcode and times on the card` : '',
    errored.length ? `${errored.join(', ')}: couldn't load, try again` : '',
    limited ? 'Live data limit reached. Wait a minute and tap Save again to finish' : '',
  ].filter(Boolean);
  if (parts.length > 1 || limited || notFound.length || errored.length) dayNotice(parts.join('. ') + '.');
  else toast(parts[0] || 'Nothing to save');
  renderDay();
}

function dayNotice(msg) {
  dayState.notice = msg;
  if (currentView === 'day') renderDay();
  else toast(msg);
}

/* ---------- Sharing a day between phones ---------- */
function encodeDay(day) {
  const compact = { d: day.date, n: day.name || '', l: day.legs.map(l => [l.headcode, l.stops.map(s => [s.crs, s.time.replace(':', '') + (s.half ? 'h' : '')])]) };
  return btoa(unescape(encodeURIComponent(JSON.stringify(compact)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeDay(str) {
  const json = decodeURIComponent(escape(atob(str.replace(/-/g, '+').replace(/_/g, '/'))));
  const c = JSON.parse(json);
  return {
    date: c.d, name: c.n || '',
    legs: c.l.map(([hc, stops]) => ({
      id: newId(), headcode: hc, uid: null, runId: null,
      stops: stops.map(([crs, t]) => ({ crs, name: STATIONS[crs] ? STATIONS[crs][0] : crs, time: `${t.slice(0, 2)}:${t.slice(2, 4)}`, half: t.endsWith('h') })),
    })),
  };
}
async function shareDay() {
  const day = selDay(); if (!day) return;
  const url = new URL(location.href.split('#')[0]);
  const params = new URLSearchParams({ day: encodeDay(day) });
  if (settings.relay) params.set('relay', settings.relay);
  url.hash = params.toString();
  const text = `${day.name ? day.name + ' · ' : ''}${fmtDate(day.date)}: follow the trains live`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Right Time', text, url: url.toString() }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url.toString()); toast('Link copied'); }
  catch { prompt('Copy this link:', url.toString()); }
}
function readDayLink() {
  const h = new URLSearchParams(location.hash.slice(1));
  const d = h.get('day');
  if (!d) return false;
  try {
    const day = decodeDay(d);
    const relay = h.get('relay');
    if (relay && /^https:\/\//i.test(relay) && !settings.relay) settings.relay = relay.replace(/\/+$/, '');
    settings.days[day.date] = day; settings.followDay = true;
    dayState.selected = day.date; dayState.month = day.date.slice(0, 7);
    persistSettings();
    history.replaceState(null, '', location.pathname + location.search);
    return true;
  } catch { toast("That day link couldn't be read"); return false; }
}

/* ---------- Start-up ---------- */
// Shown in Settings so we can tell which version a phone is running.
const APP_VERSION = '2026-11-14.11';
(() => { const a = document.querySelector('.about'); if (a) a.insertAdjacentHTML('beforeend', `<br>Version ${APP_VERSION}`); })();

stationsReady.then(() => {
  if (readDayLink()) { show('day'); toast('Day loaded'); }
  followDayTick();
});
