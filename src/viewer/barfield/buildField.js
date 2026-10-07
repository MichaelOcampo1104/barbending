// Pure bar-field builder (spec section 5): bar rows -> chunked segment arrays.
// No DOM and no three.js, so it runs in a Web Worker and in plain Node tests.
// Relative imports keep their .js extension so Node can load this file.
import { genBarPoints, transformBarLocalPoint, distOffsets, distCount } from '../../bbs/shapes.js';

const S = 0.001; // app mm -> scene metres (same mapping as RebarMesh: x, z, -y)

export const DEFAULTS = Object.freeze({
  maxSegmentsPerChunk: 30000,
  maxChunkDepth: 6,
  minChunkEdgeM: 0.5,
  blockSegments: 256,
  maxBlockDepth: 14,
  minBlockEdgeM: 0.02,
  rowsPerYield: 400,
});

// Colour slots: the diameters that have a palette entry today; anything else is the default.
export const DIA_PALETTE = Object.freeze([10, 12, 16, 20, 25, 32, 40]);
export const DEFAULT_COLOR_IDX = DIA_PALETTE.length;

export function colorIndexForDia(dia) {
  const i = DIA_PALETTE.indexOf(Number(dia));
  return i < 0 ? DEFAULT_COLOR_IDX : i;
}

// Same radius rule as RebarMesh: dia/2 in metres with an 8 mm floor.
export function radiusMForDia(dia) {
  return Math.max(0.008, (Number(dia) || 16) / 2000);
}

