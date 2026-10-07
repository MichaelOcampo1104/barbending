# BarField Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-copy bar meshes with a worker-built, spatially chunked, GPU-instanced renderer (lines far, tubes near) so a project of 1M+ physical bars stays interactive on an Intel integrated GPU.

**Architecture:** A pure `buildField` turns bar rows into chunked segment arrays (run in a Web Worker). `BarField.jsx` owns the GPU objects: one line object per chunk, instanced tube objects created lazily for chunks near the camera, and a per-row state texture that hides, tints or overlays rows. Selected and just-edited rows are drawn by the existing `RebarMesh` (the overlay). Clicks are resolved by a pure ray picker over the chunk data. The new renderer is opt-in with `?renderer=field` until Task 10 makes it the default.

**Tech Stack:** React 19, `@react-three/fiber` 9, three 0.186 (WebGL2 only), zustand 5, Vite 8 (module workers), Node 24 `node --test` for unit tests, headless Edge over CDP for browser checks.

**Spec:** `docs/superpowers/specs/2026-10-07-barfield-renderer-design.md` (read it first; this plan implements sections 4–11 of it, milestones 1–6; milestone 7, render-on-demand, is a separate later plan).

## Global Constraints

Every task's requirements implicitly include this section. Values are copied from the spec.

- **No new runtime dependencies.** The worker uses `new Worker(new URL('./barField.worker.js', import.meta.url), { type: 'module' })`.
- **Relative imports inside `src/viewer/barfield/` keep their `.js`/`.jsx` extension** so plain Node tests can load the pure modules.
- **Pure modules** (`buildField.js`, `rowState.js`, `diffRows.js`, `lod.js`, `quality.js`, `fieldPick.js`, `workerCore.js`, `fieldClient.js`) must not import `three`, React or touch the DOM at import time.
- **Data model, CSV, BBS table, store actions, IFC, box-select are unchanged.** Hover highlight is not added.
- **Scene mapping:** app `(x, y, z)` mm → scene `(x, z, −y)` metres (same as `RebarMesh`). Radius per row is `max(0.008, Dia / 2000)` metres. Palette slots follow diameters 10, 12, 16, 20, 25, 32, 40; anything else uses the default amber `#f59e0b`.
- **Chunking:** adaptive octree, split while a node holds more than **30,000** segments, depth < **6**, edge > **0.5 m**; pick blocks of at most **256** segments inside each chunk.
- **LOD:** tube when apparent bar width ≥ **3 px**, back to lines below **2 px**; recomputed at most every **100 ms**; triangle budget **5M** by default (12 triangles per segment); cache tube buffers for the **64** most recently used chunks; `barDetail` is `'auto' | 'lines' | 'tubes'` (default `'auto'`).
- **Selection:** up to **300** selected rows use the overlay; more than 300 are tinted in place.
- **Edits:** edited rows become overlay at once; after **400 ms** without edits they move into a delta chunk; full rebuild when the delta exceeds about **5%** of rows, after **10 s** idle with a non-empty delta, or when the array length changes.
- **Picking:** tolerance **6 px**; nearest hit along the ray wins; hidden and overlay rows are skipped; hits outside the active section box are ignored.
- **Adaptive quality:** target frame time **33 ms**; while interacting step down one level when the frame-time EMA exceeds **40 ms** for **10** frames; step up when it stays below **24 ms** for **2 s**; restore full quality **250 ms** after interaction ends. Levels `(dpr, triangle budget)`: `(1.75, 5M)`, `(1.25, 3M)`, `(1.0, 1.5M)`, `(1.0, 0.5M)`.
- **Success budgets** (reference machine: Intel UHD, 1600×900, DPR 1, no IFC, section box on): 1M bars (25,000 rows) ≥ **30 fps** overview idle and orbiting, ≥ **24 fps** close-up; 3M bars ≥ **15 fps** overview; viewport drawn **< 5 s** after import at 1M bars; longest main-thread block from field work ≤ **200 ms**; JS heap after import and a select/edit/undo cycle < **1.5 GB** at 1M bars; click pick ≤ **16 ms** at 3M bars.
- **After every task:** `npm test` passes, `npm run lint` exits 0, `npm run build` passes, then commit. Commit messages end with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (pass it as a second `-m`).
- **Platform:** Windows 11 + Git Bash, Node 24. The perf rig drives Microsoft Edge (`EDGE_PATH` overrides `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`). Work on branch `feat/barfield-renderer`.

---

## File Structure

Create (all new):

| File | Responsibility |
|---|---|
| `src/viewer/barfield/buildField.js` | Pure: rows → `FieldData` (segments, chunks, pick blocks) |
| `src/viewer/barfield/workerCore.js` | Pure: worker message handling (`build` → `progress` / `built` / `error`) |
| `src/viewer/barfield/barField.worker.js` | 3-line Web Worker shim around `workerCore.js` |
| `src/viewer/barfield/fieldClient.js` | `FieldBuilder`: worker client with stale-result dropping and main-thread fallback |
| `src/viewer/barfield/rowState.js` | Pure: row state constants, texture packing helpers, hide / overlay / tint computation |
| `src/viewer/barfield/fieldShaders.js` | Line and tube `ShaderMaterial`s (clipping, row-state lookup, colour) |
| `src/viewer/barfield/tubes.js` | Instanced tube geometry per chunk |
| `src/viewer/barfield/fieldObjects.js` | `FieldView`: GPU objects, row texture, tube cache, delta chunks |
| `src/viewer/barfield/lod.js` | Pure: which chunks draw as tubes |
| `src/viewer/barfield/qualityState.js` | Shared adaptive-quality values read by the LOD |
| `src/viewer/barfield/quality.js` | Pure: adaptive quality controller |
| `src/viewer/barfield/QualityController.jsx` | R3F component: feeds frame times to `quality.js`, applies pixel ratio |
| `src/viewer/barfield/fieldPick.js` | Pure: ray → chunk bounds → pick blocks → segments → row |
| `src/viewer/barfield/fieldRegistry.js` | Module-level handle so `PickHandler` / `QueryHandler` can reach the active field |
| `src/viewer/barfield/diffRows.js` | Pure: which rows changed geometry between two `bars` arrays |
| `src/viewer/barfield/fieldStatus.js` | Tiny external store for the "updating" badge + `window.__barfield` stats |
| `src/viewer/barfield/FieldBadge.jsx` | DOM badge ("Building bars… 62%" / fallback notice) |
| `src/viewer/barfield/rendererFlag.js` | `?renderer=field|legacy` flag + WebGL2 support check |
| `src/viewer/barfield/BarField.jsx` | R3F component composing all of the above |
| `tests/barfield/helpers.mjs` | Shared test fixtures |
| `tests/barfield/*.test.mjs` | One test file per pure module |
| `scripts/perf/lib/cdp.mjs`, `scripts/perf/lib/instrument.mjs` | CDP driver + in-page instrumentation |
| `scripts/perf/gen_project.mjs`, `cdp_bench.mjs`, `check_field.mjs`, `budgets.json`, `README.md` | Committed performance rig |

Modify: `package.json` (test script), `.gitignore`, `src/store.js` (`barDetail`), `src/App.jsx` (Detail selector, badge), `src/viewer/Scene.jsx` (wiring, shared click handlers, pick / query integration, quality controller), `README.md`, `agent.md`, `overview.md`, `CHANGELOG.md`.

---

### Task 1: `buildField` core and test harness

**Files:**
- Create: `src/viewer/barfield/buildField.js`
- Create: `tests/barfield/helpers.mjs`
- Create: `tests/barfield/buildField.test.mjs`
- Modify: `package.json` (add `"test"` script)

**Interfaces:**
- Consumes: `genBarPoints(bar) → { points: [[x,y,z]…] }`, `transformBarLocalPoint(bar, [x,y,z]) → [x,y,z]`, `distOffsets(bar) → [[ox,oy,oz]…]`, `distCount(bar) → number` from `src/bbs/shapes.js`.
- Produces (later tasks rely on these exact names and shapes):
  - `DEFAULTS` — frozen object `{ maxSegmentsPerChunk, maxChunkDepth, minChunkEdgeM, blockSegments, maxBlockDepth, minBlockEdgeM, rowsPerYield }`.
  - `DIA_PALETTE` (`[10,12,16,20,25,32,40]`), `DEFAULT_COLOR_IDX` (`7`), `colorIndexForDia(dia) → 0..7`, `radiusMForDia(dia) → metres`.
  - `buildFieldSteps(rows, options?) → Generator<{ stage, fraction }, FieldData>`; `buildField(rows, options?) → FieldData`. `options.rowIds` (optional array, local index → id written to `rowOfVtx`) plus any key of `DEFAULTS`.
  - `FieldData`:
    ```
    { rowCount, segCount, chunkCount, skippedRows,
      seg: Float32Array(6*segCount),        // start xyz, end xyz, scene metres
      rowOfVtx: Float32Array(2*segCount),   // row id per vertex (same value twice per segment)
      rows: { radiusM: Float32Array(rowCount), colorIdx: Uint8Array(rowCount) },  // local row index
      chunks: [{ start, count, min:[3], max:[3], center:[3], radius, maxRadiusM, blockStart, blockCount }],
      blocks: { start: Int32Array(B), size: Int32Array(B), bounds: Float32Array(6*B), maxRadiusM: Float32Array(B) },
      bounds: { min:[3], max:[3] } }
    ```
    Chunks are sorted by `start` and partition `[0, segCount)`; blocks are sorted by `start`, partition each chunk and are referenced by `chunk.blockStart/blockCount`.

- [ ] **Step 1: Add the test script and the fixtures**

Edit `package.json`: in `"scripts"`, add a line after `"lint": "oxlint",`:

```json
    "test": "node --test \"tests/**/*.test.mjs\"",
```

Create `tests/barfield/helpers.mjs`:

```js
// Shared fixtures for the barfield tests.
import { defaultBar } from '../../src/bbs/shapes.js';

// A 3 m straight bar in plan (XY), start (1000, 2000, 500) mm, bar runs along +X.
export function straightRow(over = {}) {
  return {
    ...defaultBar('straight', 1), Plane: 'XY', Dia: 16, 'Length of Bar': 3000,
    Pos_x: 1000, Pos_y: 2000, Pos_z: 500, Pos_Rotation: 0,
    qty_x: 1, spacing_x: 150, qty_y: 1, spacing_y: 150, ...over,
  };
}

// A two-leg section profile (1000 mm along +X, then 500 mm up) in the XZ plane.
export function profileRow(over = {}) {
  return {
    ...defaultBar('profile', 2), Plane: 'XZ', Dia: 20,
    legs: JSON.stringify([[1000, 0], [500, 90]]),
    Pos_x: 0, Pos_y: 0, Pos_z: 0, qty_x: 1, spacing_x: 0, qty_y: 1, spacing_y: 150, ...over,
  };
}

// Deterministic pseudo-random generator (mulberry32) so spread tests are repeatable.
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// n straight rows spread over a 100 x 50 x 20 m box, each with `copies` copies.
export function spreadRows(n, copies, seed = 1) {
  const r = rng(seed);
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push(straightRow({
      Rebar_tag: i + 1, Bar_mark: `B${i + 1}`, Dia: [10, 12, 16, 20, 25][i % 5],
      Pos_x: Math.round(r() * 100000), Pos_y: Math.round(r() * 50000), Pos_z: Math.round(r() * 20000),
      'Length of Bar': 2000 + Math.round(r() * 6000), Pos_Rotation: r() < 0.5 ? 0 : 90, qty_y: copies,
    }));
  }
  return rows;
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/barfield/buildField.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildField, buildFieldSteps, colorIndexForDia, radiusMForDia, DIA_PALETTE, DEFAULT_COLOR_IDX,
} from '../../src/viewer/barfield/buildField.js';
import { straightRow, profileRow, spreadRows } from './helpers.mjs';

const near = (a, b, eps = 1e-5) => Math.abs(a - b) <= eps;
const assertNear = (actual, expected, label) => {
  assert.equal(actual.length, expected.length, `${label}: length`);
  for (let i = 0; i < expected.length; i++) assert.ok(near(actual[i], expected[i]), `${label}[${i}] ${actual[i]} vs ${expected[i]}`);
};

test('palette: known diameters map to their slot, others to the default', () => {
  assert.deepEqual([...DIA_PALETTE], [10, 12, 16, 20, 25, 32, 40]);
  assert.equal(colorIndexForDia(16), 2);
  assert.equal(colorIndexForDia(40), 6);
  assert.equal(colorIndexForDia(13), DEFAULT_COLOR_IDX);
  assert.equal(colorIndexForDia(undefined), DEFAULT_COLOR_IDX);
});

test('radius: dia/2 in metres with an 8 mm floor, like RebarMesh', () => {
  assert.equal(radiusMForDia(10), 0.008);
  assert.equal(radiusMForDia(16), 0.008);
  assert.equal(radiusMForDia(32), 0.016);
  assert.equal(radiusMForDia(undefined), 0.008);
});

test('one straight bar becomes one segment in scene space (x, z, -y) / 1000', () => {
  const f = buildField([straightRow()]);
  assert.equal(f.rowCount, 1);
  assert.equal(f.segCount, 1);
  assert.equal(f.skippedRows, 0);
  assertNear(f.seg, [1, 0.5, -2, 4, 0.5, -2], 'seg');
  assert.deepEqual([...f.rowOfVtx], [0, 0]);
  assert.equal(f.chunks.length, 1);
  assert.equal(f.chunks[0].start, 0);
  assert.equal(f.chunks[0].count, 1);
});

test('distribution copies become separate segments', () => {
  const f = buildField([straightRow({ qty_y: 3, spacing_y: 150 })]);
  assert.equal(f.segCount, 3);
  const zs = [];
  for (let i = 0; i < 3; i++) zs.push(f.seg[i * 6 + 2]);
  zs.sort((a, b) => a - b);
  assertNear(zs, [-2.3, -2.15, -2.0], 'z of copies');
});

test('a 3-point profile with 2 copies yields 4 segments and per-row ids', () => {
  const f = buildField([straightRow(), profileRow({ qty_y: 2 })]);
  assert.equal(f.segCount, 1 + 4);
  const perRow = [0, 0];
  for (let i = 0; i < f.segCount; i++) perRow[f.rowOfVtx[2 * i]] += 1;
  assert.deepEqual(perRow, [1, 4]);
  for (let i = 0; i < f.segCount; i++) assert.equal(f.rowOfVtx[2 * i], f.rowOfVtx[2 * i + 1]);
  assert.deepEqual([...f.rows.colorIdx], [2, 3]);
  assertNear(f.rows.radiusM, [0.008, 0.01], 'radiusM');
});

test('rows with non-finite geometry are skipped and counted', () => {
  const f = buildField([straightRow(), straightRow({ 'Length of Bar': Infinity }), straightRow({ Pos_x: 5000 })]);
  assert.equal(f.rowCount, 3);
  assert.equal(f.skippedRows, 1);
  assert.equal(f.segCount, 2);
  const ids = new Set();
  for (let i = 0; i < f.segCount; i++) ids.add(f.rowOfVtx[2 * i]);
  assert.deepEqual([...ids].sort(), [0, 2]);
});

test('chunks and pick blocks partition the segments and bound them', () => {
  const rows = spreadRows(300, 50, 7); // 15,000 segments
  const f = buildField(rows, { maxSegmentsPerChunk: 1000, blockSegments: 64 });
  assert.equal(f.segCount, 15000);
  assert.ok(f.chunks.length > 4, `expected several chunks, got ${f.chunks.length}`);
  let expectStart = 0;
  for (const ch of f.chunks) {
    assert.equal(ch.start, expectStart, 'chunks are contiguous');
    expectStart += ch.count;
    for (let i = ch.start; i < ch.start + ch.count; i++) {
      for (let k = 0; k < 6; k++) {
        const axis = k % 3;
        const v = f.seg[i * 6 + k];
        assert.ok(v >= ch.min[axis] - 1e-4 && v <= ch.max[axis] + 1e-4, 'endpoint inside its chunk box');
      }
    }
  }
  assert.equal(expectStart, f.segCount, 'chunks cover every segment');
  let blockTotal = 0;
  for (const ch of f.chunks) {
    let p = ch.start;
    for (let b = ch.blockStart; b < ch.blockStart + ch.blockCount; b++) {
      assert.equal(f.blocks.start[b], p, 'blocks are contiguous inside their chunk');
      assert.ok(f.blocks.size[b] <= 64, `block of ${f.blocks.size[b]} segments exceeds 64`);
      for (let i = p; i < p + f.blocks.size[b]; i++) {
        for (let k = 0; k < 6; k++) {
          const axis = k % 3;
          const v = f.seg[i * 6 + k];
          assert.ok(v >= f.blocks.bounds[b * 6 + axis] - 1e-4 && v <= f.blocks.bounds[b * 6 + 3 + axis] + 1e-4, 'endpoint inside its block box');
        }
      }
      p += f.blocks.size[b];
      blockTotal += 1;
    }
    assert.equal(p, ch.start + ch.count, 'blocks cover their chunk');
  }
  assert.equal(blockTotal, f.blocks.start.length);
  for (const ch of f.chunks) assert.ok(ch.maxRadiusM >= 0.008);
});

test('rowIds maps local rows to the ids written in rowOfVtx (delta builds)', () => {
  const f = buildField([straightRow(), straightRow({ Pos_x: 9000 })], { rowIds: [40, 77] });
  const ids = new Set();
  for (let i = 0; i < f.segCount; i++) ids.add(f.rowOfVtx[2 * i]);
  assert.deepEqual([...ids].sort((a, b) => a - b), [40, 77]);
});

test('buildFieldSteps reports monotonic progress and matches buildField', () => {
  const rows = spreadRows(1200, 3, 3);
  const it = buildFieldSteps(rows, { rowsPerYield: 100 });
  let r = it.next();
  const fractions = [];
  while (!r.done) { fractions.push(r.value.fraction); r = it.next(); }
  assert.ok(fractions.length > 5, 'several progress reports');
  for (let i = 1; i < fractions.length; i++) assert.ok(fractions[i] >= fractions[i - 1], 'monotonic');
  assert.ok(fractions[0] >= 0 && fractions[fractions.length - 1] <= 1);
  const g = buildField(rows, { rowsPerYield: 100 });
  assert.equal(r.value.segCount, g.segCount);
  assert.equal(r.value.chunks.length, g.chunks.length);
});

test('an empty row list builds an empty field', () => {
  const f = buildField([]);
  assert.equal(f.segCount, 0);
  assert.equal(f.chunks.length, 0);
  assert.equal(f.blocks.start.length, 0);
  assert.deepEqual(f.bounds, { min: [0, 0, 0], max: [0, 0, 0] });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../src/viewer/barfield/buildField.js'`.

- [ ] **Step 4: Implement `buildField.js`**

Create `src/viewer/barfield/buildField.js`:

```js
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 9 tests in `buildField.test.mjs`, 0 failures.

- [ ] **Step 6: Lint and build**

Run: `npm run lint` — Expected: exit code 0 (warnings in untouched files are fine, none in `src/viewer/barfield/`).
Run: `npm run build` — Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add package.json src/viewer/barfield/buildField.js tests/barfield/helpers.mjs tests/barfield/buildField.test.mjs
git commit -m "feat(barfield): pure buildField (segments, octree chunks, pick blocks) with node tests" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Committed performance rig

**Files:**
- Create: `scripts/perf/lib/cdp.mjs`
- Create: `scripts/perf/lib/instrument.mjs`
- Create: `scripts/perf/gen_project.mjs`
- Create: `scripts/perf/cdp_bench.mjs`
- Create: `scripts/perf/budgets.json`
- Create: `scripts/perf/README.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: a running app at some URL (dev server `npm run dev`, or `npx vite preview`); Microsoft Edge.
- Produces:
  - `launchBrowser({ dpr?, width?, height?, instrument? }) → { send, ev, close, sleep, isCrashed, consoleErrors }` and `sleep(ms)` from `scripts/perf/lib/cdp.mjs`.
  - `INSTR` (string) from `scripts/perf/lib/instrument.mjs`: installs `window.__gl`, `window.__rec`, `__startRec()`, `__stopRec()`, `__gpuInfo()`, `__status()`, `__lat(fn)`.
  - CLI `node scripts/perf/gen_project.mjs <rows> <avgCopiesPerRow> <name> [seed]` → writes `scripts/perf/out/<name>.json`.
  - CLI `node scripts/perf/cdp_bench.mjs --url <app url> [--project <file>] [--label x] [--dpr 1] [--expect <bars>] [--budget <key>] [--enforce]` → prints `RESULT {json}` and appends to `scripts/perf/out/results.jsonl`.
  - `window.__barfield` is read by the bench when present: `{ ready, version, rows, segments, chunks, buildMs, maxBlockMs, usingFallback }` (provided by Task 5).

- [ ] **Step 1: Ignore the rig's output folder**

Append to `.gitignore`:

```
# Performance rig output (generated projects, results, screenshots)
scripts/perf/out/
```

- [ ] **Step 2: Write the CDP driver**

Create `scripts/perf/lib/cdp.mjs`:

```js
// Minimal Chrome DevTools Protocol driver for headless Edge with the real GPU (Windows).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

export async function launchBrowser({ dpr = 1, width = 1600, height = 900, instrument = '' } = {}) {
  const port = 9400 + Math.floor(Math.random() * 500);
  const profile = path.join(os.tmpdir(), `barbending-perf-edge-${port}`);
  const proc = spawn(EDGE, [
    '--headless=new', '--no-sandbox', '--hide-scrollbars', `--window-size=${width},${height}`,
    `--force-device-scale-factor=${dpr}`, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--js-flags=--max-old-space-size=8192', 'about:blank',
  ], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await sleep(300);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch { /* retry */ }
  }
  if (!wsUrl) { proc.kill(); throw new Error('Edge did not expose a debuggable page (set EDGE_PATH?)'); }

  const ws = new WebSocket(wsUrl);
  let nid = 0;
  let crashed = false;
  const pend = new Map();
  const consoleErrors = [];
  const handlers = new Map(); // CDP event name -> listener, see on()
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data.toString());
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
    if (m.method && handlers.has(m.method)) handlers.get(m.method)(m.params);
    if (m.method === 'Inspector.targetCrashed') crashed = true;
    else if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push('EXC ' + String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push('console.error ' + (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 300));
    }
  };
  await new Promise((r) => { ws.onopen = r; });

  const send = (method, params = {}, timeoutMs = 180000) => new Promise((resolve, reject) => {
    const id = ++nid;
    const t = setTimeout(() => { pend.delete(id); reject(new Error('CDP-TIMEOUT ' + method)); }, timeoutMs);
    pend.set(id, (m) => { clearTimeout(t); if (m.error) reject(new Error(m.error.message)); else resolve(m.result); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expression, timeoutMs = 180000) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'eval error').slice(0, 300));
    return r.result.value;
  };

  for (const domain of ['Page', 'Runtime', 'Inspector', 'DOM', 'Performance']) await send(`${domain}.enable`);
  if (instrument) await send('Page.addScriptToEvaluateOnNewDocument', { source: instrument });

  const close = () => {
    try { ws.close(); } catch { /* gone */ }
    try { proc.kill(); } catch { /* gone */ }
    try { spawn('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { stdio: 'ignore' }); } catch { /* gone */ }
    setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* busy */ } }, 1500);
  };
  const on = (method, fn) => handlers.set(method, fn);
  return { send, ev, on, close, sleep, isCrashed: () => crashed, consoleErrors };
}
```

- [ ] **Step 3: Write the in-page instrumentation**

Create `scripts/perf/lib/instrument.mjs`:

