# BarField renderer — design (sub-project A)

Date: 2026-10-07 · Status: design approved section by section, pending written-spec review
Branch: `feat/barfield-renderer` · Flag while in development: `?renderer=field`

## 1. Purpose and scope

barbending must stay interactive when a project holds **millions of physical bars**
(rows with distribution grids expand to many copies). Today every distribution copy is
its own `<mesh>` with its own material, so a project of 10k bars already renders at
about 9 fps on the reference machine.

This spec covers **sub-project A: the bar renderer**. It replaces the per-copy meshes
with a chunked, GPU-instanced renderer with level of detail (LOD) and adaptive quality.

### In scope

- A new `src/viewer/barfield/` module and its wiring in `Scene.jsx`.
- Line / tube LOD, section-box clipping, per-row hide / selection / tint state.
- Click, double-click, lap-pick and Query-tool picking for bars at any scale.
- Adaptive quality while the camera moves; an opt-in render-on-demand mode.
- A committed performance rig (`scripts/perf/`) with pass/fail budgets.

### Out of scope (separate sub-projects, each with its own spec → plan → build)

| Id | Sub-project | What it will do |
|---|---|---|
| B | UI and data layer | Window the BBS table and bar dropdown; undo as diffs instead of 50 full clones; save to IndexedDB instead of `localStorage` |
| C | Snapping index | Spatial index for Measure / Pick-to-place snapping, reusing the chunk structure and picker from A |
| D | IFC performance | Merge / LOD the 27 MB IFC model (3,295 draw calls today) |

Also unchanged: the data model (parametric rows), CSV / FreeCAD export, store actions,
the BBS table, box-select (it works from bar data, not meshes), and IFC rendering.
Hover highlight does not exist today and is not added.

## 2. Success criteria

Measured with `scripts/perf/` on the reference machine: Intel UHD integrated GPU,
Chromium-based browser, 1600×900 viewport, device pixel ratio 1, synthetic projects
from `scripts/perf/gen_project.mjs`, **no IFC loaded**, section box on.

| Criterion | Budget |
|---|---|
| 1M physical bars (25,000 rows), whole model framed, idle and orbiting | ≥ 30 fps |
| 1M physical bars, camera inside the model (close-up) | ≥ 24 fps |
| 3M physical bars, whole model framed | ≥ 15 fps (usable) |
| Time from project import until the bars are drawn in the viewport | < 5 s at 1M bars |
| Longest main-thread block caused by field work | ≤ 200 ms |
| JS heap after import and a select / edit / undo cycle | < 1.5 GB at 1M bars |
| Click pick (ray → row) | ≤ 16 ms at 3M bars |
| Existing bar features (section 9 checklist) | behave as today |

The import-to-drawn budget covers the **viewport only**. The BBS table still renders
every row until sub-project B (25,000 rows currently block the main thread for about
17 s, mostly DOM work); that cost is not part of A's budget but is reported by the rig.

The rig prints results on any machine and only fails the run when started with
`--enforce` (budgets are specific to the reference machine).

## 3. Evidence behind the design

A throwaway spike (2026-10-07) measured the current app and a prototype on the
reference machine. Numbers that drive the design:

- **Current app, production build, whole model framed:** 10,163 bars → 8.9 fps,
  10,173 draw calls, 6.0M triangles per frame; 50,160 bars → 2.0 fps; 100,104 bars →
  0.7 fps, 57.7M triangles; 200k bars did not finish in 7 minutes. Heap after one
  select + duplicate + undo: 220 MB / 941 MB / 1,875 MB.
- **Profile (10k bars, dev build):** 69% of CPU time inside three.js per-object work (clipping
  plane projection per material, matrix updates, program setup, culling), 22% native
  GL submission, ≈ 0% React and app code. The app sustains about 54M triangles/s
  while the same GPU sustained about 600M in the prototype, so it is draw-call
  bound, not triangle bound.
