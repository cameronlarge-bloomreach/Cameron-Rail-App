/* Right Time: find job-card tables in a photo.
   Each train on a job card has a yellow header bar (headcode) with its
   station/time rows underneath. We find the yellow bars by colour, then the
   caller reads each header and each table separately, close up, which is
   far more accurate than reading the whole page at once.

   Pure functions on RGBA pixel data, so they run in the browser and in Node. */
(function (root) {
  'use strict';

  /* rgba: Uint8ClampedArray (width*height*4). Returns header boxes in pixels:
     [{x0, y0, x1, y1}], sorted top-to-bottom, left-to-right. */
  function findYellowBars(rgba, width, height) {
    const cell = Math.max(2, Math.round(Math.min(width, height) / 400));
    const gw = Math.ceil(width / cell), gh = Math.ceil(height / cell);
    const grid = new Uint8Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        let yellow = 0, n = 0;
        for (let y = gy * cell; y < Math.min(height, (gy + 1) * cell); y += 1) {
          for (let x = gx * cell; x < Math.min(width, (gx + 1) * cell); x += 1) {
            const i = (y * width + x) * 4, r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
            n++;
            if (r > 150 && g > 130 && b < 120 && r - b > 70 && g - b > 60 && Math.abs(r - g) < 80) yellow++;
          }
        }
        if (yellow / n > 0.3) grid[gy * gw + gx] = 1;
      }
    }
    // Close tiny gaps (thin letter strokes) so each yellow segment is one piece.
    const bridge = (maxGap, horizontal) => {
      const outer = horizontal ? gh : gw, inner = horizontal ? gw : gh;
      const at = (o, i) => horizontal ? o * gw + i : i * gw + o;
      for (let o = 0; o < outer; o++) {
        let last = -1;
        for (let i = 0; i < inner; i++) {
          if (!grid[at(o, i)]) continue;
          if (last >= 0 && i - last > 1 && i - last <= maxGap) for (let k = last + 1; k < i; k++) grid[at(o, k)] = 2;
          last = i;
        }
      }
      for (let k = 0; k < grid.length; k++) if (grid[k] === 2) grid[k] = 1;
    };
    bridge(2, true);
    bridge(2, false);
    // Connected components (4-neighbour flood fill).
    const seen = new Uint8Array(gw * gh);
    const boxes = [];
    const stack = [];
    for (let s = 0; s < grid.length; s++) {
      if (!grid[s] || seen[s]) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, count = 0;
      stack.push(s); seen[s] = 1;
      while (stack.length) {
        const k = stack.pop(), x = k % gw, y = (k / gw) | 0;
        count++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        const nb = [k - 1, k + 1, k - gw, k + gw];
        for (const m of nb) {
          if (m < 0 || m >= grid.length || seen[m] || !grid[m]) continue;
          if ((m === k - 1 && x === 0) || (m === k + 1 && x === gw - 1)) continue;
          seen[m] = 1; stack.push(m);
        }
      }
      const w = (x1 - x0 + 1) * cell, h = (y1 - y0 + 1) * cell;
      boxes.push({ x0: x0 * cell, y0: y0 * cell, x1: Math.min(width, (x1 + 1) * cell), y1: Math.min(height, (y1 + 1) * cell), w, h });
    }
    // Yellow segments: short and wide-ish.
    const segs = boxes.filter(b => b.w > width * 0.04 && b.h > height * 0.006 && b.h < height * 0.06 && b.w / b.h > 2);
    // Pixel-level fill: lettered segments have holes (the black text), plain ones don't.
    // Measure only the middle band (photos are often slightly tilted, so the
    // corners of the box aren't yellow even on a plain segment).
    for (const s of segs) {
      let yes = 0, n = 0;
      const my = Math.round(s.h * 0.3), mx = Math.round(s.w * 0.08);
      for (let y = s.y0 + my; y < s.y1 - my; y += 1) for (let x = s.x0 + mx; x < s.x1 - mx; x += 2) {
        const i = (y * width + x) * 4; n++;
        if (isYellow(rgba[i], rgba[i + 1], rgba[i + 2])) yes++;
      }
      s.fill = n ? yes / n : 0;
    }
    // A header = a lettered segment, plus a plain segment just to its right if
    // there is one (on many cards the bar is split by a black box, e.g. "110").
    const lettered = segs.filter(s => s.fill < 0.9).sort((a, b) => a.x0 - b.x0);
    const plain = segs.filter(s => s.fill >= 0.9);
    const bars = lettered.map(t => {
      const mate = plain.filter(p => p.x0 >= t.x1 - t.h * 0.2 && p.x0 - t.x1 < t.h * 2.5
        && Math.min(p.y1, t.y1) - Math.max(p.y0, t.y0) > t.h * 0.4)
        .sort((a, b) => a.x0 - b.x0)[0];
      return {
        x0: t.x0, y0: Math.min(t.y0, mate ? mate.y0 : t.y0), x1: mate ? mate.x1 : t.x1, y1: Math.max(t.y1, mate ? mate.y1 : t.y1),
        text: { x0: t.x0, y0: t.y0, x1: t.x1, y1: t.y1 },
      };
    });
    const avgH = bars.reduce((a, b) => a + (b.y1 - b.y0), 0) / (bars.length || 1);
    bars.sort((a, b) => (Math.abs(a.y0 - b.y0) < avgH ? a.x0 - b.x0 : a.y0 - b.y0));
    return bars;
  }

  function isYellow(r, g, b) {
    return r > 150 && g > 130 && b < 120 && r - b > 70 && g - b > 60 && Math.abs(r - g) < 80;
  }

  /* Photos are rarely perfectly straight. Estimate the tilt (dy/dx) from the
     top edges of the yellow header bars. */
  function estimateSkew(rgba, width, height, bars) {
    const slopes = [];
    for (const b of bars) {
      const h = b.y1 - b.y0, w = b.x1 - b.x0;
      const topAt = x => {
        x = Math.round(x);
        for (let y = Math.max(0, Math.round(b.y0 - h * 0.5)); y < Math.min(height, b.y1 + h * 0.5); y++) {
          let n = 0;
          for (let k = -2; k <= 2; k++) { const i = (y * width + x + k) * 4; if (isYellow(rgba[i], rgba[i + 1], rgba[i + 2])) n++; }
          if (n >= 4) return y;
        }
        return null;
      };
      const xl = b.x0 + w * 0.04, xr = b.x1 - w * 0.04;
      const yl = topAt(xl), yr = topAt(xr);
      if (yl != null && yr != null) slopes.push((yr - yl) / (xr - xl));
    }
    if (!slopes.length) return 0;
    slopes.sort((a, b) => a - b);
    const s = slopes[Math.floor(slopes.length / 2)];
    return Math.abs(s) < 0.2 ? s : 0;
  }

  // Sample a box from the photo, straightened by `slope`, scaled by `scale`.
  function sampler(width, height, box, scale, slope) {
    const a = Math.atan(slope || 0), cos = Math.cos(a), sin = Math.sin(a);
    const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    const w = Math.round((box.x1 - box.x0) * scale), h = Math.round((box.y1 - box.y0) * scale);
    return {
      w, h,
      at(x, y) {
        const du = x / scale - (box.x1 - box.x0) / 2, dv = y / scale - (box.y1 - box.y0) / 2;
        const sx = Math.round(cx + du * cos - dv * sin), sy = Math.round(cy + du * sin + dv * cos);
        if (sx < 0 || sy < 0 || sx >= width || sy >= height) return -1;
        return (sy * width + sx) * 4;
      },
    };
  }

  /* Black-on-white image of a header using the yellow mask: yellow → white,
     everything else → black. Gives a very clean picture of the headcode. */
  function maskImage(rgba, width, box, scale, slope, height) {
    height = height || Math.floor(rgba.length / 4 / width);
    const S = sampler(width, height, box, scale, slope);
    const out = new Uint8ClampedArray(S.w * S.h * 4);
    for (let y = 0; y < S.h; y++) for (let x = 0; x < S.w; x++) {
      const i = S.at(x, y), o = (y * S.w + x) * 4;
      const v = i < 0 || isYellow(rgba[i], rgba[i + 1], rgba[i + 2]) ? 255 : 0;
      out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = 255;
    }
    return { data: out, width: S.w, height: S.h };
  }

  /* Straightened, grey, contrast-stretched copy of a table body, with the
     table's ruled lines removed and white-on-red highlighted rows inverted so
     every row reads as dark text on a light background. */
  function bodyImage(rgba, width, box, scale, slope, height) {
    height = height || Math.floor(rgba.length / 4 / width);
    const S = sampler(width, height, box, scale, slope);
    const { w, h } = S;
    const isRed = i => rgba[i] > 85 && rgba[i] - rgba[i + 1] > 45 && rgba[i] > rgba[i + 1] * 1.7 && rgba[i] > rgba[i + 2] * 1.7;
    // Highlighted rows: where in each output row does the red band start and end?
    const redFrom = new Int32Array(h).fill(-1), redTo = new Int32Array(h).fill(-1);
    for (let y = 0; y < h; y++) {
      let red = 0, n = 0, first = -1, last = -1;
      for (let x = 0; x < w; x += 2) {
        const i = S.at(x, y); if (i < 0) continue; n++;
        if (isRed(i)) { red++; if (first < 0) first = x; last = x; }
      }
      if (n && red / n > 0.25) { redFrom[y] = first; redTo[y] = last; }
    }
    const vals = new Uint8ClampedArray(w * h);
    let lo = 255, hi = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = S.at(x, y);
      let v = 255;
      if (i >= 0) {
        const m = Math.min(rgba[i], rgba[i + 1], rgba[i + 2]);
        // Inside a red band, white text becomes dark and red becomes light.
        v = redFrom[y] >= 0 && x >= redFrom[y] && x <= redTo[y] ? 255 - m : m;
      }
      vals[y * w + x] = v;
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    const span = Math.max(1, hi - lo);
    for (let k = 0; k < vals.length; k++) vals[k] = Math.max(0, Math.min(255, ((vals[k] - lo) * 255) / span));
    // Remove ruled lines: rows / columns that are mostly dark.
    const dark = v => v < 110;
    for (let y = 0; y < h; y++) {
      let d = 0; for (let x = 0; x < w; x++) if (dark(vals[y * w + x])) d++;
      if (d / w > 0.55) for (let x = 0; x < w; x++) vals[y * w + x] = 255;
    }
    for (let x = 0; x < w; x++) {
      let d = 0; for (let y = 0; y < h; y++) if (dark(vals[y * w + x])) d++;
      if (d / h > 0.45) for (let y = 0; y < h; y++) vals[y * w + x] = 255;
    }
    const out = new Uint8ClampedArray(w * h * 4);
    for (let k = 0; k < vals.length; k++) { out[k * 4] = out[k * 4 + 1] = out[k * 4 + 2] = vals[k]; out[k * 4 + 3] = 255; }
    return { data: out, width: w, height: h };
  }

  /* Horizontal bands of text in a cleaned body image (one per table row). */
  function textBands(img) {
    const { data, width: w, height: h } = img;
    const prof = new Float32Array(h);
    for (let y = 0; y < h; y++) {
      let d = 0; for (let x = 0; x < w; x++) if (data[(y * w + x) * 4] < 120) d++;
      prof[y] = d / w;
    }
    const raw = [];
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const on = y < h && prof[y] > 0.015;
      if (on && start < 0) start = y;
      if (!on && start >= 0) { raw.push({ y0: start, y1: y }); start = -1; }
    }
    if (!raw.length) return [];
    const hs = raw.map(b => b.y1 - b.y0).sort((a, b) => a - b);
    const med = hs[Math.floor(hs.length * 0.75)] || hs[0];
    // Merge fragments (e.g. a "½" or dots split from its line), drop specks.
    const merged = [];
    for (const b of raw) {
      const prev = merged[merged.length - 1];
      if (prev && b.y0 - prev.y1 < med * 0.25 && b.y1 - prev.y0 < med * 1.6) prev.y1 = b.y1;
      else merged.push({ ...b });
    }
    return merged.filter(b => b.y1 - b.y0 > med * 0.45 && b.y1 - b.y0 < med * 2.2)
      .map(b => ({ y0: Math.max(0, b.y0 - Math.round(med * 0.2)), y1: Math.min(h, b.y1 + Math.round(med * 0.2)) }));
  }

  /* Copy rows y0..y1 of an image onto a white canvas with a margin
     (Tesseract reads better with breathing room). */
  function padCrop(img, y0, y1, pad) {
    const { data, width: w } = img;
    const ch = y1 - y0, W = w + pad * 2, H = ch + pad * 2;
    const out = new Uint8ClampedArray(W * H * 4).fill(255);
    for (let y = 0; y < ch; y++) {
      out.set(data.subarray(((y0 + y) * w) * 4, ((y0 + y) * w + w) * 4), ((y + pad) * W + pad) * 4);
    }
    return { data: out, width: W, height: H };
  }

  /* Black/white version of a grey image using Otsu's threshold, computed on
     this crop only (so uneven lighting across the photo doesn't matter). Long
     horizontal dark runs (leftover ruled lines) are removed. */
  function binarize(img) {
    const { data, width: w, height: h } = img;
    const hist = new Array(256).fill(0);
    // Ignore pure white (padding and erased ruled lines) when choosing the threshold.
    let total = 0;
    for (let k = 0; k < w * h; k++) { const v = data[k * 4]; if (v < 250) { hist[v]++; total++; } }
    if (!total) return img;
    let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0, wB = 0, best = 0, thr = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) ** 2;
      if (between > best) { best = between; thr = t; }
    }
    const out = new Uint8ClampedArray(data.length);
    for (let k = 0; k < w * h; k++) {
      const v = data[k * 4] <= thr ? 0 : 255;
      out[k * 4] = out[k * 4 + 1] = out[k * 4 + 2] = v; out[k * 4 + 3] = 255;
    }
    for (let y = 0; y < h; y++) {
      let x = 0;
      while (x < w) {
        if (out[(y * w + x) * 4]) { x++; continue; }
        let e = x; while (e < w && !out[(y * w + e) * 4]) e++;
        if (e - x > w * 0.2) for (let k = x; k < e; k++) { const o = (y * w + k) * 4; out[o] = out[o + 1] = out[o + 2] = 255; }
        x = e;
      }
    }
    return { data: out, width: w, height: h };
  }

  /* Remove isolated black speckles from a black/white image (3x3 majority). */
  function despeckle(img) {
    const { data, width: w, height: h } = img;
    const out = new Uint8ClampedArray(data);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      let black = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (data[((y + dy) * w + x + dx) * 4] < 128) black++;
      const v = black >= 5 ? 0 : 255, o = (y * w + x) * 4;
      out[o] = out[o + 1] = out[o + 2] = v;
    }
    return { data: out, width: w, height: h };
  }

  /* For each header bar, the region below it that holds that table's rows:
     down to the next bar in the same column, or a sensible maximum. */
  function tableRegions(bars, width, height) {
    return bars.map(b => {
      const h = b.y1 - b.y0, w = b.x1 - b.x0;
      const below = bars.filter(o => o !== b && o.y0 > b.y1 && o.x0 < b.x1 - w * 0.3 && o.x1 > b.x0 + w * 0.3)
        .sort((p, q) => p.y0 - q.y0)[0];
      const bottom = Math.min(height, below ? below.y0 - h * 0.2 : b.y1 + h * 16);
      return {
        header: { x0: Math.max(0, b.x0 - h * 0.2), y0: Math.max(0, b.y0 - h * 0.15), x1: Math.min(width, b.x1 + h * 0.2), y1: Math.min(height, b.y1 + h * 0.15) },
        text: b.text || b,
        body: { x0: Math.max(0, b.x0 - h * 0.6), y0: b.y1 - h * 0.05, x1: Math.min(width, b.x1 + h * 0.6), y1: bottom },
      };
    });
  }

  /* Parse OCR text of one table (one line per row): "Station name   0819½".
     Keeps rows whose time couldn't be read (digits: what was seen) so they can
     be corrected from neighbouring times, or checked by the user. */
  function parseTableText(text) {
    const stops = [];
    for (const raw of String(text).split('\n')) {
      let line = raw.replace(/[|\[\]{}]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[\s|]+$/, '');
      if (!line) continue;
      // Last run of 3-4 digits (O misread for 0), plus up to 3 trailing junk chars (a misread ½).
      const m = /([0-9O]{3,4})([^\sA-Za-z]{0,3}|[0-9]{0,2})$/.exec(line.replace(/[\s~=_—-]+$/, ''))
        || /([0-9O]{4})(\S{0,3})\s+\S{1,3}$/.exec(line);
      let name, digits = '', half = false;
      if (m) {
        digits = m[1].replace(/O/g, '0');
        half = !!m[2];
        name = line.slice(0, m.index);
      } else {
        name = line;
      }
      name = name.replace(/(.)\1{2,}/g, '$1')            // "Alsageriiiiii" → "Alsageri"
        .replace(/[^A-Za-z. ]+/g, ' ')
        .replace(/\s+/g, ' ').trim()
        .replace(/^([a-z]{1,2} )+/i, m2 => (m2.trim().length <= 2 ? '' : m2)) // stray 1-2 letter bits in front
        .replace(/( [a-z]{1,2})+$/i, '')                  // and at the end ("Winsford w")
        .trim();
      if (!/[A-Za-z]{3,}/.test(name)) continue;            // not a station row
      if (!digits && !/[A-Za-z]{4,}/.test(name)) continue;
      stops.push({ name, digits, half });
    }
    return stops;
  }

  const api = { findYellowBars, tableRegions, parseTableText, maskImage, bodyImage, estimateSkew, textBands, padCrop, despeckle, binarize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JobCardImage = api;
})(typeof window !== 'undefined' ? window : globalThis);
