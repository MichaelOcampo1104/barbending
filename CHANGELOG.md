# Changelog — barbending progress record

## Unreleased (working tree → next push)

- **Standalone viewer: the whole model in one `.html` file (design and plan only, nothing built yet)**:
  - Problem: once the modelling and the BBS are done there is no light way to save and share the model. The app needs `npm` and a server, the built app cannot be opened by double-click (its module scripts load from absolute `/assets/` paths), and glTF would store every bar as a mesh, carry no BBS and need a viewer site.
  - Decision (agreed in the design conversation, 2026-10-08): a `⤓ Viewer` export writes ONE self-contained `.html` file that opens in any recent browser with nothing installed. It holds the project as the app's own parametric rows (gzip + base64, about 22 KB for the Ent3 model) and a read-only viewer built from the app's own pure modules (bar geometry, the chunked line / tube renderer with its level of detail and end-on dots, picking, camera maths, the BBS calculations): 3D bars and concrete, orbit / zoom / pan, Iso and the six true orthographic views, click a bar for its details, the sortable BBS table, a diameter legend, and a section box (Faces push / pull grips, Move, Rotate, Fit box, Test cut, Solid cut, show / hide, size readout). The same file opens in the app again (`⤒ Project`, `⤒+ Insert`), so it is also a save. Left out on purpose: the IFC model (27 MB would defeat the point), drawing the reference lines (their data is kept in the file), measuring, editing, hosting and share links.
  - Prototype (throwaway, 2026-10-08; headless Edge on the Intel UHD, 1600×900, opened from `file://`; not committed): the Ent3 project (1,680 rows, 3,848 bars) became a 627 KB file (175 KB zipped) that opens in 0.4–0.6 s and orbits at 60 fps with totals identical to the app's; a synthetic project of 1,002,336 bars (25,000 rows) became 1.5 MB (835 KB zipped), opens in 1.2 s and orbits at 45 fps.
  - Spec and plan: `docs/superpowers/specs/2026-10-08-standalone-viewer-design.md` (budgets: Ent3 file ≤ 0.8 MB; 1M-bar file ≤ 1.8 MB, opening ≤ 3 s, orbit ≥ 30 fps; export at 1M bars ≤ 3 s; the totals line equal to the app's BBS header; an exported file imported back deep-equal; the existing checks and lint unchanged) and `docs/superpowers/plans/2026-10-08-standalone-viewer.md` (11 tasks with exact code, test first: the pack format, the section-box maths shared with the app, the viewer and its build script, the button, `.html` import, the section box in four steps, the scale run, docs). The plan departs from the spec in four small ways, listed at its top: a shared `codec.js`, an `exportViewer.js` for the template fetch, a viewer totals line that copies the app's BBS header word for word, and solid-cut caps that hide with `👁 Box` as in the app.
  - Dry run of the plan (on a scratch copy of the repo; no tracked file was touched): every edit anchor matched exactly once; 23 new unit tests pass; the new `scripts/perf/check_standalone.mjs` passes its viewer (24 checks), section box (41: core, face grips, move / rotate, solid cut), export (13) and round-trip (6) sections against a scratch dev server; a face-grip drag assertion for the app's own `check_views.mjs` passes on the untouched app and on the refactored `SectionBox.jsx` with identical numbers (a 90 px drag widens the box by 0.9659 m both ways). The viewer script builds to 630 KB (162 KB gzipped) and no lint warning is added at any task boundary. The dry run caught two mistakes in the plan, now fixed: a float comparison in a unit test, and a check click in the Front view that landed on the two depth-axis grips (in any axis view they sit on the middle of the box, so a click exactly there grabs a grip instead of picking a bar, as in the app).
  - Not done: no app code has changed (`src/`, `package.json` and the existing checks are untouched) and nothing has been run on the user's own model with the new code. Not yet measured: the production build and preview path, the final Ent3 and 1M-bar file sizes, open times and orbit rates (the Ent3 file is expected near 0.67 MB), and the documentation edits. Never tried: Safari or Firefox (compression streams need Chrome or Edge 80+, Safari 16.4+, Firefox 113+) or a touch device (the grips were driven with synthetic pointer events only).
- **Box & Lasso select: a toolbar choice and one exact rule for both (app)**:
  - The viewport toolbar's single Box button becomes a pair, `⊞ Box [Shift+B]` and `➰ Lasso [Shift+L]` (a "N selected" pill follows it, the left-panel tip has both buttons, and the hint bar names the armed tool). The store's `selectTool` (`null | 'box' | 'lasso'`, with `toggleSelectTool`) replaces the `boxSelect` flag. Both tools are one-shot, as Box was: one LMB drag draws the shape and selects, then the tool disarms; Ctrl adds to the selection, Esc cancels, and a click without a drag (or a scribble shorter than 8 px) only disarms. The lasso is a free-form loop drawn as a dashed SVG outline with a light fill; it closes back to its start, is simplified to 1 px before testing, and follows the even-odd rule if it crosses itself.
  - One rule for both shapes, which changes Box: a BBS row is selected when any segment of any copy of any of its bars, projected through the active camera, lies inside the shape, crosses its outline or passes within 2 px (`TOUCH_TOL_PX`) of it. The old Box rule was the row's projected bounding box, so a box in the gap between the copies of a wide set picked the set; now it selects nothing, and an end-on bar (a dot) is selected by a shape around it. Perspective and orthographic share the code (it only needs the view-projection matrix), with near / far clipping so nothing behind a perspective camera is picked; hidden bars, bars of hidden members and bars inside them are skipped as before.
  - Implementation: new pure `src/viewer/regionSelect.js` (the shapes, segment-vs-shape tests and `selectBarsInRegion`; per-row geometry cached in a `WeakMap` keyed by the row object, and a bounding-box prefilter that uses the new `distOffsetExtents` in `shapes.js`, so no distribution grid is built just to measure a row); `RegionSelect` in `Scene.jsx` replaces `BoxSelect`; `App.jsx` has the toolbar, the hint, the left-panel buttons and Shift+L.
  - Checked on the user's Ent3 project (`inputs/saves/barbending-project-20261007-1814_ent3_with_group.json`, 1,680 rows): a free-form loop selected 49 rows where its bounding box would have picked 107; over 480 random boxes in Front, Top and perspective views the exact rule at zero tolerance never selected a row the old bounding-box rule would not have (0 violations), and the old rule over-selected about 11% of the rows (13,750 against 12,183; 12,569 with the 2 px forgiveness).
  - Measured (headless Edge on the Intel UHD, synthetic project of 25,000 rows x 40 copies = 1M bars): the selection takes 93–180 ms in the app (small lasso 140–178 ms, whole-view box 112–120 ms, big lasso 93–96 ms); in Node, 181 ms cold / 27 ms warm for a small box on the same rows. The page then stays busy after a big selection, 2.4 s for 3,206 rows and 3.7 s for 25,000: that is the selection-dependent UI (the BBS table renders every row), the same when the rows are set straight in the store, so it was not changed.
  - Tests: 136 node tests (`npm test`; 21 new in `tests/select/`: the geometry, the exact rule, hidden members, perspective near-plane clipping, the distribution extents against `distOffsets`, the store tool) and `scripts/perf/check_select.mjs` with 45 browser checks driven by trusted mouse and key events (toolbar 12, box 13, lasso 14, perspective 6) on the production build and on the dev server (StrictMode); `check_field.mjs` still 60/60 and the views `field` / `section` / `dots` sections 9 / 4 / 24; lint 29 findings, unchanged.
  - Not exercised in the browser: touch or pen input, selecting while Measure or a draw tool is on (guarded as before), perspective near-plane clipping (unit-tested only), and a million-bar run on a real project (the 1M run used the synthetic one; the real Ent3 project was compared in Node). Not included: clipping the selection to the section box (as before), a click-by-click polygon lasso, a tool that stays on (it would fight the section-box handles and the drawing tools for the same drags), and selecting concrete or IFC (rebar only). Still open: the multi-second stall after selecting thousands of rows at 1M bars (windowed BBS table, sub-project B); the toolbar rows overlay the top of the canvas, so a drag that starts on a toolbar button does not reach it.
- **End-on bars show as dots in the true views (app)**:
  - Problem (reported: "unable to see some bars on front or back view"): in an exact orthographic view a bar pointing straight at the camera has no projected area, so nothing drew it. Far away the bar is a hardware line whose two endpoints land on one pixel (a zero-length line, drawn as nothing); close up the instanced tube is an open six-sided prism whose sides are edge-on; and the classic `RebarMesh` tube (selected / just-edited bars) is open too, so a selected end-on bar vanished. In perspective they had shown as short receding lines, so this appeared with the true views. In the latest Ent3 save (`inputs/saves/barbending-project-20261007-1814_ent3_with_group.json`) 1,402 of 3,848 bars (the Ø32 `ST…` starter bars, straight on plane XZ with plan rotation 90) run along app Y and were invisible in Front / Back; 51 bars run along X (Left / Right) and none are vertical (Top / Bottom).
  - Fix, in the three places a bar is drawn. Lines: `buildField` tags every line vertex (`axisOfVtx`, new `barfield/endOn.js`: 1 / 2 / 3 = the scene X / Y / Z axis the segment runs along within 0.06°, +4 on the end vertex) and the line shader opens a segment on the camera's exact axis into a 2 px dash (`uEndOnAxis`, orthographic only). Tubes: the tube shader puts an instance within the larger of 0.06° and the angle that would leave a hole in the projection (capped at 1.1°) of the view direction onto a hexagonal disc at its near end, using the prism's own triangles, so every other bar costs nothing extra (`uOrtho`, `uViewDir`). Overlay: the `RebarMesh` tube gets flat end caps (`tubeCaps.js`; the geometry still reports `TubeGeometry` for the tools that count it). `BarField.jsx` pushes the camera state every frame (`FieldView.setCameraState`). Picking a bar by a ray running along it already worked (the closest-approach branch for parallel lines); tests added.
  - Checked on the user's Ent3 project: the Front view shows rows of blue Ø32 dots at 49 px/m (dashes) and round discs at 193 px/m; neither appeared before.
  - Measured (production build, headless Edge on the Intel UHD, 1600×900, 1M bars; the old and new builds served side by side and alternated, two rounds): orthographic Front idle 47.9 / 43.6 fps before vs 39.3 / 39.0 after — a real, repeatable cost, because the bars pointing along the view direction are now drawn instead of skipped as zero-length lines — still above the 30 fps idle budget; orbit 38.1 / 34.4 vs 40.4 / 36.0, zoom 55.9 / 57 vs 54.3 / 52.8, close-up 60 both (noise); perspective idle 46.6 / 50 vs 41.8 / 50.3 and orbit 46 / 33.7 vs 29.8 / 47 (the direction flips between rounds: noise).
  - Tests: 115 node tests (`npm test`; 19 new: the `endOn` helpers, the builder tags, tube caps, end-on picking) and `scripts/perf/check_views.mjs` gains a `dots` section (24 checks: in all six views every end-on bar shows as a dot of its colour both drawn as tubes and drawn as lines, the line shader follows the camera axis, a click on the dot selects the bar and the selected bar is still drawn, Iso / perspective / an orbited view draw plain lines): 102 view checks in total (about 13 minutes, run by section), `check_field.mjs` still 60/60, `dots` also 24/24 on the dev server (StrictMode); lint 29 findings, unchanged. Without the fix the dots probes find every end-on bar missing in both draw modes.
  - Not exercised in the browser: Measure, Query and the snap magnet on end-on bars, the section box cutting end-on bars, the Detail menu's Lines / Tubes settings (the LOD was driven by zoom), and 3M bars (the idle cost above was measured at 1M only). Still open: the far-zoom dash is always 2 px whatever the bar's diameter, and a bar a fraction of a degree off the axis in a free orbit is a line shorter than a pixel, which hardware lines can drop (tubes are covered, far-zoom lines only on the exact axis).
- **True orthographic views: Top / Bottom / Front / Back / Left / Right (app)**:
  - Problem: the preset views already pointed exactly along each axis, but through the perspective camera, so every one of them still looked like an Iso (depth shrinks things, parallel edges converge); the `view ▾` box always fell back to "Iso ▾"; and the axis gizmo stopped up to 0.6° short of the axis and stayed perspective.
  - The six views now switch to a parallel (orthographic) camera, like the plan / elevation views of AutoCAD or Revit: exact axis alignment and the same scale at every depth. Iso stays a perspective 3D view. The `view ▾` box shows the active view and its list gains Perspective / Orthographic entries; a pill under the axis gizmo ("Front · Orthographic") names the view and flips the projection with one click; a click on a gizmo head gives the same exact view as the dropdown.
  - Implementation (`src/viewer/CameraRig.jsx`, `cameraMath.js`, `cameraOps.js`, `AxisGizmo.jsx`, `ViewBadge.jsx`): two real cameras with one OrbitControls each (three-stdlib tests the camera class, so a camera that only flips flags would lose pan and zoom). Switching keeps the orbit target, the view direction and the visible region on the target plane (the dolly-zoom identity; 0.000 px drift measured), orbiting keeps the projection and the view reads "Free". The preset animation now slerps the camera direction on the orbit sphere, so opposite views no longer fly through the model; offsets are exact (no epsilon).
  - Orthographic zoom is pixels per metre: the wheel keeps the point under the cursor fixed (0.13 px drift), right-drag pans like perspective, `+` / `-` zoom by 1.2×, Fit All fills 83% of the canvas, and flings stay inside 2 mm – 500 m. The BarField line / tube LOD, bar picking, the snap magnet, `DiveZoom`, the trace tool, auto clipping and the section box were taught the orthographic camera (`viewMetrics`); perspective behaves as before.
  - Fixed on the way: the full-width toolbar container swallowed clicks over most of the axis gizmo (it now lets clicks through its gaps and stops 140 px short of the right edge); `DiveZoom` and `TraceTool` captured a stale camera when it changed; the autotest dump now follows the active camera; Fit IFC in an orthographic view keeps the view direction and only recentres and zooms (its fixed oblique framing would have turned a true Front into a "Free" view; perspective Fit IFC is unchanged). In the section box the solid-cut cap hides the bars inside the cut member, in perspective as well as orthographic (switch Solid cut off to see them); the cap code was not touched.
  - Measured (production build, headless Edge on the Intel UHD, 1600×900): 1M bars in orthographic Front 52.3 fps idle / 40.1 orbit / 57.8 zoom / 60 close-up (perspective 50 / 38.6 / 53.3 / 60, all budgets pass), viewport drawn 1.09 s after the page answers again.
  - Tests: 96 node tests (`npm test`; 26 new, in `tests/views/` and the `lod` / `fieldPick` suites) and `scripts/perf/check_views.mjs` with 78 browser checks (exact axes, parallel projection, seamless switching, gizmo heads, orbit / wheel / pan / keys / Fit All, picking, LOD, section box, and the sample IFC: Fit IFC, drawn after a 22× zoom-in, Top; its Fit IFC checks fail without the fix); it and `check_field.mjs` (still 60/60) pass on the production build and on the dev server (StrictMode). Lint 29 findings, two fewer than before (the `TraceTool` and `AutotestDump` stale-camera warnings). Checks that were wrong on the first run and were fixed, not the app: a tube assertion at a zoom where 16 mm bars are 1.5 px wide, and an amber filter that counted the section box's red handles as bars.
  - Not exercised in the browser (unit-tested, or reasoned from the shared projection code only): the Measure, Query and snap-magnet tools, the Face bar / Beam / Column / Slab trace tools, Shift+B box select, the arrow-key pan and touch / pinch gestures in the orthographic camera (the rig drives bar clicks, wheel, right-drag, `+` / `-`, Fit All, the section box and Fit IFC), and your 27 MB project IFC (only the 2.5 KB `sample-concrete.ifc` was loaded). The orthographic depth range is fixed at ±2000 m about the camera, so a model deeper than that along the view direction would clip. The toolbar now stops 140 px short of the right edge, so it wraps one row sooner on narrow windows.
- **Large-project performance: BarField renderer (spike, design, implementation)**:
  - Spike (2026-10-07; production build, headless Edge on the Intel UHD, 1600×900, synthetic projects up to 3M bars / 75k rows; throwaway rig, not committed): today's renderer draws every distribution copy as its own mesh + material — 10,163 bars → 8.9 fps (10,173 draw calls, 6.0M triangles/frame), 50k → 2.0 fps, 100k → 0.7 fps (57.7M triangles), 200k did not finish in 7 min; heap after one select/duplicate/undo 220 MB / 941 MB / 1,875 MB. CPU profile (10k bars, dev build): 69% three.js per-object work, 22% native GL submission, ≈ 0% React/app, so it is draw-call bound, not GPU bound (about 54M vs 600M triangles/s on the same chip).
  - Other walls measured: the BBS table and bar dropdown render every row (25k rows: 17 s load, 1.2M DOM nodes, 1.1 s row select; 75k rows: 90 s load with a 60 s freeze); `snapPrimitives` rebuilds every copy per mouse move (747 ms at 1M bars); one undo snapshot is 22 MB with up to 50 kept; the project JSON (7.4 MB at 1M bars) exceeds the `localStorage` cap (about 5M characters, so Save fails above roughly 15k rows); the 27 MB IFC alone loads in 15 s and orbits at 20 fps (3,295 draw calls).
  - Prototype (merged lines + spatial chunks + instanced six-sided tubes, same GPU): 1M bars 43 fps as one line buffer, 45 fps chunked LOD overview, 40 fps close-up, 25 fps all tubes with no LOD; 3M bars 15–16 fps; at 1.5× pixel density the 1M close-up fell to 16.5 fps, so adaptive quality is part of the design.
  - Design: `docs/superpowers/specs/2026-10-07-barfield-renderer-design.md` on branch `feat/barfield-renderer` (approved section by section; the written spec is awaiting review). Sub-project A = worker-built, spatially chunked, instanced renderer with line/tube LOD, a per-row state texture (hide / overlay / tint), ray-vs-chunk picking, adaptive quality and a committed perf rig with budgets (1M bars ≥ 30 fps overview and ≥ 24 fps close-up, about 15 fps at 3M, viewport drawn in < 5 s, no IFC loaded). Scope: bars only; the IFC, the windowed BBS table / undo / save, and the snapping index are separate sub-projects (D, B, C).
  - Implemented (`src/viewer/barfield/`, now the default renderer; `?renderer=legacy` keeps the old per-bar path): worker-built chunked segments with pick blocks; instanced-tube LOD with the **Detail** setting (Auto / Lines / Tubes, status bar); a per-row state texture (hide / overlay / tint); ray picker (click, Ctrl-toggle, double-click, lap pick, Query tool); edits shown at once as classic overlay tubes, then moved into a delta chunk (undo / redo stay on that path), with a full rebuild when the row count changes; adaptive quality while the camera moves; section-box clipping only while a section is active (the six clip-plane tests per fragment cost 24% at 3M bars); classic-renderer fallback with a badge if the field cannot be built. A small selection (up to 400 bar copies) keeps the classic white highlight; a heavier one is tinted in place, because the classic overlay costs one mesh per copy (50 selected rows of 40 copies ran at 8.6 fps, 300 rows at 2.2 fps at 1M bars; with the budget they hold 35–37 fps).
  - Measured (production build, headless Edge on the Intel UHD, 1600×900, median of three windows, budgets enforced): **1M bars** (25,000 rows) 47.6 fps idle, 37.6 orbit, 59.7 close-up, bars drawn 0.85 s after the page answers again, JS heap 327 MB, longest field-side main-thread block 4.5 ms. **3M bars** (7,500 rows of about 400 copies) 17.7 fps idle (budget 15), 18.5 orbit, loaded and drawn in about 4 s. 10k bars: 60 fps with 31 draw calls (classic renderer 8.9 fps, 10,173 draw calls). 1M bars at a 1.5× pixel ratio: 33 fps idle / 32 orbit / 31 close-up (spike with a fixed resolution: 26.7 / 16.5). The classic renderer could not open 200k bars.
  - Still slow, and now the dominant cost (sub-project B): the BBS table renders every row — 25,000 rows keep the page busy for 13–44 s depending on machine load, and a 75,000-row project (3M bars as 40-bar rows) does not finish loading in 5 minutes; undo clones every row, Save uses `localStorage` (about 5 MB), Measure / Pick snapping scans every bar. The status bar no longer re-enriches every row on each fps update (+5 fps zoom at 1M).
  - Tests: 70 node tests (`npm test`) and a committed rig (`scripts/perf/`: project generator, CDP benchmark with budgets and median-of-three windows, and `check_field.mjs` with 60 browser checks — parity with the classic renderer, tubes, picking, edits, bulk edits, section toggle, colours, host hiding, fallback). Bugs the rig caught on the way: importing a large project turned every new row into a classic overlay mesh and hung the page; the Query tool lost its target because `PickHandler` selected the bar first (pick is now computed once per pointer event).
- **Set card grid, range-select order, type-switch grid, one-signature-one-mark (app)**:
  - Set card: Count/Spacing X·Y·Z (all) fields apply a full 2-/3-way grid to every member at once (e.g. wall ties at 200 × 200).
  - Type switch (`applyTypeDefaults`) keeps the whole distribution grid (qty/spacing/offset on every axis) and carries the drawn main length across convertible types (straight spine == link spine == crank run); the automatic link host refit on a switch is gone because it wiped the sketched Pos/grid — use the explicit Fit to host button.
  - BBS Shift-click range select spans the DISPLAY order (grouped sections or sorted rows) instead of the raw model-index range, which diverged as soon as sorting/grouping reordered the rows.
  - `autoAssignBarMarks`: one signature = one mark — the first-seen existing mark claims its signature; a bar whose stored mark is blank or already claimed by a different signature gets the next free B-number (per host scope), and generated numbers skip taken marks so they can never collide.
  - Checked: `npm run build` passes and `npm run lint` exits 0; marks run headless on the regenerated `Drawn_rebar_auto_bbs.json` (11 distinct marks, straights → shape 20, cranks → 99, CSV round-trip without position drift). The Set-card fields and the range select were not exercised in the browser.
- **Drawn-circle starter bars (bent dowels from plan circles)**:
  - DXF: one bent dowel per `CIRCLE` (any layer — centre = plan position, centre Z = base level unless `Z=` wins). Nearest direction line (`LINE`, or open polyline on a non-`REBAR` layer so real bars are never consumed) gives Length + aim; nearest plain spec tag (`L 2000 ROT 90`, `=` optional) overrides with `L=`/`ROT=` (leg compass 0=+X, 90=+Y), `H=`/`HB=`, `H<dia>`/`DIA=`, `VIEW=`, `Z=`, `HOST=`, `GOOD`/`POOR`. Tags carrying `VERT`/`TIE`/`RISER`/`LINK`/`BENT`/`STARTER` belong to other systems — those circles skip with a WARN. Output `bent`, Plane XZ (aim near ±X, leg renders toward +X at ROT 0) or YZ (near ±Y), Rot 90, `plan_rotation` derived so the rendered leg matches the aim; bond good. Gaps fall back to `--starter-length` (2000) / `--starter-rot` (0) / `--starter-h` (0 = max(150, 10·dia)) / `--starter-dia` (0 = 2× radius snapped to standard); `--starter-plane auto|XZ|YZ`, `--starter-z`, `--starter-mark` (ST) override globally.
  - Verified on `inputs/starter_bars.dxf` (previously 0 rows): 83 circles → 83 bent dowels (64×H50 + 19×H40 from 2× radius, L=2000/H=400–500 from the tag, levels from circle Z, rendered leg aim matches ROT); lone-circle file with no line/tag falls back to defaults on XZ; slab/column/wall/stair samples convert byte-identical apart from the pre-existing `polyline` column drift.
  - Per-group assignment in `inputs/starter_bars.dxf` (backup `starter_bars_before_pergroup.bak`): group A (44 bars) keeps `L 2000 ROT 90`; new `L 1500 ROT 270` tag + direction line on group B (20 bars, legs toward −Y); new central `L 1200 ROT 90` tag + direction line on group C (19 bars) — placed mid-row so the outer C circles still pair C over A/B. Verified 44/20/19 split with matching L/plane/rotation; B/C bent legs auto (10·dia) — add `H=` to a tag to pin them.
  - Section mapping for drawn circles: DXF centre Y is now the elevation (App `Pos_z`, `Z=`/`--starter-z` still win); dia = drawn circle diameter (2× radius, snapped to standard); the out-of-plane coordinate comes from `--starter-x` (YZ plane → App X) / `--starter-y` (XZ plane → App Y), or per-group `X=`/`Y=` in the spec tag, else 0 with a NOTE (true DXF Z ignored). Verified: `--starter-x 1500` → all 83 at X=1500 with Y/Z from the section; XZ + `--starter-y` mirrors correctly; other samples byte-identical.
  - Transverse orientation (circles pierce the section): main Length runs horizontally OUT of the section — XZ toward ±Y, YZ toward ±X — with the H leg turning up at the far end (`Rot 0`). `ROT=` is the length compass (0=+X, 90=+Y; XZ phi=aim, YZ phi=aim+270); auto-plane keeps the length out-of-plane (aim ±X → YZ, ±Y → XZ); stock splits run along the length. Verified ST1 renders (2658.6, 2700, 1100.5) → (2658.6, 1500, 1100.5) + up-leg 400; file's current all-`ROT 270` tags → 83 XZ bars toward −Y with correct 44/20/19 L-split.
  - Hook-first bent bars (`hook_start` yes/no, default no = legacy leg-trails-length): `yes` builds `[0,0,0]→[0,H,0]→[L,H,0]` so the upstand sits at `Pos` (the circle) with the length running out after it. New CSV column (ignored by FreeCAD's `DictReader`), editor selects in both panels, mark signatures distinguish the variants. Drawn-circle starters emit `yes` by default (`HOOK=END` in the tag or `--starter-hook end` trails it); all other bent rows stay `no`. Verified: 83/83 `yes` on the starter file, node geometry `[0,0,0]→[0,0,400]→[0,−1200,400]`, cut length identical either way (1520), column/stair samples byte-identical on shared columns, build passes. Note: cut lengths/weights match in FreeCAD, but its macro draws the stock leg-last sketch — browser is the placement truth for hook-first bars.
  - Plane/position/direction straight from the DXF tag: `PLANE XZ` alias for `VIEW=`, `POS Y 2700` (also `POS X n`, `POS Z n`, `POSITION` spelling) alias for `X=`/`Y=`/`Z=`; `ROT=` already steers protrusion. All three `starter_bars.dxf` tags rewritten as e.g. `L 2000 ROT 270 PLANE XZ POS Y 2700` (backup `starter_bars_before_dxfpos.bak`) — plain `scripts/dxf_to_bbs.py inputs/starter_bars.dxf` with no flags now yields the full 83-row output byte-identical to the `--starter-y 2700` run.
  - Straight starters + DXF protocol note: `STRAIGHT` (or `BENT`) in the spec tag selects the bar type (`--starter-type bent|straight` default when absent); straight bars start AT the circle (protrusion origin) and run `Length` along the aim with no leg, good bond, same section position rules. Also fixed: generated `plan_rotation` now writes on every type (straight starters previously lost it and rendered unrotated). Protocol note text for the DXF (3 TEXT lines at `(2658.6, 200/350/500)`, height 150 — regex-audited so the importer ignores it, verified in situ with zero output disturbance): `PROTOCOL: CIRCLE ctr = bar origin (X horiz, Y elev) | …` / `tag: L <len> ROT <deg: 0=+X, 90=+Y> [BENT | STRAIGHT] [H=<leg>] [HOOK=START | END]` / `[PLANE XZ | YZ] [POS Y <n>] | dia from circle dia | bend at ctr, run after it`. Verified on a temp copy: 6 straight (group C demo) run 1200 from the circle toward −Y with no leg; live file converts 83/83. Note: the live `starter_bars.dxf` is CAD-locked so the note is not yet written into it — paste the 3 lines or close CAD and re-ask.
  - General `profile` bars (per-leg parameters): new `Rebar_Type` carrying `legs` ([[len, compassDeg]...] JSON) — geometry rebuilds verbatim, bend deduction per >20° turn, shape 99 with cut length in A, editor leg table (length + heading per leg, add/remove), mark signatures include the legs. Importer: `PB1 PROFILE H25 [HOST=] [PLANE=] [ROT=] [Z=] [X=/Y=] [GOOD|POOR]` pairs the nearest open 3+-pt polyline (any non-REBAR layer; DIMENSIONs ignored); single piece, never stock-split. Verified on `additional_bar_shapes.dxf` (temp copy +2 tags): 4-leg crank L=1952.9 and 2-leg L L=873.3 exact; build passes. Note: FreeCAD macro compatibility for the new type is unverified — BBS cut lengths/weights are exact in-app.
  - Plan-cranks via profiles: paired traces are consumed (no double chord rows), dia falls back to the `REBAR-H<dia>` layer, `PLANE XY` positions verbatim from the first vertex. New `--profiles auto` converts untagged open 3+-pt `REBAR-H/LINK` traces (dia from layer, XY unless `--starter-plane`, Z from `--starter-z` else 0) while tagged bars keep legacy rows; 2-pt lines always stay straight. Verified on `Drawn_rebar.dxf`: 8 crank profiles with true totals (7519.9 … 12063.9 single-piece over stock noted) + 4 straight incl. a floating-point stock split; tagged plan/stair samples byte-identical on shared cols, including `--profiles auto` on the tagged plan file.
  - Profile plane/position/distribution options: `PLANE XZ|YZ` puts the section out-of-plane (length toward ±Y on XZ at `--starter-y`/`Y=`, toward ±X on YZ at `--starter-x`/`X=` — signed values place either side); distribution is one-sided from `Pos` via tag `N=` + signed `SP=` + `AXIS=X|Y|Z` (axis defaults out-of-plane: XZ→Y, YZ→X, XY→X; spacing defaults 150 when N>1) or `--profile-n/--profile-spacing/--profile-axis`. Verified: 8/8 auto profiles at `qty_y=4 spacing_y=-150` (copies at 0/−150/−300/−450 in-app), tag `N=3 SP=-200 AXIS=Y` on a section profile, straight rows untouched. Unused plane-position flags now WARN instead of dropping silently (`--starter-y` on YZ/XY, `--starter-x` on XZ/XY — one summary line each).
  - Section-drawn rebar lands where it was drawn (`--profiles auto --starter-plane XZ|YZ`): the DXF is read as a section like the drawn-circle starters (X = in-plane horizontal, Y = elevation), so each trace's first vertex sets `Pos_z` (`--starter-z` still pins every bar to one level) instead of the old flat `Pos_z = 0`. Untagged 2-pt traces no longer fall through to plan-view chord rows (XY plane on the 52.5 cover seat, chord angle used as plan rotation, no `--starter-y`/host/distribution): in a section plane they become `straight` rows (shape 20) in XZ/YZ with `rot` = chord angle, stock-split along the slope, and the same out-of-plane position, `--profile-*` distribution and `--starter-host` as the profiles; marks `PB<n>` in drawing order. Plan (XY) behaviour unchanged; tagged `PROFILE` rows keep their documented `Z=`/host/0 rule. Root cause: the auto path never adopted the section convention the circle starters use.
  - Verified headless with the app's own `genBarPoints`/`transformBarLocalPoint`/`distOffsets` on `Drawn_rebar.dxf` + `--starter-plane XZ --starter-y 6600 --profile-n 20 --profile-spacing -150 --profile-axis Y`: 11/11 traces match the drawing (max vertex error 5 mm = the 0.1° heading rounding; before the fix 11/11 were misplaced by up to 13.9 m), 220 bars (11 × 20 @ −150 toward −Y), BBS shows the 3 straights as shape 20 and the cranks as 99; a synthetic 15 m / 30° bar splits 12000 + 4840 with the 1840 H25 lap along the slope in both XZ and YZ; the 16 other sample DXFs × default/`auto`/`auto XY` are byte-identical, as is `Drawn_rebar.dxf` in default/`auto`/`auto XY`/tags modes (`bar_plan_bbs.dxf` forced into an XZ section differs by design: its one untagged 2-pt trace is now a section bar instead of stealing tag 201). Reference `inputs/Drawn_rebar_auto.*` regenerated with that command.
  - Bent corner seated at the protrusion: hook-first starters now drop `Pos_z` by the signed leg so the run/corner sits AT the circle elevation (upstand laps from underneath) — previously the run floated H above the mark while straight bars protruded from it. E.g. ST1 (H40, H=400, circle 1100.5) renders tail (2658.6, 2700, 700.5) → corner (2658.6, 2700, 1100.5) → tip (2658.6, −300, 1100.5); `HOOK=END` and straight rows unchanged (run already at circle level); column sample byte-identical on shared columns.
  - Host concrete input: `--starter-host <name>` sets `Group` on every circle bar (tag `HOST=` still wins per group); on project import the app links it to a same-named concrete member. Verified: flag alone → 83× `GL23-Slab`; group B tag `HOST=GL23-Wall` + flag → 20 wall / 63 slab; column sample byte-identical on shared columns.
  - Circle-to-tag pairing is strictly nearest-wins with a close-contest WARN (same 400 rule as bar tags): a circle takes the nearest `L=`/`ROT=` tag, so interleaved tag rows split the zone midway — 487/816 circles in the current 18-tag file sit within 400 of a rival tag and flip by metres. Deterministic zoning = one tag deep inside each zone; re-run until zero WARNs.
  - Dia-driven lengths: `--starter-lengths "25:2000,40:3000,32:2500"` (H prefix, `:`/`=` and comma/semicolon separators all accepted) assigns `Length` by drawn diameter; precedence tag `L=` > table > direction line > `--starter-length`. Verified on a synthetic H25/H40/H32 file (2000/3000/2500 via `(dia)` source) and tag-precedence on the live file (split unchanged).
  - Query tool never fails silently anymore (`Scene.jsx` handler): every armed click logs `[query] targets=N hits=M`; clicks owned by an armed Measure/draw/box-select post a `Query paused — <tool> owns clicks` panel notice (never clobbers a real result); hit-without-record paths log and skip; result-build exceptions surface a `Query failed` panel row instead of dying quiet. Verified headless on the 95-bar starter scene (arm → rebar hit with full rows, zero console errors); build passes.

- **Face-sketch rebar (FreeCAD-workbench style)**:
  - Toolbar 🔩 Face bar: click 1 picks a concrete face (working plane at cover + Ø/2, thin members center it), clicks 2–3 draw the straight bar line on that plane (snap-assist clamped to the face, Esc/right-click steps back, stays armed). Face normal quantizes to the dominant axis → Plane YZ/XZ/XY + in-plane rotation from the drawn vector.
  - Distribution auto-fills the transverse in-face axis (cover-inset extent, count from spacing, centered — e.g. beam +Y face, bar along X → 4 @ 150 up Z); bars host to the picked member with its name as Group. Live preview: allowed-zone loop, bar line + length badge, grid extent with count badge; HUD with Dia/Spacing/status.
  - Verified: 12-assertion node suite (all 6 face orientations, guards) + headless trusted-click run (face pick, 3 committed bars, zero page exceptions); lint clean, build passes.
  - Fix: preview length/grid badges (drei `<Html>` wrappers, `pointer-events: auto`) sat exactly on the click point and swallowed pointerdown, so p2 clicks died silently after p1. Display-only label wrappers are now click-through (`facebadge-wrap`, incl. the ref-line preview badge); silent click-3 exits also log + surface a HUD reason.
  - Sloped faces (stair flights, pitched slabs): true 3D working plane from the face normal (no more axis quantization); any drawn direction decomposes to Plane + Pos_Rotation + plan_rotation; transverse near a world axis → single row + grid, else stepped rows along the slope (importer SD1 precedent); axis faces keep the exact legacy path. HUD shows the face slope; `?autotest=facebar` stages flight + slab fixtures with a click projector. Open: browser e2e on the fixtures still pending (math suite green).
  - Bar sets: multi-row sketch commits share a `setId` + the sketch spec, and edit as one parametric group from a Set card (Dia across all, count×spacing grid with anchored/even/full-extent modes, uniform/taper lengths per type length keys, full dimension fields per type like the single-bar editor, Plane/Rotation/Plan-rot + in-place ±90° quick rotate, type switch, select/delete set — one undo step each). `setId`/`setSpec` round-trip through CSV and project files.
  - Fix: set type-switch skipped the stirrup host refit — it collapsed every stepped row onto one identical position. Conversions now keep per-member position/distribution (dims reset to defaults).
  - Pick-to-place relocates the whole selection: the active bar lands exactly on the picked point and every other selected bar rides the same delta (one undo step); single selection behaves as before.

- **Stairs phase 3: landing starter bars from drawn profiles (H13)**:
  - DXF: `SSB1 STARTER H13-150 AT=BOT HOST=<stair>` (bottom pair `SSB1/SSB2`, top pair `SST1/SST2`) pairs the nearest OPEN polyline on `REBAR-H<dia>` — the 1:1 section profile (X = along-run, Y = up) drawn in a detail zone — verbatim into a new `stair_starter` shape (BS8666-style code 99, `polyline` CSV column, cut length in A; lengths/weights/counts exact). Anchored at the landing edge, copied across the width (9 @ 150 on the sample), Plane XZ/YZ by run direction, bond BOT good / TOP poor (`GOOD`/`POOR` win). Levels auto-seat from the stair — BOT v=0 on the bottom cover (1046.5), TOP v=0 hung from the top cover at the high end (2985.6 via `SLOPE=`); explicit `Z=` still wins.
  - Seating: (0,0) lands on the landing-edge steel. Hairpins (flight-leg root at landing level) are S-seated — root translated to the edge steel and rotated so the flight leg matches `SLOPE=` (~1.4°, lengths verbatim, else the leg dives through the soffit); section-spanners are A-seated verbatim. Known schematic slack: spanner stubs/legs outside the 300 waist belong to the unmodelled landing zone; per-type `Z=` overrides exist.
  - App: `stair_starter` renders/measures/snaps like other bars (explicit `[[run,up]…]` profile, bend deduction per >20° turn), BBS + FreeCAD CSV round-trip the `polyline` column, type-switch drops/adds it cleanly. `inputs/stair_sample.dxf` now carries all four profiles + tags (78 rows).
  - Verified: hairpin flight legs track their mats within 60 mm, slab/column/wall files convert byte-identical on shared columns, lint clean, build passes.

- **Stairs phase 1: riser L-bars (mains need pitch support (done below) — next)**:
  - Member: closed rect on `CONC-*` + `ST1 STAIR ST1 THK=<waist> Z=<soffit-low> SLOPE=<deg> ...` (rect = plan footprint, run along the longer side, low end at bbox min; flat box at base for hosting only). `STAIR` concrete kind + GUI `Stairs` join group.
  - Risers: `SR1 RISER 12xH12 [SP=<sp>] HOST=<stair>` makes per step one section L (main=going along run + riser down, copies across the width at SP=) plus one transverse straight bar across the full width at the nosing line (SR1-i-S) whose line the L corner sits on (rot 180, flat leg back uphill) — steps divide the run evenly up the slope (main = going, H = riser), copies across the width at `SP=` (H-sp, else 150); no centerlines drawn. Bond poor-safe (`GOOD`/`POOR` overrides).
  - Verified on a 1200×3000, 30° sample: 12 steps (going 250, rise 144.3) × 9 across (cut 370, 2.96 kg each); slab + column files convert byte-identical; lint clean, build passes.
- **Stairs phase 2: sloped mains + stepped distribution (no model change)**:
  - Key finding: `Pos_Rotation` in the section plane already pitches bars (verified: XZ/YZ + 30° → 866 along run, 500 up), so no pitch field was needed.
  - Mains: drawn centerline + `SM1 H20-150 MAIN EXT=<width> HOST=<stair>` — full-run length (plan/cos slope) re-rooted at the low end regardless of draw direction (short direction ticks pair cleanly where coincident full lines tie); ROT = ±slope (explicit `ROT=` wins); bottom cover seat, bond good, stock splits climb. Top mat: same with `TOP` (`SM2`, poor bond, top-cover seat). Verified: bottom (600,0,1050)→(600,3000,2782), top +200 parallel.
  - Distribution: `SD1 H12-150 DIST [NZ=] HOST=<stair>` generates stepped full-width rows (length = width − covers, z ridden on the mains via the same-host MAIN dia + gap); count even over the slope with `NZ=`, else from-low at spacing; `TOP` variant hangs under the top mains (poor bond). Verified: 24 + 24 rows; slab/column/wall files convert byte-identical.
  - Orientation rule (decided): members and bars must be axis-aligned; rotated geometry converts on a bbox approximation with a WARN (verified on a 15.8-degree stair: pitch/lengths/levels/counts adapt, ~4% long, distribution skewed).
  - Explicit `MAIN`/`DIST` now only act as fallback behind `BOT`/`TOP` in level and bond (fixes a regression that flattened TOP mains to the soffit).

- **Walls: flat U-hook links**:
  - Same `c_link_with_hook` shape (code 85), drawn on `REBAR-LINK` + `WL1 H13 LINK_HOOK A=<leg> B=<leg> HOST=<wall>`: wall links force Plane XY / ROT 90 (spine across the thickness, legs along the wall; explicit `VIEW=`/`ROT=` still win). Spine auto = wall thickness − covers; hook leg follows thickness-covers, superseding `B=` (NOTEd).
  - Wall rules keyed off the member `kind` (now stored on concretes): spine auto = wall thickness − covers (`wall` source); field = along-wall spread (EXT width/tick, rect-long-side driven, spine centered on cover inside the rect) × stacked height from the host (`NZ=`/`SZ=` or auto, capped so the tallest leg stays under the top cover); second EXT axis ignored with NOTE; base at bottom cover.
  - Verified on a 5000×200×3000 test wall: spine 120, 33 @150 along wall, 17 @150 up from z=46.5 (561 copies, cut 770, 450.08 kg, spine on cover 40→160); legs trail −X past a tight rect start (warned with exact overhang — widen the rect to include them); live slab file converts byte-identical (CSV).
  - Wall mains + distribution: verticals via `WV1 VERT 34xH12 HOST=<wall>` (perimeter ring, full internal height, good bond — works unchanged); horizontals are drawn plan centerlines (one per curtain) with `WH1 H12-150 NZ=20 SZ=150 HOST=<wall>` — length from the line, stacked in Z from the base cover (count auto from host height unless `NZ=` given); `NZ=` wins over any side inference, bond stays poor unless `GOOD`/`POOR` overrides. Verified: 34 verticals + 4800-long horizontals × 20 levels (85.23 kg), no parity warnings. Wall starters work with the same `ST1 STARTER 34xH12` (match the verticals count so laps align XY) over a strip footing; top takes the slab-free mirror with a WARN. Sample wall is slab-free and complete: links + mains + distribution + starters (105 rows).
  - Link input defaults where nothing is measurable: spine length 110 (degenerate/field-rect cases), legs 130 (open lines, wall fields) with a NOTE — explicit `L=/A=/B=` and measurable rects still win everywhere else.
  - Spacing-driven generation + routing: `VERT H12-150` / `STARTER H12-150` derive the count from the ring perimeter (same spacing on both keeps laps aligned); wall-link `SP=sxysz` routes sx along the wall and sy to the Z stacking (`SZ=` still wins); `L=`/`A=` honored with wall auto-rules as fallback; `W` marks accepted; straight bars with `NZ=`/`SZ=` stack in Z from the base cover (wall horizontals).

- **Coordination: multi-project insert (⤒+ Insert)**:
  - New header button merges another project `.json` alongside the live model instead of replacing it: clashing concrete ids remap (`c1` + `c1` → `c1` + `c1_2`), incoming tags renumber past the max, hosted bars/refLines follow, globals and selection untouched, one undo step. Camera fits both on insert.
  - Verified headless with the two sample projects: 11 + 49 = 60 bars, tags unique, zero orphaned hosts; lint clean, build passes.
- **README: DXF importer CLI section** — copy-paste `dxf_to_bbs.py` commands (slab + column samples, options), tag cheat-sheet, and the ⤒+ Insert coordination flow.

- **Column starters (bent dowels)**:
  - DXF: `ST1 STARTER 8xH25 [AT=BOT|TOP] [HB=<bent leg>] HOST=<col>` generates bent bars (legs aimed outward from the column center via per-bar `plan_rotation`): vertical lap above the SFL plus straight-then-bent below, one good-bond tension lap each way (bent leg `HB=`, else lap minus straight; straight limited by the lower-slab depth; `AT=TOP` is a true mirror — bend fixed at the upper-slab cover, vertical hanging down exactly one lap past the top SFL; slab-free fallbacks assume the embed depth with WARNs when no slab is drawn).
  - Also fixed en route: concrete tags now pair smallest-first (consumed), so a column stacked on a slab claims its own tag instead of both taking the nearest.
  - Verified on a slab+column test file: base starters L=1685/H=895 at z=1290 (1290 + 395 + 895), mirrored top L=1737.5/H=842.5 at z=1710 (1290 below top SFL exact), outward aims spot-checked, cut 2530, good bond; sample `column_sample_800` (slab-free: 16 verticals + 16 + 16 starters + tie, 49 rows); lint clean, build passes.


- **Columns phase 1: `qty_z` distribution + closed `tie` shape + DXF verticals**:
  - Data model: `qty_z`/`spacing_z` in `MASTER_HEADERS` (CSV + importer), `distCount`/`distOffsets` stack copies in Z, editor has Count Z / Spacing Z fields. BBS weights/counts follow automatically.
  - New `tie` shape (BS8666 code 51): closed rectangular loop reusing the link dim columns (`length` = X-side, `c_length_a` = Y-side); GUI type dropdown, per-host Fit (column hosts stack `qty_z` over full height), new-bar defaults.
  - DXF: `V<n> VERT n x H<dia> [H=<height>] HOST=<col>` synthesizes one vertical straight bar per column-perimeter position (cover inset, height from `H=` else host internal depth, base-cover seat, good bond, stock-split upward in Z); `T1 TIE A=<x> B=<y> [SZ=] [NZ=] HOST=<col>` rows closed ties stacked from the base cover (count auto from host height). Dia-less `TIE` tags pair by proximity with no dia penalty; generator tags fenced (VERT tags only pair their own mark, TIE tags only closed LINK rects); closed rects pair by full perimeter distance.
  - Verified on a from-scratch 500×500×3000 test column: 8×H25 verticals at z=52.5 (L=2920) + 420×420 tie with `qty_z`=20 @150 (cut 1600, 19.73 kg); `defaultBarForHost('tie')` on column gives 404 loop + 20 ties; lint clean, build passes. FreeCAD macro authors note: `tie`/51 is a new `Rebar_Type` (dims ride existing columns).

- **3D view render cap raised (incomplete link fields)**:
  - Root cause: `Scene.jsx` drew at most `MAX_RENDER_COPIES = 200` distribution copies per bar (plus a red-dot marker for the remainder) while the BBS counted all — the 256-copy 1156 link field rendered 200/256, smaller fields were unaffected. Parsing/CSV were verified correct throughout.
  - `MAX_RENDER_COPIES` 200 → 5000 (a full 5.5×16.7 m slab at 150 spacing is ~4100 copies); all 12 sample bars render fully, BBS stays exact, red dot remains the over-cap signal. Lint clean, build passes.
  - Sample DXF gained the second link box (1156, 16×16 @300×450 from its rect), redrawn ticks/lengths flow through (201: 36→40, 102: 17→28, 104: 17→44); regenerated `bar_plan_bbs_auto.*` (12 rows).

- **Per-bar bond condition end-to-end (DXF → CSV → GUI)**:
  - `dxf_to_bbs.py` persists `bond_condition` per row (`B*` good / `T*` poor per EC2 §8.2, links blank); `MASTER_HEADERS`/`parseCsv`/`toCsv` round-trip it, legacy CSVs without the column infer `B`→good / `T`→poor (links stay blank).
  - GUI: `barBond`/`lapBondFor` in `calc.js` (poor wins a mixed pair, global bond is fallback only); `applyLapSplice` laps with the pair's effective bond; bar editor has a per-bar bond dropdown (auto shows inferred value); BBS table has a `Bond` column; new bars default to auto.
  - Verified: `B2` laps 2240 (good) vs `T2` 3200 (poor) from `bar_plan_bbs_auto.csv`; legacy-inference + mixed-pair rule node-checked; `npm run lint/build`.
- **Transverse distribution stacking + link auto-seat (DXF importer)**:
  - Even marks ride one step inside their odd main (`B2` on `B1` → z=125, `T2` under `T1` → z=875, `B4` on `B3` → z=174) instead of clashing on the same level; explicit `Z=` still wins.
  - Links with no `Z=` seat on the bottom cover (`auto-linkBot`, same cover+Ø/2 convention); a vertical-spine link whose explicit `Z=` pokes out of the host slab warns (`drop Z= to auto-seat it` — caught the stale `Z=696` putting B1155 616 mm above the slab).
  - GUI matches: `slabLinkSpine(host, dia, cover)` (`lz − covB − covT`, member covers preferred) drives new-link defaults and Fit-to-host on slab-like hosts (rotation 90° so the spine stands vertical); beam/column behavior unchanged.
- **Link layer + EXT fallback + free mark convention (DXF importer)**:
  - Links live on `REBAR-LINK-H<dia>` (closed rect declares the link; old `REBAR-H` + `LINK` tag still works); omitted `EXT=/SP=` zones the grid from the drawn rect with a `NOTE` (keep `EXT=` when the field is intentionally smaller — B1155's rect would balloon 40 → 589 links).
  - Marks can be any integer (`101`, …); location is explicit via `BOT|TOP`, `MAIN|DIST`, `LYR=n`, `ON=<parent>`, `GOOD|POOR` keywords, with classic `B/T`+number inference as fallback (old-vs-new output diff: geometry identical, only intended stacking deltas).
  - Main-vs-distribution orientation check is role-based (mains share one direction per slab, distribution across; warns, never blocks).
  - Sample DXF retagged to the new scheme (`101 BOT MAIN`, `102 BOT DIST ON=101`, … `202 TOP DIST ON=201`, `LYR=2` edge bars; B1155 on the link layer, stale `Z=` dropped); regenerated `bar_plan_bbs_auto.*` (11 rows).

- **DXF plan → BBS importer (`scripts/dxf_to_bbs.py`, Python + ezdxf)**:
  - Drafting protocol: bar centerlines on `REBAR-H<dia>`, distribution width as cyan `REBAR-EXTENT` tick (length = zone width) or `EXT=` in the tag, per-bar TEXT tag `MARK H<dia>[-sp] Z=<z> EXT=<w> HOST=<group>` (plan has no Z — tag is the only source of `Pos_z`/spacing/host); concrete as closed `CONC-*` rect + `ID KIND NAME THK=<lz> Z=<z>` tag (footprint from bbox, name must equal bars' `HOST` so `resolveBarHost` auto-hosts).
  - Shape keywords: `BENT H=<leg> UP|DOWN`, `LINK A=<a> B=<b>` (closed stirrup rect), `LINK_HOOK L=<spine> A=<a> B=<b> [DOUBLE]` with `L/A/B` overriding measurement; 2-axis grids via `EXT=wxh SP=sxsy`; `VIEW=` sets `Plane`, `ROT=` overrides `Pos_Rotation`.
  - Grids are centered on the drawn anchor via `offset_x/offset_y` (the app copies one-sided from `Pos`, drafters center the line in its zone — unverified one-sided output spilled B2's 21 bars past the slab edge); closed rects anchor at bbox-min.
  - Stock-length splitting (>12 m) with EC2 lap table mirroring `src/bbs/calc.js` (`--bond poor|good`; H40 poor lap 3200 → 14000 splits 12000+5200); links never split. Emits `MASTER_HEADERS` CSV (FreeCAD-compatible, `Shape_Code/Total/Weight` left for `enrichBar`) plus a `*_bbs.json` project (bars + concretes) that opens via ⤒ Project.
  - Verified: `barAppBox` containment of every exported bar vs slab, `parseCsv`+`enrichBar` round-trip with weights; sample `inputs/bar_plan_bbs.dxf` → `bar_plan_bbs_linktest.*` (B1/B2 straights, B1155 `c_link_with_hook` 4×10 grid).
  - Auto-level + auto-bond: `B*` = bottom mat / `T*` = top mat (odd main, even distribution); straight B/T bars without `Z=` level from the host slab (`--cover` 40, `--gap` 25) — B1 on soffit cover, T1 topmost, `(B3,B4)`/`(T3,T5)` stack outward per layer; bent/links and explicit `Z=` override. Bond `--auto` per EC2 §8.2 (B good, T poor, unknown poor); `--bond good|poor` forces all. Project JSON stores `--cover` and a safe-default bond.
  - Covers in the slab tag (`COVB=`/`COVT=`, else `COV=`, else `--cover`) drive auto-level and link spine length (`L = THK − covers` unless `L=` given); sample DXF demos full top+bottom mats (T1/T2 auto-top, B1/B2 auto-bottom) with restored `EXT/HOST` tags.
  - Ambiguous tag pairing now warns instead of silently mis-assigning: a CAD drift that moves a tag nearer a same-diameter neighbour prints winner + margin (caught live when a +1014 shift crossed T2/B2); keep each tag within ~500 of its bar end.

- **Adjustable navigation (⚙ Nav panel + keyboard map)**:
  - Session-only `nav` prefs (never saved/undo): orbit / pan / zoom speed multipliers (0.2×–2.5×), smooth-glide damping toggle, zoom-to-cursor toggle (off = classic dolly at the pivot); toolbar button shows a ● when customized, with Reset defaults.
  - Speeds feed `OrbitControls` (`rotateSpeed`, `panSpeed`, `enableDamping`) and `DiveZoom` (wheel gain + cursor-vs-pivot branch); new `NavKeys` driver: arrows pan, Shift+arrows orbit in polar-clamped 15° steps, +/− dolly, Home fits all (typing + Ctrl/Meta guarded).
  - Verified headless over CDP: popover renders, slider→store round-trip exact (2.0×/0.5×/1.0× labels), keys exception-free; `npm run build`.

- **ⓘ Object Query tool (click-to-inspect coordinates)**:
  - Armed via the ⓘ Query toolbar button (next to Measure); `QueryHandler` in `Scene.jsx` raycasts `collectPickTargets` and builds a result row set per kind into ephemeral `store.query` (never saved, never in BBS/CSV).
  - Rebar: mark/type/Ø, bar index (`userData-barIndex` on the rebar group), Pos, bbox min/max/size (`barAppBox`), distribution count, cut length (`enrichBar`), click point. Concrete: name, origin, Lx·Ly·Lz, bbox min/max, center, click point. IFC: name/type/storey/GlobalId/Express ID, live index-aware `subsetBox` bbox restated in mm incl. placement, click point in model-mm + app-mm (per-type subsets handled).
  - Floating `QueryHud` panel with Copy-as-text; misses keep the last result; Esc exits the mode without clearing the bar selection (consumed in the Esc cascade). Query clicks also select the inspected bar/element so editors follow.
  - Verified headless over CDP with trusted clicks: concrete + rebar panels byte-correct (rebar pixels projected with the repo's own `genBarPoints`/`transformBarLocalPoint`), Esc close, zero page exceptions; `npm run build`.

- **FreeCAD-style window multi-select (Shift+B) + bulk rebar ops + deselect**:
  - `selectedBars` in store (active `selectedBar` = last of set, so the single-bar editor is unchanged); `setSelectedBars` / `toggleBarSelected` / `clearBarSelection` plus undoable bulk `removeBars` / `duplicateBars` / `hideBars` / `moveBars`; persisted in project save/load and undo snapshots.
  - `BoxSelect` in `Scene.jsx`: Shift+B (or ⊞ Box toolbar button) arms one-shot window select — LMB drag collects every visible bar whose projected bbox touches the rectangle, Ctrl-drag adds, Esc cancels; Ctrl/Cmd/Shift-click toggles single bars, BBS rows follow the same rule.
  - Rebar panel shows a bulk card when 2+ selected (Duplicate / Hide / Show / Delete with confirm, dX/dY/dZ Move, Keep 1 / All).
  - Deselect via viewport empty-click (never while placing/lapping/measuring/drawing/box-selecting), ✕ button, or Esc — Esc cascades (measure / draw / lap / box / delete-mode exit first via `preventDefault`, selection clears last); lap-picking Esc cancel now actually works.
- **Concrete pickable again for measure & pick-to-place**:
  - Root cause: `collectPickTargets` assumed the concrete pick root is a mesh (`if (r.isMesh)`), but `ConcreteMesh` renders it as a group — the box mesh was never raycast, so measure points and cover-offset picks silently missed concrete (IFC/rebar unaffected).
  - Group roots now traverse children with the same visible-mesh / stencil-ghost guards; verified headless with real three.js raycast (0 hits before → hit after, ghosts/edges excluded) + `npm run build`.

- **Concrete Element Rendering & Exact Geometry Enhancements**:
  - **Exact Shape & Profile Capture**: Auto-Trace and sidebar "Trace Concrete" now extract the exact triangulated mesh (`c.meshData`) from IFC elements, capturing real-world openings, penetrations, chamfers, bevels, notches, and custom cross-sections rather than reducing everything to an axis-aligned bounding box.
  - **Section Tool Clipping on Concrete**: Fixed clipping plane propagation on concrete elements so that both the mesh faces and edge outlines (`lineBasicMaterial`) react to the Section Box with full stencil solid-cut cap generation.
  - **Concrete Render Styles & Appearance**: Added real-time style modes (◧ *Ghost*, ◼ *Solid*, 📐 *Blueprint*, 🧱 *Textured*), live opacity slider (5%–100%), custom color tint picker, and edge outlines toggle in the Concrete panel.
  - **Mesh-Aware Snapping**: Updated `concreteSnapNodes` and `concreteEdges` in `shapes.js` to extract snapping points and edges directly from `c.meshData` vertices, enabling precise rebar alignment along opening edges and chamfers.

- **IFC Loading & Auto-Trace Fixes**:
  - **Schema compatibility**: Expanded schema validation in `session.js` to support all standard IFC versions (`IFC2X3`, `IFC4`, `IFC4X3`, etc.) rather than rejecting non-IFC4 files.
  - **Expanded IFC element types**: Added standard case and common structural types (`IFCBEAMSTANDARDCASE`, `IFCCOLUMNSTANDARDCASE`, `IFCSLABSTANDARDCASE`, `IFCSLABELEMENTEDCASE`, `IFCWALLELEMENTEDCASE`, `IFCSTAIR`, `IFCRAMP`, `IFCCOVERING`, `IFCRAILING`) to `IFC_TYPES` and `SOLID_CAP_TYPES`.
  - **Enhanced unit detection**: Improved `detectLengthUnit` to handle full unit keywords (`MILLIMETRE`, `CENTIMETRE`, `FOOT`, `INCH`) and `IFCCONVERSIONBASEDUNIT` definitions.
  - **Index-aware IFC subset bounding**: Fixed `cachedWorldBox` in `TraceTool.jsx` to always compute index-aware subset bounding boxes for IFC meshes, preventing pointer snapping and hover previews from collapsing to the entire IFC model's global bounding box.
  - **Auto-Trace direct raycast fallback**: Added pointerup raycasting fallback in `TraceTool.jsx` to ensure 1-click Auto-Trace reliably captures the target IFC element even without prior mousemove events.
  - **Shading effect reactivity & panel fixes**: Added `shading`/`isWireframe` to `IfcModel.jsx` effect dependencies and fixed concrete array reference in `IfcPanel.jsx` Trace Concrete button.

- **Measure controller bar/ref roles fix**:
  - Root cause: the HUD always assumed Point 1 = fixed ref and Point 2 = on the
    bar, so clicking rebar-first (or measuring an unselected bar) moved the
    wrong bar and rewrote the beam point — the dimension jumped while the
    rebar stayed put.
  - Each new measure point is now tested against visible bars (`distToBar`
    within tube surface + 8 mm; hidden bars never attract); the point on the
    rebar becomes the bar-side point and that bar becomes the controlled one
    regardless of click order (`barPointIdx` / `measureBarIdx` in store,
    preserved across pop/clear/deactivate).
  - HUD computes deltas bar-minus-ref, Set pins the ref point and moves only
    the bar-side point, with a ⇄ Swap override when auto-detect guesses wrong.
  - Verified: 13-assertion Node store test (both click orders, bar moves /
    ref stays / other bars untouched, swap) + `npm run build`.
- **Blender-style navigation**:
  - Axis gizmo top-right of the viewport (`GizmoHelper` + `GizmoViewport`,
    no new deps): click an axis tip for Top/Bottom/Left/Right/Front/Back,
    drag to orbit.
  - Toolbar `view ▾` preset picker (Top/Bottom/Front/Back/Left/Right/Iso)
    mapped to the app frame; keeps the orbit target so focus never jumps
    (`viewReq` in store, `ViewPreset` driver in Scene).
- **Restored `distOffsets`** in `src/bbs/shapes.js`: the ref-lines WIP had
  replaced it with `distToBar` while `Scene.jsx` still imports it (viewport
  could not load from source). Both now coexist.
- **Reference lines parented to concrete (WIP in this push)**:
  - `refLines` in store (undoable, saved in project file, removed with host);
    draw via 📏 Draw Ref Line trace tool with live preview; 3D group with
    select highlight, length tag, Delete-key removal; hide with hidden host.
  - Snap/measure/hover paths (`allSnapNodes`, `MeasureHandler`,
    `SnapPreview`) include ref-line nodes; per-member row in the Concrete
    editor with + Centerline / + Cover Line helpers, rename, color, show/hide.

- **Rebar Plane Rotation & 3D Orientation Fix**:
  - Connected `RebarMesh` tube geometry rendering to `transformBarLocalPoint`, ensuring 3D rebar reacts accurately to Plane (`XZ`, `YZ`, `XY`) and in-plane `Pos_Rotation` changes.
  - Standardized local 2D shape coordinate definitions across all shapes (`bent`, `crank`, `double_crank`, `c_link`, `c_link_with_hook`, `straight`).
  - Added Plane selector dropdown in the Rebar editor panel and updated stirrup `Fit to host` logic to respect host orientation.
  - Aligned snapping, bounding box, lap splicing, and CSV parsing/exporting with multi-plane coordinates.
- **Multi-Type Lap Splice Support (Bent, Straight, Crank, Double-Crank)**:
  - Extended auto-lapping from straight-only to all longitudinal rebar combinations (`straight`, `bent`, `crank`, `double_crank`).
  - Added smart proximity detection: automatically splices onto the anchor's end or start depending on which side the lapping bar is closer to.
  - Splicing along the main straight axis ensures bent hooks and cranks orient collinear and form the required EC2 lap overlap.
  - Rendered dual splice point anchor markers in the 3D viewport.
- **Lapping rule fix**: Lap splice length calculation now correctly uses the smaller (least size) bar diameter (`Math.min(diaA, diaB)`) per standard detailing code (Eurocode 2 §8.7.3) rather than the first picked/larger bar.
- **FreeCAD Reinforcement Benchmark BBS CSV Export**:
  - Added dedicated `⤓ BBS Schedule CSV` toolbar and header actions exporting in FreeCAD Reinforcement benchmark / BS 8666 format with UTF-8 BOM.
  - Implemented standard shape code mapping: `straight = 20`, `bent = 37`, `clink = 38`, `c_link_with_hook = 85`, `crank = 41`, `double_crank = 43`.
  - Added shape dimension parameters (`A`, `B`, `C`, `D`, `E`) and summary breakdown per diameter with grand totals.
  - Displayed live shape code badges in the BBS table.
- **Enhanced Measure Tool & Rebar Distance Controller**:
  - **Concrete Snapping & Picking**: Measure tool now snaps to concrete member corners, edge midpoints, and face centers in addition to rebar centerlines.
  - **3D Delta Line Projections**: Displays 3D vector length alongside color-coded orthogonal dashed projection lines and labels for ΔX (Width), ΔY (Depth), and ΔZ (Height).
  - **Interactive Rebar Distance Controller HUD**: Added floating inspector and controller to directly position and adjust any selected rebar's clearance against measured reference points along X, Y, Z, or the direct 3D vector (with quick cover alignment and undo/redo support).
- **BBS bottom-panel sorting (this session)**:
  - Sort dropdown (Model order / Bar mark / Diameter Ø / Type / Cut length / Weight / Group) + Asc/Desc toggle; Mark sorts naturally (B2 < B10). Clickable `Mark`, `Type`, `Ø`, `Bars`, `Cut`, `Wt`, `Set` headers cycle asc → desc → model order. Sort applies within each element group as well as the flat view.
- **Ad-hoc parametric groups (this session)**:
  - Checkbox per BBS row + Ctrl-click toggle + Shift-click range select; new `Set` column shows the `▦ S#` badge (click selects the whole group). `▦ Group N` (BBS toolbar + blue multi-select card) tags the selection with a fresh `setId` so it edits together in the green Set card (Dia, per-type dims, Plane/rotation, uniform/taper lengths, type switch — one undo step each); `▦ Ungroup` dissolves it with dims intact. New store actions `groupBars` / `ungroupBars` / `ungroupSet` (undoable); ad-hoc groups carry no sketch spec so grid re-spread notes its face-sketch requirement instead of failing silently. `setId` already round-trips through CSV and project files.
- **Resizable BBS bottom panel (this session)**:
  - Drag handle across the top edge of the BBS strip (row-resize, 120px – 75% viewport clamp); double-click resets to 240px; height persists in `localStorage` (`barbending.bbsHeight`). Build passes.
- **Drawn_rebar parse fixes (this session)**:
  - Exact-stock float guard: the 12000 trace measures `12000.000000000005`, which tripped `L > stock` into a spurious lap split (extra 1290 mm `B1-P2` piece). Stock comparisons now carry a 1e-6 epsilon — exact-stock bars stay one piece, no lap. Same file went 12 rows → 11, marks sequential `B1/B2/B3` (was `B1/B3/B4` with the gap).
  - Auto B-numbers count bars, not rows (`bar_n` per bar instead of `B{len(rows)+1}`), so genuine stock splits no longer burn numbers and leave gaps.
  - Auto-profile leg headings normalized to `[0, 360)` (`PB4` leg was `-150.3°`, now `209.7°`; near-zero float residue prints `0.0` not `360.0`) — matches the tagged-profile path; app mark signatures normalize the same way so old + fresh imports of identical geometry unify under Match Marks (verified headless).
  - Main/dist parity roles now only apply to tag-derived marks — auto numbers carry no layer meaning, so the 2nd untagged bar no longer warns as mislabeled DIST steel.
  - Regression: all 16 other sample DXFs × default/auto modes byte-identical pre/post; reference `inputs/Drawn_rebar_auto.csv` regenerated (11 rows).


## 2026-09-29 — pushed to `main`

- **Auto-lap splice** 🔗 (EC2 §8.7 bond table): arm 🔗 Lap, click anchor then
  lapping bar — or anchor dropdown + bond + Apply in the Rebar editor. Moves
  the lap bar's start one lap length before the anchor's end, collinear
  (inherits rotation); length from the larger Ø (good/poor tables for
  13–50, interpolated/extrapolated, rounded up to 10 mm; default poor bond).
  Straight bars only, single undo unit, footer confirmation. Verified:
  store-level (1920,0,0) + headless editor flow with overlay proof.

- **Snap on the rebar** ⚓: pick-to-place and measure snap to visible bar
  ends/corners within 14 px (`rebarSnapNodes`: every polyline vertex × every
  copy; hidden bars never attract; the bar being placed is excluded).
  Exact node, no cover offset, ⚓ marker in the footer. Verified headlessly:
  off-end click landed exactly (4500, 0, 0).
- **Snap toggle + magnet preview** 🧲: toolbar toggle (default on, UI pref —
  never saved); hovering a snap target shows a pink magnet glyph exactly
  where the click would land. Verified: glyph on hover, toggle-off click
  lands the surface point instead.

- **Measure tool** 📏: click IFC/concrete/bar surfaces for points (exact hits,
  no cover offset), per-segment midpoint labels + running total in the footer,
  markers + on-top line. RMB-click removes last point, Esc exits. Ephemeral
  view aid — never saved, never in BBS/CSV; measuring owns clicks (pick,
  bar-select and trace step aside). Verified headlessly: 2 pts → 1,444 mm.

- **Undo/redo + browser save**: ↶ ↷ header buttons + Ctrl+Z / Ctrl+Y
  (text inputs keep native undo; number fields use app undo so controlled
  inputs can't diverge). History covers bars, concrete, selection, cover
  (50 steps; IFC/section excluded). 💾 Save persists bars + concrete + cover
  to localStorage and auto-restores on boot (IFC files reload by hand).
  Verified headlessly: add → undo → redo → save → reload restores.
- **Project file transfer**: ⤓ Project downloads a dated
  `barbending-project-*.json` (bars + concrete + cover); ⤒ Project opens it
  on any system (replaces current model, validated v1). Verified: real file
  download + upload round-trip headlessly.

- **Hide members & bars (view-only)**: per-concrete 👁 in the Concrete tab —
  hosted bars hide with their member, and any bar whose geometry overlaps a
  hidden member hides too (no host assignment needed — fixes picked/positioned
  bars staying visible); per-bar 👁 in the BBS strip + a Hide checkbox and
  host-member dropdown in the Rebar editor (Fit-to-host assigns the host).
  Hidden items stay in BBS totals and CSV; visibility round-trips via a
  `Visible` CSV column FreeCAD ignores. Deleting a member unhosts.

- **Blender-Style Unlimited Fluid Zoom & Fast Panning**:
  - Implemented exponential decay damping (`useFrame`) on wheel & trackpad pinch gestures for buttery-smooth 60/120fps glide.
  - Unlimited dive-zoom: smoothly advances camera and orbit pivot along the cursor ray when approaching geometry, eliminating the OrbitControls pivot wall / Zeno slowdown.
  - Zoom-out dynamically re-inflates compressed radii so backing out from micro-inspection is instantaneous.
  - Fast, responsive panning with `panSpeed={1.8}`, `screenSpacePanning`, and native `Shift + MMB` / `RMB` support.
  - Dynamic adaptive near clipping ($0.1\,\text{mm}$) and expanded far plane ($5000\,\text{m}$) for zero foreground clipping.

- **IFC Wireframe Mode & Structural Tracing Tools**:
  - Added **Wireframe** shading mode alongside Solid and X-ray to expose interior joints, frames, and vertices of IFC models.
  - **Smart Node & Joint Snapping Engine**: Raycast-driven vertex, corner node, and edge midpoint snapping with 3D glowing snap glyphs and coordinate HUD.
  - **1-Click Auto-Trace**: Click any IFC beam, column, slab, footing, or wall in viewport (with real-time hover bounding preview) or via the IFC properties panel to instantly extract exact 3D bounding geometry, dimensions, and structural member names into concrete elements.
  - **Interactive 2-Point Snapped Tracing**: Draw custom beams, columns, and slabs by snapping between start and opposite corner nodes with real-time 3D bounding box dimensions preview.
- **Fix**: scratch concrete boxes rendered with plan-depth (Ly) and height (Hz)
  swapped (a 6000×400×600 beam drew 400 tall × 600 deep); now matches the data,
  the pick mapping, and the stirrup fit.
- **IFC pick perf**: per-subset tight bounding spheres at load (subset buffers
  are shared whole-model, which defeated raycast/frustum culling — every click
  tested every triangle, freezing real-size models so clicks died as drags).
  Plus an always-on `[pick] targets/hits/ms` console line for remote diagnosis.
- **Selected bar renders on top** (`depthTest` off, high render order):
  snap-to-cover parks bars inside opaque IFC solids where the old depth-tested
  white highlight was invisible; unselected bars keep depth. Section clipping
  still applies.
- **Trace tool perf (hang on real-size IFCs)**: the snap handler raycast the
  full scene + walked whole element indexes on every mousemove even with the
  tool off. Now idle without a draw mode, rAF-throttled to one raycast/frame,
  element bboxes cached (recomputed only on geometry/matrix change), click
  handler stabilized via ref mirror. Behavior identical on fixtures
  (headless: auto-traced C1 400×400×3000, no errors).
- **Viewport perf**: `AdaptiveDpr` (resolution drops under load, restores when
  smooth), pan speed 0.7 → 1.0 + zoom speed 1.4×, stencil mark meshes skipped
  for hidden IFC subsets and frustum-culled with the rest.
- **Nav + zoom**: zoom speed 2×, near/far retuned for constant depth precision
  (dive from site scale to a single bar — close faces no longer clip, distant
  faces don't z-fight), `high-performance` GPU hint for hybrid laptops,
  buffer-preserving canvas only under `?autotest`. Zoom range itself was and
  stays unlimited (0 … ∞, zoom-to-cursor).
- **Dive-zoom**: stock orbit parks the camera at its pivot, so wheel-in dies
  whenever the pivot isn't on the surface you're approaching (and the
  collapsed radius then starves zoom-out too). Wheel-in now walks the pivot
  forward along the cursor ray; wheel-out pulls the camera back past stock
  dolly with a floor that re-inflates collapsed radii. Verified headlessly:
  240 wheel-ins fly through the old pivot without stalling, 10 wheel-outs
  recover 3 m. Touch pinch keeps stock behavior.
- **Dive-zoom calibration**: first cut flew 22 m past the target (model lost)
  and the tight far plane clipped distant context on close dives. Now gentler
  tracking (3%/notch, 5 cm cap, 2 mm anti-stall floor), zoom speed 1.5×, far
  floor 200 m. Verified: 9.4 m → 1.5 m in 20 notches, glides through arrival
  without stalling, 10 wheel-outs recover. Fast travel, controlled arrival.

- **IFC placement**: per-model X/Y/Z offset (mm) + Rx/Ry/Rz (deg, Y-up) with
  one-click reset to 0,0,0 + 0°; camera fit, click-place and zoom-to-element
  follow the moved model.
- **Work-while-sectioned**: 👁 Box toggle hides all section visuals while the
  cut stays live; orbit can no longer stick disabled after interrupted drags.
- **Blender-style viewport**: unlimited zoom (per-frame dynamic near/far +
  zoom-to-cursor, no distance clamps), Solid / X-ray shading switch, status
  bar (mouse hints, live FPS, camera distance, totals), collapsible left rail,
  Select/Orbit LMB modes (MMB always orbits).
- **Pick pos rebuilt**: DOM-level pointer tracking + manual raycast against
  IFC + concrete + rebar surfaces (visible-only, stencil ghosts skipped);
  placed coordinates confirmed in the viewport footer. No IFC required.
- **Perf**: render resolution capped at 1.75×, calmer pan speed.

## 2026-09-28 — pushed to `main` (`68434aa`)

- Browser BBS workstation: parametric rebar (6 FreeCAD-compatible shapes),
  FreeCAD-style distribution grids, BBS table + `rebar_scheduling.csv` round-trip.
- IFC4 reference loading (WASM, in-browser): per-level/per-element outliner,
  query + rename + level moves, units auto-detect, solid/ghost, click-to-place.
- Revit-style section box: push/pull faces, move/rotate gizmos, stencil-cap
  solid cuts (per-plane bits, solid types only), hideable.
- Docs: `agent.md` (agent conventions + verified web-ifc/R3F pitfalls),
  `overview.md` (architecture), `README.md` (user guide), headless CDP
  verification harness (`scripts/cdp-section.mjs`, `?autotest` hooks).

## Verification status

- Headless Edge (CDP) green: section clipping, caps-at-cuts-only, IFC load,
  pick-to-place with bar relocation, orbit-mode switch. Screenshots + DOM
  dumps under `Temp\opencode` (not committed).
- Test fixtures (not committed): `Temp\opencode\ifctest\` — `test_concrete.ifc`
  (beam+column), `test_agg.ifc` (containment + aggregate storeys); generated
  with FreeCAD's bundled ifcopenshell (headless `freecadcmd`).
- Known limits: IFC4 only; view-only IFC annotations (file never modified);
  >1000 elements falls back to type-level control; stencil caps need a
  stencil-capable GPU; cut faces are flat fills (no hatch).

## Open / next

- User acceptance on real project IFCs (cap fills on thin-shell-heavy models,
  pick behavior at site scale, navigation feel).
- True views: user acceptance of the orthographic Top / Bottom / Front / Back / Left / Right on real
  project models (navigation feel, the toolbar wrapping sooner beside the axis gizmo), and drive the
  Measure / Query / trace tools in the orthographic camera in the browser rig.
- End-on dots: measure the exact-axis idle cost at 3M bars and, if it matters, draw end-on bars as GL points
  (one vertex each) instead of 2 px lines; drive Measure / Query / snap and the section box on end-on bars in
  the browser rig.
- Box / Lasso select: the seconds the page stays busy after selecting thousands of rows at 1M bars are the BBS
  table (sub-project B); a click-by-click polygon lasso, a selection clipped to the section box and a tool that
  stays on are possible if wanted.
- Possible follow-ups: hatch-pattern caps, BS 8666 shape codes + 2D bending
  diagrams, DXF/SVG export.
- Tagged `PROFILE` rows on XZ/YZ still seat at `Z=` / host bottom cover / 0,
  while `--profiles auto` now reads the drawn section Y as the elevation —
  decide whether the tag path should default to the drawn Y too (no sample
  DXF uses `PROFILE` tags, so there is no regression baseline yet).
- Large-project performance, next: sub-project B (window the BBS table and bar
  dropdown — now the dominant cost at 1M bars and the reason a 75,000-row project
  cannot load — plus undo as diffs and IndexedDB save), C (spatial snapping index
  reusing A's chunks and picker), D (IFC merge / LOD) and milestone 7 of the BarField
  spec (render on demand while the camera is still).