- **Prototype (merged lines, spatial chunks, instanced six-sided tubes), same GPU:**
  1M bars as one line buffer 43 fps; chunked LOD 45 fps (whole model) and 40 fps
  (camera inside, 5.1M triangles); every segment as a tube with no LOD 25 fps
  (24M triangles); 3M bars 15–16 fps. At device pixel ratio 1.5 the 1M close-up fell to
  16.5 fps, so fill cost must be adaptive. Build time 0.5 s at 1M and 2.7 s at 3M bars.
- **Other costs relevant to later sub-projects** (Node, 1M bars / 25k rows): one undo
  snapshot 22 MB (up to 50 kept); `snapPrimitives` 747 ms per mouse move; saved JSON
  7.4 MB against a `localStorage` limit of about 5M characters.

## 4. Architecture

New folder `src/viewer/barfield/`. Each unit has one job and a small interface.

| Unit | Job | Depends on |
|---|---|---|
| `buildField.js` | Pure function: bar rows → chunked segment arrays (`FieldData`). No DOM, runs in a Worker and in Node tests | `bbs/shapes.js` |
| `barField.worker.js` | Runs `buildField` off the main thread; returns buffers as transferables | `buildField.js` |
| `fieldShaders.js` | Line and tube materials: section clipping, row-state lookup, colour by diameter, simple lighting | `viewer/sectionPlanes.js` |
| `lod.js` | Pure functions: which chunks draw as tubes given camera, viewport, budget, previous state | none |
| `fieldPick.js` | Pure ray picker: ray → chunk bounds → segments → row index | `FieldData` |
| `quality.js` | Adaptive quality controller (pixel ratio, tube budget) from frame times and interaction state | none |
| `BarField.jsx` | R3F component: owns GPU objects, syncs with the store, applies LOD, handles clicks | all of the above |

Changes to existing files:

- `src/viewer/Scene.jsx`: replace the `bars.map(<RebarMesh/>)` list with `<BarField/>`
  plus `<RebarMesh/>` for overlay rows only; extract the `RebarMesh` click and
  double-click logic into a shared `handleBarClick(i, ev)` / `handleBarDoubleClick(i)`
  used by both overlay meshes and the field picker; give `QueryHandler` a field-pick
  fallback; keep `collectPickTargets` working (field objects are not pick roots).
- `src/store.js`: one persisted view setting `barDetail` (`'auto' | 'lines' | 'tubes'`,
  default `'auto'`, saved in `localStorage` under `barbending.barDetail`, like the layout sizes).
- `src/App.jsx`: a **Detail** selector in the viewport bar.
- `AutotestDump` (test hook): count field draw objects in its census and expose `window.__store`.
  The field publishes `window.__barfield` stats for the perf rig, and `?fieldfail=1` forces a
  build failure to exercise the fallback.

No new runtime dependencies. The worker uses Vite's
`new Worker(new URL('./barField.worker.js', import.meta.url), { type: 'module' })`.

## 5. Data and build pipeline

### 5.1 FieldData

```
FieldData {
  rowCount, segCount, chunkCount, skippedRows
  seg:      Float32Array(6 * segCount)   // start xyz, end xyz; scene space, metres, Y up
  rowOfVtx: Float32Array(2 * segCount)   // row index per vertex (lines read it; picker reads [2*i])
  rows: { radiusM: Float32Array, colorIdx: Uint8Array }   // per row, length rowCount
  chunks: [{ start, count, min[3], max[3], center[3], radius, maxRadiusM, blockStart, blockCount }]
  blocks: { start: Int32Array, size: Int32Array, bounds: Float32Array(6 * B), maxRadiusM: Float32Array }
          // pick blocks: at most 256 consecutive segments each; they partition every chunk
  bounds: { min[3], max[3] }
}
```

Memory is about 32 bytes per segment (≈ 64 MB per 1M bars). Radius and colour live per
row, not per segment.

### 5.2 Expansion

For each row: `genBarPoints(row)` → `transformBarLocalPoint` → polyline in app mm; every
copy from `distOffsets(row)`; segments between consecutive points; app `(x, y, z)` mm →
scene `(x, z, −y)` metres (same mapping as `RebarMesh`). The 5,000-copy cap and the red
"more copies" marker do not apply to field rows: every copy is drawn. Rows whose points
are non-finite are skipped (`skippedRows`, one console warning).