```js
// Injected into every page before the app loads (Page.addScriptToEvaluateOnNewDocument).
// Counts WebGL draw calls / triangles / lines, records frame times, long tasks, and exposes helpers.
export const INSTR = `(() => {
  if (window.__instr) return; window.__instr = true;
  const g = window.__gl = { calls: 0, tris: 0, lines: 0, frames: 0, on: false };
  for (const proto of [window.WebGL2RenderingContext && WebGL2RenderingContext.prototype, window.WebGLRenderingContext && WebGLRenderingContext.prototype]) {
    if (!proto) continue;
    for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const o = proto[fn]; if (!o) continue;
      proto[fn] = function (mode, a, b, c, d) {
        if (g.on) {
          g.calls++;
          const inst = fn === 'drawElementsInstanced' ? d : fn === 'drawArraysInstanced' ? c : 1;
          const cnt = (fn === 'drawArrays' || fn === 'drawArraysInstanced') ? b : a;
          if (mode === 4) g.tris += (cnt / 3) * (inst || 1); else if (mode === 1 || mode === 3) g.lines += (cnt / 2) * (inst || 1);
        }
        return o.apply(this, arguments);
      };
    }
  }
  const rec = window.__rec = { on: false, t: [] };
  const loop = (now) => { if (rec.on) { rec.t.push(now); g.frames++; } requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  window.__lt = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ entryTypes: ['longtask'] }); } catch (e) {}
  window.__startRec = () => { rec.t.length = 0; g.calls = 0; g.tris = 0; g.lines = 0; g.frames = 0; g.on = true; rec.on = true; };
  window.__stopRec = () => {
    rec.on = false; g.on = false; const t = rec.t, d = [];
    for (let i = 1; i < t.length; i++) d.push(t[i] - t[i - 1]);
    d.sort((a, b) => a - b); const n = d.length; const sum = d.reduce((s, v) => s + v, 0);
    return { frames: t.length, fps: n ? +(1000 * n / sum).toFixed(1) : 0, p50ms: n ? +d[Math.floor(n * 0.5)].toFixed(1) : 0, p95ms: n ? +d[Math.floor(n * 0.95)].toFixed(1) : 0, worstMs: n ? +d[n - 1].toFixed(1) : 0,
      drawCallsPerFrame: g.frames ? Math.round(g.calls / g.frames) : 0, trisPerFrame: g.frames ? Math.round(g.tris / g.frames) : 0, linesPerFrame: g.frames ? Math.round(g.lines / g.frames) : 0 };
  };
  window.__gpuInfo = () => { const c = document.createElement('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl'); if (!gl) return 'no webgl'; const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); };
  window.__status = () => {
    // Read the status bar text ("… 60 fps · cam 11.4 m · 53 bars · 441.5 kg"); the span may also hold
    // controls (the Detail selector), so match on its text rather than on being a leaf element.
    const el = Array.from(document.querySelectorAll('.statusbar span')).find((e) => /\\d+\\s*fps\\s*·\\s*cam/.test(e.textContent));
    const m = el && el.textContent.match(/(\\d+)\\s*fps\\s*·\\s*cam\\s*([^·]+)·\\s*(\\d+)\\s*bars/);
    return { bars: m ? Number(m[3]) : -1, appFps: m ? Number(m[1]) : -1, t: performance.now() };
  };
  window.__lat = (fn) => new Promise((res) => { const t0 = performance.now(); fn(); requestAnimationFrame(() => requestAnimationFrame(() => res(+(performance.now() - t0).toFixed(1)))); });
})();`;
```

- [ ] **Step 4: Write the project generator**

Create `scripts/perf/gen_project.mjs`:

```js
// Generates a synthetic barbending project JSON for performance runs.
// usage: node scripts/perf/gen_project.mjs <rows> <avgCopiesPerRow> <name> [seed]
// Mix mirrors a real BBS: straight mats, bent bars, hooked links (2-axis grids), drawn profiles
// (cranks) and column ties over a 120 x 60 m footprint on 8 levels. Distribution grids carry the
// physical-bar count (like the DXF importer), so 25,000 rows x 40 copies ~ 1M physical bars.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [rowsS, copiesS, name, seedS = '1'] = process.argv.slice(2);
if (!rowsS || !copiesS || !name) {
  console.error('usage: node scripts/perf/gen_project.mjs <rows> <avgCopiesPerRow> <name> [seed]');
  process.exit(2);
}
const R = Number(rowsS), C = Number(copiesS);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `${name}.json`);

let s = Number(seedS) >>> 0;
const rnd = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const ur = (a, b) => a + rnd() * (b - a);
const DIAS = [10, 12, 16, 16, 20, 20, 25, 32];

const bars = [];
let physical = 0;
for (let i = 0; i < R; i++) {
  const tag = i + 1;
  const n = Math.max(1, Math.round(C * ur(0.5, 1.5)));
  const dia = pick(DIAS);
  const lvl = Math.floor(rnd() * 8) * 3000;
  const base = {
    Rebar_tag: tag, Bar_mark: `B${tag}`, Dia: dia, bond_condition: 'poor', Group: `Zone${i % 40}`,
    Pos_x: Math.round(ur(0, 120000)), Pos_y: Math.round(ur(0, 60000)), Pos_z: lvl + Math.round(ur(40, 250)),
    Pos_Rotation: 0, qty: 1, Visible: 1,
  };
  const r = rnd();
  let row, copies;
  if (r < 0.5) {
    const rot90 = rnd() < 0.5;
    row = { ...base, Rebar_Type: 'straight', Plane: 'XY', 'Length of Bar': Math.round(ur(2000, 9000) / 500) * 500,
      Pos_Rotation: rot90 ? 90 : 0, qty_x: rot90 ? n : 1, spacing_x: 150, qty_y: rot90 ? 1 : n, spacing_y: 150 };
    copies = n;
  } else if (r < 0.7) {
    row = { ...base, Rebar_Type: 'bent', Plane: 'XZ', 'Length of Bar': Math.round(ur(1500, 4000)), H: Math.round(ur(300, 900)),
      bent_up_down: 'up', hook_start: 'no', qty_x: 1, spacing_x: 0, qty_y: n, spacing_y: 200 };
    copies = n;
  } else if (r < 0.85) {
    const a = pick([2, 4, 5, 8]); const b = Math.max(1, Math.round(n / a));
    row = { ...base, Rebar_Type: 'c_link_with_hook', Plane: 'XZ', Pos_Rotation: 90, length: Math.round(ur(200, 1200)),
      c_length_a: 130, c_length_b: 130, double_hook: 'no', Dia: pick([10, 12, 13]), qty_x: a, spacing_x: 200, qty_y: b, spacing_y: 150 };
    copies = a * b;
  } else if (r < 0.95) {
    row = { ...base, Rebar_Type: 'profile', Plane: 'XZ',
      legs: JSON.stringify([[Math.round(ur(800, 2000)), 0], [Math.round(ur(300, 900)), 30], [Math.round(ur(800, 2000)), 0]]),
      qty_x: 1, spacing_x: 0, qty_y: n, spacing_y: -150 };
    copies = n;
  } else {
    row = { ...base, Rebar_Type: 'tie', Plane: 'XY', length: Math.round(ur(300, 800)), c_length_a: Math.round(ur(300, 800)), qty_z: n, spacing_z: 150 };
    copies = n;
  }
  physical += copies;
  bars.push(row);
}
const proj = { v: 1, app: 'barbending', savedAt: Date.now(), bars, concretes: [], refLines: [], cover: 40, bond: 'poor', selectedBar: 0, selectedBars: [0] };
fs.writeFileSync(out, JSON.stringify(proj));
console.log(`${out}: rows=${R} physical bars=${physical} size=${(fs.statSync(out).size / 1e6).toFixed(2)} MB`);
```

- [ ] **Step 5: Write the budgets**

Create `scripts/perf/budgets.json` (keys omitted here are not checked):

```json
{
  "p1m": { "minIdleFps": 30, "minOrbitFps": 30, "minCloseupFps": 24, "maxViewportMs": 5000, "maxHeapMB": 1500, "maxFieldBlockMs": 200 },
  "p3m": { "minIdleFps": 15 }
}
```

- [ ] **Step 6: Write the benchmark**

Create `scripts/perf/cdp_bench.mjs`:

```js
// Headless-Edge (GPU on) benchmark of the barbending app against a synthetic project.
// usage: node scripts/perf/cdp_bench.mjs --url <app url> [--project <file>] [--label x] [--dpr 1]
//        [--expect <physical bars>] [--budget <key in budgets.json>] [--enforce] [--detail auto|lines|tubes]
// Loads the project through the real "⤒ Project" file input, then measures load, memory, DOM size,
// draw calls, fps idle / orbit / zoom / close-up, and select / edit / undo latency.
// PROFILE=1 adds a CPU profile of the idle phase (use against the dev server for readable names).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, sleep } from './lib/cdp.mjs';
import { INSTR } from './lib/instrument.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });
const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
};
const url = arg('url');
if (!url) {
  console.error('usage: node scripts/perf/cdp_bench.mjs --url <app url> [--project file.json] [--label x] [--dpr 1] [--expect <bars>] [--budget p1m] [--enforce]');
  process.exit(2);
}
const projPath = arg('project', '-');
const label = arg('label', 'run');
const dpr = Number(arg('dpr', '1'));
const expected = Number(arg('expect', '0'));
const budgetKey = arg('budget', '');
const detail = arg('detail', ''); // bar detail preference to run with (field renderer)
const enforce = process.argv.includes('--enforce');

const R = { label, url, dpr, detail: detail || 'default' };
const tBench = Date.now();
// Progress goes to stderr so a stalled run is visible; the RESULT line on stdout is unchanged.
const phase = (name) => console.error(`[bench +${((Date.now() - tBench) / 1000).toFixed(1)}s] ${name}`);
const timeout = setTimeout(() => { R.status = 'GLOBAL-TIMEOUT'; finish(1); }, 12 * 60 * 1000);
let b = null;
let finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  if (b) { R.consoleErrors = b.consoleErrors.slice(0, 10); b.close(); }
  console.log('RESULT ' + JSON.stringify(R));
  fs.appendFileSync(path.join(outDir, 'results.jsonl'), JSON.stringify(R) + '\n');
  setTimeout(() => process.exit(code), 1500);
}

function checkBudget() {
  const all = JSON.parse(fs.readFileSync(path.join(here, 'budgets.json'), 'utf8'));
  const bud = all[budgetKey];
  if (!bud) { console.error(`no budget "${budgetKey}" in budgets.json`); return false; }
  const rows = [
    ['idle fps', R.idle && R.idle.fps, bud.minIdleFps, (v, lim) => v >= lim],
    ['orbit fps', R.orbit && R.orbit.fps, bud.minOrbitFps, (v, lim) => v >= lim],
    ['close-up fps', R.closeup && R.closeup.fps, bud.minCloseupFps, (v, lim) => v >= lim],
    ['viewport ready ms', R.viewportMs, bud.maxViewportMs, (v, lim) => v != null && v <= lim],
    ['heap MB after edit', R.afterEdit && R.afterEdit.jsHeapMB, bud.maxHeapMB, (v, lim) => v <= lim],
    ['longest field block ms', R.field && R.field.maxBlockMs, bud.maxFieldBlockMs, (v, lim) => v != null && v <= lim],
  ];
  let ok = true;
  for (const [name, value, limit, pass] of rows) {
    if (limit === undefined) continue;
    const good = value !== undefined && value !== null && pass(value, limit);
    if (!good) ok = false;
    console.log(`${good ? 'PASS' : 'FAIL'}  ${name}: ${value} (budget ${limit})`);
  }
  return ok;
}

try {
  b = await launchBrowser({ dpr, instrument: INSTR });
  const { send, ev } = b;
  const waitReady = async () => {
    for (let i = 0; i < 100; i++) {
      await sleep(300);
      try { if (await ev('!window.__old && !!document.querySelector("canvas") && !!window.__status', 5000)) return true; } catch { /* retry */ }
    }
    return false;
  };
  await send('Page.navigate', { url });
  let ready = await waitReady();
  if (ready && detail) {
    // Bar detail is a persisted preference: store it, then load the app again so the store reads it.
    await ev(`window.__old = true; localStorage.setItem('barbending.barDetail', ${JSON.stringify(detail)})`);
    await send('Page.navigate', { url });
    ready = await waitReady();
  }
  if (!ready) { R.status = 'APP-NOT-READY'; finish(1); }
  R.gpu = await ev('window.__gpuInfo()');
  phase('app ready');
  await sleep(1500);
  const metric = async () => {
    const o = {};
    for (const x of (await send('Performance.getMetrics')).metrics) o[x.name] = x.value;
    return { jsHeapMB: Math.round(o.JSHeapUsedSize / 1048576), domNodes: o.Nodes, layoutCount: o.LayoutCount, scriptSec: +o.ScriptDuration.toFixed(2) };
  };
  R.baseline = { ...(await metric()) };
  phase('measuring baseline');
  await ev('window.__startRec()'); await sleep(2000); R.baseline.idle = await ev('window.__stopRec()');

  if (projPath !== '-') {
    const root = await send('DOM.getDocument', { depth: 0 });
    const q = await send('DOM.querySelectorAll', { nodeId: root.root.nodeId, selector: 'input[type=file]' });
    const lt0 = await ev('window.__lt.length');
    const v0 = await ev('(window.__barfield && window.__barfield.version) || 0');
    const bars0 = (await ev('window.__status()')).bars; // read before the import starts
    phase('importing project');
    const tStart = Date.now();
    await send('DOM.setFileInputFiles', { files: [path.resolve(projPath)], nodeId: q.nodeIds[0] });
    // Poll; each evaluate only answers once the main thread is free again.
    const fieldReadyExpr = '!!(window.__barfield && window.__barfield.ready && window.__barfield.version > ' + v0 + ')';
    // The default project already has bars, so "the project is in" means the expected count, or any
    // count different from what the page showed before the import.
    const projectIn = (s) => s.bars > 0 && (expected ? s.bars === expected : s.bars !== bars0);
    let quick = 0, last = null, loaded = false, tFree = null, readyAt = null;
    while (Date.now() - tStart < 10 * 60 * 1000 && !b.isCrashed()) {
      const p0 = Date.now();
      try { last = await ev('window.__status()', 90000); } catch (e) { R.loadError = e.message; break; }
      const rt = Date.now() - p0;
      // First answer with the project's bars in the store: the BBS table's synchronous render (spec
      // section 2: not part of the viewport budget) has finished by then, so the page is free again.
      if (tFree === null && projectIn(last)) tFree = Date.now();
      if (readyAt === null && await ev(fieldReadyExpr, 90000).catch(() => false)) readyAt = Date.now();
      if (projectIn(last)) {
        quick = rt < 200 ? quick + 1 : 0;
        if (quick >= 3) { loaded = true; break; }
      }
      await sleep(80);
    }
    R.load = { ms: Date.now() - tStart, loaded, barsShown: last && last.bars };
    phase(`page responsive again after ${R.load.ms} ms (loaded=${loaded})`);
    if (!loaded) { R.status = b.isCrashed() ? 'CRASHED' : (R.loadError ? 'HUNG' : 'LOAD-INCOMPLETE'); finish(1); }
    // The field is drawn a little after the page is responsive again (build + install): keep waiting.
    if (readyAt === null && await ev('!!window.__barfield').catch(() => false)) {
      for (let i = 0; i < 600 && readyAt === null; i++) {
        if (await ev(fieldReadyExpr, 90000).catch(() => false)) readyAt = Date.now();
        else await sleep(100);
      }
    }
    // viewportMs: from the page being responsive until the bars are drawn (budgeted).
    // viewportWallMs: from the import until the bars are drawn, BBS table included (reported only).
    R.viewportMs = readyAt !== null && tFree !== null ? Math.max(0, readyAt - tFree) : null;
    R.viewportWallMs = readyAt !== null ? readyAt - tStart : null;
    phase(`bars drawn: viewportMs=${R.viewportMs} wall=${R.viewportWallMs}`);
    const lts = await ev(`window.__lt.slice(${lt0}).map(x => x[1])`);
    R.load.longTasks = lts.length;
    R.load.blockedMs = Math.round(lts.reduce((s, v) => s + v, 0));
    R.load.worstTaskMs = Math.round(Math.max(0, ...lts));
    R.afterLoad = await metric();
  }

  // Frame the whole model (worst case: everything in the frustum).
  await ev('(document.querySelector(\'button[title="Fit entire model in view"]\') || { click() {} }).click()');
  await sleep(2500);
  const prof = !!process.env.PROFILE;
  if (prof) { await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 500 }); await send('Profiler.start'); }
  phase('idle (whole model framed)');
  await ev('window.__startRec()'); await sleep(prof ? 6000 : 3000); R.idle = await ev('window.__stopRec()');
  phase(`idle ${R.idle.fps} fps`);
  if (prof) {
    const { profile } = await send('Profiler.stop', {}, 120000);
    const self = new Map();
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    let total = 0;
    profile.samples.forEach((id, i) => { const dt = (profile.timeDeltas[i] || 0) / 1000; total += dt; self.set(id, (self.get(id) || 0) + dt); });
    const bucket = (n) => {
      const u = n.callFrame.url || '', f = n.callFrame.functionName || '';
      if (f === '(idle)') return 'idle'; if (f === '(garbage collector)') return 'GC'; if (f === '(program)') return 'native/driver';
      if (/three/.test(u) && !/fiber|drei|stdlib|web-ifc/.test(u)) return 'three.js';
      if (/react-dom|scheduler/.test(u)) return 'react-dom'; if (/fiber/.test(u)) return 'r3f'; if (/drei/.test(u)) return 'drei';
      if (/\/src\//.test(u)) return 'app (/src)'; if (!u) return 'native/other';
      return 'other:' + u.split('/').slice(-1)[0].slice(0, 24);
    };
    const buckets = {};
    const fns = new Map();
    for (const [id, ms] of self) {
      const n = byId.get(id);
      const bk = bucket(n);
      buckets[bk] = (buckets[bk] || 0) + ms;
      const key = (n.callFrame.functionName || '(anon)') + ' @' + (n.callFrame.url || '').split('/').slice(-1)[0].slice(0, 28);
      fns.set(key, (fns.get(key) || 0) + ms);
    }
    R.profile = {
      totalMs: Math.round(total),
      buckets: Object.fromEntries(Object.entries(buckets).sort((x, y) => y[1] - x[1]).map(([k, v]) => [k, Math.round(v)])),
      top: [...fns].sort((x, y) => y[1] - x[1]).slice(0, 14).map(([k, v]) => [k, Math.round(v)]),
    };
  }

  const [cx, cy] = await ev('(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()');
  // Orbit: a real trusted middle-button drag in a circle.
  phase('orbit');
  await ev('window.__startRec()');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'middle', buttons: 4, clickCount: 1 });
  const tO = Date.now();
  let th = 0;
  while (Date.now() - tO < 4000) {
    th += 0.12;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + 140 * Math.cos(th), y: cy + 70 * Math.sin(th), button: 'middle', buttons: 4 });
    await sleep(8);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'middle', buttons: 0, clickCount: 1 });
  R.orbit = await ev('window.__stopRec()');
  phase(`orbit ${R.orbit.fps} fps`);
  await sleep(600);
  // Zoom: wheel in then out.
  phase('zoom');
  await ev('window.__startRec()');
  for (let i = 0; i < 25; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -100 }); await sleep(30); }
  for (let i = 0; i < 25; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: 100 }); await sleep(30); }
  R.zoom = await ev('window.__stopRec()');
  phase(`zoom ${R.zoom.fps} fps`);
  await sleep(500);
  // Close-up: dive into the model along the cursor ray, then measure the steady state there.
  phase('close-up');
  for (let i = 0; i < 60; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -100 }); await sleep(30); }
  await sleep(1500);
  await ev('window.__startRec()'); await sleep(3000); R.closeup = await ev('window.__stopRec()');
  phase(`close-up ${R.closeup.fps} fps`);

  // Interaction latencies (click -> two frames later).
  phase('latencies');
  R.latency = {};
  const lat = async (key, expr) => { try { R.latency[key] = await ev(expr, 90000); } catch (e) { R.latency[key] = 'ERR ' + e.message.slice(0, 40); } };
  await lat('selectRow_ms', 'window.__lat(() => { const tr = document.querySelectorAll("table tbody tr")[1]; if (tr) tr.click(); })');
  await lat('editDuplicate_ms', 'window.__lat(() => { const x = document.querySelector(\'button[title^="Copy"]\'); if (x) x.click(); })');
  await lat('undo_ms', 'window.__lat(() => { const x = document.querySelector(\'button[title^="Undo"]\'); if (x && !x.disabled) x.click(); })');
  R.afterEdit = await metric();
  phase('done');
  R.field = await ev('window.__barfield ? JSON.parse(JSON.stringify(window.__barfield)) : null');
  R.status = 'OK';
} catch (e) {
  R.status = b && b.isCrashed() ? 'CRASHED' : 'ERROR ' + String(e.message).slice(0, 160);
}
let code = R.status === 'OK' ? 0 : 1;
if (enforce && R.status === 'OK') code = checkBudget() ? 0 : 1;
finish(code);
```

- [ ] **Step 7: Write the README**

Create `scripts/perf/README.md`:

````markdown
# Performance rig

Measures how the app behaves with large synthetic projects, in a separate headless Edge that
uses the real GPU (Windows only). Nothing here touches your own browser session.

## Quick start

```bash
# 1. serve a build (production is the fair baseline)
npm run build && npx vite preview --port 5188 --host 127.0.0.1 &

# 2. generate projects (written to scripts/perf/out/, git-ignored)
node scripts/perf/gen_project.mjs 250 40 p10k 7        # ~10k bars
node scripts/perf/gen_project.mjs 25000 40 p1m 7       # ~1M bars  (expect 1002336)
node scripts/perf/gen_project.mjs 75000 40 p3m 11      # ~3M bars  (expect 3002391)

# 3. benchmark
node scripts/perf/cdp_bench.mjs --url "http://127.0.0.1:5188/?renderer=field" \
  --project scripts/perf/out/p1m.json --label field-1m --expect 1002336 --budget p1m --enforce
```

`--enforce` checks `budgets.json` (reference machine: Intel UHD, 1600×900, DPR 1, no IFC).
Without it the run only prints results. `PROFILE=1` adds a CPU profile (best against the dev server).

Reading the load numbers: `load.ms` is the wall-clock time until the page is responsive again, and
`load.blockedMs` is the main-thread time lost to long tasks — at 1M bars nearly all of that is the BBS
table rendering every row (sub-project B). `viewportMs` is the time from the page being responsive until
the bars are drawn (the budgeted number: the viewport only, as the spec defines it). `viewportWallMs` is
import-to-drawn wall-clock with the table included; it is reported, not budgeted. Both need the field
renderer (`?renderer=field`), which publishes `window.__barfield`.

## Scripts

| Script | Purpose |
|---|---|
| `gen_project.mjs` | Synthetic project JSON (mixed bar types, grids) |
| `cdp_bench.mjs` | Load time, memory, DOM size, draw calls, fps (idle / orbit / zoom / close-up), latencies |
| `check_field.mjs` | Functional checks of the field renderer against the legacy renderer (parity, picking, fallback) |

Set `EDGE_PATH` if Edge is not at `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`.
````

- [ ] **Step 8: Smoke-test the rig against the legacy renderer on a small project**

Run:

```bash
npm run build
npx vite preview --port 5188 --host 127.0.0.1 &
sleep 4
node scripts/perf/gen_project.mjs 250 40 p10k 7
node scripts/perf/cdp_bench.mjs --url "http://127.0.0.1:5188/" --project scripts/perf/out/p10k.json --label legacy-10k --expect 10163
```

Expected: a `RESULT {...}` line with `"status":"OK"`, a `gpu` string containing `Intel` or your GPU name (not `SwiftShader`), `load.loaded: true`, `idle.fps` between 5 and 15 (the legacy renderer at 10k bars; the spike measured 8.9), `idle.drawCallsPerFrame` ≈ 10,000, and `consoleErrors` empty or absent. Stop the preview server afterwards (`taskkill //F //IM node.exe` is too broad — close it with `Stop-Process` on the process listening on 5188, or leave it running for the next tasks).

- [ ] **Step 9: Commit**

```bash
git add .gitignore scripts/perf
git commit -m "chore(perf): commit the performance rig (generator, CDP bench, budgets)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Worker core and `FieldBuilder` client

**Files:**
- Create: `src/viewer/barfield/workerCore.js`
- Create: `src/viewer/barfield/barField.worker.js`
- Create: `src/viewer/barfield/fieldClient.js`
- Create: `tests/barfield/fieldClient.test.mjs`

**Interfaces:**
- Consumes: `buildFieldSteps(rows, options)` from Task 1.
- Produces:
  - `transferablesOf(data) → ArrayBuffer[]`, `handleBuildMessage(msg, post)` from `workerCore.js`. Protocol — in: `{ type: 'build', id, rows, options }`; out: `{ type: 'progress', id, fraction }` (throttled to one per 50 ms), `{ type: 'built', id, data }` (with `transferablesOf(data)`), `{ type: 'error', id, message }`.
  - `class FieldBuilder` from `fieldClient.js`: `new FieldBuilder({ createWorker?, onProgress?, sliceMs? = 12 })`, `.build(rows, options?) → Promise<FieldData | null>` (resolves `null` when a newer build superseded it or the builder was disposed; rejects with `Error` when the build fails), `.dispose()`, `.usingFallback` (boolean, true once the worker failed and builds run on the main thread in `sliceMs` slices; the first slice is deferred, so a superseded build never runs).

- [ ] **Step 1: Write the failing tests**

Create `tests/barfield/fieldClient.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { FieldBuilder } from '../../src/viewer/barfield/fieldClient.js';
import { handleBuildMessage } from '../../src/viewer/barfield/workerCore.js';
import { straightRow, spreadRows } from './helpers.mjs';

