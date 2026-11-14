/* Right Time: job card reader.
   Turns OCR words (from Tesseract) of a driver's job card photo into trains:
   [{ headcode, stops: [{ name, time: "08:19", half: true }] }]

   Job card tables look like:
       1G43 LTP 110
       Crewe      0819½
       Stafford   0839½
       ...
       New St.    0920      <- last row is the arrival
   Works in the browser (window.JobCard) and in Node (module.exports). */
(function (root) {
  'use strict';

  // "0819", "0819½", and common OCR misreads of ½ ("0819%", "081972", "08192", "0819\"")
  const TIME_RE = /^[\[(|]?([0-2O][0-9O][0-5O][0-9O])(.*)$/;

  function parseTime(text) {
    const t = String(text).trim().replace(/[.,:;]$/, '');
    const m = TIME_RE.exec(t);
    if (!m) return null;
    const digits = m[1].replace(/O/g, '0');
    const h = +digits.slice(0, 2), mi = +digits.slice(2);
    if (h > 23 || mi > 59) return null;
    const rest = m[2].replace(/[\s.,:;|)\]]+$/, '');
    if (rest.length > 3) return null;
    return { time: `${digits.slice(0, 2)}:${digits.slice(2)}`, half: rest.length > 0, mins: h * 60 + mi + (rest.length ? 0.5 : 0) };
  }

  // Headcode: digit, letter, digit, digit (e.g. 1G43). Fix common OCR swaps.
  function findHeadcode(text) {
    const toDigit = { O: '0', o: '0', Q: '0', D: '0', I: '1', l: '1', '|': '1', i: '1', Z: '2', z: '2', S: '5', s: '5', B: '8', G: '6', T: '7' };
    const toLetter = { '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '8': 'B', '6': 'G', '4': 'A' };
    const s = String(text).replace(/\s+/g, '');
    for (let i = 0; i + 4 <= s.length; i++) {
      const c = s.slice(i, i + 4).split('');
      const d0 = /\d/.test(c[0]) ? c[0] : toDigit[c[0]];
      const l1 = /[A-Z]/.test(c[1]) ? c[1] : toLetter[c[1]] || (/[a-z]/.test(c[1]) ? c[1].toUpperCase() : null);
      const d2 = /\d/.test(c[2]) ? c[2] : toDigit[c[2]];
      const d3 = /\d/.test(c[3]) ? c[3] : toDigit[c[3]];
      if (d0 && l1 && d2 && d3 && /[0-9]/.test(d0) && /[A-Z]/.test(l1)) {
        // Prefer exact matches: require at least 3 of 4 characters to be correct already.
        const exact = (/\d/.test(c[0]) ? 1 : 0) + (/[A-Z]/.test(c[1]) ? 1 : 0) + (/\d/.test(c[2]) ? 1 : 0) + (/\d/.test(c[3]) ? 1 : 0);
        if (exact >= 3) return d0 + l1 + d2 + d3;
      }
    }
    return null;
  }

  const isNameWord = t => /[A-Za-z]{2,}/.test(t) && !/^(LTP|LU|SO|SX|FO|MO|MX)$/i.test(t);
  const cleanName = t => t.replace(/^[\[(|{]+|[\])|}~]+$/g, '').trim();

  /* words: [{t, x0, y0, x1, y1}] (any order). Returns tables with geometry,
     so the caller can re-read each header strip for the headcode. */
  function parseWords(words) {
    words = words.filter(w => w && w.t && w.t.trim());
    const hs = words.map(w => w.y1 - w.y0).filter(h => h > 5).sort((a, b) => a - b);
    const lineH = hs.length ? hs[Math.floor(hs.length / 2)] : 30;

    // 1. Pair every time token with the station-name words to its left on the same line.
    const times = words.map(w => ({ w, p: parseTime(w.t) })).filter(x => x.p);
    const used = new Set();
    const rows = [];
    for (const { w, p } of times) {
      const cy = (w.y0 + w.y1) / 2;
      const left = words.filter(n => n !== w && !used.has(n) && isNameWord(n.t)
        && n.x1 <= w.x0 + 5 && w.x0 - n.x1 < lineH * 9
        && Math.abs((n.y0 + n.y1) / 2 - cy) < lineH * 0.6);
      if (!left.length) continue;
      left.sort((a, b) => a.x0 - b.x0);
      // Keep the cluster of name words nearest the time (a station name is 1-3 words).
      const chosen = [];
      for (let i = left.length - 1; i >= 0; i--) {
        const nx = chosen.length ? chosen[0].x0 : w.x0;
        if (nx - left[i].x1 > lineH * 2.5 && chosen.length) break;
        chosen.unshift(left[i]);
        if (chosen.length === 3) break;
      }
      chosen.forEach(n => used.add(n));
      rows.push({
        name: chosen.map(n => cleanName(n.t)).join(' ').replace(/\s+/g, ' ').trim(),
        time: p.time, half: p.half, mins: p.mins,
        x0: chosen[0].x0, x1: w.x1, y0: Math.min(w.y0, ...chosen.map(n => n.y0)), y1: Math.max(w.y1, ...chosen.map(n => n.y1)),
        tx: w.x0,
      });
    }

    // 2. Group rows into columns by the x position of their time.
    rows.sort((a, b) => a.tx - b.tx);
    const cols = [];
    for (const r of rows) {
      const c = cols.find(c => Math.abs(c.tx - r.tx) < lineH * 3);
      if (c) { c.rows.push(r); c.tx = (c.tx * (c.rows.length - 1) + r.tx) / c.rows.length; }
      else cols.push({ tx: r.tx, rows: [r] });
    }

    // 3. Within a column, split into tables at large vertical gaps (the next table's header).
    const tables = [];
    for (const c of cols) {
      c.rows.sort((a, b) => a.y0 - b.y0);
      let cur = [];
      for (const r of c.rows) {
        const prev = cur[cur.length - 1];
        if (prev && r.y0 - prev.y0 > lineH * 2.1) { tables.push(cur); cur = []; }
        cur.push(r);
      }
      if (cur.length) tables.push(cur);
    }

    return tables.filter(t => t.length >= 2).map(t => {
      const x0 = Math.min(...t.map(r => r.x0)), x1 = Math.max(...t.map(r => r.x1));
      const top = t[0].y0, rowH = (t[t.length - 1].y0 - t[0].y0) / Math.max(1, t.length - 1) || lineH * 1.2;
      // Look for a headcode among words just above the first row.
      const above = words.filter(w => w.y1 <= top + 4 && w.y0 >= top - rowH * 2.2 && w.x1 >= x0 - rowH && w.x0 <= x1 + rowH)
        .sort((a, b) => a.x0 - b.x0);
      return {
        headcode: findHeadcode(above.map(w => w.t).join(' ')) || '',
        stops: t.map(r => ({ name: r.name, time: r.time, half: r.half })),
        header: { x0: x0 - rowH * 0.5, x1: x1 + rowH * 0.5, y0: top - rowH * 1.9, y1: top - rowH * 0.15 },
        firstMins: t[0].mins,
      };
    }).sort((a, b) => a.firstMins - b.firstMins);
  }

  /* ---------- Station names → CRS codes ---------- */
  // Abbreviations seen on job cards, expanded before matching.
  const EXPAND = {
    st: 'street', 'st.': 'street', pkwy: 'parkway', pky: 'parkway', bdge: 'bridge', bdg: 'bridge', br: 'bridge',
    gb: 'galton bridge', jn: 'junction', jcn: 'junction', jct: 'junction', intl: 'international', int: 'international',
    cen: 'central', ctrl: 'central', cent: 'central', rd: 'road', pk: 'park', apt: 'airport', hl: 'high level', ll: 'low level',
    sq: 'square', n: 'north', s: 'south', e: 'east', w: 'west', gtwy: 'gateway', mkt: 'market',
  };
  // Shorthand that needs a specific station (checked first). Add more as needed.
  const KNOWN = {
    'new st': 'BHM', 'new street': 'BHM', 'bham new st': 'BHM', 'bham': 'BHM', 'snow hill': 'BSW', 'moor st': 'BMO', 'intl': 'BHI', 'bham intl': 'BHI',
    'lime st': 'LIV', 'liv lime st': 'LIV', 'liv spkwy': 'LPY', 'liv s pkwy': 'LPY', 'spkwy': 'LPY',
    'smeth gb': 'SGB', 'smeth': 'SGB', 'smeth rs': 'SMR', 'smethrs': 'SMR', 'tamebrpw': 'TAB', 'tame br pw': 'TAB', 'tame bridge': 'TAB',
    'perrybarr': 'PRY', 'dudley po': 'DDP', 'dudleypo': 'DDP', 'dudley port': 'DDP', 'sandwell': 'SAD', 'bescot': 'BSC', 'coseley': 'CSY', 'duddeston': 'DUD',
    'hamstead': 'HSD', 'witton': 'WTT', 'aston': 'AST', 'tipton': 'TIP', 'walsall': 'WSL', 'snow hill': 'BSW', 'moor st': 'BMO', 'b ham intl': 'BHI', 'smeth rolfe st': 'SMR', 'wolvrhptn': 'WVH', 'wolves': 'WVH', 'actonbdge': 'ACB',
    'stoke': 'SOT', 'euston': 'EUS', 'mk': 'MKC', 'milton keynes': 'MKC', 'mkc': 'MKC', 'nton': 'NMP', 'northampton': 'NMP',
    'picc': 'MAN', 'man picc': 'MAN', 'manchester picc': 'MAN', 'stafford': 'STA', 'stone': 'SNE', 'crewe': 'CRE',
  };

  // Stations on West Midlands Trains lines (West Midlands Railway + London
  // Northwestern Railway). Names read from a job card are matched against
  // these first, so partly-read names still find the right station.
  const NETWORK = new Set(["ACB", "ACG", "ADD", "ALB", "ALV", "APG", "APS", "ASG", "AST", "ATH", "BBK", "BBS", "BDM", "BEH", "BEP", "BER", "BHI", "BHM", "BKD", "BKM", "BKT", "BKW", "BLX", "BLY", "BMO", "BMV", "BRV", "BSC", "BSH", "BSJ", "BSW", "BTG", "BUL", "BWB", "BWN", "CAA", "CAO", "CED", "CLV", "CNL", "COS", "COV", "CRA", "CRD", "CRE", "CSL", "CSY", "CWL", "DAS", "DDG", "DDP", "DTW", "DUD", "DZY", "ERD", "EUS", "EWD", "FEN", "FOK", "FWY", "GMV", "GVH", "HAG", "HBY", "HFD", "HIA", "HLG", "HML", "HNF", "HNL", "HRW", "HSD", "HTF", "HTN", "JEQ", "KDG", "KGL", "KID", "KIH", "KMH", "KNN", "KNW", "LAW", "LBK", "LBZ", "LED", "LEH", "LGG", "LIC", "LID", "LIV", "LMS", "LOB", "LPT", "LPW", "LPY", "LTV", "LYE", "MGN", "MKC", "MLB", "MOV", "MVL", "NFD", "NMP", "NUN", "OHL", "OKN", "OLT", "PIR", "PKG", "PRY", "PSW", "RDC", "RGL", "RGT", "RID", "ROW", "RUG", "RUN", "SAD", "SAV", "SBJ", "SBT", "SCF", "SEN", "SFN", "SGB", "SHR", "SLY", "SMA", "SMR", "SNE", "SOL", "SOT", "SRI", "SRL", "STA", "STY", "SUT", "SWR", "TAB", "TAM", "TFC", "THL", "THW", "TIP", "TLK", "TRI", "TYS", "UNI", "WDE", "WFJ", "WIA", "WLN", "WMB", "WMC", "WMR", "WOB", "WOF", "WOL", "WOP", "WOS", "WRP", "WRW", "WSF", "WSL", "WTE", "WTT", "WVH", "WWW", "WYL", "WYT", "YRD"]);

  const KNOWN_LETTERS = Object.fromEntries(Object.entries(KNOWN).map(([k, v]) => [k.replace(/[^a-z]/g, ''), v]));

  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9 .]/g, ' ').replace(/\s+/g, ' ').trim();
  const isSubseq = (a, b) => { let i = 0; for (const ch of b) if (ch === a[i]) i++; return i === a.length; };

  function haversineKm(a, b) {
    const R = 6371, rad = x => x * Math.PI / 180;
    const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // Candidates with scores (higher is better) for an abbreviated name.
  function candidates(name, stations) {
    const n = norm(name);
    if (!n) return [];
    const nk = n.replace(/\./g, '').trim();
    const known = KNOWN_LETTERS[nk.replace(/[^a-z]/g, '')];
    if (known && stations[known]) return [{ crs: known, score: 100 }];
    // A 3-letter station code, only if written in capitals ("CRE"), not a fragment like "ewe".
    if (/^[A-Z]{3}$/.test(String(name).trim()) && stations[nk.toUpperCase()]) return [{ crs: nk.toUpperCase(), score: 90 }];
    const tokens = nk.split(' ').flatMap(t => (EXPAND[t] || t).split(' '));
    const out = [];
    for (const [crs, [full]] of Object.entries(stations)) {
      const f = norm(full).replace(/\./g, '');
      if (f === tokens.join(' ')) { out.push({ crs, score: 80 }); continue; }
      const ft = f.split(' ');
      // Every token must match a station-name token in order: prefix, or same-first-letter subsequence.
      let j = 0, score = 40, ok = true;
      for (const t of tokens) {
        let found = false;
        while (j < ft.length) {
          const w = ft[j++];
          if (w.startsWith(t)) { score += t.length >= 4 ? 6 : 3; found = true; break; }
          if (t.length >= 3 && w[0] === t[0] && isSubseq(t, w)) { score += 2; found = true; break; }
        }
        if (!found) { ok = false; break; }
      }
      if (!ok) {
        // Joined abbreviation like "ActonBdge" → "acton bridge"
        const joined = ft.join('');
        if (tokens.length === 1 && tokens[0].length >= 5 && tokens[0][0] === joined[0] && isSubseq(tokens[0], joined)) score = 35;
        else continue;
      }
      score -= Math.max(0, ft.length - tokens.length) * 2; // prefer shorter names
      out.push({ crs, score });
    }
    // Also consider typo-tolerant matches ("Statford" is Stafford, not Stratford);
    // nearby stations on the card then decide between close scores.
    for (const f of fuzzyCandidates(nk, stations)) {
      const e = out.find(o => o.crs === f.crs);
      if (e) e.score = Math.max(e.score, f.score); else out.push(f);
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 8);
  }

  function lev(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }

  /* Fallback for misread names: "EeiCrewe" (junk in front), "Runcom" (typo),
     "Sones" (Stone). Also tries known shorthand with small typos. */
  function fuzzyCandidates(nk, stations) {
    const q = nk.replace(/[^a-z]/g, '');
    if (q.length < 3) return [];
    const out = new Map();
    const add = (crs, score) => { if (stations[crs] && (!out.has(crs) || out.get(crs) < score)) out.set(crs, score); };
    for (const [k, crs] of Object.entries(KNOWN)) {
      const kk = k.replace(/[^a-z]/g, '');
      if (kk.length >= 4 && (q.endsWith(kk) || lev(q, kk) <= 1)) add(crs, 70 - lev(q, kk) * 5);
    }
    for (const [crs, [full]] of Object.entries(stations)) {
      const f = norm(full).replace(/[^a-z]/g, '');
      if (f.length >= 4 && q.length > f.length && q.endsWith(f) && q.length - f.length <= 4) { add(crs, 60 + f.length - (q.length - f.length)); continue; }
      if (f.length >= 5 && q.length > f.length && q.includes(f) && q.length - f.length <= 4) { add(crs, 55 + f.length - (q.length - f.length)); continue; }
      if (Math.abs(f.length - q.length) > 2) continue;
      const d = lev(q, f);
      if (d <= Math.max(1, Math.floor(f.length * 0.3))) add(crs, 50 - d * 6);
      else {
        // Junk in front: compare the tail of what was read with the name.
        const tail = q.slice(-f.length);
        if (q.length > f.length) { const dt = lev(tail, f); if (dt <= 1) add(crs, 45 - dt * 6); }
      }
    }
    // A longer tail like "...stone" (5+ letters) vs a station also ending in the same letters.
    if (!out.size && q.length >= 6) {
      for (const [crs, [full]] of Object.entries(stations)) {
        const f = norm(full).replace(/[^a-z]/g, '');
        if (f.length >= 4 && f.length < q.length && lev(q.slice(-f.length), f) <= 1) add(crs, 35);
      }
    }
    return [...out.entries()].map(([crs, score]) => ({ crs, score })).sort((a, b) => b.score - a.score).slice(0, 8);
  }

  /* Match a (possibly partly read) name against network stations only. */
  function networkCandidates(name, stations) {
    const q = norm(name).replace(/[^a-z]/g, '');
    if (q.length < 3) return [];
    const out = [];
    for (const crs of NETWORK) {
      if (!stations[crs]) continue;
      const f = norm(stations[crs][0]).replace(/[^a-z]/g, '');
      const firstWord = norm(stations[crs][0]).split(' ')[0].replace(/[^a-z]/g, '');
      let score = 0;
      if (q === f || q === firstWord) score = 95;
      else if (f.endsWith(q) && q.length >= 3) score = 62 + q.length;           // start cut off ("ewe")
      else if (firstWord.endsWith(q) && q.length >= 3) score = 60 + q.length;
      else if ((f.startsWith(q) || firstWord.startsWith(q)) && q.length >= 4) score = 64 + q.length; // end cut off
      else {
        const d = Math.min(lev(q, f), lev(q, firstWord));
        const L = Math.max(4, Math.min(f.length, q.length));
        if (d <= Math.max(1, Math.floor(L * 0.4))) score = 78 - d * 7;
        else if (q.length >= 4 && q[0] === f[0] && isSubseq(q, f)) score = 60;  // shorthand ("wolvrhptn")
        else {
          // Junk in front: compare the end of what was read with the name.
          const tail = q.slice(-f.length), dt = lev(tail, f);
          if (q.length > f.length && f.length >= 4 && dt <= 1) score = 70 - dt * 6;
        }
      }
      if (score) out.push({ crs, score });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 6);
  }

  /* Resolve every stop to a CRS, using neighbouring stops to pick between
     look-alikes (e.g. "Stoke" → Stoke-on-Trent when next to Kidsgrove). */
  function resolveStops(stops, stations) {
    const cands = stops.map(s => {
      const all = candidates(s.name, stations).map(c => ({ crs: c.crs, score: c.score + (NETWORK.has(c.crs) ? 15 : 0) }));
      for (const n of networkCandidates(s.name, stations)) {
        const e = all.find(a => a.crs === n.crs);
        if (e) e.score = Math.max(e.score, n.score + 15); else all.push({ crs: n.crs, score: n.score + 15 });
      }
      return all.sort((a, b) => b.score - a.score);
    });
    const pick = cands.map(c => (c.length && (c.length === 1 || c[0].score - c[1].score >= 8)) ? c[0].crs : null);
    for (let pass = 0; pass < 2; pass++) {
      cands.forEach((c, i) => {
        if (pick[i] || !c.length) return;
        // Nearest resolved stops before and after this one.
        let prev = null, next = null;
        for (let k = i - 1; k >= 0; k--) if (pick[k]) { prev = pick[k]; break; }
        for (let k = i + 1; k < stops.length; k++) if (pick[k]) { next = pick[k]; break; }
        if (!prev && !next) { if (pass === 1) pick[i] = c[0].crs; return; }
        // A train doesn't call at the same station twice in a row.
        let top = c.filter(x => x.score >= c[0].score - 12 && x.crs !== pick[i - 1] && x.crs !== pick[i + 1]);
        if (!top.length) top = c.slice(0, 1);
        // Best fit on the route: shortest detour from the stop before to the stop after.
        const pos = crs => [stations[crs][1], stations[crs][2]];
        const cost = x => {
          const p = pos(x.crs);
          return (prev ? haversineKm(pos(prev), p) : 0) + (next ? haversineKm(p, pos(next)) : 0) - x.score * 0.05;
        };
        top.sort((a, b) => cost(a) - cost(b));
        pick[i] = top[0].crs;
      });
    }
    return stops.map((s, i) => Object.assign({}, s, { crs: pick[i] || '' }));
  }

  /* Turn read digits into times, fixing misreads using the fact that times in
     a table always go forwards. stops: [{name, digits, half}] →
     [{name, time: "HH:MM" | "", half, check: bool}] (check = please confirm). */
  const CONFUSE = { 0: '869', 1: '47', 2: '7', 3: '85', 4: '1', 5: '683', 6: '58', 7: '12', 8: '3506', 9: '8' };
  function fixTimes(stops) {
    const toMins = d => (/^\d{4}$/.test(d) && +d.slice(0, 2) < 24 && +d.slice(2) < 60) ? +d.slice(0, 2) * 60 + +d.slice(2) : null;
    const res = stops.map(s => ({ name: s.name, digits: s.digits || '', half: !!s.half, mins: toMins(s.digits || ''), check: false }));
    const fits = (i, m) => {
      for (let k = i - 1; k >= 0; k--) if (res[k].mins != null) { if (m < res[k].mins || m - res[k].mins > 50 * (i - k)) return false; break; }
      for (let k = i + 1; k < res.length; k++) if (res[k].mins != null) { if (m > res[k].mins || res[k].mins - m > 50 * (k - i)) return false; break; }
      return true;
    };
    // Out-of-order times are misreads too.
    res.forEach((r, i) => { if (r.mins != null && !fits(i, r.mins)) { r.mins = null; r.check = true; } });
    res.forEach((r, i) => {
      if (r.mins != null) return;
      const d = r.digits;
      const options = new Set();
      if (d.length === 4) {
        for (let p = 0; p < 4; p++) for (const c of CONFUSE[d[p]] || '') options.add(d.slice(0, p) + c + d.slice(p + 1));
      } else if (d.length === 3) {
        for (let p = 0; p <= 3; p++) for (let c = 0; c <= 9; c++) options.add(d.slice(0, p) + c + d.slice(p));
      }
      const good = [...options].map(toMins).filter(m => m != null && fits(i, m));
      if (good.length) {
        // Prefer the option closest to the middle of its neighbours.
        let prev = null, next = null;
        for (let k = i - 1; k >= 0; k--) if (res[k].mins != null) { prev = res[k].mins; break; }
        for (let k = i + 1; k < res.length; k++) if (res[k].mins != null) { next = res[k].mins; break; }
        const target = prev != null && next != null ? (prev + next) / 2 : prev != null ? prev + 5 : next != null ? next - 5 : good[0];
        good.sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
        r.mins = good[0];
      }
      r.check = true;
    });
    const pad = n => String(n).padStart(2, '0');
    return res.map(r => ({ name: r.name, time: r.mins != null ? `${pad(Math.floor(r.mins / 60))}:${pad(r.mins % 60)}` : '', half: r.half, check: r.check }));
  }

  /* How well a read name matches a station (higher is better; 0 = nothing). */
  function nameScore(name, stations) {
    const clean = String(name || '').replace(/(.)\1{2,}/g, '$1').replace(/[^A-Za-z. ]+/g, ' ').trim();
    if (clean.replace(/[^A-Za-z]/g, '').length < 3) return 0;
    const c = candidates(clean, stations).map(x => x.score + (NETWORK.has(x.crs) ? 15 : 0));
    const n = networkCandidates(clean, stations).map(x => x.score + 15);
    return Math.max(0, ...c, ...n);
  }

  const api = { parseTime, findHeadcode, parseWords, candidates, resolveStops, fixTimes, nameScore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JobCard = api;
})(typeof window !== 'undefined' ? window : globalThis);
