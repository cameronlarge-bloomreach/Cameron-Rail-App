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
    // Pieces of one bar can be split by a letter touching its edge: join pieces
    // on the same line with only a small gap (smaller than the gap to the next
    // table or the black "110" box), then keep the wide, short ones.
    let pieces = boxes.filter(b => b.h > height * 0.006 && b.h < height * 0.06 && b.w > b.h * 0.4).sort((a, b) => a.x0 - b.x0);
    for (let changed = true; changed;) {
      changed = false;
      outer: for (let i = 0; i < pieces.length; i++) for (let j = 0; j < pieces.length; j++) {
        const a = pieces[i], b = pieces[j];
        if (i === j || b.x0 < a.x0) continue;
        const hh = Math.max(a.h, b.h), gap = b.x0 - a.x1;
        const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        if (gap < hh * 0.6 && overlap > Math.min(a.h, b.h) * 0.5) {
          a.x0 = Math.min(a.x0, b.x0); a.x1 = Math.max(a.x1, b.x1); a.y0 = Math.min(a.y0, b.y0); a.y1 = Math.max(a.y1, b.y1);
          a.w = a.x1 - a.x0; a.h = a.y1 - a.y0;
          pieces.splice(j, 1); changed = true; break outer;
        }
      }
    }
    const segs = pieces.filter(b => b.w > width * 0.04 && b.h > height * 0.006 && b.h < height * 0.06 && b.w / b.h > 2);
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
      // Top edge at several points along the bar; slope from the outer pairs.
      const pts = [];
      for (let k = 0; k <= 10; k++) {
        const x = b.x0 + w * (0.05 + 0.09 * k), y = topAt(x);
        if (y != null) pts.push([x, y]);
      }
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        if (pts[j][0] - pts[i][0] > w * 0.4) slopes.push((pts[j][1] - pts[i][1]) / (pts[j][0] - pts[i][0]));
      }
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
      // Smooth (bilinear) sample of the darkest colour channel, for enlarging text.
      minAt(x, y, rgba) {
        const du = x / scale - (box.x1 - box.x0) / 2, dv = y / scale - (box.y1 - box.y0) / 2;
        const fx = cx + du * cos - dv * sin, fy = cy + du * sin + dv * cos;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        if (x0 < 0 || y0 < 0 || x0 + 1 >= width || y0 + 1 >= height) return -1;
        const tx = fx - x0, ty = fy - y0;
        const m = k => Math.min(rgba[k], rgba[k + 1], rgba[k + 2]);
        const i00 = (y0 * width + x0) * 4, i10 = i00 + 4, i01 = i00 + width * 4, i11 = i01 + 4;
        return (m(i00) * (1 - tx) + m(i10) * tx) * (1 - ty) + (m(i01) * (1 - tx) + m(i11) * tx) * ty;
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
      const m = S.minAt(x, y, rgba);
      let v = 255;
      if (m >= 0) {
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
    // Vertical lines: only long unbroken dark runs. (Text that lines up down
    // the page, like the first letter of every station or the 0 of every
    // time, is broken by the gaps between rows, so it's left alone.)
    const runMin = Math.max(20, h * 0.35);
    // The table's side borders start at its top and end at its bottom row:
    // remember where they end, to know where the table stops.
    const borderEnds = [];
    for (let x = 0; x < w; x++) {
      let start = -1;
      for (let y = 0; y <= h; y++) {
        const isDark = y < h && dark(vals[y * w + x]);
        if (isDark && start < 0) start = y;
        if (!isDark && start >= 0) {
          if (y - start > runMin) {
            for (let k = start; k < y; k++) vals[k * w + x] = 255;
            if (start < h * 0.25) borderEnds.push(y);
          }
          start = -1;
        }
      }
    }
    // Then horizontal ruled lines between rows.
    for (let y = 0; y < h; y++) {
      let d = 0; for (let x = 0; x < w; x++) if (dark(vals[y * w + x])) d++;
      if (d / w > 0.55) for (let x = 0; x < w; x++) vals[y * w + x] = 255;
    }
    const out = new Uint8ClampedArray(w * h * 4);
    for (let k = 0; k < vals.length; k++) { out[k * 4] = out[k * 4 + 1] = out[k * 4 + 2] = vals[k]; out[k * 4 + 3] = 255; }
    borderEnds.sort((a, b) => a - b);
    // The longest border marks the bottom (a crease or shadow can cut one short).
    const tableBottom = borderEnds.length >= 2 ? borderEnds[borderEnds.length - 1] : null;
    return { data: out, width: w, height: h, tableBottom };
  }

  /* Horizontal bands of text in a cleaned body image, one per table row.
     rowH: expected row height in this image's pixels (about the height of the
     yellow header bar). Dark pixels are judged against each row's own
     background, so shadows and creases don't merge rows. Ruled lines between
     rows split bands; bands that are still too tall are split evenly. */
  function textBands(img, rowH) {
    const { data, width: w, height: h } = img;
    const prof = new Float32Array(h);
    // Look at the middle of the table only, so shadows at the edges don't count.
    const xa = Math.round(w * 0.15), xb = Math.round(w * 0.85);
    for (let y = 0; y < h; y++) {
      const vals = [];
      for (let x = xa; x < xb; x += 2) vals.push(data[(y * w + x) * 4]);
      vals.sort((a, b) => a - b);
      const bg = vals[Math.floor(vals.length * 0.85)];
      let d = 0; for (const v of vals) if (v < bg - 60) d++;
      prof[y] = d / vals.length;
    }
    // Ruled lines: rows that are dark right across.
    const line = y => prof[y] > 0.45;
    // Nothing below the bottom of the table's side borders.
    if (img.tableBottom && img.tableBottom > h * 0.2) for (let y = Math.min(h, img.tableBottom + 4); y < h; y++) prof[y] = 0;
    const on = y => prof[y] > 0.02 && !line(y);
    const raw = [];
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const o = y < h && on(y);
      if (o && start < 0) start = y;
      if (!o && start >= 0) { raw.push({ y0: start, y1: y }); start = -1; }
    }
    if (!raw.length) return [];
    if (!rowH) {
      const hs = raw.map(b => b.y1 - b.y0).sort((a, b) => a - b);
      rowH = hs[Math.floor(hs.length / 2)] * 1.4;
    }
    // Join fragments of the same row (e.g. a "½" or a dot split off).
    const merged = [];
    for (const b of raw) {
      const prev = merged[merged.length - 1];
      if (prev && b.y0 - prev.y1 < rowH * 0.15 && b.y1 - prev.y0 < rowH * 1.15) prev.y1 = b.y1;
      else merged.push({ ...b });
    }
    // Split anything taller than one row at its lightest points.
    const out = [];
    for (const b of merged) {
      const bh = b.y1 - b.y0;
      const n = Math.round(bh / rowH);
      if (bh > rowH * 1.45 && n >= 2) {
        let y0 = b.y0;
        for (let k = 1; k < n; k++) {
          const target = b.y0 + (bh * k) / n;
          let best = Math.round(target), bestV = Infinity;
          for (let y = Math.round(target - rowH * 0.3); y <= Math.round(target + rowH * 0.3); y++) {
            if (y > y0 && y < b.y1 && prof[y] < bestV) { bestV = prof[y]; best = y; }
          }
          out.push({ y0, y1: best }); y0 = best;
        }
        out.push({ y0, y1: b.y1 });
      } else out.push(b);
    }
    return out.filter(b => b.y1 - b.y0 > rowH * 0.3 && b.y1 - b.y0 < rowH * 1.6)
      .map(b => ({ y0: Math.max(0, b.y0 - Math.round(rowH * 0.12)), y1: Math.min(h, b.y1 + Math.round(rowH * 0.12)) }));
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
      // Part of a bar can be lost in shadow; tables in the same column share a
      // left edge, so use the furthest-left bar of the column.
      const column = bars.filter(o => o.x1 > b.x0 + w * 0.3 && o.x0 < b.x1 - w * 0.3);
      const left = Math.min(b.x0, ...column.map(o => o.x0));
      b = Object.assign({}, b, { x0: left, text: b.text ? Object.assign({}, b.text, { x0: Math.min(b.text.x0, left) }) : b.text });
      const below = bars.filter(o => o !== b && o.y0 > b.y1 && o.x0 < b.x1 - w * 0.3 && o.x1 > b.x0 + w * 0.3)
        .sort((p, q) => p.y0 - q.y0)[0];
      const bottom = Math.min(height, below ? below.y0 - h * 0.2 : b.y1 + h * 16);
      return {
        header: { x0: Math.max(0, b.x0 - h * 0.2), y0: Math.max(0, b.y0 - h * 0.15), x1: Math.min(width, b.x1 + h * 0.2), y1: Math.min(height, b.y1 + h * 0.15) },
        text: b.text || b,
        body: { x0: Math.max(0, b.x0 - h * 1.2), y0: b.y1 - h * 0.05, x1: Math.min(width, b.x1 + h * 0.8), y1: bottom },
        rowH: h,
      };
    });
  }

  /* Parse OCR text of one table (one line per row): "Station name   0819½".
     Keeps rows whose time couldn't be read (digits: what was seen) so they can
     be corrected from neighbouring times, or checked by the user. */
  function parseTableText(text, keepBlank) {
    const stops = [];
    for (const raw of String(text).split('\n')) {
      let line = raw.replace(/[|\[\]{}]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[\s|]+$/, '');
      // keepBlank: every line is a table row, so keep unreadable rows as
      // placeholders (their position still matters).
      const blank = () => { if (keepBlank) stops.push({ name: '', digits: '', half: false }); };
      if (!line) { blank(); continue; }
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
      if (!/[A-Za-z]{3,}/.test(name)) { if (digits) stops.push({ name: '', digits, half }); else blank(); continue; }
      if (!digits && !/[A-Za-z]{4,}/.test(name)) { blank(); continue; }
      stops.push({ name, digits, half });
    }
    return stops;
  }

  /* Copy a rectangle of an image onto a white canvas with a margin. */
  function crop(img, x0, y0, x1, y1, pad) {
    const { data, width: w } = img;
    x0 = Math.max(0, Math.round(x0)); x1 = Math.min(w, Math.round(x1));
    const cw = x1 - x0, ch = y1 - y0, W = cw + pad * 2, H = ch + pad * 2;
    const out = new Uint8ClampedArray(W * H * 4).fill(255);
    for (let y = 0; y < ch; y++) out.set(data.subarray(((y0 + y) * w + x0) * 4, ((y0 + y) * w + x1) * 4), ((y + pad) * W + pad) * 4);
    return { data: out, width: W, height: H };
  }

  /* Where the station-name column ends and the time column starts: the widest
     empty vertical gap in the middle of the table rows. */
  function columnSplit(img, bands) {
    const { data, width: w } = img;
    const col = new Float32Array(w);
    let rows = 0;
    for (const b of bands) for (let y = b.y0; y < b.y1; y += 2) {
      // Skip ruled lines between rows (dark right across).
      let d = 0; for (let x = 0; x < w; x += 3) if (data[(y * w + x) * 4] < 110) d++;
      if (d / (w / 3) > 0.4) continue;
      rows++;
      for (let x = 0; x < w; x++) if (data[(y * w + x) * 4] < 110) col[x]++;
    }
    if (!rows) return null;
    let best = null, run = 0;
    for (let x = Math.round(w * 0.3); x < Math.round(w * 0.8); x++) {
      if (col[x] / rows < 0.02) {
        run++;
        if (!best || run > best.len) best = { len: run, end: x };
      } else run = 0;
    }
    return best && best.len > w * 0.03 ? best.end - Math.round(best.len / 2) : null;
  }

  /* Read every table on a job card photo.
     small: the photo scaled down (≤2000px) for finding the tables.
     full:  the photo at full size (or null) for reading the text sharply.
     ocr:   { header(img), name(img), time(img), line(img) → text, nameScore?(text) → number }
     Returns [{ headText, lines: [text per row] }] or null if no yellow headers. */
  async function readCard(small, full, ocr, progress) {
    const bars = findYellowBars(small.data, small.width, small.height);
    if (!bars.length) return null;
    const slope = estimateSkew(small.data, small.width, small.height, bars);
    const regions = tableRegions(bars, small.width, small.height);
    const src = full || small, f = src.width / small.width;
    const sb = b => ({ x0: b.x0 * f, y0: b.y0 * f, x1: b.x1 * f, y1: b.y1 * f });
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const out = [];
    for (const [i, r] of regions.entries()) {
      if (progress) progress(i, regions.length);
      // Header: clean yellow-mask picture, about 70px tall.
      // (Read from the small copy: the yellow mask is cleanest there.)
      const head = despeckle(maskImage(small.data, small.width, r.text, 3, slope, small.height));
      let headText = await ocr.header(padCrop(head, 0, head.height, 20));
      if (!/\d[A-Z]\d\d/.test(headText.replace(/\s+/g, ''))) {
        // Part of the bar in shadow: try a plain black-and-white picture instead.
        const grey = bodyImage(small.data, small.width, r.text, 3, slope, small.height);
        headText += ' ' + await ocr.header(binarize(padCrop(grey, 0, grey.height, 20)));
      }
      // Rows: each about 64px tall. Name and time columns are read separately.
      const bs = clamp(64 / r.rowH, 1.5, 3.5);
      const body = bodyImage(src.data, src.width, sb(r.body), bs / f, slope, src.height);
      // The table is the first run of rows with no big gap; anything further
      // down (handwriting, other notes) is ignored.
      const rowPx = r.rowH * bs;
      const allBands = textBands(body, rowPx);
      // (textBands already stops at the bottom of the table; only drop a stray
      // band far below the rest.)
      const bands = [];
      for (const b of allBands) {
        const prev = bands[bands.length - 1];
        if (prev && b.y0 - prev.y1 > rowPx * 2.5) break;
        bands.push(b);
      }
      const split = columnSplit(body, bands);
      const lines = [];
      for (const b of bands) {
        if (split == null) {
          const grey = padCrop(body, b.y0, b.y1, 16);
          let text = (await ocr.line(binarize(grey))).trim();
          if (!/\d{3}/.test(text)) { const t2 = (await ocr.line(grey)).trim(); if (/\d{3}/.test(t2)) text = t2; }
          lines.push(text);
          continue;
        }
        const nameGrey = crop(body, 0, b.y0, split, b.y1, 16);
        const timeGrey = crop(body, split, b.y0, body.width, b.y1, 16);
        // Name: two readings, keep the one that best matches a known station.
        const n1 = (await ocr.name(binarize(nameGrey))).trim();
        let name = n1;
        if (ocr.nameScore) {
          const n2 = (await ocr.name(nameGrey)).trim();
          if (ocr.nameScore(n2) > ocr.nameScore(n1)) name = n2;
        }
        // Time: digits only (a ½ comes out as extra digits, which the parser understands).
        let time = (await ocr.time(binarize(timeGrey))).replace(/\s+/g, '');
        if (!/^\d{4,7}$/.test(time)) { const t2 = (await ocr.time(timeGrey)).replace(/\s+/g, ''); if (/^\d{4,7}$/.test(t2) || !/\d{4}/.test(time)) time = t2; }
        lines.push(`${name} ${time}`);
      }
      out.push({ headText, lines });
    }
    return out;
  }

  const api = { findYellowBars, tableRegions, parseTableText, maskImage, bodyImage, estimateSkew, textBands, padCrop, despeckle, binarize, readCard };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JobCardImage = api;
})(typeof window !== 'undefined' ? window : globalThis);