// A fake Web Worker that runs the real worker core on this thread, asynchronously.
function fakeWorker({ failWith = null } = {}) {
  return () => {
    const w = {
      onmessage: null, onerror: null, onmessageerror: null, terminated: false,
      postMessage(msg) {
        queueMicrotask(() => {
          if (w.terminated) return;
          if (failWith) { if (w.onerror) w.onerror(new Error(failWith)); return; }
          handleBuildMessage(msg, (m) => { if (!w.terminated && w.onmessage) w.onmessage({ data: m }); });
        });
      },
      terminate() { w.terminated = true; },
    };
    return w;
  };
}

test('build resolves the FieldData from the worker', async () => {
  const fb = new FieldBuilder({ createWorker: fakeWorker() });
  const data = await fb.build([straightRow(), straightRow({ qty_y: 4 })]);
  assert.equal(data.segCount, 5);
  assert.equal(fb.usingFallback, false);
  fb.dispose();
});

test('a newer build supersedes an older one (stale result resolves null)', async () => {
  const fb = new FieldBuilder({ createWorker: fakeWorker() });
  const first = fb.build([straightRow()]);
  const second = fb.build([straightRow(), straightRow({ Pos_x: 9000 })]);
  assert.equal(await first, null);
  assert.equal((await second).segCount, 2);
  fb.dispose();
});

test('a worker error falls back to the main thread and still resolves', async () => {
  const fb = new FieldBuilder({ createWorker: fakeWorker({ failWith: 'boom' }) });
  const data = await fb.build([straightRow(), straightRow({ qty_y: 3 })]);
  assert.equal(data.segCount, 4);
  assert.equal(fb.usingFallback, true);
  fb.dispose();
});

test('a worker that cannot be created falls back to the main thread', async () => {
  const fb = new FieldBuilder({ createWorker: () => { throw new Error('no workers here'); } });
  const data = await fb.build([straightRow()]);
  assert.equal(data.segCount, 1);
  assert.equal(fb.usingFallback, true);
  fb.dispose();
});

test('the main-thread fallback reports progress and drops stale builds', async () => {
  const seen = [];
  // sliceMs 0 = one generator step per slice, so progress is reported deterministically
  const fb = new FieldBuilder({ createWorker: () => { throw new Error('none'); }, onProgress: (f) => seen.push(f), sliceMs: 0 });
  const a = fb.build(spreadRows(1500, 2, 5));
  const b = fb.build([straightRow()]);
  assert.equal(await a, null, 'the superseded build never runs');
  assert.equal((await b).segCount, 1);
  const c = await fb.build(spreadRows(1500, 2, 6));
  assert.equal(c.rowCount, 1500);
  assert.ok(seen.length > 0, 'progress reported while slicing');
  fb.dispose();
});

test('dispose resolves pending builds with null', async () => {
  const fb = new FieldBuilder({ createWorker: fakeWorker() });
  const p = fb.build([straightRow()]);
  fb.dispose();
  assert.equal(await p, null);
});