Radius per row is `max(0.008, Dia / 2000)` metres (same minimum as `RebarMesh`).
`colorIdx` maps `Dia` to the existing palette (10, 12, 16, 20, 25, 32, 40; anything else
uses the default amber), so colours match today's.

### 5.3 Chunking

Adaptive octree over the model bounds: split a node while it holds more than 30,000
segments, depth < 6 and edge > 0.5 m. Each segment is assigned by its midpoint. Leaves
with at least one segment become chunks; segments are counting-sorted so every chunk is
one contiguous range. Chunk bounds come from the real segment endpoints, so culling is
exact even when a long segment crosses a cell border.

Inside each chunk the same octree keeps splitting down to **pick blocks** of at most 256
segments (depth <= 14, edge >= 2 cm). A block is a contiguous range with its own bounds and
every chunk owns a contiguous run of blocks. Blocks exist only to make click picking fast
(section 7.1); rendering uses chunks.

### 5.4 Worker protocol

- Main → worker: `{ type: 'build', id, rows }`
- Worker → main: `{ type: 'progress', id, fraction }`, then
  `{ type: 'built', id, data }` with buffers transferred, or `{ type: 'error', id, message }`.
- Only the latest `id` is accepted; stale results are dropped.

### 5.5 Row state

One small float RGBA `DataTexture` (width 2048, height `ceil(rowCount / 2048)`, one texel
per row) holds `state` (0 normal, 1 hidden, 2 overlay, 3 tint) in R, `colorIdx` in G and
`radiusM` in B (from the per-row table of 5.1; the shaders read colour and radius from
here). Only the R channel changes after the build: hide, host-hide, spatial-hide,
selection and overlay are single-value writes followed by one texture upload (about
1 MB at 75k rows). Shaders collapse hidden / overlay vertices outside clip space and tint
tinted rows.

### 5.6 Keeping the field in sync with `bars`

Rows are immutable objects and unchanged rows keep their identity, so `BarField` diffs
`bars` against the array the field was built from, by reference (O(rows)). Rows whose identity
changed are compared by a geometry signature (view-only fields such as `hidden`, `host`,
`Group` and `Bar_mark` are ignored) to find the rows that really changed. If more than 2,000
rows changed identity (undo, redo or import of a large project) it does not compare one by
one and rebuilds in the worker instead.

- **Edited rows (same array length):** the row switches to *overlay* at once (drawn by
  `RebarMesh`, zero edit latency). After 400 ms without further edits its geometry is
  built on the main thread into a small **delta chunk** drawn by the same shaders; the
  old copies stay hidden through row state. Delta rows use virtual row ids `rowCount + k` in
  the texture and map back to bar indices for picking.
- **Full rebuild in the worker** when the delta exceeds about 5% of rows, after 10 s idle
  with a non-empty delta, or when the array length changes (add, remove, import). The
  previous field stays visible until the new one swaps in atomically; a small
  "updating" badge shows while it builds. While rebuilding after an add / remove, the
  view can be briefly stale.
- Rows with index ≥ `field.rowCount` (just added) are overlay rows until the rebuild.

## 6. Rendering

All field objects are static: `matrixAutoUpdate = false`, no event handlers (so R3F's own
raycaster ignores them), opaque, and given exact bounding spheres so three culls them.

### 6.1 Far view: lines

One `LineSegments` per chunk. Material derives from three's line material so section
clipping works unchanged; a small shader patch reads the row texel (state, colour) via
the per-vertex row id. 1 px lines.

### 6.2 Near view: instanced tubes