export function* buildFieldSteps(rows, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const rowIds = o.rowIds || null;
  const n = rows.length;

  // ---- stage 1: per-row polylines, counts and the per-row tables ----
  const radiusM = new Float32Array(n);
  const colorIdx = new Uint8Array(n);
  const prep = new Array(n);
  let segTotal = 0;
  let skippedRows = 0;
  for (let i = 0; i < n; i++) {
    const row = rows[i];
    radiusM[i] = radiusMForDia(row && row.Dia);
    colorIdx[i] = colorIndexForDia(row && row.Dia);
    let p = null;
    try {
      const pts = genBarPoints(row).points.map((pt) => transformBarLocalPoint(row, pt));
      let ok = pts.length >= 2;
      for (let k = 0; ok && k < pts.length; k++) {
        ok = Number.isFinite(pts[k][0]) && Number.isFinite(pts[k][1]) && Number.isFinite(pts[k][2]);
      }
      const copies = distCount(row);
      if (ok && copies > 0) {
        p = { pts, px: Number(row.Pos_x) || 0, py: Number(row.Pos_y) || 0, pz: Number(row.Pos_z) || 0 };
        segTotal += (pts.length - 1) * copies;
      }
    } catch {
      p = null;
    }
    prep[i] = p;
    if (!p) skippedRows += 1;
    if ((i + 1) % o.rowsPerYield === 0) yield { stage: 'prepare', fraction: 0.15 * ((i + 1) / n) };
  }
  yield { stage: 'prepare', fraction: 0.15 };

  // ---- stage 2: expand every distribution copy into straight segments ----
  const segRaw = new Float32Array(segTotal * 6);
  const rowRaw = new Uint32Array(segTotal); // local row index per segment
  let used = 0;
  for (let i = 0; i < n; i++) {
    const p = prep[i];
    if (p) {
      const offs = distOffsets(rows[i]);
      const pts = p.pts;
      for (let c = 0; c < offs.length; c++) {
        const ox = offs[c][0], oy = offs[c][1], oz = offs[c][2];
        if (!(Number.isFinite(ox) && Number.isFinite(oy) && Number.isFinite(oz))) continue;
        for (let j = 1; j < pts.length; j++) {
          const a = pts[j - 1], b = pts[j];
          const o6 = used * 6;
          segRaw[o6] = (p.px + ox + a[0]) * S;
          segRaw[o6 + 1] = (p.pz + oz + a[2]) * S;
          segRaw[o6 + 2] = -(p.py + oy + a[1]) * S;
          segRaw[o6 + 3] = (p.px + ox + b[0]) * S;
          segRaw[o6 + 4] = (p.pz + oz + b[2]) * S;
          segRaw[o6 + 5] = -(p.py + oy + b[1]) * S;
          rowRaw[used] = i;
          used += 1;
        }
      }
      prep[i] = null;
    }
    if ((i + 1) % o.rowsPerYield === 0) yield { stage: 'expand', fraction: 0.15 + 0.4 * ((i + 1) / n) };
  }
  yield { stage: 'expand', fraction: 0.55 };

  // ---- stage 3: bounds + midpoints, then an adaptive octree ----
  const mid = new Float32Array(used * 3);
  const bmin = [Infinity, Infinity, Infinity];
  const bmax = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < used; i++) {
    const o6 = i * 6;
    for (let k = 0; k < 3; k++) {
      const a = segRaw[o6 + k], c = segRaw[o6 + 3 + k];
      mid[i * 3 + k] = (a + c) / 2;
      if (a < bmin[k]) bmin[k] = a;
      if (c < bmin[k]) bmin[k] = c;
      if (a > bmax[k]) bmax[k] = a;
      if (c > bmax[k]) bmax[k] = c;
    }
  }
  if (used === 0) { bmin.fill(0); bmax.fill(0); }

  const order = new Uint32Array(used);
  for (let i = 0; i < used; i++) order[i] = i;
  const scratch = new Uint32Array(used);
  const chunkRanges = []; // { lo, hi } into `order`
  const blockRanges = []; // { lo, hi } into `order`
  const stack = [{
    lo: 0, hi: used,
    cx: (bmin[0] + bmax[0]) / 2, cy: (bmin[1] + bmax[1]) / 2, cz: (bmin[2] + bmax[2]) / 2,
    hx: Math.max((bmax[0] - bmin[0]) / 2, 1e-3), hy: Math.max((bmax[1] - bmin[1]) / 2, 1e-3), hz: Math.max((bmax[2] - bmin[2]) / 2, 1e-3),
    depth: 0, inChunk: false,
  }];
  const counts = new Int32Array(8);
  const starts = new Int32Array(8);
  const fillAt = new Int32Array(8);
  let doneSegs = 0;
  let visited = 0;
  while (stack.length) {
    const nd = stack.pop();
    const count = nd.hi - nd.lo;
    if (count <= 0) continue;
    const edge = 2 * Math.max(nd.hx, nd.hy, nd.hz);
    let inChunk = nd.inChunk;
    if (!inChunk && (count <= o.maxSegmentsPerChunk || nd.depth >= o.maxChunkDepth || edge <= o.minChunkEdgeM)) {
      chunkRanges.push({ lo: nd.lo, hi: nd.hi });
      inChunk = true;
    }
    if (inChunk && (count <= o.blockSegments || nd.depth >= o.maxBlockDepth || edge <= o.minBlockEdgeM)) {
      blockRanges.push({ lo: nd.lo, hi: nd.hi });
      doneSegs += count;
      visited += 1;
      if ((visited & 63) === 0) yield { stage: 'chunk', fraction: Math.min(0.85, 0.55 + 0.3 * (doneSegs / used)) };
      continue;
    }
    counts.fill(0);
    for (let t = nd.lo; t < nd.hi; t++) {
      const s = order[t] * 3;
      counts[(mid[s] >= nd.cx ? 1 : 0) | (mid[s + 1] >= nd.cy ? 2 : 0) | (mid[s + 2] >= nd.cz ? 4 : 0)] += 1;
    }
    let acc = nd.lo;
    for (let c = 0; c < 8; c++) { starts[c] = acc; fillAt[c] = acc; acc += counts[c]; }
    for (let t = nd.lo; t < nd.hi; t++) {
      const sIdx = order[t];
      const s = sIdx * 3;
      const oc = (mid[s] >= nd.cx ? 1 : 0) | (mid[s + 1] >= nd.cy ? 2 : 0) | (mid[s + 2] >= nd.cz ? 4 : 0);
      scratch[fillAt[oc]] = sIdx;
      fillAt[oc] += 1;
    }
    order.set(scratch.subarray(nd.lo, nd.hi), nd.lo);
    for (let c = 0; c < 8; c++) {
      if (!counts[c]) continue;
      stack.push({
        lo: starts[c], hi: starts[c] + counts[c],
        cx: nd.cx + ((c & 1) ? nd.hx / 2 : -nd.hx / 2),
        cy: nd.cy + ((c & 2) ? nd.hy / 2 : -nd.hy / 2),
        cz: nd.cz + ((c & 4) ? nd.hz / 2 : -nd.hz / 2),
        hx: nd.hx / 2, hy: nd.hy / 2, hz: nd.hz / 2, depth: nd.depth + 1, inChunk,
      });
    }
  }
  chunkRanges.sort((a, b) => a.lo - b.lo);
  blockRanges.sort((a, b) => a.lo - b.lo);
  yield { stage: 'chunk', fraction: 0.85 };

  // ---- stage 4: gather segments in tree order, then bounds per block and chunk ----
  const seg = new Float32Array(used * 6);
  const rowOfVtx = new Float32Array(used * 2);
  const localRow = new Uint32Array(used);
  for (let i = 0; i < used; i++) {
    const s = order[i];
    const a = s * 6, b = i * 6;
    seg[b] = segRaw[a]; seg[b + 1] = segRaw[a + 1]; seg[b + 2] = segRaw[a + 2];
    seg[b + 3] = segRaw[a + 3]; seg[b + 4] = segRaw[a + 4]; seg[b + 5] = segRaw[a + 5];
    const lr = rowRaw[s];
    localRow[i] = lr;
    const gid = rowIds ? rowIds[lr] : lr;
    rowOfVtx[2 * i] = gid;
    rowOfVtx[2 * i + 1] = gid;
  }

  const B = blockRanges.length;
  const blocks = {
    start: new Int32Array(B), size: new Int32Array(B),
    bounds: new Float32Array(B * 6), maxRadiusM: new Float32Array(B),
  };
  for (let bi = 0; bi < B; bi++) {
    const { lo, hi } = blockRanges[bi];
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity, mr = 0;
    for (let i = lo; i < hi; i++) {
      const o6 = i * 6;
      for (let e = 0; e < 2; e++) {
        const x = seg[o6 + e * 3], y = seg[o6 + e * 3 + 1], z = seg[o6 + e * 3 + 2];
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      const r = radiusM[localRow[i]];
      if (r > mr) mr = r;
    }
    blocks.start[bi] = lo;
    blocks.size[bi] = hi - lo;
    blocks.bounds.set([x0, y0, z0, x1, y1, z1], bi * 6);
    blocks.maxRadiusM[bi] = mr;
  }

  const chunks = [];
  let bi = 0;
  for (const { lo, hi } of chunkRanges) {
    const blockStart = bi;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity, mr = 0;
    while (bi < B && blocks.start[bi] < hi) {
      const bo = bi * 6;
      if (blocks.bounds[bo] < x0) x0 = blocks.bounds[bo];
      if (blocks.bounds[bo + 1] < y0) y0 = blocks.bounds[bo + 1];
      if (blocks.bounds[bo + 2] < z0) z0 = blocks.bounds[bo + 2];
      if (blocks.bounds[bo + 3] > x1) x1 = blocks.bounds[bo + 3];
      if (blocks.bounds[bo + 4] > y1) y1 = blocks.bounds[bo + 4];
      if (blocks.bounds[bo + 5] > z1) z1 = blocks.bounds[bo + 5];
      if (blocks.maxRadiusM[bi] > mr) mr = blocks.maxRadiusM[bi];
      bi += 1;
    }
    chunks.push({
      start: lo, count: hi - lo,
      min: [x0, y0, z0], max: [x1, y1, z1],
      center: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
      radius: 0.5 * Math.hypot(x1 - x0, y1 - y0, z1 - z0),
      maxRadiusM: mr, blockStart, blockCount: bi - blockStart,
    });
  }
  yield { stage: 'done', fraction: 1 };

  return {
    rowCount: n, segCount: used, chunkCount: chunks.length, skippedRows,
    seg, rowOfVtx, rows: { radiusM, colorIdx }, chunks, blocks,
    bounds: { min: bmin, max: bmax },
  };
}

export function buildField(rows, options = {}) {
  const it = buildFieldSteps(rows, options);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}