test('a build error inside the worker rejects the promise', async () => {
  const fb = new FieldBuilder({ createWorker: fakeWorker() });
  // rows must be an array; null makes buildFieldSteps throw (rows.length) inside handleBuildMessage
  await assert.rejects(() => fb.build(null), /./);
  fb.dispose();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../src/viewer/barfield/fieldClient.js'` (the Task 1 tests still pass).

- [ ] **Step 3: Implement the worker core and the shim**

Create `src/viewer/barfield/workerCore.js`:

```js
// Pure worker logic (testable in Node): runs buildFieldSteps and reports through `post`.
import { buildFieldSteps } from './buildField.js';

export function transferablesOf(data) {
  return [
    data.seg.buffer, data.rowOfVtx.buffer, data.rows.radiusM.buffer, data.rows.colorIdx.buffer,
    data.blocks.start.buffer, data.blocks.size.buffer, data.blocks.bounds.buffer, data.blocks.maxRadiusM.buffer,
  ];
}

export function handleBuildMessage(msg, post) {
  if (!msg || msg.type !== 'build') return;
  const { id, rows, options } = msg;
  try {
    const it = buildFieldSteps(rows, options);
    let r = it.next();
    let lastPost = 0;
    while (!r.done) {
      const now = Date.now();
      if (now - lastPost > 50) { post({ type: 'progress', id, fraction: r.value.fraction }); lastPost = now; }
      r = it.next();
    }
    post({ type: 'built', id, data: r.value }, transferablesOf(r.value));
  } catch (err) {
    post({ type: 'error', id, message: String((err && err.message) || err) });
  }
}
```

Create `src/viewer/barfield/barField.worker.js`:

```js
import { handleBuildMessage } from './workerCore.js';

self.onmessage = (e) => handleBuildMessage(e.data, (m, transfer) => self.postMessage(m, transfer || []));
```

- [ ] **Step 4: Implement the client**

Create `src/viewer/barfield/fieldClient.js`:

```js
// Worker client: latest build wins, stale results resolve null, and if the worker fails the same
// build runs on the main thread in 12 ms slices (spec section 9.1).
import { buildFieldSteps } from './buildField.js';

function defaultCreateWorker() {
  return new Worker(new URL('./barField.worker.js', import.meta.url), { type: 'module' });
}

// The first slice is deferred too, so a build that is superseded right after it was requested
// never runs at all. `sliceMs` = main-thread time per slice (0 = one generator step per slice).
function runSliced(rows, options, onProgress, isStale, sliceMs) {
  return new Promise((resolve, reject) => {
    let it;
    try { it = buildFieldSteps(rows, options); } catch (e) { reject(e); return; }
    const step = () => {
      if (isStale()) { resolve(null); return; }
      const t0 = performance.now();
      try {
        let r = it.next();
        while (!r.done && performance.now() - t0 < sliceMs) r = it.next();
        if (r.done) { resolve(r.value); return; }
        onProgress(r.value.fraction);
      } catch (e) { reject(e); return; }
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  });
}

export class FieldBuilder {
  constructor({ createWorker = defaultCreateWorker, onProgress = () => {}, sliceMs = 12 } = {}) {
    this.createWorker = createWorker;
    this.onProgress = onProgress;
    this.sliceMs = sliceMs;
    this.worker = null;
    this.latest = 0;
    this.pending = new Map();
    this.usingFallback = false;
    this.disposed = false;
  }

  _ensureWorker() {
    if (this.usingFallback || this.worker) return this.worker;
    try {
      const w = this.createWorker();
      w.onmessage = (e) => this._onMessage(e.data);
      w.onerror = (e) => this._failover(e);
      w.onmessageerror = (e) => this._failover(e);
      this.worker = w;
    } catch (e) {
      this._failover(e);
    }
    return this.worker;
  }

  build(rows, options = {}) {
    const id = ++this.latest;
    return new Promise((resolve, reject) => {
      if (this.disposed) { resolve(null); return; }
      const worker = this._ensureWorker();
      if (!worker) { this._runFallback(id, rows, options, resolve, reject); return; }
      this.pending.set(id, { resolve, reject, rows, options });
      worker.postMessage({ type: 'build', id, rows, options });
    });
  }

  _onMessage(m) {
    if (!m || m.id == null) return;
    if (m.type === 'progress') { if (m.id === this.latest) this.onProgress(m.fraction); return; }
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    if (m.id !== this.latest) { p.resolve(null); return; }
    if (m.type === 'built') p.resolve(m.data);
    else if (m.type === 'error') p.reject(new Error(m.message));
  }

  _failover() {
    if (this.usingFallback) return;
    this.usingFallback = true;
    try { if (this.worker) this.worker.terminate(); } catch { /* already gone */ }
    this.worker = null;
    const jobs = [...this.pending.entries()];
    this.pending.clear();
    for (const [id, p] of jobs) this._runFallback(id, p.rows, p.options, p.resolve, p.reject);
  }

  _runFallback(id, rows, options, resolve, reject) {
    runSliced(rows, options, (f) => { if (id === this.latest) this.onProgress(f); }, () => id !== this.latest || this.disposed, this.sliceMs)
      .then(resolve, reject);
  }

  dispose() {
    this.disposed = true;
    try { if (this.worker) this.worker.terminate(); } catch { /* already gone */ }
    this.worker = null;
    for (const p of this.pending.values()) p.resolve(null);
    this.pending.clear();
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests in `buildField.test.mjs` and `fieldClient.test.mjs`, 0 failures.

- [ ] **Step 6: Lint and build**

Run: `npm run lint` — Expected: exit code 0.
Run: `npm run build` — Expected: succeeds (the worker file is not imported yet, so it is not part of the bundle).

- [ ] **Step 7: Commit**

```bash
git add src/viewer/barfield/workerCore.js src/viewer/barfield/barField.worker.js src/viewer/barfield/fieldClient.js tests/barfield/fieldClient.test.mjs
git commit -m "feat(barfield): worker core and FieldBuilder client with main-thread fallback" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Row state (hide / overlay / tint) and texture packing

**Files:**
- Create: `src/viewer/barfield/rowState.js`
- Create: `tests/barfield/rowState.test.mjs`

**Interfaces:**
- Consumes: `barOverlapsBoxes(bar, boxes) → boolean` from `src/bbs/shapes.js`.
- Produces (used by `fieldObjects.js` and `BarField.jsx`):
  - `STATE = { NORMAL: 0, HIDDEN: 1, OVERLAY: 2, TINT: 3 }`, `ROW_TEX_WIDTH = 2048`, `SELECTION_OVERLAY_LIMIT = 300`.
  - `rowTexDims(texelCount) → { width, height }`, `createRowTexelData(texelCount) → Float32Array` (RGBA float texels), `writeRowAttributes(data, id, colorIdx, radiusM)`, `writeRowState(data, id, state)`.
  - `computeHiddenMask({ bars, concretes }) → Uint8Array` (1 = hidden), `composeRowStates({ hiddenMask, selectedBars, forceOverlay?, selectionOverlayLimit? }) → { states: Uint8Array, overlay: number[] }`.
  - Texel layout (shaders in Task 5 read exactly this): **R = state, G = colour slot, B = radius in metres, A = 1**; row id `r` lives at texel `(r % 2048, floor(r / 2048))`.

- [ ] **Step 1: Write the failing tests**

Create `tests/barfield/rowState.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATE, ROW_TEX_WIDTH, SELECTION_OVERLAY_LIMIT, rowTexDims, createRowTexelData,
  writeRowAttributes, writeRowState, computeHiddenMask, composeRowStates,
} from '../../src/viewer/barfield/rowState.js';
import { straightRow } from './helpers.mjs';

test('texture dims: 2048 wide, one texel per row, at least one row of texels', () => {
  assert.deepEqual(rowTexDims(0), { width: ROW_TEX_WIDTH, height: 1 });
  assert.deepEqual(rowTexDims(1), { width: 2048, height: 1 });
  assert.deepEqual(rowTexDims(2048), { width: 2048, height: 1 });
  assert.deepEqual(rowTexDims(2049), { width: 2048, height: 2 });
  assert.equal(createRowTexelData(2049).length, 2048 * 2 * 4);
});

test('texel packing: R state, G colour slot, B radius, A one', () => {
  const d = createRowTexelData(10);
  writeRowAttributes(d, 3, 5, 0.012);
  writeRowState(d, 3, STATE.TINT);
  assert.equal(d[3 * 4], STATE.TINT);
  assert.equal(d[3 * 4 + 1], 5);
  assert.ok(Math.abs(d[3 * 4 + 2] - 0.012) < 1e-6);
  assert.equal(d[3 * 4 + 3], 1);
  assert.equal(d[2 * 4], 0, 'untouched rows stay NORMAL');
});

test('hidden mask: bar.hidden, hidden host, and bars inside a hidden member', () => {
  const concretes = [
    { id: 'c1', visible: false, x: 0, y: 0, z: 0, lx: 1000, ly: 1000, lz: 1000 },
    { id: 'c2', visible: false, x: 50000, y: 50000, z: 0, lx: 100, ly: 100, lz: 100 },
    { id: 'c3', visible: true, x: 0, y: 0, z: 0, lx: 100000, ly: 100000, lz: 100000 },
  ];
  const bars = [
    straightRow({ Pos_x: 100, Pos_y: 100, Pos_z: 100 }),            // inside hidden member c1
    straightRow({ Pos_x: 90000, hidden: true }),                    // hidden itself
    straightRow({ Pos_x: 90000, host: 'c2' }),                      // host c2 is hidden
    straightRow({ Pos_x: 90000, Pos_y: 90000, Pos_z: 90000 }),      // visible
    straightRow({ Pos_x: 90000, Pos_y: 90000, host: 'c3' }),        // host visible
  ];
  assert.deepEqual([...computeHiddenMask({ bars, concretes })], [1, 1, 1, 0, 0]);
});

test('no hidden members and no hidden bars: nothing is hidden', () => {
  const bars = [straightRow(), straightRow({ Pos_x: 9000 })];
  assert.deepEqual([...computeHiddenMask({ bars, concretes: [] })], [0, 0]);
});

test('selection up to the limit becomes overlay; hidden wins over selection', () => {
  const hiddenMask = Uint8Array.from([0, 0, 1, 0]);
  const { states, overlay } = composeRowStates({ hiddenMask, selectedBars: [1, 2] });
  assert.deepEqual([...states], [STATE.NORMAL, STATE.OVERLAY, STATE.HIDDEN, STATE.NORMAL]);
  assert.deepEqual(overlay, [1]);
});

test('more than the limit selected rows are tinted in place, not overlaid', () => {
  const n = SELECTION_OVERLAY_LIMIT + 5;
  const hiddenMask = new Uint8Array(n);
  const selectedBars = Array.from({ length: n }, (_, i) => i);
  const { states, overlay } = composeRowStates({ hiddenMask, selectedBars });
  assert.equal(overlay.length, 0);
  assert.ok(states.every((s) => s === STATE.TINT));
  const small = composeRowStates({ hiddenMask, selectedBars: selectedBars.slice(0, SELECTION_OVERLAY_LIMIT) });
  assert.equal(small.overlay.length, SELECTION_OVERLAY_LIMIT, 'exactly the limit still overlays');
});

test('forceOverlay rows become overlay even when not selected', () => {
  const { states, overlay } = composeRowStates({ hiddenMask: new Uint8Array(4), selectedBars: [0], forceOverlay: new Set([3]) });
  assert.deepEqual([...states], [STATE.OVERLAY, STATE.NORMAL, STATE.NORMAL, STATE.OVERLAY]);
  assert.deepEqual(overlay, [0, 3]);
});

test('selected indices beyond the row count are ignored', () => {
  const { states, overlay } = composeRowStates({ hiddenMask: new Uint8Array(2), selectedBars: [7] });
  assert.deepEqual([...states], [0, 0]);
  assert.deepEqual(overlay, []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../src/viewer/barfield/rowState.js'`.

- [ ] **Step 3: Implement `rowState.js`**

Create `src/viewer/barfield/rowState.js`:

```js
// Pure row-state helpers (spec 5.5 and 6.4): which rows the field hides, overlays or tints, and how
// per-row data is packed into the lookup texture. No three.js and no DOM.
import { barOverlapsBoxes } from '../../bbs/shapes.js';

export const STATE = Object.freeze({ NORMAL: 0, HIDDEN: 1, OVERLAY: 2, TINT: 3 });
export const ROW_TEX_WIDTH = 2048;
export const SELECTION_OVERLAY_LIMIT = 300;

export function rowTexDims(texelCount) {
  return { width: ROW_TEX_WIDTH, height: Math.max(1, Math.ceil(texelCount / ROW_TEX_WIDTH)) };
}

// Float RGBA texel per row id: R = state, G = colour slot, B = radius (m), A = 1.
export function createRowTexelData(texelCount) {
  const { width, height } = rowTexDims(texelCount);
  return new Float32Array(width * height * 4);
}

export function writeRowAttributes(data, id, colorIdx, radiusM) {
  data[id * 4 + 1] = colorIdx;
  data[id * 4 + 2] = radiusM;
  data[id * 4 + 3] = 1;
}

export function writeRowState(data, id, state) {
  data[id * 4] = state;
}

// The expensive part: rows hidden by the user, by a hidden host member, or lying inside a hidden member.
// Same rules as the legacy renderer in Scene.jsx. Recompute only when `bars` or `concretes` change.
export function computeHiddenMask({ bars, concretes }) {
  const hiddenIds = new Set((concretes || []).filter((c) => c.visible === false).map((c) => c.id));
  const hiddenBoxes = (concretes || []).filter((c) => c.visible === false)
    .map((c) => ({ minX: c.x, minY: c.y, minZ: c.z, maxX: c.x + c.lx, maxY: c.y + c.ly, maxZ: c.z + c.lz }));
  const mask = new Uint8Array(bars.length);
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (b.hidden || (b.host && hiddenIds.has(b.host)) || (hiddenBoxes.length > 0 && barOverlapsBoxes(b, hiddenBoxes))) mask[i] = 1;
  }
  return mask;
}

// The cheap part, rerun on every selection change: combine the hidden mask with the selection and
// with rows forced to overlay (for example rows edited but not yet rebuilt).
export function composeRowStates({ hiddenMask, selectedBars, forceOverlay, selectionOverlayLimit = SELECTION_OVERLAY_LIMIT }) {
  const n = hiddenMask.length;
  const states = new Uint8Array(n);
  const overlay = [];
  const sel = Array.isArray(selectedBars) ? selectedBars : [];
  const selSet = new Set(sel);
  const tint = sel.length > selectionOverlayLimit;
  for (let i = 0; i < n; i++) {
    if (hiddenMask[i]) { states[i] = STATE.HIDDEN; continue; }
    if (selSet.has(i)) {
      if (tint) states[i] = STATE.TINT;
      else { states[i] = STATE.OVERLAY; overlay.push(i); }
    } else if (forceOverlay && forceOverlay.has(i)) {
      states[i] = STATE.OVERLAY;
      overlay.push(i);
    }
  }
  return { states, overlay };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests in all three test files, 0 failures.

- [ ] **Step 5: Lint, build, commit**

Run: `npm run lint` — exit 0. Run: `npm run build` — succeeds.

```bash
git add src/viewer/barfield/rowState.js tests/barfield/rowState.test.mjs
git commit -m "feat(barfield): row state helpers (hide / overlay / tint) and texture packing" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: GPU objects, `BarField` (lines) and the `?renderer=field` flag

**Files:**
- Create: `src/viewer/barfield/fieldShaders.js`
- Create: `src/viewer/barfield/tubes.js`
- Create: `src/viewer/barfield/fieldObjects.js`
- Create: `src/viewer/barfield/fieldStatus.js`
- Create: `src/viewer/barfield/FieldBadge.jsx`
- Create: `src/viewer/barfield/rendererFlag.js`
- Create: `src/viewer/barfield/BarField.jsx`
- Create: `scripts/perf/check_field.mjs`
- Modify: `src/viewer/Scene.jsx` (imports, shared click handlers, field / legacy switch, autotest census)
- Modify: `src/App.jsx` (badge)

**Interfaces:**
- Consumes: Task 1 `FieldData` and `buildField`; Task 3 `FieldBuilder`; Task 4 `computeHiddenMask`, `composeRowStates`, `createRowTexelData`, `rowTexDims`, `writeRowAttributes`; `sectionPlanes` from `src/viewer/sectionPlanes.js` (six shared `THREE.Plane`s); `useStore` selectors `bars`, `selectedBars`, `concretes`.
- Produces (later tasks rely on these):
  - `createLineMaterial(rowTex, planes)`, `createTubeMaterial(rowTex, planes)`, `PALETTE_HEX`, `LIGHT` from `fieldShaders.js`.
  - `createChunkTubeGeometry(data, chunk) → THREE.InstancedBufferGeometry` from `tubes.js`.
  - `class FieldView` from `fieldObjects.js`: `new FieldView(data, { deltaCapacity = 0 })`; fields `group`, `data`, `rowCount`, `texelCount`, `texData`, `states` (Uint8Array over texels), `radiusM` (Float32Array over texels), `items` (`[{ data, chunk, lines, tubes, delta, lastUsed, sphere }]`), `staticCount`, `frame`; methods `writeRowAttrs(id, colorIdx, radiusM)`, `touch()`, `setStates(states)`, `addChunks(data, delta)`, `removeDelta()`, `dataSets() → FieldData[]`, `applyTubeSet(wanted: Set<number>)` (item indices), `dispose()`.
  - `fieldStatus` (`get`, `set(patch)`, `subscribe`), `fieldStats`, `publishStats(patch)`, `timed(fn)` from `fieldStatus.js`.
  - `getRendererMode()`, `fieldSupported()`, `isFieldRendererActive()`, `DEFAULT_RENDERER` from `rendererFlag.js`.
  - `function handleBarClick(i, ev)` and `function handleBarDoubleClick(i)` in `Scene.jsx` (module-private: only `Scene.jsx` uses them, and exporting non-components from a component file trips the `only-export-components` lint rule).
  - `<BarField renderOverlayBar={(i) => ReactNode} />`.
  - `window.__barfield = fieldStats` (`{ ready, version, rows, segments, chunks, buildMs, maxBlockMs, usingFallback }`).

- [ ] **Step 1: Write the shaders**

Create `src/viewer/barfield/fieldShaders.js`:

```js
// Line and tube materials for the bar field (spec 6.1, 6.2). Both are ShaderMaterials that read
// per-row state / colour / radius from the row texture, and both use three's clipping chunks so
// the shared section-box planes cut them exactly like every other material.
import * as THREE from 'three';
import { ROW_TEX_WIDTH } from './rowState.js';

// Slot order = DIA_PALETTE (10, 12, 16, 20, 25, 32, 40) + default; same colours as Scene.jsx DIA_COLORS.
export const PALETTE_HEX = ['#22c55e', '#84cc16', '#f59e0b', '#ef4444', '#a855f7', '#3b82f6', '#e11d48', '#f59e0b'];
// Tubes use simple lighting calibrated against the classic RebarMesh (MeshStandardMaterial under the
// scene's ambient + hemisphere + directional lights): mean tube colour within a few percent in a close-up.
export const LIGHT = Object.freeze({ ambient: 0.33, hemi: 0.18, key: 0.33 });

// Raw sRGB components: the shaders write them straight to the sRGB framebuffer.
const hexToVec3 = (hex) => new THREE.Vector3(
  parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255,
);

const ROW_FETCH = `
  uniform sampler2D uRowTex;
  vec4 rowTexel(float row) {
    int r = int(row + 0.5);
    return texelFetch(uRowTex, ivec2(r % ${ROW_TEX_WIDTH}, r / ${ROW_TEX_WIDTH}), 0);
  }
`;

const LINE_VS = `
${ROW_FETCH}
  uniform vec3 uPalette[8];
  uniform vec3 uTint;
  attribute float aRow;
  varying vec3 vColor;
  #include <clipping_planes_pars_vertex>
  void main() {
    vec4 t = rowTexel(aRow);
    int state = int(t.r + 0.5);
    vColor = state == 3 ? uTint : uPalette[int(t.g + 0.5)];
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    if (state == 1 || state == 2) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // hidden / overlay: outside clip space
    #include <clipping_planes_vertex>
  }
`;

const LINE_FS = `
  varying vec3 vColor;
  #include <clipping_planes_pars_fragment>
  void main() {
    #include <clipping_planes_fragment>
    gl_FragColor = vec4(vColor, 1.0);
  }
`;

const TUBE_VS = `
${ROW_FETCH}
  uniform vec3 uPalette[8];
  uniform vec3 uTint;
  attribute vec3 aStart;
  attribute vec3 aEnd;
  attribute float aRow;
  varying vec3 vN;
  varying vec3 vColor;
  #include <clipping_planes_pars_vertex>
  void main() {
    vec4 t = rowTexel(aRow);
    int state = int(t.r + 0.5);
    float rad = t.b;
    vec3 d = aEnd - aStart;
    float len = length(d);
    vec3 ax = d / max(len, 1e-6);
    vec3 ref = abs(ax.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 u = normalize(cross(ref, ax));
    vec3 v = cross(ax, u);
    vec3 radial = u * position.y + v * position.z;
    vec3 p = aStart + ax * (position.x * len) + radial * rad;
    vN = radial; // world space: field objects have an identity model matrix
    vColor = state == 3 ? uTint : uPalette[int(t.g + 0.5)];
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    if (state == 1 || state == 2) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    #include <clipping_planes_vertex>
  }
`;

const TUBE_FS = `
  uniform vec3 uLight; // x ambient, y hemisphere, z key
  varying vec3 vN;
  varying vec3 vColor;
  #include <clipping_planes_pars_fragment>
  void main() {
    #include <clipping_planes_fragment>
    vec3 n = normalize(vN);
    float hemi = 0.5 + 0.5 * n.y;
    float key = max(dot(n, normalize(vec3(8.0, 10.0, 6.0))), 0.0);
    float lit = uLight.x + uLight.y * hemi + uLight.z * key;
    gl_FragColor = vec4(vColor * lit, 1.0);
  }
`;

function baseUniforms(rowTex) {
  return {
    uRowTex: { value: rowTex },
    uPalette: { value: PALETTE_HEX.map(hexToVec3) },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
  };
}

export function createLineMaterial(rowTex, planes) {
  const m = new THREE.ShaderMaterial({ uniforms: baseUniforms(rowTex), vertexShader: LINE_VS, fragmentShader: LINE_FS, clipping: true });
  m.clippingPlanes = planes;
  return m;
}

export function createTubeMaterial(rowTex, planes) {
  const uniforms = { ...baseUniforms(rowTex), uLight: { value: new THREE.Vector3(LIGHT.ambient, LIGHT.hemi, LIGHT.key) } };
  const m = new THREE.ShaderMaterial({ uniforms, vertexShader: TUBE_VS, fragmentShader: TUBE_FS, clipping: true });
  m.clippingPlanes = planes;
  return m;
}
```

- [ ] **Step 2: Write the instanced tube geometry**

Create `src/viewer/barfield/tubes.js`:

```js
// Instanced tube geometry for one chunk (spec 6.2): one shared six-sided prism (12 triangles) drawn
// once per segment. Per-instance start / end points are an interleaved view onto the chunk's slice
// of data.seg (no copy); the row id selects colour and radius in the row texture.
import * as THREE from 'three';

let base = null;
function baseTube() {
  if (base) return base;
  const pos = [];
  const idx = [];
  for (let r = 0; r < 2; r++) {
    for (let i = 0; i < 6; i++) {
      const t = (i / 6) * Math.PI * 2;
      pos.push(r, Math.cos(t), Math.sin(t)); // x along the axis (0..1), yz on the unit circle
    }
  }
  for (let i = 0; i < 6; i++) {
    const a = i, b = (i + 1) % 6, c = 6 + i, d = 6 + ((i + 1) % 6);
    idx.push(a, b, c, b, d, c);
  }
  base = { position: new THREE.Float32BufferAttribute(pos, 3), index: idx };
  return base;
}

export function createChunkTubeGeometry(data, chunk) {
  const b = baseTube();
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', b.position);
  g.setIndex(b.index);
  g.instanceCount = chunk.count;
  const inter = new THREE.InstancedInterleavedBuffer(data.seg.subarray(chunk.start * 6, (chunk.start + chunk.count) * 6), 6, 1);
  g.setAttribute('aStart', new THREE.InterleavedBufferAttribute(inter, 3, 0));
  g.setAttribute('aEnd', new THREE.InterleavedBufferAttribute(inter, 3, 3));
  const rows = new Float32Array(chunk.count);
  for (let i = 0; i < chunk.count; i++) rows[i] = data.rowOfVtx[2 * (chunk.start + i)];
  g.setAttribute('aRow', new THREE.InstancedBufferAttribute(rows, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(chunk.center[0], chunk.center[1], chunk.center[2]), chunk.radius);
  return g;
}
```

- [ ] **Step 3: Write `FieldView`**

Create `src/viewer/barfield/fieldObjects.js`:

```js
// FieldView: the GPU side of one built field (spec 6): one LineSegments per chunk, lazily created
// instanced tube meshes for chunks near the camera (most recently used 64 kept), the row-state
// texture, and optional delta chunks for edited rows (spec 5.6). All objects are static.
import * as THREE from 'three';
import { createRowTexelData, rowTexDims, writeRowAttributes } from './rowState.js';
import { createLineMaterial, createTubeMaterial } from './fieldShaders.js';
import { createChunkTubeGeometry } from './tubes.js';
import { sectionPlanes } from '../sectionPlanes.js';

const TUBE_CACHE = 64;

function makeLines(data, chunk, material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(data.seg.subarray(chunk.start * 6, (chunk.start + chunk.count) * 6), 3));
  g.setAttribute('aRow', new THREE.BufferAttribute(data.rowOfVtx.subarray(chunk.start * 2, (chunk.start + chunk.count) * 2), 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(chunk.center[0], chunk.center[1], chunk.center[2]), chunk.radius);
  const lines = new THREE.LineSegments(g, material);
  lines.matrixAutoUpdate = false;
  lines.userData.barField = 'lines';
  return lines;
}

export class FieldView {
  constructor(data, { deltaCapacity = 0 } = {}) {
    this.data = data;
    this.rowCount = data.rowCount;
    this.texelCount = data.rowCount + deltaCapacity;
    this.group = new THREE.Group();
    this.group.name = 'barfield';
    this.group.matrixAutoUpdate = false;
    this.texData = createRowTexelData(this.texelCount);
    this.states = new Uint8Array(this.texelCount);
    this.radiusM = new Float32Array(this.texelCount);
    for (let i = 0; i < data.rowCount; i++) {
      writeRowAttributes(this.texData, i, data.rows.colorIdx[i], data.rows.radiusM[i]);
      this.radiusM[i] = data.rows.radiusM[i];
    }
    const { width, height } = rowTexDims(this.texelCount);
    this.texture = new THREE.DataTexture(this.texData, width, height, THREE.RGBAFormat, THREE.FloatType);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.needsUpdate = true;
    this.lineMaterial = createLineMaterial(this.texture, sectionPlanes);
    this.tubeMaterial = createTubeMaterial(this.texture, sectionPlanes);
    this.items = [];
    this.deltaDatas = [];
    this.addChunks(data, false);
    this.staticCount = this.items.length;
    this.frame = 0;
  }

  // Colour slot + radius for a row id (used for delta rows; call touch() afterwards).
  writeRowAttrs(id, colorIdx, radiusM) {
    writeRowAttributes(this.texData, id, colorIdx, radiusM);
    this.radiusM[id] = radiusM;
  }

  touch() { this.texture.needsUpdate = true; }

  // states: Uint8Array over texels (row ids); texels beyond its length keep their value.
  setStates(states) {
    const n = Math.min(states.length, this.texelCount);
    for (let i = 0; i < n; i++) {
      this.states[i] = states[i];
      this.texData[i * 4] = states[i];
    }
    this.texture.needsUpdate = true;
  }

  addChunks(data, delta) {
    for (const chunk of data.chunks) {
      const lines = makeLines(data, chunk, this.lineMaterial);
      this.group.add(lines);
      this.items.push({
        data, chunk, lines, tubes: null, delta, lastUsed: 0,
        sphere: new THREE.Sphere(new THREE.Vector3(chunk.center[0], chunk.center[1], chunk.center[2]), chunk.radius),
      });
    }
    if (delta) this.deltaDatas.push(data);
  }

  removeDelta() {
    for (let i = this.items.length - 1; i >= this.staticCount; i--) this._disposeItem(this.items[i]);
    this.items.length = this.staticCount;
    this.deltaDatas = [];
  }

  _disposeItem(it) {
    this.group.remove(it.lines);
    it.lines.geometry.dispose();
    if (it.tubes) {
      this.group.remove(it.tubes);
      it.tubes.geometry.dispose();
      it.tubes = null;
    }
  }

  dataSets() { return [this.data, ...this.deltaDatas]; }

  // Draw exactly the items in `wanted` (a Set of item indices) as tubes and every other item as lines.
  applyTubeSet(wanted) {
    this.frame += 1;
    let cached = 0;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (wanted.has(i)) {
        if (!it.tubes) {
          it.tubes = new THREE.Mesh(createChunkTubeGeometry(it.data, it.chunk), this.tubeMaterial);
          it.tubes.matrixAutoUpdate = false;
          it.tubes.userData.barField = 'tubes';
          this.group.add(it.tubes);
        }
        it.tubes.visible = true;
        it.lines.visible = false;
        it.lastUsed = this.frame;
      } else {
        if (it.tubes) it.tubes.visible = false;
        it.lines.visible = true;
      }
      if (it.tubes) cached += 1;
    }
    if (cached > TUBE_CACHE) {
      const hidden = this.items.filter((it) => it.tubes && !it.tubes.visible).sort((a, b) => a.lastUsed - b.lastUsed);
      for (let k = 0; cached > TUBE_CACHE && k < hidden.length; k++) {
        const it = hidden[k];
        this.group.remove(it.tubes);
        it.tubes.geometry.dispose();
        it.tubes = null;
        cached -= 1;
      }
    }
  }

  dispose() {
    for (const it of this.items) this._disposeItem(it);
    this.items.length = 0;
    this.lineMaterial.dispose();
    this.tubeMaterial.dispose();
    this.texture.dispose();
  }
}
```

- [ ] **Step 4: Write the status store, the badge and the renderer flag**

Create `src/viewer/barfield/fieldStatus.js`:

```js
// Tiny external store (no React dependency) for the viewport badge, plus the stats object that
// scripts/perf reads as window.__barfield.
const listeners = new Set();
let state = { building: false, fraction: 0, message: '', error: false };

export const fieldStatus = {
  get: () => state,
  set(patch) {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  },
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export const fieldStats = {
  ready: false, version: 0, rows: 0, segments: 0, chunks: 0, buildMs: 0, maxBlockMs: 0, usingFallback: false,
};

export function publishStats(patch) {
  Object.assign(fieldStats, patch);
  if (typeof window !== 'undefined') window.__barfield = fieldStats;
}

// Runs fn and records the longest synchronous block spent in field work (budget: <= 200 ms).
export function timed(fn) {
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    const dt = performance.now() - t0;
    if (dt > fieldStats.maxBlockMs) fieldStats.maxBlockMs = dt;
  }
}
```

Create `src/viewer/barfield/FieldBadge.jsx`:

```jsx
import { useSyncExternalStore } from 'react';
import { fieldStatus } from './fieldStatus.js';

// Small viewport badge: "Building bars… 62%" while the field builds, or a fallback / error notice.
export default function FieldBadge() {
  const s = useSyncExternalStore(fieldStatus.subscribe, fieldStatus.get);
  if (!s.building && !s.message) return null;
  const text = s.message || `Building bars… ${Math.round((s.fraction || 0) * 100)}%`;
  return (
    <div
      style={{
        position: 'absolute', left: 12, bottom: 12, zIndex: 40, padding: '4px 10px', borderRadius: 6,
        fontSize: 12, pointerEvents: 'none', color: '#e2e8f0', border: '1px solid #334155',
        background: s.error ? 'rgba(127,29,29,.85)' : 'rgba(15,23,42,.85)',
      }}
    >
      {text}
    </div>
  );
}
```

Create `src/viewer/barfield/rendererFlag.js`:

```js
// Which bar renderer is active: ?renderer=field | legacy. Until the plan's last task the default is
// 'legacy' (today's behaviour). The field renderer needs WebGL2.
export const DEFAULT_RENDERER = 'legacy';

export function getRendererMode() {
  try {
    const v = new URLSearchParams(window.location.search).get('renderer');
    if (v === 'field' || v === 'legacy') return v;
  } catch { /* no window (tests) */ }
  return DEFAULT_RENDERER;
}

let supported = null;
export function fieldSupported() {
  if (supported === null) supported = typeof WebGL2RenderingContext !== 'undefined';
  return supported;
}

export function isFieldRendererActive() {
  return getRendererMode() === 'field' && fieldSupported();
}
```

- [ ] **Step 5: Write `BarField` (lines, row states, overlay)**

Create `src/viewer/barfield/BarField.jsx`:

```jsx
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useStore } from '../../store.js';
import { FieldBuilder } from './fieldClient.js';
import { FieldView } from './fieldObjects.js';
import { computeHiddenMask, composeRowStates } from './rowState.js';
import { fieldStatus, fieldStats, publishStats, timed } from './fieldStatus.js';

// Draws every bar as merged lines in spatial chunks. Task 6 adds tubes + LOD, Task 7 picking and
// Task 8 incremental edits. `renderOverlayBar(i)` draws row i with the classic RebarMesh (selected rows).
export default function BarField({ renderOverlayBar }) {
  const bars = useStore((s) => s.bars);
  const selectedBars = useStore((s) => s.selectedBars);
  const concretes = useStore((s) => s.concretes);
  const root = useMemo(() => new THREE.Group(), []);
  const builderRef = useRef(null);
  const viewRef = useRef(null);
  const [version, setVersion] = useState(0);

  // One builder (and worker) for the component's lifetime.
  useEffect(() => {
    const builder = new FieldBuilder({ onProgress: (f) => fieldStatus.set({ building: true, fraction: f }) });
    builderRef.current = builder;
    return () => { builder.dispose(); builderRef.current = null; };
  }, []);

  // Rebuild the whole field whenever `bars` changes (Task 8 replaces this with diff + delta chunks).
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const builder = builderRef.current;
      if (!builder) return;
      fieldStatus.set({ building: true, fraction: 0, message: '', error: false });
      const t0 = performance.now();
      try {
        const data = await builder.build(bars);
        if (cancelled || !data) return;
        if (data.skippedRows) console.warn(`[barfield] skipped ${data.skippedRows} rows with invalid geometry`);
        timed(() => {
          const next = new FieldView(data);
          const old = viewRef.current;
          root.add(next.group);
          viewRef.current = next;
          if (old) { root.remove(old.group); old.dispose(); }
        });
        publishStats({
          ready: true, version: fieldStats.version + 1, rows: data.rowCount, segments: data.segCount,
          chunks: data.chunkCount, buildMs: Math.round(performance.now() - t0), usingFallback: builder.usingFallback,
        });
        fieldStatus.set({ building: false, fraction: 1 });
        setVersion((v) => v + 1);
      } catch (err) {
        console.error('[barfield] build failed', err);
        fieldStatus.set({ building: false, message: 'Bar renderer failed - see the console', error: true });
      }
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [bars, root]);

  // Free the GPU objects when the component goes away.
  useEffect(() => () => {
    const v = viewRef.current;
    if (v) { root.remove(v.group); v.dispose(); viewRef.current = null; }
    publishStats({ ready: false });
  }, [root]);

  // Row states: hidden rows vanish from the field, selected rows are drawn by the overlay instead.
  // The overlay list is derived during render, and the texture update runs in a layout effect, so a
  // selected row leaves the field and appears as an overlay mesh within the same frame.
  const hiddenMask = useMemo(() => computeHiddenMask({ bars, concretes }), [bars, concretes]);
  const rowStates = useMemo(() => composeRowStates({ hiddenMask, selectedBars }), [hiddenMask, selectedBars]);
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (view) timed(() => view.setStates(rowStates.states));
  }, [rowStates, version]);
  const overlay = rowStates.overlay;

  return (
    <>
      <primitive object={root} />
      {overlay.map((i) => (bars[i] ? renderOverlayBar(i) : null))}
    </>
  );
}
```

- [ ] **Step 6: Wire `Scene.jsx`**

In `src/viewer/Scene.jsx`:

**6a. Imports** — after the line `import { stencilMats } from './stencilMats.js';` add:

```js
import BarField from './barfield/BarField.jsx';
import { isFieldRendererActive } from './barfield/rendererFlag.js';
```

**6b. Shared click handlers** — directly above the line `function RebarMesh({ bar, index, selected, onClick, onDoubleClick }) {` insert:

```js
// Click handling shared by the classic RebarMesh groups and the BarField picker: select,
// Ctrl/Cmd/Shift toggle, lap picking. Same behaviour as the closure that used to live in Scene().
function handleBarClick(i, ev) {
  const st = useStore.getState();
  if (st.measure?.active || st.boxSelect) return;
  // Lap picking: first click anchors, second click laps + selects.
  if (st.lapArmed) {
    if (st.lapAnchor == null) { st.setLapAnchor(i); return; }
    if (st.lapAnchor === i) return;
    st.selectBar(i);
    const r = st.applyLapSplice(st.lapAnchor, i);
    if (!r.ok) alert(r.msg);
    else { st.setLapAnchor(null); st.setLapArmed(false); }
    return;
  }
  // Ctrl/Cmd/Shift-click toggles into the multi-selection so the box result can be adjusted bar by bar.
  const add = ev && (ev.ctrlKey || ev.metaKey || ev.shiftKey);
  if (add) st.toggleBarSelected(i);
  else st.selectBar(i);
}

function handleBarDoubleClick(i) {
  const st = useStore.getState();
  st.selectBar(i);
  st.requestFit('bar', i);
}

```

**6c. Scene component** — in `export default function Scene() {`, delete the now-unused line:

```js
  const selectBar = useStore((s) => s.selectBar);
```

and directly above `  return (\n    <Canvas camera={{ position: [6, 4, -6], fov: 45 }}` insert:

```jsx
  const useField = useMemo(() => isFieldRendererActive(), []);
  const renderBar = (b, i) => (
    <RebarMesh
      key={i}
      bar={b}
      index={i}
      selected={(selectedBars || []).includes(i)}
      onClick={(ev) => handleBarClick(i, ev)}
      onDoubleClick={() => handleBarDoubleClick(i)}
    />
  );
```

**6d. The bar list** — replace this whole block:

```jsx
      {bars.map((b, i) => {
        // View-only hiding: individually hidden bars, bars hosted on a hidden
        // member, and bars spatially inside a hidden member (covers picked/
        // positioned bars that were never assigned a host). Schedule stays whole.
        if (b.hidden) return null;
        if (b.host && hiddenHosts.has(b.host)) return null;
        if (hiddenBoxes.length && barOverlapsBoxes(b, hiddenBoxes)) return null;
        return (
          <RebarMesh
            key={i}
            bar={b}
            index={i}
            selected={(selectedBars || []).includes(i)}
            onClick={(ev) => {
              const st = useStore.getState();
              if (st.measure?.active || st.boxSelect) return;
              // Lap picking: first click anchors, second click laps + selects.
              if (st.lapArmed) {
                if (st.lapAnchor == null) { st.setLapAnchor(i); return; }
                if (st.lapAnchor === i) return;
                st.selectBar(i);
                const r = st.applyLapSplice(st.lapAnchor, i);
                if (!r.ok) alert(r.msg);
                else { st.setLapAnchor(null); st.setLapArmed(false); }
                return;
              }
              // Ctrl/Cmd/Shift-click toggles into the multi-selection so the
              // box result can be adjusted bar by bar.
              const add = ev && (ev.ctrlKey || ev.metaKey || ev.shiftKey);
              if (add) st.toggleBarSelected(i);
              else selectBar(i);
            }}
            onDoubleClick={() => {
              selectBar(i);
              useStore.getState().requestFit('bar', i);
            }}
          />
        );
      })}
```

with:

```jsx
      {useField ? (
        <BarField renderOverlayBar={(i) => renderBar(bars[i], i)} />
      ) : bars.map((b, i) => {
        // View-only hiding: individually hidden bars, bars hosted on a hidden
        // member, and bars spatially inside a hidden member (covers picked/
        // positioned bars that were never assigned a host). Schedule stays whole.
        if (b.hidden) return null;
        if (b.host && hiddenHosts.has(b.host)) return null;
        if (hiddenBoxes.length && barOverlapsBoxes(b, hiddenBoxes)) return null;
        return renderBar(b, i);
      })}
```

**6e. Autotest census** — inside `AutotestDump`, directly above the comment line `      // Pixel verdict: 5 sample points along the default bar OUTSIDE the box` insert:

```js
      // BarField census: chunk line / tube objects and how many are currently drawn.
      let fieldLines = 0, fieldTubes = 0, fieldVisible = 0;
      scene.traverse((o) => {
        if (o.userData?.barField === 'lines') { fieldLines += 1; if (o.visible) fieldVisible += 1; }
        else if (o.userData?.barField === 'tubes') { fieldTubes += 1; if (o.visible) fieldVisible += 1; }
      });
```

and in the `el.textContent = JSON.stringify({ ... })` object, directly after the line `        pick: useStore.getState().ifcPick,` add:

```js
        field: { lines: fieldLines, tubes: fieldTubes, visible: fieldVisible },
        selectedBars: useStore.getState().selectedBars,
```

- [ ] **Step 7: Show the badge in the viewport**

In `src/App.jsx`: after the line `import Scene from './viewer/Scene.jsx';` add:

```js
import FieldBadge from './viewer/barfield/FieldBadge.jsx';
```

and change the line

```jsx
        <section className="view"><Scene /><ViewportBar /><MeasureHud /><QueryHud /><FaceSketchHud /></section>
```

to

```jsx
        <section className="view"><Scene /><ViewportBar /><MeasureHud /><QueryHud /><FaceSketchHud /><FieldBadge /></section>
```

- [ ] **Step 8: Write the parity check (placement and clipping vs the legacy renderer)**

Create `scripts/perf/check_field.mjs`:

```js
// Functional checks of the field renderer against the legacy renderer, in headless Edge.
// usage: node scripts/perf/check_field.mjs --url <app base url> [--only parity]
// parity : the same small project drawn by ?renderer=legacy and ?renderer=field, with and without
//          the section box (?autotest=section cuts it to the central third). The amber pixels must
//          occupy the same screen box (placement + clipping), and the field must draw something.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, sleep } from './lib/cdp.mjs';
import { INSTR } from './lib/instrument.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });
const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
};
const base = (arg('url') || '').replace(/\/$/, '');
const only = arg('only', '');
if (!base) { console.error('usage: node scripts/perf/check_field.mjs --url <app base url> [--only parity]'); process.exit(2); }

let failures = 0;
const report = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures += 1; };

// Bars that straddle the section box ?autotest=section creates (scene metres: x -1.33..1.33,
// y 1.33..2.67, z -1.33..1.33; app mm: x, y = -z, z = up). All Dia 16 so every bar is amber.
function makeCheckProject() {
  const bars = [];
  let tag = 1;
  const add = (row) => bars.push({
    Rebar_tag: tag, Bar_mark: `B${tag++}`, Dia: 16, Group: 'check', bond_condition: 'poor', Pos_Rotation: 0,
    qty: 1, Visible: 1, qty_x: 1, spacing_x: 150, qty_y: 1, spacing_y: 150, ...row,
  });
  for (let k = 0; k < 24; k++) add({ Rebar_Type: 'straight', Plane: 'XY', 'Length of Bar': 6000, Pos_x: -3000, Pos_y: -1100 + k * 100, Pos_z: 1500 + (k % 4) * 300 });
  for (let k = 0; k < 8; k++) add({ Rebar_Type: 'straight', Plane: 'XZ', Pos_Rotation: 90, 'Length of Bar': 4000, Pos_x: -1000 + k * 300, Pos_y: 0, Pos_z: 0 });
  add({ Rebar_Type: 'straight', Plane: 'XY', 'Length of Bar': 5000, Pos_x: -2500, Pos_y: -1000, Pos_z: 2000, qty_y: 20, spacing_y: 100 });
  add({ Rebar_Type: 'bent', Plane: 'XZ', 'Length of Bar': 3000, H: 800, bent_up_down: 'up', hook_start: 'no', Pos_x: -1500, Pos_y: 500, Pos_z: 1600 });
  return { v: 1, app: 'barbending', savedAt: Date.now(), bars, concretes: [], refLines: [], cover: 40, bond: 'poor', selectedBar: 0, selectedBars: [0] };
}

// Amber pixels (#f59e0b and its shaded variants) outside the orientation gizmo corner.
const PIXEL_STATS = `(() => {
  const c = document.querySelector('canvas'); const t = document.createElement('canvas');
  t.width = c.width; t.height = c.height;
  const x = t.getContext('2d', { willReadFrequently: true }); x.drawImage(c, 0, 0);
  const d = x.getImageData(0, 0, t.width, t.height).data;
  let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, sx = 0, sy = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const px = p % t.width, py = (p / t.width) | 0;
    if (px > t.width - 220 && py < 220) continue;
    if (r > 140 && g > 70 && g < 210 && b < 100 && r > g * 1.1) {
      n++; sx += px; sy += py;
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
  }
  return { n, x0, y0, x1, y1, cx: n ? sx / n : 0, cy: n ? sy / n : 0, w: t.width, h: t.height };
})()`;

async function openProject(b, query, projectFile) {
  await b.send('Page.navigate', { url: `${base}/?${query}` });
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    await sleep(300);
    try { ready = await b.ev('!!document.querySelector("canvas") && !!window.__status', 5000); } catch { /* retry */ }
  }
  if (!ready) throw new Error('app did not start: ' + query);
  const root = await b.send('DOM.getDocument', { depth: 0 });
  const q = await b.send('DOM.querySelectorAll', { nodeId: root.root.nodeId, selector: 'input[type=file]' });
  await b.send('DOM.setFileInputFiles', { files: [projectFile], nodeId: q.nodeIds[0] });
  if (query.includes('renderer=field')) {
    for (let i = 0; i < 200; i++) {
      await sleep(250);
      if (await b.ev('!!(window.__barfield && window.__barfield.ready)', 5000).catch(() => false)) break;
    }
  }
  await sleep(1500);
  await b.ev('(document.querySelector(\'button[title="Fit entire model in view"]\') || { click() {} }).click()');
  await sleep(3000);
}

async function parity() {
  const projectFile = path.join(outDir, 'check_clip.json');
  fs.writeFileSync(projectFile, JSON.stringify(makeCheckProject()));
  const b = await launchBrowser({ instrument: INSTR });
  try {
    for (const section of [false, true]) {
      const stats = {};
      for (const mode of ['legacy', 'field']) {
        const query = `renderer=${mode}&autotest=${section ? 'section' : 'parity'}`;
        b.consoleErrors.length = 0;
        await openProject(b, query, projectFile);
        stats[mode] = await b.ev(PIXEL_STATS);
        const shot = await b.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(outDir, `check-${mode}${section ? '-section' : ''}.png`), Buffer.from(shot.data, 'base64'));
        if (mode === 'field') {
          report(b.consoleErrors.length === 0, `field renderer logged no errors (${section ? 'section' : 'plain'})${b.consoleErrors.length ? ': ' + b.consoleErrors[0] : ''}`);
          // The scene census (AutotestDump) must show chunk line objects, and the one selected row
          // (the project file selects bar 0) must be drawn by the overlay RebarMesh, not the field.
          const dump = JSON.parse(await b.ev("document.getElementById('autotest-dump') ? document.getElementById('autotest-dump').textContent : '{}'"));
          report(!!dump.field && dump.field.lines > 0, `${section ? 'section' : 'plain'}: field chunk line objects exist (${dump.field ? dump.field.lines : 'no census'})`);
          report(dump.tube !== undefined && dump.tube !== 'none' && (dump.selectedBars || []).length === 1, `${section ? 'section' : 'plain'}: the selected row is drawn by the overlay mesh (selected=${(dump.selectedBars || []).length}, tube=${String(dump.tube).slice(0, 20)})`);
        }
      }
      const L = stats.legacy, F = stats.field, tol = 14;
      const label = section ? 'section box on' : 'no section box';
      console.log(`      ${label}: legacy n=${L.n} bbox=[${L.x0},${L.y0},${L.x1},${L.y1}]  field n=${F.n} bbox=[${F.x0},${F.y0},${F.x1},${F.y1}]`);
      report(L.n > 200, `${label}: legacy renderer drew the bars (${L.n} amber px)`);
      report(F.n > 0.03 * L.n, `${label}: field renderer drew the bars (${F.n} vs ${L.n} amber px)`);
      const same = Math.abs(L.x0 - F.x0) <= tol && Math.abs(L.x1 - F.x1) <= tol && Math.abs(L.y0 - F.y0) <= tol && Math.abs(L.y1 - F.y1) <= tol;
      report(same, `${label}: same screen extent within ${tol}px`);
      report(Math.hypot(L.cx - F.cx, L.cy - F.cy) <= 12, `${label}: same centre of mass within 12px (legacy ${L.cx.toFixed(0)},${L.cy.toFixed(0)} field ${F.cx.toFixed(0)},${F.cy.toFixed(0)})`);
    }
  } finally {
    b.close();
  }
}

try {
  if (!only || only === 'parity') await parity();
} catch (e) {
  console.error('ERROR', e.message);
  failures += 1;
}
console.log(failures ? `RESULT: FAIL (${failures})` : 'RESULT: PASS');
process.exit(failures ? 1 : 0);
```

- [ ] **Step 9: Verify**

Run:

```bash
npm test
npm run lint
npm run build
```

Expected: tests pass; lint exit 0 (no new warnings in `src/viewer/barfield/`; an unused-variable warning for `selectBar` means step 6c was missed); build passes.

Then run the browser checks against a production preview:

```bash
npx vite preview --port 5188 --host 127.0.0.1 &
sleep 4
node scripts/perf/check_field.mjs --url http://127.0.0.1:5188 --only parity
```

Expected: `RESULT: PASS` with 14 PASS lines (no errors logged; chunk line objects exist; the selected row is drawn by the overlay mesh; legacy and field draw bars; same screen extent and centre of mass, with and without the section box). Screenshots are saved to `scripts/perf/out/check-*.png` — open `check-field.png` and `check-legacy.png`: the field one shows the same bars as thin amber lines. If the extent check fails with the section box on, the bars are not being clipped: re-check that both materials set `clipping: true` and `clippingPlanes = sectionPlanes`.

Then measure the lines-only field renderer:

```bash
node scripts/perf/gen_project.mjs 250 40 p10k 7
node scripts/perf/gen_project.mjs 25000 40 p1m 7
node scripts/perf/cdp_bench.mjs --url "http://127.0.0.1:5188/?renderer=field" --project scripts/perf/out/p10k.json --label field-10k --expect 10163
node scripts/perf/cdp_bench.mjs --url "http://127.0.0.1:5188/?renderer=field" --project scripts/perf/out/p1m.json --label field-1m --expect 1002336
```

Expected for 10k: `idle.fps` ≈ 60 (the legacy renderer measured 8.9), `idle.drawCallsPerFrame` below 40, `viewportMs` a few hundred ms, `field.ready: true`, no `consoleErrors`. Expected for 1M: `idle.fps` ≥ 30 (the spike measured 43–45 for 1M lines), `drawCallsPerFrame` a few hundred, `viewportMs` under 5000. (The BBS table still takes ~17 s to render 25,000 rows — that is sub-project B, and `load.ms` will show it.)

- [ ] **Step 10: Commit**

```bash
git add src/viewer/barfield src/viewer/Scene.jsx src/App.jsx scripts/perf/check_field.mjs
git commit -m "feat(barfield): chunked line renderer behind ?renderer=field with row states and overlay" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Tubes and level of detail, plus the Detail setting

**Files:**
- Create: `src/viewer/barfield/lod.js`
- Create: `src/viewer/barfield/qualityState.js`
- Create: `tests/barfield/lod.test.mjs`
- Create: `tests/barfield/barDetail.test.mjs`
- Modify: `src/viewer/barfield/BarField.jsx` (LOD loop)
- Modify: `src/store.js` (`barDetail`, persisted)
- Modify: `src/App.jsx` (Detail selector in the status bar)
- Modify: `src/App.css` (compact select in the status bar)
- Modify: `scripts/perf/check_field.mjs` (tubes check)

**Interfaces:**
- Consumes: `FieldView.items`, `FieldView.applyTubeSet(wanted: Set<number>)` (Task 5); chunk objects `{ count, center, radius, maxRadiusM }` from `FieldData.chunks`.
- Produces:
  - `TRIS_PER_SEGMENT = 12`, `ON_PX = 3`, `OFF_PX = 2`, `apparentPx(maxRadiusM, distance, fovRad, viewportHeightPx) → px`, `chooseTubeChunks({ chunks, cameraPos: [x,y,z], fovRad, viewportHeightPx, budgetTris, prevTubes?: Set, detail?: 'auto'|'lines'|'tubes', isVisible?: (i) => boolean, onPx?, offPx? }) → Set<number>` (chunk indices) from `lod.js`.
  - `qualityState = { budgetTris, dpr, level }` (mutable shared object) from `qualityState.js`.
  - Store: `barDetail` (`'auto' | 'lines' | 'tubes'`, default `'auto'`, persisted under `localStorage['barbending.barDetail']`) and `setBarDetail(v)`.

- [ ] **Step 1: Write the failing LOD tests**

Create `tests/barfield/lod.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { apparentPx, chooseTubeChunks, TRIS_PER_SEGMENT, ON_PX, OFF_PX } from '../../src/viewer/barfield/lod.js';

const fov = (45 * Math.PI) / 180;
const chunk = (cx, count = 1000, maxRadiusM = 0.008) => ({ center: [cx, 0, 0], radius: 1, count, maxRadiusM });
const base = { fovRad: fov, viewportHeightPx: 800, budgetTris: 5e6, cameraPos: [0, 0, 0] };

test('constants match the spec', () => {
  assert.equal(TRIS_PER_SEGMENT, 12);
  assert.equal(ON_PX, 3);
  assert.equal(OFF_PX, 2);
});

test('apparent width: 15.45 px for an 8 mm bar at 1 m, shrinking with distance, growing with radius', () => {
  assert.ok(Math.abs(apparentPx(0.008, 1, fov, 800) - 15.45) < 0.05);
  assert.ok(apparentPx(0.008, 1, fov, 800) > apparentPx(0.008, 10, fov, 800));
  assert.ok(Math.abs(apparentPx(0.016, 5, fov, 800) - 2 * apparentPx(0.008, 5, fov, 800)) < 1e-9);
});

test('a chunk whose bars are at least 3 px wide draws as tubes, thinner stays lines', () => {
  // px = 15.45 / d for an 8 mm bar: d = 4 -> 3.9 px (tube), d = 6 -> 2.6 px (line)
  const set = chooseTubeChunks({ ...base, chunks: [chunk(4), chunk(6)] });
  assert.deepEqual([...set], [0]);
});

test('hysteresis: a chunk already drawn as tubes stays until it drops below 2 px', () => {
  const chunks = [chunk(6)]; // 2.6 px: between the thresholds
  assert.equal(chooseTubeChunks({ ...base, chunks }).size, 0, 'not promoted from lines');
  assert.equal(chooseTubeChunks({ ...base, chunks, prevTubes: new Set([0]) }).size, 1, 'kept once promoted');
  assert.equal(chooseTubeChunks({ ...base, chunks: [chunk(9)], prevTubes: new Set([0]) }).size, 0, '1.7 px drops back to lines');
});

test('closest chunks are promoted first and the triangle budget is respected', () => {
  const chunks = [chunk(3), chunk(1), chunk(2)]; // 1000 segments each = 12,000 triangles
  const set = chooseTubeChunks({ ...base, chunks, budgetTris: 25000 });
  assert.deepEqual([...set].sort(), [1, 2], 'the two closest fit, the farthest does not');
});

test('the closest chunk is always promoted even when it alone exceeds the budget', () => {
  const set = chooseTubeChunks({ ...base, chunks: [chunk(1, 100000)], budgetTris: 1000 });
  assert.deepEqual([...set], [0]);
});

test('detail overrides: lines never draws tubes, tubes always does (ignoring budget and distance)', () => {
  const chunks = [chunk(1), chunk(500), chunk(900)];
  assert.equal(chooseTubeChunks({ ...base, chunks, detail: 'lines' }).size, 0);
  assert.equal(chooseTubeChunks({ ...base, chunks, detail: 'tubes', budgetTris: 1 }).size, 3);
});

test('isVisible filters chunks outside the view before the budget is spent', () => {
  const chunks = [chunk(1), chunk(2), chunk(3)];
  const set = chooseTubeChunks({ ...base, chunks, budgetTris: 25000, isVisible: (i) => i !== 0 });
  assert.deepEqual([...set].sort(), [1, 2]);
});

test('an empty chunk list gives an empty set', () => {
  assert.equal(chooseTubeChunks({ ...base, chunks: [] }).size, 0);
});
```

Create `tests/barfield/barDetail.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { useStore } from '../../src/store.js';

test('barDetail defaults to auto and accepts lines / tubes / auto only', () => {
  assert.equal(useStore.getState().barDetail, 'auto');
  useStore.getState().setBarDetail('lines');
  assert.equal(useStore.getState().barDetail, 'lines');
  useStore.getState().setBarDetail('tubes');
  assert.equal(useStore.getState().barDetail, 'tubes');
  useStore.getState().setBarDetail('bogus');
  assert.equal(useStore.getState().barDetail, 'auto');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../lod.js'` and `setBarDetail is not a function`.

- [ ] **Step 3: Implement `lod.js` and `qualityState.js`**

Create `src/viewer/barfield/lod.js`:

```js
// Pure LOD policy (spec 6.3): which chunks draw as tubes. No three.js.
export const TRIS_PER_SEGMENT = 12;
export const ON_PX = 3;
export const OFF_PX = 2;

// Apparent width in pixels of a bar of radius maxRadiusM at `distance` metres
// (perspective camera, vertical field of view fovRad).
export function apparentPx(maxRadiusM, distance, fovRad, viewportHeightPx) {
  return ((2 * maxRadiusM) / Math.max(distance, 1e-6)) * (viewportHeightPx / (2 * Math.tan(fovRad / 2)));
}

// Returns the Set of chunk indices to draw as tubes; every other chunk draws as lines.
//  - 'lines' never draws tubes, 'tubes' draws every chunk as tubes (no budget cap).
//  - 'auto': a chunk is a candidate at >= onPx, or stays one while >= offPx (hysteresis, via prevTubes);
//    candidates are promoted closest-first until the triangle budget is spent. The closest chunk is
//    always promoted so zooming in always shows tubes. isVisible(i) skips chunks outside the view.
export function chooseTubeChunks({
  chunks, cameraPos, fovRad, viewportHeightPx, budgetTris,
  prevTubes = new Set(), detail = 'auto', isVisible = null, onPx = ON_PX, offPx = OFF_PX,
}) {
  const out = new Set();
  if (detail === 'lines') return out;
  if (detail === 'tubes') {
    for (let i = 0; i < chunks.length; i++) out.add(i);
    return out;
  }
  const candidates = [];
  for (let i = 0; i < chunks.length; i++) {
    if (isVisible && !isVisible(i)) continue;
    const ch = chunks[i];
    const dist = Math.hypot(cameraPos[0] - ch.center[0], cameraPos[1] - ch.center[1], cameraPos[2] - ch.center[2]);
    const px = apparentPx(ch.maxRadiusM, dist, fovRad, viewportHeightPx);
    if (px >= (prevTubes.has(i) ? offPx : onPx)) candidates.push({ i, dist, cost: TRIS_PER_SEGMENT * ch.count });
  }
  candidates.sort((a, b) => a.dist - b.dist);
  let used = 0;
  for (const c of candidates) {
    if (out.size === 0 || used + c.cost <= budgetTris) {
      out.add(c.i);
      used += c.cost;
    }
  }
  return out;
}
```

Create `src/viewer/barfield/qualityState.js`:

```js
// Values the adaptive quality controller (Task 9) publishes and the LOD reads on every update.
export const qualityState = { budgetTris: 5_000_000, dpr: 1.75, level: 0 };
```

- [ ] **Step 4: Add `barDetail` to the store**

In `src/store.js`, directly after the line `const SAVE_KEY = 'barbending.save.v1';` add:

```js
const DETAIL_KEY = 'barbending.barDetail';
const readBarDetail = () => {
  try {
    const v = localStorage.getItem(DETAIL_KEY);
    return v === 'lines' || v === 'tubes' ? v : 'auto';
  } catch { return 'auto'; }
};
```

and directly after the line `  setConcreteStyle: (v) => set({ concreteStyle: v }),` add:

```js
  // Bar detail for the BarField renderer: 'auto' (lines far, tubes near) | 'lines' | 'tubes'.
  // Persisted like the layout preferences.
  barDetail: readBarDetail(),
  setBarDetail: (v) => {
    const next = v === 'lines' || v === 'tubes' ? v : 'auto';
    try { localStorage.setItem(DETAIL_KEY, next); } catch { /* storage unavailable */ }
    set({ barDetail: next });
  },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — every test file, 0 failures.

- [ ] **Step 6: Add the LOD loop to `BarField`**

In `src/viewer/barfield/BarField.jsx`: after the line `import * as THREE from 'three';` add:

```js
import { useFrame, useThree } from '@react-three/fiber';
import { chooseTubeChunks } from './lod.js';
import { qualityState } from './qualityState.js';
```

and directly above the final `  return (\n    <>\n      <primitive object={root} />` insert:

```jsx
  // Level of detail: at most every 100 ms (and only when something changed) decide which chunks
  // draw as tubes; the rest stay lines. Chunks outside the frustum never spend triangle budget.
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const frustum = useMemo(() => new THREE.Frustum(), []);
  const projView = useMemo(() => new THREE.Matrix4(), []);
  const lod = useRef({ last: 0, prev: new Set(), cam: new THREE.Matrix4(), detail: '', budget: 0, view: null });
  useFrame(() => {
    const view = viewRef.current;
    if (!view) return;
    const st = lod.current;
    const detail = useStore.getState().barDetail || 'auto';
    camera.updateMatrixWorld();
    const unchanged = st.view === view && detail === st.detail && qualityState.budgetTris === st.budget && st.cam.equals(camera.matrixWorld);
    const now = performance.now();
    if (unchanged || now - st.last < 100) return;
    if (st.view !== view) st.prev = new Set();
    st.last = now;
    st.view = view;
    st.detail = detail;
    st.budget = qualityState.budgetTris;
    st.cam.copy(camera.matrixWorld);
    timed(() => {
      projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projView);
      const tubes = chooseTubeChunks({
        chunks: view.items.map((it) => it.chunk),
        cameraPos: [camera.position.x, camera.position.y, camera.position.z],
        fovRad: (camera.fov * Math.PI) / 180,
        viewportHeightPx: gl.domElement.clientHeight || 800,
        budgetTris: qualityState.budgetTris,
        prevTubes: st.prev,
        detail,
        isVisible: (i) => frustum.intersectsSphere(view.items[i].sphere),
      });
      view.applyTubeSet(tubes);
      st.prev = tubes;
    });
  });

```

- [ ] **Step 7: Add the Detail selector to the status bar**

The viewport bar is already full at common window widths: one more control there wraps "Zoom Sel [F]"
onto the second row and pushes the bar count under the orientation gizmo. The status bar has room and
already carries the fps readout, so the selector lives there.

In `src/App.jsx`: after the line `import FieldBadge from './viewer/barfield/FieldBadge.jsx';` add:

```js
import { isFieldRendererActive } from './viewer/barfield/rendererFlag.js';
```

In `function StatusBar() {`, replace:

```jsx
    : `${Math.round(perf.dist * 1000).toLocaleString('en-US')} mm`;
  return (
    <footer className="statusbar">
      <span>{navMode === 'orbit' ? 'LMB orbit' : 'LMB select'} · MMB orbit · RMB pan · wheel zoom-to-cursor · Esc deselect</span>
      <span>{perf.fps} fps · cam {dist} · {totalBars} bars · {totalW.toFixed(1)} kg</span>
    </footer>
  );
```

with:

```jsx
    : `${Math.round(perf.dist * 1000).toLocaleString('en-US')} mm`;
  // Bar detail of the new renderer lives here, next to the fps readout, because the viewport bar is
  // already full at common window widths.
  const barDetail = useStore((s) => s.barDetail);
  const setBarDetail = useStore((s) => s.setBarDetail);
  const fieldOn = isFieldRendererActive();
  return (
    <footer className="statusbar">
      <span>{navMode === 'orbit' ? 'LMB orbit' : 'LMB select'} · MMB orbit · RMB pan · wheel zoom-to-cursor · Esc deselect</span>
      <span>
        {fieldOn && (
          <>
            <label title="Bar detail (new bar renderer): Auto draws lines far away and real tubes as you zoom in · Lines never draws tubes (fastest) · Tubes always draws tubes (slowest on very large projects)">
              detail{' '}
              <select value={barDetail} onChange={(e) => setBarDetail(e.target.value)}>
                <option value="auto">Auto</option>
                <option value="lines">Lines</option>
                <option value="tubes">Tubes</option>
              </select>
            </label>
            {' · '}
          </>
        )}
        {perf.fps} fps · cam {dist} · {totalBars} bars · {totalW.toFixed(1)} kg
      </span>
    </footer>
  );
```

In `src/App.css`, directly above the line `.sidebody { overflow-y: auto; padding: 8px; flex: 1; }` add (a compact select that does not make the footer taller):

```css
.statusbar select { background: #0b1528; color: #e2e8f0; border: 1px solid #2b3d63; border-radius: 4px; padding: 0 3px; font-size: 11px; height: 15px; vertical-align: middle; }
```

- [ ] **Step 8: Add the tubes check**

In `scripts/perf/check_field.mjs`, replace this block at the end of the file:

```js
try {
  if (!only || only === 'parity') await parity();
} catch (e) {
```

with:

```js
// tubes : with Detail = Tubes every chunk draws as instanced tubes: the extent still matches the
//         legacy renderer (tubes have the same 8 mm minimum radius) and the census shows tube objects.
async function tubes() {
  const projectFile = path.join(outDir, 'check_clip.json');
  fs.writeFileSync(projectFile, JSON.stringify(makeCheckProject()));
  const b = await launchBrowser({ instrument: INSTR });
  try {
    await b.send('Page.navigate', { url: `${base}/?renderer=legacy&autotest=parity` });
    await sleep(1500);
    await openProject(b, 'renderer=legacy&autotest=parity', projectFile);
    const L = await b.ev(PIXEL_STATS);
    await b.ev("localStorage.setItem('barbending.barDetail', 'tubes')");
    b.consoleErrors.length = 0;
    await openProject(b, 'renderer=field&autotest=parity', projectFile);
    await sleep(1500);
    const F = await b.ev(PIXEL_STATS);
    const census = await b.ev("(() => { const el = document.getElementById('autotest-dump'); return el ? JSON.parse(el.textContent).field : null; })()");
    const shot = await b.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, 'check-field-tubes.png'), Buffer.from(shot.data, 'base64'));
    console.log(`      tubes: legacy n=${L.n} bbox=[${L.x0},${L.y0},${L.x1},${L.y1}]  field n=${F.n} bbox=[${F.x0},${F.y0},${F.x1},${F.y1}]  census=${JSON.stringify(census)}`);
    report(b.consoleErrors.length === 0, `tubes: no errors logged${b.consoleErrors.length ? ': ' + b.consoleErrors[0] : ''}`);
    report(!!census && census.tubes > 0 && census.visible > 0, 'tubes: tube objects were created and are drawn');
    report(F.n > 0.3 * L.n, `tubes: field drew comparable amber area (${F.n} vs ${L.n} px)`);
    const tol = 14;
    report(Math.abs(L.x0 - F.x0) <= tol && Math.abs(L.x1 - F.x1) <= tol && Math.abs(L.y0 - F.y0) <= tol && Math.abs(L.y1 - F.y1) <= tol, `tubes: same screen extent within ${tol}px`);
    await b.ev("localStorage.removeItem('barbending.barDetail')");
  } finally {
    b.close();
  }
}

try {
  if (!only || only === 'parity') await parity();
  if (!only || only === 'tubes') await tubes();
} catch (e) {
```

Also change the usage comment at the top of the file: add the line `// tubes  : Detail = Tubes draws instanced tubes with the same extent as the legacy renderer.` after the `parity` description.

- [ ] **Step 9: Verify**

Run: `npm test` (PASS), `npm run lint` (exit 0), `npm run build` (passes).

Then, with a production preview running (`npm run build && npx vite preview --port 5188 --host 127.0.0.1 &`):

```bash
node scripts/perf/check_field.mjs --url http://127.0.0.1:5188
```

Expected: `RESULT: PASS` — the parity checks from Task 5 still pass (the small project stays on lines because its bars are under 3 px at the framed distance), and the tubes check passes with `census` showing `"tubes"` greater than 0. `scripts/perf/out/check-field-tubes.png` shows lit tubes.

Visual check (look at the screenshots): tube shading should be close to the overlay/legacy look — if tubes look too dark or too bright, adjust `LIGHT` in `fieldShaders.js` (ambient / hemi / key) until they match `check-legacy.png` reasonably.

Then the benchmark at 1M bars:

```bash
node scripts/perf/cdp_bench.mjs --url "http://127.0.0.1:5188/?renderer=field" --project scripts/perf/out/p1m.json --label field-1m-lod --expect 1002336 --budget p1m
```

Expected: `idle.fps` ≥ 30, `orbit.fps` ≥ 30, `closeup.fps` close to or above 24 with `closeup.trisPerFrame` in the millions (tubes are drawing), `field.maxBlockMs` under 200. (Run with `--enforce` once Task 9 is done; the heap figure includes the 25,000-row BBS table until sub-project B.)

- [ ] **Step 10: Commit**

```bash
git add src/viewer/barfield src/store.js src/App.jsx tests/barfield scripts/perf/check_field.mjs
git commit -m "feat(barfield): instanced tubes with distance LOD and the Detail setting" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Picking (click, double-click, Query tool)

**Files:**
- Create: `src/viewer/barfield/fieldPick.js`
- Create: `src/viewer/barfield/fieldRegistry.js`
- Create: `tests/barfield/fieldPick.test.mjs`
- Modify: `src/viewer/barfield/BarField.jsx` (register the picker)
- Modify: `src/viewer/Scene.jsx` (`PickHandler`, `QueryHandler`, double-click helper)
- Modify: `scripts/perf/check_field.mjs` (pick check)

**Interfaces:**
- Consumes: `FieldData` (`seg`, `rowOfVtx`, `chunks`, `blocks`) from Task 1; `FieldView.dataSets()`, `FieldView.states`, `FieldView.radiusM` (Task 5); `handleBarClick`, `handleBarDoubleClick` (Task 5); `isWorldPointInSectionBox(point, section)` from `src/viewer/sectionPlanes.js`.
- Produces:
  - `pickField(data, ray, opts?) → { row, distance, point: [x,y,z], seg } | null` where `ray = { origin: [x,y,z], dir: [x,y,z] }` (unit direction, scene metres) and `opts = { fovRad?, viewportHeightPx?, tolPx = 6, rowStates?: Uint8Array, rowRadiusM?: Float32Array, accept?: (point) => boolean }`. Rows with state 1 (hidden) or 2 (overlay) are skipped.
  - `fieldRegistry = { current }` where `current = { pick(ray: THREE.Ray, { fovRad, viewportHeightPx }) → { row, distance, point: THREE.Vector3 } | null }`; `row` is the bar index.

- [ ] **Step 1: Write the failing picker tests**

Create `tests/barfield/fieldPick.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildField } from '../../src/viewer/barfield/buildField.js';
import { pickField } from '../../src/viewer/barfield/fieldPick.js';
import { straightRow, spreadRows, rng } from './helpers.mjs';

// Three 2 m bars along +X at height 1 m and scene z = 0, -0.5, -1.0 (app y = 0, 500, 1000).
const threeBars = () => [0, 500, 1000].map((y) => straightRow({ Pos_x: 0, Pos_y: y, Pos_z: 1000, 'Length of Bar': 2000 }));
const down = (x, z, y = 5) => ({ origin: [x, y, z], dir: [0, -1, 0] });
const opts = { fovRad: Math.PI / 4, viewportHeightPx: 800 }; // 6 px ~ 0.025 m at 4 m

test('a ray straight down onto a bar hits that row at the right distance and point', () => {
  const f = buildField(threeBars());
  const hit = pickField(f, down(1, -0.5), opts);
  assert.equal(hit.row, 1);
  assert.ok(Math.abs(hit.distance - 4) < 1e-6);
  assert.ok(Math.abs(hit.point[0] - 1) < 1e-5 && Math.abs(hit.point[1] - 1) < 1e-5 && Math.abs(hit.point[2] + 0.5) < 1e-5);
});

test('near misses inside the pixel tolerance hit, clear misses do not', () => {
  const f = buildField(threeBars());
  assert.equal(pickField(f, down(1, 0.02), opts).row, 0, '2 cm off the bar is within 6 px at 4 m');
  assert.equal(pickField(f, down(1, 0.04), opts), null, '4 cm off is outside');
  assert.equal(pickField(f, down(1, -0.25), opts), null, 'between two bars');
  assert.equal(pickField(f, down(5, 0), opts), null, 'beside the end of the bars');
});

test('the nearest hit along the ray wins', () => {
  const f = buildField([
    straightRow({ Pos_x: 0, Pos_y: 0, Pos_z: 1000, 'Length of Bar': 2000 }), // row 0 at height 1 m
    straightRow({ Pos_x: 0, Pos_y: 0, Pos_z: 2000, 'Length of Bar': 2000 }), // row 1 at height 2 m (nearer to a camera above)
  ]);
  assert.equal(pickField(f, down(1, 0), opts).row, 1);
});

test('hidden (1) and overlay (2) rows are skipped, tinted (3) rows are pickable', () => {
  const f = buildField(threeBars());
  assert.equal(pickField(f, down(1, 0), { ...opts, rowStates: Uint8Array.from([1, 0, 0]) }), null);
  assert.equal(pickField(f, down(1, 0), { ...opts, rowStates: Uint8Array.from([2, 0, 0]) }), null);
  assert.equal(pickField(f, down(1, 0), { ...opts, rowStates: Uint8Array.from([3, 0, 0]) }).row, 0);
  assert.equal(pickField(f, down(1, -0.5), { ...opts, rowStates: Uint8Array.from([1, 0, 0]) }).row, 1, 'other rows still pick');
});

test('accept() can reject hits, for example points outside the section box', () => {
  const f = buildField(threeBars());
  assert.equal(pickField(f, down(1, 0), { ...opts, accept: () => false }), null);
  assert.equal(pickField(f, down(1.5, 0), { ...opts, accept: (p) => p[0] < 1.2 }), null);
  assert.equal(pickField(f, down(0.5, 0), { ...opts, accept: (p) => p[0] < 1.2 }).row, 0);
});

test('a ray that starts past the bars does not pick them', () => {
  const f = buildField(threeBars());
  assert.equal(pickField(f, down(1, 0, 0.5), opts), null, 'camera below the bars looking down');
});

test('a thick bar is hit by its radius even where 6 px is smaller', () => {
  const f = buildField([straightRow({ Pos_x: 0, Pos_y: 0, Pos_z: 1000, 'Length of Bar': 2000, Dia: 32 })]);
  const rowRadiusM = Float32Array.from([0.016]);
  assert.equal(pickField(f, down(1, 0.012, 1.3), { ...opts, rowRadiusM }).row, 0, '12 mm off a 16 mm-radius bar, 0.3 m away');
});

test('picking is fast on a large field (150,000 segments)', () => {
  const f = buildField(spreadRows(3000, 50, 9));
  assert.equal(f.segCount, 150000);
  const r = rng(5);
  const cx = 50, cy = 10, cz = -25;
  let total = 0;
  let worst = 0;
  const N = 100;
  for (let k = 0; k < N; k++) {
    const origin = [cx + (r() - 0.5) * 200, cy + 60 + r() * 40, cz + (r() - 0.5) * 120];
    const target = [cx + (r() - 0.5) * 80, cy, cz + (r() - 0.5) * 40];
    const d = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]];
    const len = Math.hypot(...d);
    const t0 = performance.now();
    pickField(f, { origin, dir: [d[0] / len, d[1] / len, d[2] / len] }, opts);
    const dt = performance.now() - t0;
    total += dt;
    if (dt > worst) worst = dt;
  }
  assert.ok(total / N < 8, `average ${(total / N).toFixed(2)} ms per pick is too slow`);
  assert.ok(worst < 40, `worst ${worst.toFixed(1)} ms per pick is too slow`);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../fieldPick.js'`.

- [ ] **Step 3: Implement the picker and the registry**

Create `src/viewer/barfield/fieldPick.js`:

```js
// Pure ray picker (spec 7.1): ray -> chunk bounds -> pick blocks -> segments -> row id.
// Distances are scene metres. No three.js; works on the FieldData from buildField.

// Slab test: distance along the ray to where it enters the box (0 if it starts inside), or Infinity.
function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tmin = 0;
  let tmax = Infinity;
  if (Math.abs(dx) < 1e-12) {
    if (ox < x0 || ox > x1) return Infinity;
  } else {
    let t0 = (x0 - ox) / dx, t1 = (x1 - ox) / dx;
    if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
    if (t0 > tmin) tmin = t0;
    if (t1 < tmax) tmax = t1;
    if (tmin > tmax) return Infinity;
  }
  if (Math.abs(dy) < 1e-12) {
    if (oy < y0 || oy > y1) return Infinity;
  } else {
    let t0 = (y0 - oy) / dy, t1 = (y1 - oy) / dy;
    if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
    if (t0 > tmin) tmin = t0;
    if (t1 < tmax) tmax = t1;
    if (tmin > tmax) return Infinity;
  }
  if (Math.abs(dz) < 1e-12) {
    if (oz < z0 || oz > z1) return Infinity;
  } else {
    let t0 = (z0 - oz) / dz, t1 = (z1 - oz) / dz;
    if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
    if (t0 > tmin) tmin = t0;
    if (t1 < tmax) tmax = t1;
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

// ray = { origin: [x,y,z], dir: [x,y,z] } (unit direction).
// opts = { fovRad, viewportHeightPx, tolPx = 6, rowStates?: Uint8Array (1 hidden, 2 overlay: skipped),
//          rowRadiusM?: Float32Array, accept?: (point) => boolean }
// Returns { row, distance (along the ray), point (closest point on the bar axis), seg } or null.
export function pickField(data, ray, opts = {}) {
  const {
    fovRad = Math.PI / 4, viewportHeightPx = 800, tolPx = 6, rowStates = null, rowRadiusM = null, accept = null,
  } = opts;
  const [ox, oy, oz] = ray.origin;
  const [dx, dy, dz] = ray.dir;
  const tanHalf = Math.tan(fovRad / 2);
  const wpp = (t) => (2 * Math.max(t, 0) * tanHalf) / viewportHeightPx; // world units per pixel at distance t
  const { seg, rowOfVtx, blocks, chunks } = data;

  const cand = [];
  for (let c = 0; c < chunks.length; c++) {
    const ch = chunks[c];
    const far = Math.hypot(ch.center[0] - ox, ch.center[1] - oy, ch.center[2] - oz) + ch.radius;
    const pad = ch.maxRadiusM + tolPx * wpp(far);
    const t = rayBox(ox, oy, oz, dx, dy, dz,
      ch.min[0] - pad, ch.min[1] - pad, ch.min[2] - pad, ch.max[0] + pad, ch.max[1] + pad, ch.max[2] + pad);
    if (t < Infinity) cand.push({ t, c, pad });
  }
  cand.sort((a, b) => a.t - b.t);

  let best = null;
  let bestS = Infinity;
  for (const { t, c, pad } of cand) {
    if (t > bestS) break;
    const ch = chunks[c];
    for (let bi = ch.blockStart; bi < ch.blockStart + ch.blockCount; bi++) {
      const bo = bi * 6;
      const bt = rayBox(ox, oy, oz, dx, dy, dz,
        blocks.bounds[bo] - pad, blocks.bounds[bo + 1] - pad, blocks.bounds[bo + 2] - pad,
        blocks.bounds[bo + 3] + pad, blocks.bounds[bo + 4] + pad, blocks.bounds[bo + 5] + pad);
      if (bt > bestS) continue;
      const s0 = blocks.start[bi];
      const s1 = s0 + blocks.size[bi];
      for (let i = s0; i < s1; i++) {
        const row = rowOfVtx[2 * i];
        if (rowStates) {
          const st = rowStates[row];
          if (st === 1 || st === 2) continue;
        }
        const o6 = i * 6;
        const ax = seg[o6], ay = seg[o6 + 1], az = seg[o6 + 2];
        const vx = seg[o6 + 3] - ax, vy = seg[o6 + 4] - ay, vz = seg[o6 + 5] - az;
        const wx = ox - ax, wy = oy - ay, wz = oz - az;
        const b = dx * vx + dy * vy + dz * vz; // u.v
        const c2 = vx * vx + vy * vy + vz * vz; // v.v
        const d = dx * wx + dy * wy + dz * wz; // u.w
        const e = vx * wx + vy * wy + vz * wz; // v.w
        const den = c2 - b * b;
        let tt;
        if (c2 > 0 && den > 1e-12 * c2) tt = (e - b * d) / den;
        else tt = c2 > 0 ? e / c2 : 0;
        if (tt < 0) tt = 0; else if (tt > 1) tt = 1;
        let s = tt * b - d; // parameter along the ray (unit direction)
        if (s < 0) {
          s = 0;
          tt = c2 > 0 ? e / c2 : 0;
          if (tt < 0) tt = 0; else if (tt > 1) tt = 1;
        }
        if (s >= bestS) continue;
        const qx = ax + tt * vx, qy = ay + tt * vy, qz = az + tt * vz;
        const px = ox + s * dx - qx, py = oy + s * dy - qy, pz = oz + s * dz - qz;
        const rad = rowRadiusM ? rowRadiusM[row] : 0.008;
        const tol = Math.max(rad, tolPx * wpp(s));
        if (px * px + py * py + pz * pz > tol * tol) continue;
        if (accept && !accept([qx, qy, qz])) continue;
        bestS = s;
        best = { row, distance: s, point: [qx, qy, qz], seg: i };
      }
    }
  }
  return best;
}
```

Create `src/viewer/barfield/fieldRegistry.js`:

```js
// Lets PickHandler / QueryHandler reach the active BarField without prop drilling. BarField sets
// `current` while mounted. current.pick(ray, { fovRad, viewportHeightPx }) takes a THREE.Ray in scene
// metres and returns { row (bar index), distance, point: THREE.Vector3 } or null.
export const fieldRegistry = { current: null };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — including the 150,000-segment timing test (average well under 8 ms; typically around 1 ms).

- [ ] **Step 5: Register the picker from `BarField`**

In `src/viewer/barfield/BarField.jsx`: after the line `import { qualityState } from './qualityState.js';` add:

```js
import { pickField } from './fieldPick.js';
import { fieldRegistry } from './fieldRegistry.js';
import { isWorldPointInSectionBox } from '../sectionPlanes.js';
```

and directly above the comment line `  // Level of detail: at most every 100 ms (and only when something changed) decide which chunks` insert:

```jsx
  // Let PickHandler / QueryHandler pick bars through the field (rays are in scene metres).
  useEffect(() => {
    fieldRegistry.current = {
      pick(ray, { fovRad, viewportHeightPx }) {
        const view = viewRef.current;
        if (!view) return null;
        const section = useStore.getState().section;
        const r = { origin: [ray.origin.x, ray.origin.y, ray.origin.z], dir: [ray.direction.x, ray.direction.y, ray.direction.z] };
        let best = null;
        for (const data of view.dataSets()) {
          const hit = pickField(data, r, {
            fovRad, viewportHeightPx, tolPx: 6, rowStates: view.states, rowRadiusM: view.radiusM,
            accept: (p) => isWorldPointInSectionBox({ x: p[0], y: p[1], z: p[2] }, section),
          });
          if (hit && (!best || hit.distance < best.distance)) best = hit;
        }
        if (!best) return null;
        return { row: best.row, distance: best.distance, point: new THREE.Vector3(best.point[0], best.point[1], best.point[2]) };
      },
    };
    return () => { fieldRegistry.current = null; };
  }, []);

```

- [ ] **Step 6: Integrate with `PickHandler` and `QueryHandler`**

In `src/viewer/Scene.jsx`:

**6a.** After the line `import { isFieldRendererActive } from './barfield/rendererFlag.js';` add:

```js
import { fieldRegistry } from './barfield/fieldRegistry.js';
```

**6b.** Directly after the `handleBarDoubleClick` function (the one that ends with `st.requestFit('bar', i);\n}`), add:

```js
// A click on a BarField bar: same handlers as RebarMesh, and two clicks on the same bar within
// 300 ms also fire the double-click action (select + zoom to the bar).
let lastFieldClick = { row: -1, t: 0 };
function fieldBarClick(row, ev) {
  handleBarClick(row, ev);
  const now = performance.now();
  if (lastFieldClick.row === row && now - lastFieldClick.t < 300) {
    handleBarDoubleClick(row);
    lastFieldClick = { row: -1, t: 0 };
  } else {
    lastFieldClick = { row, t: now };
  }
}

// Query-panel rows for bar index i (shared by the mesh hit path and the BarField pick path).
function buildRebarQueryResult(st, i, appPt) {
  const b = Number.isInteger(i) ? st.bars[i] : null;
  if (!b) return null;
  const fmt = (p) => p.map((v) => (+v).toFixed(1)).join(', ');
  const bb = barAppBox(b);
  const en = enrichBar(b);
  return {
    kind: 'rebar',
    title: `Rebar ${b.Bar_mark || `#${i}`}`,
    sub: `${b.Rebar_Type} · Ø${b.Dia}`,
    point: appPt,
    rows: [
      ['Bar index', String(i)],
      ['Position (app mm)', fmt([b.Pos_x || 0, b.Pos_y || 0, b.Pos_z || 0])],
      ['Bbox min (app mm)', fmt([bb.minX, bb.minY, bb.minZ])],
      ['Bbox max (app mm)', fmt([bb.maxX, bb.maxY, bb.maxZ])],
      ['Bbox size (mm)', fmt([bb.maxX - bb.minX, bb.maxY - bb.minY, bb.maxZ - bb.minZ])],
      ['Distribution', `${en._copies ?? distCount(b)} bars`],
      ['Cut length', `${(en._cut || 0).toLocaleString('en-US')} mm`],
      ['Click point (app mm)', fmt(appPt)],
    ],
  };
}
```

**6c.** In `PickHandler`, replace these four lines:

```js
      const hits = raycaster.current.intersectObjects(targets, false);
      const ms = performance.now() - t0;
      // Always-on one-liner (remote diagnosis: slow raycast vs clean miss).
      console.info(`[pick] targets=${targets.length} hits=${hits.length} raycast=${ms < 10 ? ms.toFixed(1) : Math.round(ms)}ms pick=${st.ifcPick}`);
```

with:

```js
      const meshHits = raycaster.current.intersectObjects(targets, false);
      // BarField bars are not meshes: pick them from the field data, then run the same click
      // handlers a RebarMesh would. A field bar counts as the nearest hit when it is at least as
      // close as any mesh, so the empty-space and IFC branches below behave as they did before.
      const fh = fieldRegistry.current
        ? fieldRegistry.current.pick(raycaster.current.ray, { fovRad: (camera.fov * Math.PI) / 180, viewportHeightPx: rect.height })
        : null;
      if (fh) fieldBarClick(fh.row, ev);
      const hits = fh && (!meshHits.length || fh.distance <= meshHits[0].distance)
        ? [{ object: { userData: {} }, point: fh.point, distance: fh.distance, face: null }]
        : meshHits;
      const ms = performance.now() - t0;
      // Always-on one-liner (remote diagnosis: slow raycast vs clean miss).
      console.info(`[pick] targets=${targets.length} hits=${meshHits.length} field=${fh ? fh.row : '-'} raycast=${ms < 10 ? ms.toFixed(1) : Math.round(ms)}ms pick=${st.ifcPick}`);
```

**6d.** In `QueryHandler`, replace these three lines:

```js
      const hits = raycaster.current.intersectObjects(targets, false);
      console.info(`[query] targets=${targets.length} hits=${hits.length}`);
      if (!hits.length) return; // miss keeps the last result (hint shows when empty)
```

with:

```js
      const hits = raycaster.current.intersectObjects(targets, false);
      const fh = fieldRegistry.current
        ? fieldRegistry.current.pick(raycaster.current.ray, { fovRad: (camera.fov * Math.PI) / 180, viewportHeightPx: rect.height })
        : null;
      console.info(`[query] targets=${targets.length} hits=${hits.length} field=${fh ? fh.row : '-'}`);
      if (fh && (!hits.length || fh.distance <= hits[0].distance)) {
        // BarField bar nearer than any mesh: same panel as a RebarMesh hit.
        const fp = fh.point;
        const fieldPt = [fp.x * 1000, -fp.z * 1000, fp.y * 1000].map((v) => Math.round(v * 10) / 10);
        const res = buildRebarQueryResult(st, fh.row, fieldPt);
        if (res) st.setQueryResult({ ...res, at: Date.now() });
        return;
      }
      if (!hits.length) return; // miss keeps the last result (hint shows when empty)
```

**6e.** In `QueryHandler`, replace the whole rebar branch:

```js
      if (kind === 'rebar') {
        const i = root.userData?.barIndex;
        const b = Number.isInteger(i) ? st.bars[i] : null;
        if (!b) { console.info('[query] rebar hit has no bar record — skipped'); return; }
        const bb = barAppBox(b);
        const en = enrichBar(b);
        result = {
          kind,
          title: `Rebar ${b.Bar_mark || `#${i}`}`,
          sub: `${b.Rebar_Type} · Ø${b.Dia}`,
          point: appPt,
          rows: [
            ['Bar index', String(i)],
            ['Position (app mm)', fmtPt([b.Pos_x || 0, b.Pos_y || 0, b.Pos_z || 0])],
            ['Bbox min (app mm)', fmtPt([bb.minX, bb.minY, bb.minZ])],
            ['Bbox max (app mm)', fmtPt([bb.maxX, bb.maxY, bb.maxZ])],
            ['Bbox size (mm)', fmtPt([bb.maxX - bb.minX, bb.maxY - bb.minY, bb.maxZ - bb.minZ])],
            ['Distribution', `${en._copies ?? distCount(b)} bars`],
            ['Cut length', `${(en._cut || 0).toLocaleString('en-US')} mm`],
            ['Click point (app mm)', fmtPt(appPt)],
          ],
        };
      } else if (kind === 'concrete') {
```

with:

```js
      if (kind === 'rebar') {
        result = buildRebarQueryResult(st, root.userData?.barIndex, appPt);
        if (!result) { console.info('[query] rebar hit has no bar record — skipped'); return; }
      } else if (kind === 'concrete') {
```

- [ ] **Step 7: Add the pick check**

In `scripts/perf/check_field.mjs`, replace this block at the end of the file:

```js
try {
  if (!only || only === 'parity') await parity();
  if (!only || only === 'tubes') await tubes();
} catch (e) {
```

with:

```js
// pick : real trusted clicks on the field renderer. Click one bar -> that bar is selected; Ctrl-click
//        another -> both; click empty space -> the selection clears. Reads the selection from the
//        ?autotest dump (selectedBars), so it needs no store access.
const mulVec4 = (m, v) => [0, 1, 2, 3].map((row) => m[row] * v[0] + m[4 + row] * v[1] + m[8 + row] * v[2] + m[12 + row] * v[3]);
async function pick() {
  const bars = [0, 1, 2].map((k) => ({
    Rebar_tag: k + 1, Bar_mark: `B${k + 1}`, Rebar_Type: 'straight', Plane: 'XY', Dia: 16, 'Length of Bar': 3000,
    Pos_x: 0, Pos_y: k * 800, Pos_z: 1000 + k * 200, Pos_Rotation: 0, qty: 1, qty_x: 1, spacing_x: 150, qty_y: 1, spacing_y: 150,
    Group: 'pick', bond_condition: 'poor', Visible: 1,
  }));
  const projectFile = path.join(outDir, 'check_pick.json');
  fs.writeFileSync(projectFile, JSON.stringify({ v: 1, app: 'barbending', savedAt: Date.now(), bars, concretes: [], refLines: [], cover: 40, bond: 'poor', selectedBar: 0, selectedBars: [] }));
  const b = await launchBrowser({ instrument: INSTR });
  try {
    await openProject(b, 'renderer=field&autotest=pick', projectFile);
    const cam = await b.ev('({ view: Array.from(window.__camera.matrixWorldInverse.elements), proj: Array.from(window.__camera.projectionMatrix.elements) })');
    const rect = await b.ev('(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()');
    // mid-point of bar k in scene metres: x 1.5, y = height, z = -(app y)
    const screen = (k) => {
      const p = [1.5, (1000 + k * 200) / 1000, -(k * 800) / 1000, 1];
      const c = mulVec4(cam.proj, mulVec4(cam.view, p));
      return { x: rect.x + (c[0] / c[3] * 0.5 + 0.5) * rect.w, y: rect.y + (-c[1] / c[3] * 0.5 + 0.5) * rect.h };
    };
    const click = async (pt, modifiers = 0) => {
      await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y });
      await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1, modifiers });
      await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1, modifiers });
      await sleep(1400); // the autotest dump refreshes once per second
    };
    const selected = async () => (await b.ev("JSON.parse(document.getElementById('autotest-dump').textContent).selectedBars")) || [];
    const same = (a, c) => a.length === c.length && [...a].sort().join() === [...c].sort().join();
    await click(screen(2));
    let s = await selected();
    report(same(s, [2]), `click on bar 3 selects it (selectedBars=${JSON.stringify(s)})`);
    await click(screen(1));
    s = await selected();
    report(same(s, [1]), `click on bar 2 replaces the selection (selectedBars=${JSON.stringify(s)})`);
    await click(screen(0), 2);
    s = await selected();
    report(same(s, [0, 1]), `Ctrl-click on bar 1 adds it (selectedBars=${JSON.stringify(s)})`);
    await click({ x: rect.x + rect.w * 0.08, y: rect.y + rect.h * 0.92 });
    s = await selected();
    report(s.length === 0, `click on empty space clears the selection (selectedBars=${JSON.stringify(s)})`);
    report(b.consoleErrors.length === 0, `no errors logged${b.consoleErrors.length ? ': ' + b.consoleErrors[0] : ''}`);
  } finally {
    b.close();
  }
}

try {
  if (!only || only === 'parity') await parity();
  if (!only || only === 'tubes') await tubes();
  if (!only || only === 'pick') await pick();
} catch (e) {
```

Also add the line `// pick   : real clicks on the field renderer select / toggle / clear bars.` to the usage comment at the top of the file.

- [ ] **Step 8: Verify**

Run: `npm test` (PASS), `npm run lint` (exit 0), `npm run build` (passes).

With a production preview running:

```bash
node scripts/perf/check_field.mjs --url http://127.0.0.1:5188 --only pick
```

Expected: `RESULT: PASS` — four PASS lines for the clicks plus "no errors logged". If a click selects nothing, open the page with `?renderer=field&autotest=pick` in a normal browser, click a bar and read the console: the `[pick] ... field=<row>` line shows whether the field picker saw it.

Manual check in the app (production or dev, `?renderer=field`): load a project, click bars, Ctrl-click to add, double-click to zoom to a bar, turn on the Query tool and click a bar, arm Lap picking and click two bars, hide a bar with its eye icon (it must disappear and no longer be clickable).

- [ ] **Step 9: Commit**

```bash
git add src/viewer/barfield src/viewer/Scene.jsx tests/barfield scripts/perf/check_field.mjs
git commit -m "feat(barfield): ray picker over chunks and blocks; PickHandler and Query integration" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Staying in sync with edits (diff, overlay, delta chunk, rebuild) and the failure fallback

**Files:**
- Create: `src/viewer/barfield/diffRows.js`
- Create: `tests/barfield/diffRows.test.mjs`
- Replace: `src/viewer/barfield/BarField.jsx` (full file below; it keeps the LOD loop of Task 6 and the picker of Task 7)
- Modify: `src/viewer/Scene.jsx` (expose `window.__store` in `AutotestDump`)
- Modify: `scripts/perf/check_field.mjs` (`edit` and `fallback` checks; the field wait skips `?fieldfail`)

**Interfaces:**
- Consumes: Task 1 `buildField` (with `rowIds`), Task 3 `FieldBuilder`, Task 4 `computeHiddenMask` / `composeRowStates` / `STATE`, Task 5 `FieldView` (`addChunks`, `removeDelta`, `writeRowAttrs`, `touch`, `setStates`, `texelCount`, `rowCount`, `states`, `radiusM`, `dataSets`, `applyTubeSet`, `items`), Task 6 LOD, Task 7 picker and registry; store actions `updateBar(idx, patch)`, `hideBars(idxs, hidden)`, `clearBarSelection()`.
- Produces:
  - `geometryKey(row) → string` (JSON of the row without view-only keys `hidden, Visible, host, Group, Bar_mark, Rebar_tag, setId, setSpec, bond_condition, feature`), `MAX_SIGNATURE_ROWS = 2000`, `diffRows(prev, next) → { sameLength, changed: number[], needsRebuild }` from `diffRows.js`. `needsRebuild` is true when the lengths differ or more than `MAX_SIGNATURE_ROWS` row objects changed identity (undo / redo / import).
  - Delta rows: an edited bar `bi` that has been flushed draws from the delta chunk with virtual id `view.rowCount + k`, where `deltaRows[k] = bi`; its static id `bi` is set to `STATE.HIDDEN`.
  - `window.__store` (autotest only) for the browser checks.
  - `?fieldfail=1` forces the field build to fail so the fallback can be exercised.

- [ ] **Step 1: Write the failing `diffRows` tests**

Create `tests/barfield/diffRows.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { diffRows, geometryKey, MAX_SIGNATURE_ROWS } from '../../src/viewer/barfield/diffRows.js';
import { spreadRows } from './helpers.mjs';

test('identical arrays report no changes', () => {
  const a = spreadRows(10, 2, 1);
  assert.deepEqual(diffRows(a, a.slice()), { sameLength: true, changed: [], needsRebuild: false });
});

test('a replaced row with different geometry is reported', () => {
  const a = spreadRows(10, 2, 1);
  const b = a.map((r, i) => (i === 4 ? { ...r, Pos_x: r.Pos_x + 100 } : r));
  assert.deepEqual(diffRows(a, b), { sameLength: true, changed: [4], needsRebuild: false });
});

test('view-only changes (hidden, Group, Bar_mark, host) are not geometry changes', () => {
  const a = spreadRows(10, 2, 1);
  const b = a.map((r, i) => (i === 2 ? { ...r, hidden: true, Group: 'X', Bar_mark: 'ZZ', host: 'c9' } : r));
  assert.deepEqual(diffRows(a, b).changed, []);
});

test('diameter, length, copies and profile changes count as geometry changes', () => {
  const a = spreadRows(6, 2, 1);
  for (const patch of [{ Dia: 32 }, { 'Length of Bar': 1234 }, { qty_y: 9 }, { spacing_y: 77 }, { Pos_Rotation: 45 }, { legs: '[[10,0]]' }]) {
    const b = a.map((r, i) => (i === 3 ? { ...r, ...patch } : r));
    assert.deepEqual(diffRows(a, b).changed, [3], JSON.stringify(patch));
  }
});

test('a structuredClone of every row (undo) reports only the rows that really changed', () => {
  const a = spreadRows(20, 2, 1);
  const c = structuredClone(a);
  assert.deepEqual(diffRows(a, c).changed, []);
  c[7] = { ...c[7], 'Length of Bar': 1 };
  assert.deepEqual(diffRows(a, c).changed, [7]);
});

test('different lengths need a rebuild', () => {
  const a = spreadRows(5, 1, 1);
  assert.deepEqual(diffRows(a, a.slice(0, 4)), { sameLength: false, changed: [], needsRebuild: true });
});

test('more replaced rows than MAX_SIGNATURE_ROWS need a rebuild without comparing signatures', () => {
  const rows = spreadRows(MAX_SIGNATURE_ROWS + 5, 1, 2);
  const next = rows.map((r) => ({ ...r }));
  assert.deepEqual(diffRows(rows, next), { sameLength: true, changed: [], needsRebuild: true });
});

test('geometryKey ignores view-only keys but not geometry', () => {
  const [r] = spreadRows(1, 2, 1);
  assert.equal(geometryKey(r), geometryKey({ ...r, hidden: true, Visible: 0, Group: 'g', host: 'h', Bar_mark: 'M', Rebar_tag: 99 }));
  assert.notEqual(geometryKey(r), geometryKey({ ...r, Dia: 99 }));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../diffRows.js'`.

- [ ] **Step 3: Implement `diffRows.js`**

Create `src/viewer/barfield/diffRows.js`:

```js
// Pure: which rows changed GEOMETRY between two `bars` arrays (spec 5.6). Rows are immutable objects,
// so unchanged rows keep their identity; view-only fields never count as geometry changes.
const VIEW_ONLY = new Set(['hidden', 'Visible', 'host', 'Group', 'Bar_mark', 'Rebar_tag', 'setId', 'setSpec', 'bond_condition', 'feature']);

export const MAX_SIGNATURE_ROWS = 2000;

export function geometryKey(row) {
  return JSON.stringify(row, (k, v) => (VIEW_ONLY.has(k) ? undefined : v));
}

// -> { sameLength, changed: number[], needsRebuild }
//  - different lengths: the caller must rebuild
//  - rows whose identity changed are candidates; more than MAX_SIGNATURE_ROWS candidates (undo, redo,
//    import) are not compared one by one: rebuild instead
//  - otherwise `changed` holds the candidates whose geometryKey differs
export function diffRows(prev, next) {
  if (prev.length !== next.length) return { sameLength: false, changed: [], needsRebuild: true };
  const candidates = [];
  for (let i = 0; i < next.length; i++) if (prev[i] !== next[i]) candidates.push(i);
  if (candidates.length > MAX_SIGNATURE_ROWS) return { sameLength: true, changed: [], needsRebuild: true };
  const changed = [];
  for (const i of candidates) if (geometryKey(prev[i]) !== geometryKey(next[i])) changed.push(i);
  return { sameLength: true, changed, needsRebuild: false };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — every test file, 0 failures.

- [ ] **Step 5: Replace `BarField.jsx` with the full synchronising version**

Replace the whole content of `src/viewer/barfield/BarField.jsx` with:

```jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useStore } from '../../store.js';
import { FieldBuilder } from './fieldClient.js';
import { buildField } from './buildField.js';
import { FieldView } from './fieldObjects.js';
import { computeHiddenMask, composeRowStates, STATE } from './rowState.js';
import { diffRows } from './diffRows.js';
import { chooseTubeChunks } from './lod.js';
import { qualityState } from './qualityState.js';
import { pickField } from './fieldPick.js';
import { fieldRegistry } from './fieldRegistry.js';
import { isWorldPointInSectionBox } from '../sectionPlanes.js';
import { fieldStatus, fieldStats, publishStats, timed } from './fieldStatus.js';

const REBUILD_DEBOUNCE_MS = 150; // wait out bursts of changes (import, add / remove) before rebuilding
const EDIT_QUIET_MS = 400; // edited rows move from the overlay into the delta chunk after this long
const IDLE_REBUILD_MS = 10000; // a non-empty delta is folded into a full rebuild after this long
const DELTA_FRACTION = 0.05; // delta capacity = 5% of the rows (+64)
const LEGACY_FALLBACK_ROWS = 20000;

// Draws every bar through the chunked field (lines far, tubes near), keeps it in sync with the store,
// and lets selected / just-edited rows use the classic RebarMesh through `renderOverlayBar(i)`.
export default function BarField({ renderOverlayBar }) {
  const bars = useStore((s) => s.bars);
  const concretes = useStore((s) => s.concretes);
  const root = useMemo(() => new THREE.Group(), []);
  const viewRef = useRef(null);
  const deltaRowsRef = useRef([]); // virtual id k (view.rowCount + k) -> bar index
  const lod = useRef({ last: 0, prev: new Set(), cam: new THREE.Matrix4(), detail: '', budget: 0, view: null });
  const [overlay, setOverlay] = useState([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const builder = new FieldBuilder({ onProgress: (f) => fieldStatus.set({ building: true, fraction: f }) });
    const timers = { rebuild: 0, quiet: 0, idle: 0 };
    const pending = new Set(); // edited rows waiting for the quiet period (drawn by the overlay)
    const forceFail = new URLSearchParams(window.location.search).has('fieldfail');
    let disposed = false;
    let seq = 0;
    let builtFrom = null; // the bars array the static field was built from
    let deltaSet = new Set(); // bar indices drawn by the delta chunk
    let deltaBuilt = new Map(); // bar index -> the row object the delta was built from
    let hidden = { bars: null, concretes: null, mask: null };

    const hiddenMask = (b, c) => {
      if (hidden.bars !== b || hidden.concretes !== c) hidden = { bars: b, concretes: c, mask: computeHiddenMask({ bars: b, concretes: c }) };
      return hidden.mask;
    };

    // Compose the row states from the store (hidden mask, selection, pending edits) and apply them.
    const applyStates = () => {
      const st = useStore.getState();
      const view = viewRef.current;
      const force = new Set(pending);
      if (view) for (let i = view.rowCount; i < st.bars.length; i++) force.add(i); // rows added since the build
      const { states, overlay: list } = composeRowStates({
        hiddenMask: hiddenMask(st.bars, st.concretes), selectedBars: st.selectedBars, forceOverlay: force,
      });
      if (view) {
        timed(() => {
          const tex = new Uint8Array(view.texelCount);
          const n = Math.min(states.length, view.rowCount);
          for (let i = 0; i < n; i++) tex[i] = deltaSet.has(i) ? STATE.HIDDEN : states[i];
          const dr = deltaRowsRef.current;
          for (let k = 0; k < dr.length; k++) tex[view.rowCount + k] = dr[k] < states.length ? states[dr[k]] : STATE.HIDDEN;
          view.setStates(tex);
        });
      }
      setOverlay((prev) => (prev.length === list.length && prev.every((v, i) => v === list[i]) ? prev : list));
    };

    const scheduleRebuild = (delay) => {
      clearTimeout(timers.rebuild);
      timers.rebuild = setTimeout(runRebuild, delay);
    };

    // Move the edited rows from the overlay into a small delta chunk (spec 5.6).
    const flushDelta = () => {
      const view = viewRef.current;
      if (disposed || !view || !builtFrom) return;
      const cur = useStore.getState().bars;
      if (cur.length !== builtFrom.length) { scheduleRebuild(0); return; }
      const d = diffRows(builtFrom, cur);
      if (d.needsRebuild || d.changed.length > view.texelCount - view.rowCount) { scheduleRebuild(0); return; }
      const rows = d.changed;
      try {
        timed(() => {
          view.removeDelta();
          if (rows.length) {
            const ids = rows.map((_, k) => view.rowCount + k);
            const data = buildField(rows.map((i) => cur[i]), { rowIds: ids });
            view.addChunks(data, true);
            for (let k = 0; k < rows.length; k++) view.writeRowAttrs(view.rowCount + k, data.rows.colorIdx[k], data.rows.radiusM[k]);
            view.touch();
          }
        });
      } catch (err) {
        console.error('[barfield] delta build failed', err);
        scheduleRebuild(0);
        return;
      }
      deltaRowsRef.current = rows;
      deltaSet = new Set(rows);
      deltaBuilt = new Map(rows.map((i) => [i, cur[i]]));
      pending.clear();
      lod.current.view = null; // chunk list changed: re-evaluate the LOD
      applyStates();
    };

    // Compare the current rows with the ones the field was built from and queue delta / rebuild work.
    const reconcile = (cur) => {
      const view = viewRef.current;
      if (!view || !builtFrom) return;
      if (cur.length !== builtFrom.length) { scheduleRebuild(REBUILD_DEBOUNCE_MS); return; }
      const d = diffRows(builtFrom, cur);
      if (d.needsRebuild || d.changed.length > view.texelCount - view.rowCount) { scheduleRebuild(REBUILD_DEBOUNCE_MS); return; }
      const changed = new Set(d.changed);
      pending.clear();
      let stale = false;
      for (const i of changed) if (deltaBuilt.get(i) !== cur[i]) { pending.add(i); stale = true; }
      for (const i of deltaSet) if (!changed.has(i)) stale = true; // reverted to the built geometry (undo)
      if (stale) {
        clearTimeout(timers.quiet);
        timers.quiet = setTimeout(flushDelta, EDIT_QUIET_MS);
        clearTimeout(timers.idle);
        timers.idle = setTimeout(() => scheduleRebuild(0), IDLE_REBUILD_MS);
      }
    };

    async function runRebuild() {
      if (disposed) return;
      const snapshot = useStore.getState().bars;
      const mySeq = ++seq;
      fieldStatus.set({ building: true, fraction: 0, message: '', error: false });
      const t0 = performance.now();
      try {
        if (forceFail) throw new Error('forced by ?fieldfail');
        const data = await builder.build(snapshot);
        if (disposed || !data || mySeq !== seq) return;
        if (data.skippedRows) console.warn(`[barfield] skipped ${data.skippedRows} rows with invalid geometry`);
        timed(() => {
          const next = new FieldView(data, { deltaCapacity: Math.ceil(data.rowCount * DELTA_FRACTION) + 64 });
          const old = viewRef.current;
          root.add(next.group);
          viewRef.current = next;
          if (old) { root.remove(old.group); old.dispose(); }
        });
        builtFrom = snapshot;
        deltaRowsRef.current = [];
        deltaSet = new Set();
        deltaBuilt = new Map();
        pending.clear();
        clearTimeout(timers.quiet);
        clearTimeout(timers.idle);
        lod.current.view = null;
        publishStats({
          ready: true, version: fieldStats.version + 1, rows: data.rowCount, segments: data.segCount,
          chunks: data.chunkCount, buildMs: Math.round(performance.now() - t0), usingFallback: builder.usingFallback,
        });
        fieldStatus.set({ building: false, fraction: 1, message: '', error: false });
        setFailed(false);
        reconcile(useStore.getState().bars); // edits made while it was building
        applyStates();
      } catch (err) {
        console.error('[barfield] build failed', err);
        if (disposed) return;
        setFailed(true);
        fieldStatus.set({ building: false, message: 'Bar renderer unavailable - showing the classic view (first 20,000 bars)', error: true });
      }
    }

    const barsChanged = (cur) => {
      if (!viewRef.current) scheduleRebuild(REBUILD_DEBOUNCE_MS);
      else reconcile(cur);
      applyStates();
    };

    const unsub = useStore.subscribe((state, prev) => {
      if (state.bars !== prev.bars) barsChanged(state.bars);
      else if (state.selectedBars !== prev.selectedBars || state.concretes !== prev.concretes) applyStates();
    });

    // Let PickHandler / QueryHandler pick bars through the field (rays are in scene metres).
    fieldRegistry.current = {
      pick(ray, { fovRad, viewportHeightPx }) {
        const view = viewRef.current;
        if (!view) return null;
        const section = useStore.getState().section;
        const r = { origin: [ray.origin.x, ray.origin.y, ray.origin.z], dir: [ray.direction.x, ray.direction.y, ray.direction.z] };
        let best = null;
        for (const data of view.dataSets()) {
          const hit = pickField(data, r, {
            fovRad, viewportHeightPx, tolPx: 6, rowStates: view.states, rowRadiusM: view.radiusM,
            accept: (p) => isWorldPointInSectionBox({ x: p[0], y: p[1], z: p[2] }, section),
          });
          if (hit && (!best || hit.distance < best.distance)) best = hit;
        }
        if (!best) return null;
        const row = best.row < view.rowCount ? best.row : (deltaRowsRef.current[best.row - view.rowCount] ?? -1);
        if (row < 0) return null;
        return { row, distance: best.distance, point: new THREE.Vector3(best.point[0], best.point[1], best.point[2]) };
      },
    };

    barsChanged(useStore.getState().bars);

    return () => {
      disposed = true;
      Object.values(timers).forEach((t) => clearTimeout(t));
      unsub();
      builder.dispose();
      fieldRegistry.current = null;
      const v = viewRef.current;
      if (v) { root.remove(v.group); v.dispose(); viewRef.current = null; }
      publishStats({ ready: false });
    };
  }, [root]);

  // Level of detail: at most every 100 ms (and only when something changed) decide which chunks
  // draw as tubes; the rest stay lines. Chunks outside the frustum never spend triangle budget.
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const frustum = useMemo(() => new THREE.Frustum(), []);
  const projView = useMemo(() => new THREE.Matrix4(), []);
  useFrame(() => {
    const view = viewRef.current;
    if (!view) return;
    const st = lod.current;
    const detail = useStore.getState().barDetail || 'auto';
    camera.updateMatrixWorld();
    const unchanged = st.view === view && detail === st.detail && qualityState.budgetTris === st.budget && st.cam.equals(camera.matrixWorld);
    const now = performance.now();
    if (unchanged || now - st.last < 100) return;
    if (st.view !== view) st.prev = new Set();
    st.last = now;
    st.view = view;
    st.detail = detail;
    st.budget = qualityState.budgetTris;
    st.cam.copy(camera.matrixWorld);
    timed(() => {
      projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projView);
      const tubes = chooseTubeChunks({
        chunks: view.items.map((it) => it.chunk),
        cameraPos: [camera.position.x, camera.position.y, camera.position.z],
        fovRad: (camera.fov * Math.PI) / 180,
        viewportHeightPx: gl.domElement.clientHeight || 800,
        budgetTris: qualityState.budgetTris,
        prevTubes: st.prev,
        detail,
        isVisible: (i) => frustum.intersectsSphere(view.items[i].sphere),
      });
      view.applyTubeSet(tubes);
      st.prev = tubes;
    });
  });

  // If the field cannot be built, the classic renderer takes over for the first rows so the app still works.
  const failedList = useMemo(() => {
    if (!failed) return null;
    const mask = computeHiddenMask({ bars, concretes });
    const out = [];
    for (let i = 0; i < bars.length && out.length < LEGACY_FALLBACK_ROWS; i++) if (!mask[i]) out.push(i);
    return out;
  }, [failed, bars, concretes]);
  const list = failedList || overlay;

  return (
    <>
      <primitive object={root} />
      {list.map((i) => (bars[i] ? renderOverlayBar(i) : null))}
    </>
  );
}
```

- [ ] **Step 6: Expose the store to the browser checks**

In `src/viewer/Scene.jsx`, inside `AutotestDump`, directly after the line `    window.__camera = camera;` add:

```js
    window.__store = useStore; // browser checks drive edits / hiding through the real store
```

- [ ] **Step 7: Add the `edit` and `fallback` checks**

In `scripts/perf/check_field.mjs`:

**7a.** In `openProject`, change the line

```js
  if (query.includes('renderer=field')) {
```

to

```js
  if (query.includes('renderer=field') && !query.includes('fieldfail')) {
```

**7b.** Replace this block at the end of the file:

```js
try {
  if (!only || only === 'parity') await parity();
  if (!only || only === 'tubes') await tubes();
  if (!only || only === 'pick') await pick();
} catch (e) {
```

with:

```js
// edit : edit and hide bars through the real store and compare with the legacy renderer.
//        The edited bar must move (centre of mass shifts), both renderers must agree afterwards, hiding a
//        bar must remove its pixels, and a single edit must not trigger a full rebuild (delta path).
async function edit() {
  const mk = (k) => ({
    Rebar_tag: k + 1, Bar_mark: `B${k + 1}`, Rebar_Type: 'straight', Plane: 'XY', Dia: 16, 'Length of Bar': 3000,
    Pos_x: 0, Pos_y: k * 1200, Pos_z: 1500, Pos_Rotation: 0, qty: 1, qty_x: 1, spacing_x: 150, qty_y: 1, spacing_y: 150,
    Group: 'edit', bond_condition: 'poor', Visible: 1,
  });
  const projectFile = path.join(outDir, 'check_edit.json');
  fs.writeFileSync(projectFile, JSON.stringify({ v: 1, app: 'barbending', savedAt: Date.now(), bars: [0, 1, 2].map(mk), concretes: [], refLines: [], cover: 40, bond: 'poor', selectedBar: 0, selectedBars: [] }));
  const b = await launchBrowser({ instrument: INSTR });
  const res = {};
  try {
    for (const mode of ['legacy', 'field']) {
      b.consoleErrors.length = 0;
      await openProject(b, `renderer=${mode}&autotest=edit`, projectFile);
      await b.ev('window.__store.getState().clearBarSelection()');
      await sleep(800);
      const v0 = mode === 'field' ? await b.ev('window.__barfield.version') : 0;
      const before = await b.ev(PIXEL_STATS);
      await b.ev('window.__store.getState().updateBar(2, { Pos_y: 3200, Pos_x: 400 })');
      await sleep(1800); // 400 ms quiet period + delta flush + a few frames
      const moved = await b.ev(PIXEL_STATS);
      await b.ev('window.__store.getState().hideBars([0], true)');
      await sleep(1200);
      const hiddenStats = await b.ev(PIXEL_STATS);
      const v1 = mode === 'field' ? await b.ev('window.__barfield.version') : 0;
      res[mode] = { before, moved, hiddenStats, v0, v1, errors: b.consoleErrors.slice() };
      const shot = await b.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(outDir, `check-edit-${mode}.png`), Buffer.from(shot.data, 'base64'));
    }
  } finally {
    b.close();
  }
  const L = res.legacy, F = res.field;
  const close = (a, c, tol = 14) => Math.abs(a.x0 - c.x0) <= tol && Math.abs(a.x1 - c.x1) <= tol && Math.abs(a.y0 - c.y0) <= tol && Math.abs(a.y1 - c.y1) <= tol
    && Math.hypot(a.cx - c.cx, a.cy - c.cy) <= 12;
  console.log(`      field: before c=(${F.before.cx.toFixed(0)},${F.before.cy.toFixed(0)}) moved c=(${F.moved.cx.toFixed(0)},${F.moved.cy.toFixed(0)}) n ${F.moved.n} -> hidden n ${F.hiddenStats.n}`);
  report(F.errors.length === 0, `edit: no errors logged${F.errors.length ? ': ' + F.errors[0] : ''}`);
  report(Math.hypot(F.before.cx - F.moved.cx, F.before.cy - F.moved.cy) >= 5, 'edit: the edited bar moved on screen');
  report(close(L.before, F.before), 'edit: before the edit both renderers agree');
  report(close(L.moved, F.moved), 'edit: after moving a bar both renderers agree');
  report(F.hiddenStats.n < 0.9 * F.moved.n, `edit: hiding a bar removes its pixels (${F.moved.n} -> ${F.hiddenStats.n})`);
  report(close(L.hiddenStats, F.hiddenStats), 'edit: after hiding a bar both renderers agree');
  report(F.v1 === F.v0, `edit: a single edit used the delta chunk, not a full rebuild (field version ${F.v0} -> ${F.v1})`);
}

// fallback : ?fieldfail=1 makes the field build fail on purpose: the classic renderer must take over
//            (same picture as the legacy renderer) and the badge must say so.
async function fallback() {
  const projectFile = path.join(outDir, 'check_clip.json');
  fs.writeFileSync(projectFile, JSON.stringify(makeCheckProject()));
  const b = await launchBrowser({ instrument: INSTR });
  try {
    await openProject(b, 'renderer=legacy&autotest=parity', projectFile);
    const L = await b.ev(PIXEL_STATS);
    b.consoleErrors.length = 0;
    await openProject(b, 'renderer=field&fieldfail=1&autotest=parity', projectFile);
    await sleep(1500);
    const F = await b.ev(PIXEL_STATS);
    const badge = await b.ev("document.body.innerText.includes('Bar renderer unavailable')");
    console.log(`      fallback: legacy n=${L.n} c=(${L.cx.toFixed(0)},${L.cy.toFixed(0)})  fieldfail n=${F.n} c=(${F.cx.toFixed(0)},${F.cy.toFixed(0)})`);
    report(badge, 'fallback: the badge says the classic view is showing');
    report(b.consoleErrors.some((e) => e.includes('build failed')), 'fallback: the failure was logged');
    report(F.n > 0.7 * L.n && F.n < 1.4 * L.n, `fallback: the classic renderer drew the bars (${F.n} vs ${L.n} amber px)`);
    report(Math.hypot(L.cx - F.cx, L.cy - F.cy) <= 8, 'fallback: same picture as the legacy renderer');
  } finally {
    b.close();
  }
}

try {
  if (!only || only === 'parity') await parity();
  if (!only || only === 'tubes') await tubes();
  if (!only || only === 'pick') await pick();
  if (!only || only === 'edit') await edit();
  if (!only || only === 'fallback') await fallback();
} catch (e) {
```

and add these two lines to the usage comment at the top of the file:

```js
// edit   : edits and hiding go through the delta path and match the legacy renderer.
// fallback: ?fieldfail=1 -> the classic renderer takes over with a badge.
```

- [ ] **Step 8: Verify**

Run: `npm test` (PASS), `npm run lint` (exit 0; the `react-hooks/exhaustive-deps` rule may warn about the big effect — only `root` is a dependency by design, the effect reads everything else through refs and the store, so a single warning there is acceptable), `npm run build` (passes).

With a production preview running (`npm run build && npx vite preview --port 5188 --host 127.0.0.1 &`):

```bash
node scripts/perf/check_field.mjs --url http://127.0.0.1:5188
```

Expected: `RESULT: PASS` for parity, tubes, pick, edit and fallback. If `edit` reports "a single edit used the delta chunk" as FAIL (version changed), the diff found more than a few changed rows: print `d.changed` in `reconcile`. If "after moving a bar both renderers agree" fails, open `scripts/perf/out/check-edit-field.png` and `check-edit-legacy.png` side by side.

Manual check (`?renderer=field`): select a bar and drag its length in the editor — it should follow instantly (overlay), keep the new shape after you deselect it, undo/redo should restore it, adding and deleting bars should rebuild briefly with the "Building bars…" badge.

- [ ] **Step 9: Commit**

```bash
git add src/viewer/barfield src/viewer/Scene.jsx tests/barfield scripts/perf/check_field.mjs
git commit -m "feat(barfield): sync with edits via overlay, delta chunk and rebuild; classic fallback on failure" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Adaptive quality

**Files:**
- Create: `src/viewer/barfield/quality.js`
- Create: `src/viewer/barfield/QualityController.jsx`
- Create: `tests/barfield/quality.test.mjs`
- Modify: `src/viewer/Scene.jsx` (use the controller with the field renderer)

**Interfaces:**
- Consumes: `qualityState` (Task 6); R3F `useThree().setDpr`.
- Produces:
  - `QUALITY_LEVELS = [{ dpr, budgetTris }…]` (`(1.75, 5M)`, `(1.25, 3M)`, `(1.0, 1.5M)`, `(1.0, 0.5M)`), `TARGET_MS = 33`, `SLOW_MS = 40`, `SLOW_FRAMES = 10`, `FAST_MS = 24`, `FAST_HOLD_MS = 2000`, `RESTORE_MS = 250`.
  - `createQualityController() → { level, update(frameMs, interacting, nowMs) → { level, changed, dpr, budgetTris } }`.
  - `<QualityController />` — writes `qualityState` and calls `setDpr` when the level changes.

- [ ] **Step 1: Write the failing tests**

Create `tests/barfield/quality.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createQualityController, QUALITY_LEVELS, SLOW_FRAMES, FAST_HOLD_MS, RESTORE_MS,
} from '../../src/viewer/barfield/quality.js';

test('levels match the spec', () => {
  assert.deepEqual(QUALITY_LEVELS.map((l) => [l.dpr, l.budgetTris]), [[1.75, 5e6], [1.25, 3e6], [1.0, 1.5e6], [1.0, 0.5e6]]);
});

test('starts at full quality', () => {
  const c = createQualityController();
  assert.equal(c.level, 0);
  const r = c.update(16, false, 0);
  assert.equal(r.level, 0);
  assert.equal(r.changed, false);
});

test('slow frames while interacting step down after SLOW_FRAMES slow frames, not before', () => {
  const c = createQualityController();
  let steppedAt = -1;
  for (let i = 1; i <= 40; i++) {
    const r = c.update(100, true, i * 100);
    if (r.changed) { steppedAt = i; assert.equal(r.level, 1); break; }
  }
  assert.ok(steppedAt >= SLOW_FRAMES && steppedAt <= SLOW_FRAMES + 3, `stepped down at frame ${steppedAt}`);
});

test('keeps stepping down while slow, capped at the last level', () => {
  const c = createQualityController();
  let level = 0;
  for (let i = 1; i <= 400; i++) level = c.update(100, true, i * 100).level;
  assert.equal(level, QUALITY_LEVELS.length - 1);
});

test('slow frames while NOT interacting never step down', () => {
  const c = createQualityController();
  for (let i = 1; i <= 100; i++) assert.equal(c.update(100, false, i * 100).level, 0);
});

test('one frame spike is smoothed away (no step down)', () => {
  const c = createQualityController();
  for (let i = 1; i <= 30; i++) c.update(16, true, i * 16);
  assert.equal(c.update(120, true, 600).level, 0);
  for (let i = 1; i <= 30; i++) assert.equal(c.update(16, true, 600 + i * 16).level, 0);
});

test('fast frames for FAST_HOLD_MS while interacting step back up one level', () => {
  const c = createQualityController();
  let t = 0;
  while (c.level < 2) { t += 100; c.update(100, true, t); }
  const down = c.level;
  let up = null;
  const start = t;
  while (t - start < FAST_HOLD_MS + 4000 && up === null) {
    t += 16;
    const r = c.update(12, true, t);
    if (r.changed) up = r.level;
  }
  assert.equal(up, down - 1);
});

test('full quality is restored RESTORE_MS after interaction ends', () => {
  const c = createQualityController();
  let t = 0;
  while (c.level < 1) { t += 100; c.update(100, true, t); }
  const lastInteract = t;
  let r = c.update(16, false, lastInteract + RESTORE_MS - 10);
  assert.equal(r.level, 1, 'not yet');
  r = c.update(16, false, lastInteract + RESTORE_MS + 10);
  assert.equal(r.level, 0);
  assert.equal(r.changed, true);
  assert.equal(r.budgetTris, 5e6);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../quality.js'`.

- [ ] **Step 3: Implement the controller**

Create `src/viewer/barfield/quality.js`:

```js
// Pure adaptive-quality controller (spec 8.1). No three.js and no DOM.
// While the camera is moving (interacting) and frames run long, step the pixel ratio and the tube
// triangle budget down; step back up when frames are comfortably fast; restore full quality shortly
// after the interaction ends.
export const QUALITY_LEVELS = Object.freeze([
  Object.freeze({ dpr: 1.75, budgetTris: 5_000_000 }),
  Object.freeze({ dpr: 1.25, budgetTris: 3_000_000 }),
  Object.freeze({ dpr: 1.0, budgetTris: 1_500_000 }),
  Object.freeze({ dpr: 1.0, budgetTris: 500_000 }),
]);
export const TARGET_MS = 33;
export const SLOW_MS = 40; // frame-time EMA above this for SLOW_FRAMES frames while interacting: step down
export const SLOW_FRAMES = 10;
export const FAST_MS = 24; // EMA below this for FAST_HOLD_MS while interacting: step up
export const FAST_HOLD_MS = 2000;
export const RESTORE_MS = 250; // after interaction ends, back to full quality
const ALPHA = 0.1;

export function createQualityController() {
  let level = 0;
  let ema = TARGET_MS;
  let slowFrames = 0;
  let fastSince = null;
  let lastInteractAt = -Infinity;
  let wasInteracting = false;
  return {
    get level() { return level; },
    update(frameMs, interacting, nowMs) {
      ema += ALPHA * (frameMs - ema);
      let changed = false;
      if (interacting) {
        lastInteractAt = nowMs;
        wasInteracting = true;
        if (ema > SLOW_MS) {
          slowFrames += 1;
          fastSince = null;
        } else {
          slowFrames = 0;
          if (ema < FAST_MS) {
            if (fastSince === null) fastSince = nowMs;
            else if (nowMs - fastSince >= FAST_HOLD_MS && level > 0) {
              level -= 1;
              changed = true;
              fastSince = null;
              ema = TARGET_MS;
            }
          } else {
            fastSince = null;
          }
        }
        if (slowFrames >= SLOW_FRAMES && level < QUALITY_LEVELS.length - 1) {
          level += 1;
          changed = true;
          slowFrames = 0;
          fastSince = null;
          ema = TARGET_MS; // judge the new level on its own frames
        }
      } else if (wasInteracting && nowMs - lastInteractAt >= RESTORE_MS) {
        wasInteracting = false;
        slowFrames = 0;
        fastSince = null;
        if (level !== 0) { level = 0; changed = true; ema = TARGET_MS; }
      }
      const l = QUALITY_LEVELS[level];
      return { level, changed, dpr: l.dpr, budgetTris: l.budgetTris };
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — every test file, 0 failures.

- [ ] **Step 5: Add the R3F controller and use it**

Create `src/viewer/barfield/QualityController.jsx`:

```jsx
import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { createQualityController } from './quality.js';
import { qualityState } from './qualityState.js';

// Replaces drei's AdaptiveDpr for the field renderer: watches frame times while the camera moves and
// steps the pixel ratio and the tube triangle budget (spec 8.1). "Interacting" = the camera moved
// within the last 250 ms, whatever moved it (orbit, wheel zoom, keys, fit / view animations).
export default function QualityController() {
  const camera = useThree((s) => s.camera);
  const setDpr = useThree((s) => s.setDpr);
  const ctl = useRef(null);
  const prev = useRef({ pos: new THREE.Vector3(), quat: new THREE.Quaternion(), movedAt: -Infinity, init: false });
  if (!ctl.current) ctl.current = createQualityController();
  useFrame((_, delta) => {
    const now = performance.now();
    const p = prev.current;
    if (!p.init) { p.pos.copy(camera.position); p.quat.copy(camera.quaternion); p.init = true; }
    const moved = p.pos.distanceToSquared(camera.position) > 1e-10 || p.quat.angleTo(camera.quaternion) > 1e-5;
    if (moved) { p.movedAt = now; p.pos.copy(camera.position); p.quat.copy(camera.quaternion); }
    const r = ctl.current.update(Math.min(delta * 1000, 250), now - p.movedAt < 250, now);
    if (r.changed) {
      qualityState.budgetTris = r.budgetTris;
      qualityState.level = r.level;
      const dpr = Math.max(1, Math.min(r.dpr, window.devicePixelRatio || 1));
      qualityState.dpr = dpr;
      setDpr(dpr);
    }
  });
  return null;
}
```

In `src/viewer/Scene.jsx`: after the line `import { fieldRegistry } from './barfield/fieldRegistry.js';` add:

```js
import QualityController from './barfield/QualityController.jsx';
```

and replace these two lines:

```jsx
      {/* Drops render resolution under load, restores when smooth (fill-bound GPUs) */}
      <AdaptiveDpr />
```

with:

```jsx
      {/* Drops render resolution under load, restores when smooth (fill-bound GPUs). The field
          renderer also shrinks its tube budget while the camera moves. */}
      {useField ? <QualityController /> : <AdaptiveDpr />}
```

- [ ] **Step 6: Verify**

Run: `npm test` (PASS), `npm run lint` (exit 0), `npm run build` (passes).

With a production preview running, re-run the functional checks and compare orbiting at a higher pixel density, where fill cost dominates:

```bash
node scripts/perf/check_field.mjs --url http://127.0.0.1:5188
node scripts/perf/cdp_bench.mjs --url "http://127.0.0.1:5188/?renderer=field" --project scripts/perf/out/p1m.json --label field-1m-dpr15 --dpr 1.5 --expect 1002336
```

Expected: all functional checks still pass. In the benchmark at `--dpr 1.5`, `orbit.fps` should be at or above `idle.fps` (the spike measured 26.7 fps idle at 1.5× with a fixed resolution) because the controller lowers the resolution while the camera moves; `idle.fps` itself is unchanged (full quality when still). If `orbit.fps` is lower than `idle.fps`, check that `setDpr` is being called (add a `console.info` in the `r.changed` branch).

- [ ] **Step 7: Commit**

```bash
git add src/viewer/barfield src/viewer/Scene.jsx tests/barfield
git commit -m "feat(barfield): adaptive quality (pixel ratio and tube budget while the camera moves)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Make the field renderer the default, document it, and verify the budgets

**Files:**
- Modify: `src/viewer/barfield/rendererFlag.js` (default flips to `'field'`)
- Modify: `README.md`, `agent.md`, `overview.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: everything from Tasks 1–9.
- Produces: the app opens with the field renderer by default; `?renderer=legacy` forces the classic path; documented rig, flags and conventions.

- [ ] **Step 1: Flip the default**

In `src/viewer/barfield/rendererFlag.js` change

```js
export const DEFAULT_RENDERER = 'legacy';
```

to

```js
export const DEFAULT_RENDERER = 'field';
```

and update the comment above it to:

```js
// Which bar renderer is active: ?renderer=field | legacy. 'field' is the default; ?renderer=legacy
// forces the classic per-bar meshes. The field renderer needs WebGL2 (otherwise legacy is used).
```

- [ ] **Step 2: Run the whole verification suite**

```bash
npm test
npm run lint
npm run build
npx vite preview --port 5188 --host 127.0.0.1 &
sleep 4
node scripts/perf/gen_project.mjs 25000 40 p1m 7
node scripts/perf/gen_project.mjs 75000 40 p3m 11
node scripts/perf/check_field.mjs --url http://127.0.0.1:5188
node scripts/perf/cdp_bench.mjs --url "http://127.0.0.1:5188/" --project scripts/perf/out/p1m.json --label default-1m --expect 1002336 --budget p1m --enforce
node scripts/perf/cdp_bench.mjs --url "http://127.0.0.1:5188/" --project scripts/perf/out/p3m.json --label default-3m --expect 3002391 --budget p3m --enforce
node scripts/cdp-section.mjs "http://127.0.0.1:5188/?autotest=section" scripts/perf/out/section.png
```

Expected:
- `npm test`: all pass. `npm run lint`: exit 0. `npm run build`: passes.
- `check_field.mjs`: `RESULT: PASS` (parity, tubes, pick, edit, fallback). Note the checks pass `renderer=legacy` / `renderer=field` explicitly, so the new default does not change them.
- 1M bars bench with `--enforce`: every line `PASS` (idle fps ≥ 30, orbit fps ≥ 30, close-up fps ≥ 24, viewport ready ≤ 5000 ms, heap ≤ 1500 MB, longest field block ≤ 200 ms). If a budget fails, do not weaken `budgets.json`: find the cause (run with `PROFILE=1` against the dev server for the CPU breakdown, check `orbit.worstMs`, and `field.maxBlockMs`).
- 3M bars bench: idle fps ≥ 15.
- `cdp-section.mjs`: prints `DUMP:` JSON containing `"section"`, six `planes` values, and `"field":{"lines":N,...}` with N > 0; the screenshot `scripts/perf/out/section.png` shows the bars clipped by the section box.

- [ ] **Step 3: Manual checklist (spec section 9.2)**

Open the app normally (`npm run dev`, no flag) and load `scripts/perf/out/p1m.json` through `⤒ Project`; also load a real sample such as `inputs/stair_sample_auto_bbs.json`. Confirm each item still behaves as before:

- Click select; Ctrl/Cmd/Shift-click toggle; double-click zooms to the bar; lap picking (anchor, second bar); Query tool on a bar; hide / show a bar; hide a host member; box select (Shift+B); Fit All and view presets; section box (cut, uncut, drag a face) with bars clipping correctly; colour by diameter; the selected bar's white highlight; CSV and project export / import unchanged.
- Orbit and zoom stay smooth on the 1M-bar project; the **detail** selector in the status bar (next to the fps readout) switches between Auto, Lines and Tubes.
- `http://localhost:5173/?renderer=legacy` still gives the old behaviour.

- [ ] **Step 4: Document the renderer and the rig**

In `README.md`, directly above the line `## Troubleshooting` insert:

````markdown
## Large projects (BarField renderer)

Projects with hundreds of thousands to millions of physical bars stay interactive: bars are drawn in
spatial chunks as merged lines when far away and as instanced tubes near the camera, selected and
just-edited bars use the classic tube look, and the pixel ratio drops while the camera moves.

- **Detail** (status bar, next to the fps readout): *Auto* (default, lines far / tubes near), *Lines* (fastest), *Tubes* (always
  tubes; slow on very large projects). Saved in the browser.
- `?renderer=legacy` forces the old one-mesh-per-bar renderer (also used automatically without WebGL2).
- If the new renderer cannot be built, the classic renderer shows the first 20,000 bars and a notice.
- `scripts/perf/` measures it (synthetic projects, headless Edge on the real GPU):
  `node scripts/perf/gen_project.mjs 25000 40 p1m 7`, then
  `node scripts/perf/cdp_bench.mjs --url http://127.0.0.1:5188/ --project scripts/perf/out/p1m.json --expect 1002336 --budget p1m --enforce`.
  `node scripts/perf/check_field.mjs --url http://127.0.0.1:5188` checks placement, clipping, picking,
  edits and the fallback against the legacy renderer. See `scripts/perf/README.md`.
- Still slow at very large scale (separate follow-ups): the BBS table and bar dropdown render every row,
  undo clones the whole bar list, Save uses `localStorage` (about 5 MB), and Measure / Pick snapping scans
  every bar.
````

In `agent.md`, directly above the line `## Dev servers & the stale-tab problem` insert:

````markdown
## Bar renderer (`src/viewer/barfield/`)

- Default renderer is the **BarField** (chunked lines + instanced tubes, spec in
  `docs/superpowers/specs/2026-10-07-barfield-renderer-design.md`); `?renderer=legacy` selects the
  old per-bar `RebarMesh` list. `RebarMesh` still draws selected / just-edited rows (the overlay).
- Pure modules (`buildField`, `rowState`, `diffRows`, `lod`, `quality`, `fieldPick`, `workerCore`,
  `fieldClient`) have Node tests in `tests/barfield/` (`npm test`); they import with explicit `.js`
  extensions and must not touch three.js, React or the DOM.
- Field objects are static (`matrixAutoUpdate = false`), have no event handlers, and are NOT pick roots:
  bars are picked from data (`fieldPick.js` through `fieldRegistry`), never by raycasting meshes.
- Row id texture layout: R = state (0 normal, 1 hidden, 2 overlay, 3 tint), G = colour slot, B = radius (m).
  Edited rows use virtual ids `rowCount + k` (delta chunk); `deltaRows[k]` maps back to the bar index.
- Browser checks: `scripts/perf/check_field.mjs` (needs a built preview) and `scripts/perf/cdp_bench.mjs`.
  `?autotest=...` exposes `window.__scene`, `__camera` and `__store` for them; `?fieldfail=1` forces the
  field build to fail to exercise the fallback.

````

In `overview.md`, directly above the line starting with `| \`src/viewer/IfcModel.jsx\` |` insert:

```markdown
| `src/viewer/barfield/*` | Default bar renderer: worker-built chunked segments, line / instanced-tube LOD, row-state texture, ray picker, adaptive quality (`BarField.jsx` composes them) |
```

and in the "Data flows" section, replace the first line of the **Rebar:** paragraph

```markdown
**Rebar:** form edit → `updateBar` → `genBarPoints` (local mm polyline) →
`TubeGeometry` per distribution copy + `enrichBar` (cut length, `qty×qty_x×qty_y`
weight) → BBS row → CSV export.
```

with:

```markdown
**Rebar:** form edit → `updateBar` → `genBarPoints` (local mm polyline) → BarField
(segments per distribution copy in chunks; the edited row shows as a classic tube until it moves
into a delta chunk) + `enrichBar` (cut length, `qty×qty_x×qty_y` weight) → BBS row → CSV export.
```

- [ ] **Step 5: Record the work in the CHANGELOG**

In `CHANGELOG.md`, change the heading of the first Unreleased bullet from

```markdown
- **Large-project performance: spike + BarField renderer design (docs only — no app code changed)**:
```

to

```markdown
- **Large-project performance: BarField renderer (spike, design, implementation)**:
```

and directly after that bullet's `Design:` sub-bullet add:

```markdown
  - Implemented (`src/viewer/barfield/`, default renderer; `?renderer=legacy` keeps the old path): worker-built chunked segments with pick blocks, instanced-tube LOD with the **Detail** setting (Auto / Lines / Tubes), per-row state texture (hide / overlay / tint) shared with the section-box clipping planes, ray picker (click, Ctrl-toggle, double-click, lap pick, Query), delta chunk + rebuild for edits, adaptive quality, classic-renderer fallback with a badge. 60+ node tests (`npm test`) and a committed rig (`scripts/perf/`: generator, CDP bench with budgets, parity / pick / edit / fallback checks).
  - Measured (production build, headless Edge on the Intel UHD, 1600×900; copy the numbers from the bench output): 1M bars idle <idle.fps> fps, orbit <orbit.fps> fps, close-up <closeup.fps> fps, viewport drawn in <viewportMs> ms, JS heap <afterEdit.jsHeapMB> MB; 3M bars idle <idle.fps> fps (legacy renderer before: 8.9 fps at 10k bars, 0.7 fps at 100k). The BBS table still takes about 17 s to render 25,000 rows (sub-project B).
```

(Replace each `<…>` with the value of that field from the `RESULT` JSON printed by the matching benchmark run; do not invent numbers.)

- [ ] **Step 6: Final build and commit**

Run: `npm test && npm run lint && npm run build` — Expected: all pass.

```bash
git add src/viewer/barfield/rendererFlag.js README.md agent.md overview.md CHANGELOG.md
git commit -m "feat(barfield): make the field renderer the default; document the renderer and the perf rig" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Do not push unless the user asks.

---

## Self-review against the spec

- **Spec 4 architecture:** `buildField` (T1), worker + shim (T3), `fieldShaders` / `tubes` / `fieldObjects` (T5), `lod` (T6), `fieldPick` (T7), `quality` + controller (T9), `BarField` (T5 → T6 → T7 → T8); `Scene.jsx` swap + shared handlers (T5), Query fallback (T7), `barDetail` (T6), Detail selector (T6), autotest census (T5).
- **Spec 5 pipeline:** FieldData incl. pick blocks (T1); expansion without the 5,000-copy cap (T1); chunking limits (T1 constants); worker protocol (T3); row state texture (T4/T5); sync, delta, rebuild, timers (T8).
- **Spec 6 rendering:** lines + tubes + clipping chunks (T5), LOD rule and cache of 64 (T5/T6), selection overlay up to 300 and tint above (T4/T5), hidden rows (T4).
- **Spec 7 interaction:** picker, same handlers, double-click, Query (T7); box select / snapping unchanged.
- **Spec 8:** adaptive quality (T9). Render-on-demand is deliberately a separate later plan (spec 8.2 / milestone 7).
- **Spec 9 / 10 / 11:** fallbacks (T8), checklist and tests (T10), milestones 1–6 map to Tasks 1–10.
- **Spec 2 budgets:** enforced by `scripts/perf/budgets.json` with `--enforce` (T2, T10).
- **Refinements of the spec made by this plan** (all internal): pick blocks inside chunks for the 16 ms pick budget; signature comparison of changed rows only up to 2,000 candidates (more triggers a rebuild); virtual row ids for delta chunks; `window.__barfield`, `window.__store` and `?fieldfail=1` test hooks; `barDetail` persisted under `localStorage['barbending.barDetail']`.