Created lazily per chunk when it is first promoted. One shared six-sided prism (12
triangles); per-instance data are start and end points (an interleaved view onto the
chunk's `seg` range) and the row id; radius and colour come from the row table.
Lighting is simple (Lambert plus hemisphere, tuned to the scene's lights). This is a
bit flatter than today's metallic material; **selected and edited bars keep today's
exact material** through the overlay. Section clipping uses three's clipping chunks.

### 6.3 LOD rule (`lod.js`)

Recomputed at most every 100 ms or when the camera or quality changes.

- Apparent bar width in pixels for a chunk:
  `px = 2 · maxRadiusM / distance · viewportHeight / (2 · tan(fov / 2))`, using the
  chunk's distance from the camera to its bounding-sphere centre.
- A chunk is a tube candidate when `px ≥ 3`; a chunk currently drawn as tubes reverts
  to lines when `px < 2` (hysteresis).
- Candidates are promoted closest-first until the **triangle budget** is spent
  (12 per segment; 5M by default, reduced by adaptive quality). Everything else draws
  as lines.
- Tube buffers are cached for the 64 most recently used chunks.
- `barDetail`: `'auto'` = the rule above; `'lines'` = never tubes; `'tubes'` = every
  chunk a candidate with no budget cap (about 25 fps at 1M bars).

### 6.4 Selection, overlay and hiding

- **Selection of up to 300 rows:** overlay rows, drawn by the existing `RebarMesh`
  (white emissive, on top, no depth test), exactly as today. The field hides their
  copies via row state. Overlay rows keep today's 5,000-copy cap and marker.
- **Selection of more than 300 rows** (for example "All"): no overlay; rows are tinted
  in place in the field (state 3). They are not forced on top.
- **Hidden rows** (`bar.hidden`, host hidden, spatially inside a hidden member): state 1,
  recomputed in O(rows) when hidden state changes.
- Lap-anchor markers, reference lines, concrete and IFC rendering are unchanged.

## 7. Interaction

### 7.1 Click picking (`fieldPick.js`)

On pointer-up without drag (same threshold as `PickHandler`, skipped while draw,
measure or box-select own the click): build the pick ray, intersect it with chunk
bounds, visit chunks front to back, then the pick blocks of each chunk (bounds test), and
test only the segments of blocks the ray touches. A segment is hit when the
3D ray–segment distance is at most `max(radius, 6 px · world size of one pixel at that
depth)`. Hidden and overlay rows are skipped; a hit outside the active section box
(`isWorldPointInSectionBox`) is ignored. The nearest hit along the ray wins; search stops
once the next chunk begins beyond the best hit. The result is a row index.

The row index feeds the same handlers as the overlay meshes: select, Ctrl/Cmd/Shift
toggle, lap-pick anchor and second click, double-click (two clicks on the same row within
300 ms → select and `requestFit('bar', i)`). Overlay rows still receive R3F's own events;
the field picker never reports them.

### 7.2 Query tool

`QueryHandler` keeps its mesh raycast. If the nearest mesh hit is farther than the
field pick, or there is none, it uses the field pick and reads the row index directly.

### 7.3 Unchanged

Box-select (works from `barAppBox` on bar data), Measure and Pick-to-place snapping
(`snapPrimitives`; slow at very large scale until sub-project C), keyboard navigation,
DiveZoom, section box dragging.

## 8. Adaptive quality and render-on-demand

### 8.1 Adaptive quality (`quality.js`)

Target frame time 33 ms. *Interacting* means the camera moved within the last 250 ms,
whatever moved it (orbit, wheel zoom, keys, fit / view animations).

- While interacting: if the frame-time EMA exceeds 40 ms for 10 frames, step down one
  level. Levels pair a pixel ratio with a tube budget: (1.75, 5M), (1.25, 3M), (1.0, 1.5M),
  (1.0, 0.5M triangles). If the EMA stays below 24 ms for 2 s, step up one level.
- 250 ms after interaction ends, restore full quality.
- Replaces the current `<AdaptiveDpr/>` so the two do not fight.

### 8.2 Render on demand

An opt-in mode (`frameloop="demand"`, setting `renderOnDemand`, default off) that draws
only when something changes: `invalidate()` on camera change, store changes and while any
animation loop (DiveZoom momentum, fit / view animation, nav keys, auto-clipping) is
active. It is a **late milestone**, off by default until every tool has been verified
with it, because it touches every `useFrame` loop. Benefit: zero GPU use when idle.

## 9. Errors, fallbacks and the verification checklist

### 9.1 Fallbacks

- No WebGL2, or the field fails to initialise: the legacy `RebarMesh` path draws all
  rows (still capped at 5,000 copies per row) and a one-line notice explains why.
- Worker failure: the same build runs on the main thread in time-sliced batches with a
  progress badge.
- Out-of-memory while building: an error banner is shown and the legacy path takes over
  for the first 20,000 rows only, so the page stays responsive.
- Non-finite row geometry: skipped with a console warning (`skippedRows`).

### 9.2 Feature checklist (must behave as today)

Click select; Ctrl/Cmd/Shift toggle; double-click zoom to bar; lap pick (anchor, second
bar); Query tool on a bar; hide / show a bar; hide a host; spatial hide; box select;
section box (cut, uncut, drag faces) with bars clipping correctly; Fit All; view presets;
CSV and project import / export (data layer unchanged); colour by diameter; selected bar
highlight.

## 10. Testing

TDD per implementation plan.

- **Node tests** (`node --test`, no new dependency) for `buildField`: segment count
  equals the sum over rows of copies × (points − 1); every segment matches the
  `genBarPoints` + `distOffsets` ground truth within 0.01 mm; chunk ranges partition the
  segments exactly and bounds contain their segments; every non-skipped row appears;
  non-finite rows are skipped. For `lod.js`: promotion order, budget cap, hysteresis,
  `lines` / `tubes` overrides. For `quality.js`: step down, step up, restore.
- **Picker tests:** known rays hit the expected row; misses return none; hidden and
  overlay rows are skipped; points outside the section box are ignored; timing at 1M
  and 3M segments is recorded and compared with the 16 ms budget.
- **Performance rig** `scripts/perf/` (generator, CDP bench, optional prototype page):
  loads synthetic projects through the real "⤒ Project" input and measures load time,
  heap, DOM size, draw calls, fps idle / orbit / zoom and select / edit / undo latency.
  Budgets from section 2 are enforced with `--enforce`.
- **Visual parity:** CDP screenshots of a small project under `?renderer=legacy` and
  `?renderer=field` at close range, checked for placement and colour; the existing
  `scripts/cdp-section.mjs` section-box harness must still pass.
- **Build gates:** `npm run build` passes and `npm run lint` exits 0 after every milestone.

## 11. Rollout and milestones

Work happens on `feat/barfield-renderer`. Each milestone leaves the app working. The URL
flag `?renderer=field|legacy` selects the renderer: until milestone 6 the default is
`legacy` (today's behaviour) and `?renderer=field` opts in; from milestone 6 the default
is `field` and `?renderer=legacy` forces the fallback path.

1. **Builder:** `buildField.js` + Node tests + the committed perf rig and generator.
2. **Lines:** worker, chunks, `BarField` drawing far-view lines with row state and
   section clipping behind the flag.
3. **Tubes and LOD:** lazy tube chunks, `lod.js`, the Detail setting.
4. **Interaction:** field picker, shared click handlers, overlay for selected and
   edited rows, hide / host-hide, Query fallback, delta chunk and rebuild logic.
5. **Adaptive quality:** `quality.js`, replacing `AdaptiveDpr`.
6. **Default on:** run the rig and checklist, make the field renderer the default and
   keep the legacy path as the fallback.
7. **Render on demand:** opt-in flag, enabled by default only after every tool is
   verified with it (may land in a later change).

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Fill cost on a high-DPI integrated GPU in close-up | Adaptive pixel ratio and tube budget (section 8.1); measured at 1.5× in the spike |
| Field and overlay tubes look different | Overlay is used only for selected / edited bars, which already look distinct; parity screenshots in milestone 6 |
| Clipping or state-lookup bugs in patched materials | Built from three's own materials with small patches; section harness and picker tests |
| Stale field during a rebuild after add / remove | Atomic swap, "updating" badge, delta chunk for ordinary edits |
| Thin-line picking feels fiddly | 6 px tolerance and nearest-along-ray rule; tolerance is a single constant |
| Render-on-demand regressions | Opt-in, late milestone, per-tool verification |

## 13. Assumptions

- Reference hardware is an Intel integrated GPU; Chromium-based browser with WebGL2.
- Typical projects are thousands to tens of thousands of rows, each expanding to many
  copies; a bar averages about two straight segments (bars with more bends cost more).
- Straight-segment tubes may show small gaps at very tight bends in extreme close-up;
  accepted for this sub-project.
