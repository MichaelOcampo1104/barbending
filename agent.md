# agent.md — barbending contributor notes (for AI agents)

Lightweight browser bar-bending-schedule (BBS) app: draw concrete + rebar in 3D,
optionally over an IFC4 reference model, export `rebar_scheduling.csv` that feeds
the FreeCAD macros in `C:\Users\Michael Ocampo\AppData\Local\Programs\FreeCAD 1.1\Macro`.

## Stack (pinned realities)

- Vite 8 + React 19 + `@react-three/fiber` 9 + `@react-three/drei` 10 + zustand 5.
- `three` 0.186. `web-ifc-three` 0.0.126 (peer `three@^0.149.0`, installed with
  `--legacy-peer-deps`) + its **nested** `web-ifc` 0.0.39 (NOT the root 0.0.78).
- `public/web-ifc.wasm` MUST be the nested copy
  (`node_modules/web-ifc-three/node_modules/web-ifc/web-ifc.wasm`, ~665 KB).
  Loader calls `setWasmPath('/')` → served as `/web-ifc.wasm`.
- All named `three` imports used by `web-ifc-three` exist in 0.186 (verified);
  `mergeGeometries` import path `three/examples/jsm/utils/BufferGeometryUtils`
  resolves under Vite, but **fails under plain Node ESM** (extensionless) —
  headless scripts need a resolve hook (see Verification).

## Units & coordinates (load-bearing)

- App data is **millimetres**. Scene units are **metres** (`S = 0.001` in viewers).
- Mapping three ↔ app: `sceneX = x`, `sceneY = z`, `sceneZ = −y`
  (app `Pos_x/Pos_y/Pos_z` in mm).
- `web-ifc-three` outputs three.js **Y-up** directly (verified by bbox test) —
  do NOT add a Z-up rotation.
- `COORDINATE_TO_ORIGIN: true` is applied on every parse (site coords like
  249801/36044 would otherwise jitter). Consequence: rebar never auto-aligns to
  IFC site coords; placement is manual/pick.
- IFC length units are auto-detected by **STEP-text regex** on `IFCSIUNIT`
  (`detectLengthUnit`), because `getItemProperties` **misaligns IfcSIUnit
  attributes** in web-ifc 0.0.39 (verified). Bboxes are stored in **raw model
  units**; mm readouts, camera fit, and pick-position scale at render time so
  unit overrides stay consistent (`fitOf` in store).

## FreeCAD interop (do not break)

- Export header `MASTER_HEADERS` (`src/bbs/csv.js`) is a superset of the
  FreeCAD `rebar_scheduling.csv` + `Rebar_Type`; extra columns are ignored by
  `rebar_detailing.py`'s `DictReader`. Keep it that way.
- Distribution semantics mirror `parametric_utils.py`: copies at
  `Pos + (ix·spacing_x, iy·spacing_y, 0)` + offset; total bars =
  `qty × qty_x × qty_y`. Weight uses total bars.
- Rebar types: `straight, bent, crank, double_crank, c_link, c_link_with_hook`.

## State (zustand `src/store.js`) + migrations

- `bars` (optional `host` concrete-id, `hidden`), `concretes` (optional
  `visible`), `selectedBar`, `showConcrete`, `cover`, undo stacks
  `past`/`future` (model-only snapshots), `saveStamp`. All view flags are
  optional → legacy sessions/CSVs default to visible. CSV `Visible` column
  round-trips `hidden`; `host` is session-only (concretes aren't exported).
  Project file = `{v:1, bars, concretes, cover, selectedBar}` JSON
  (`exportProject`/`importProject`; browser save shares the shape).
- `measure: {active, points[]}` is ephemeral (never saved); measuring owns
  clicks — `PickHandler`, bar-select and `TraceTool` all step aside while
  `measure.active`. `collectPickTargets(scene)` is the shared visible-mesh
  collector for pick/measure hover paths.
- `ifc` meta shape evolved: `{fileName, unit*, auto*, level, types[], elements[],
  opacity, bbox{center,radius,size}}`. Old in-memory sessions may lack
  `elements/size/level` → code MUST guard (`level !== 'element'` → type branch,
  `bbox.size?.` optional chaining in `defaultSectionBox`).
- `section`: current shape `{enabled, mode, center, size, quat, solidCut}`.
  Legacy `{min,max}` sessions are migrated by `normalizeSection()` in both the
  store toggle and `SectionBox` render. Never assume fields exist on
  hot-reloaded state.

## Verified web-ifc quirks (don't "fix" these)

1. `getSpatialStructure()` returns empty → storeys mapped via
   `IFCRELCONTAINEDINSPATIALSTRUCTURE` then `IFCRELAGGREGATES` (relating type must
   contain STOREY|SPACE), else elevation-band fallback. See `collectStoreys`.
2. Subset geometries **share the full model's position buffer** and filter by
   index → `Box3.setFromObject`/`computeBoundingBox` return the WHOLE model box.
   Always use index-aware `subsetBox()` (`src/ifc/session.js`).
3. Subset filtering itself works (`getExpressId` sampling verified).
4. **Tight `boundingSphere` per subset is assigned at load** (`subsetLocalSphere`,
   index-aware, NaN-skipping): subset geometries share the full-model position
   buffer, so three's `computeBoundingSphere` returns the whole-model sphere
   (raycast + frustum culling then test every triangle of every subset — hangs
   real-size models) or NaN on degenerate exporter geometry (early-out misses).
   Only assigned when the subset mesh transform is identity (always true from
   `createSubset`); the sphere is a conservative box-sphere so it can't
   wrongly exclude.
4. `mesh.onAfterRender` MUST be assigned imperatively via ref — R3F does not
   reliably forward the `onAfterRender` prop, and without per-face stencil
   clears the caps accumulate into full grey faces.
5. Face dragging uses **native window pointermove/up listeners**, not R3F
   pointer capture (which silently swallowed drags on the user's machine).
6. `useMemo` geometry deps for rebar tubes key on the whole `bar` object —
   a manual field list previously swallowed `bent_up_down` updates.
7. Pick raycast runs against subset meshes directly (no BVH dep): kept fast by
   the tight per-subset spheres in (4); every pick click logs
   `[pick] targets/hits/ms` + `[pick] placed` to the console for remote diagnosis.

## Code-splitting (keep the parser lazy)

- `src/ifc/session.js` (imports `web-ifc-three`, ~6 MB) is loaded ONLY via
  dynamic `import()` — in `IfcPanel.loadFile`, remove/zoom/focus handlers.
- `src/viewer/IfcModel.jsx` is `React.lazy` + gated on `ifcActive`.
- `src/ifc/IfcPanel.jsx` and `src/ifc/units.js` are static-safe (no parser
  imports). Never add a static `web-ifc*` import outside the lazy boundary.

## Bar renderer (`src/viewer/barfield/`)

- Default renderer is the **BarField** (chunked lines + instanced tubes, spec in
  `docs/superpowers/specs/2026-10-07-barfield-renderer-design.md`); `?renderer=legacy` selects the
  old per-bar `RebarMesh` list. `RebarMesh` still draws a small selection and just-edited rows (the
  overlay), because it costs one mesh per bar copy: the overlay is capped at 300 rows AND 400 bar copies
  (`rowState.js` / `overlayRows.js`); a heavier selection is tinted in place instead. Do not raise the cap
  without re-measuring (50 selected rows of 40 copies ran at 8.6 fps at 1M bars).
- Pure modules (`buildField`, `rowState`, `overlayRows`, `diffRows`, `lod`, `quality`, `fieldPick`,
  `workerCore`, `fieldClient`) have Node tests in `tests/barfield/` (`npm test`); they import with explicit
  `.js` extensions and must not touch three.js, React or the DOM.
- Field objects are static (`matrixAutoUpdate = false`), have no event handlers, and are NOT pick roots:
  bars are picked from data (`fieldPick.js` through `fieldRegistry`), never by raycasting meshes. The
  pick is computed once per pointer event (`ev`), because `PickHandler` may select the bar before
  `QueryHandler` runs for the same click.
- Row id texture layout: R = state (0 normal, 1 hidden, 2 overlay, 3 tint), G = colour slot, B = radius (m).
  Edited rows use virtual ids `rowCount + k` (delta chunk); `deltaRows[k]` maps back to the bar index.
- Do not call setState inside the sync effect in `BarField.jsx` (lint rule `set-state-in-effect`): the
  overlay list is an external store, read with `useSyncExternalStore`.
- Browser checks: `scripts/perf/check_field.mjs` (needs a built preview) and `scripts/perf/cdp_bench.mjs`.
  `?autotest=...` exposes `window.__scene`, `__camera` and `__store` for them; `?fieldfail=1` forces the
  field build to fail to exercise the fallback. The rig reads the fps / bar count from the status bar text,
  so keep "N fps · cam … · N bars" in one `.statusbar span`.

- End-on bars: a bar pointing straight at an orthographic camera (a starter bar in the Front view, a vertical
  bar in the Top view) has no projected area, so nothing draws it: a hardware line becomes zero length and the
  open six-sided tube prism has edge-on sides. Three paths handle it, keep all three: (1) `buildField` tags
  every line vertex in `axisOfVtx` (`endOn.js`: 1 / 2 / 3 = the scene X / Y / Z axis the segment runs along
  within 0.06 degrees, +4 on the end vertex) and `LINE_VS` opens a segment on the camera's exact axis
  (`uEndOnAxis`, from `cameraEndOnAxis`) into a 2 px dash; (2) `TUBE_VS` collapses an instance within about a
  degree of the view direction (orthographic only: `uOrtho`, `uViewDir`) onto a hexagonal disc at its near end,
  using the prism's own triangles; (3) the classic `RebarMesh` tube is capped (`tubeCaps.js`, still named
  `TubeGeometry` for the tools that count it). `BarField.jsx` pushes the camera state every frame through
  `FieldView.setCameraState`. Measured cost at 1M bars in an exact-axis orthographic view: idle about 46 -> 39
  fps (the end-on bars are drawn now), other numbers unchanged. Browser check: `check_views.mjs --only dots`.

## Camera & views (`src/viewer/CameraRig.jsx`, `cameraMath.js`, `cameraOps.js`)

- Two real cameras, two OrbitControls (perspective + orthographic); only one pair is enabled and
  `state.camera` / `state.controls` always point at it. Do not make one "hybrid" camera: three-stdlib
  `OrbitControls` tests `instanceof PerspectiveCamera` / `OrthographicCamera` for pan and zoom, so a camera
  that only flips flags loses both. Never `makeDefault` either `<OrbitControls>`; `CameraRig` owns that.
- Any effect or handler that captures `camera` or `controls` from `useThree` must list it in its deps: the
  active camera changes object when the projection switches (`DiveZoom` and `TraceTool` had stale cameras).
- Orthographic scale: R3F makes the frustum the canvas size in CSS pixels, so `camera.zoom` = **pixels per
  metre** and the visible height is `H / zoom`. Never use `camera.fov` or the distance to the target for
  scale in the orthographic path; take `viewMetrics(camera, H)` (→ `pxPerMeter`, `null` for perspective) as
  LOD, pick tolerance, wheel zoom and Fit do. Orthographic near / far are ∓2000 (a negative near plane is
  fine) and the zoom is clamped to 2 mm – 500 m visible height; perspective keeps its 2 mm – 400 m distance.
- Switching projection keeps the same orbit target, view direction and visible region on the target plane
  (the dolly-zoom identity `zoom = H / (2·d·tan(fov/2))`), so only the perspective changes (`switchProjection`).
- The six true views use exact axis offsets (no epsilon: OrbitControls already clamps the pole at 1e-6); the
  preset animation slerps the camera direction on the orbit sphere, so opposite views never fly through the
  model. `viewName` is derived from the camera direction every frame (`viewFromForward`, 0.003 rad) and
  `setViewName` returns the same state object when it is unchanged, or every subscriber would re-render each
  frame.
- Mutate cameras / controls only in `cameraOps.js`: the React-compiler lint rule `react(immutability)`
  rejects direct property writes on hook-returned objects inside components. Pure math goes in
  `cameraMath.js` (no React; `tests/views/` runs both under `npm test`).
- Fit IFC (`FitIfc.jsx`) keeps the view direction in the orthographic camera (recentre + zoom to the bounding
  sphere) and uses its fixed oblique offset only in perspective; `AutoClipping` leaves the orthographic depth
  range (±2000) alone.
- Layout: `.vptools` (toolbar) is `pointer-events: none` with its children `auto` and stops 140 px short of
  the right edge, so the axis gizmo heads stay clickable; the view pill sits under the gizmo. Keep the
  bottom-left of the canvas free (hint bar; a click on empty canvas deselects).
- Browser checks: `scripts/perf/check_views.mjs` (needs a built preview, 78 checks), next to
  `check_field.mjs`; `cdp_bench.mjs --view front` benchmarks the orthographic camera.

## Dev servers & the stale-tab problem

- `:5173` dev (`npm run dev`, started with `CHOKIDAR_USEPOLLING=1` — native
  watching misses edits under this synced `Documents` folder).
- `:5174` production preview (`vite preview`), rebuilt via `npm run build`.
- The header shows `build <UTC timestamp>` (`__BUILD_ID__` via vite `define`).
  If a reported bug doesn't match current code, check the stamp FIRST, then
  verify served source (`Invoke-WebRequest http://localhost:PORT/src/...` and
  grep for the new symbol) before touching code.
- Background servers are started detached (`Start-Process … -WindowStyle
  Minimized`); kill by owning PID of the listening port before restarting.

## Verification (evidence before synthesis)

- `npm run build` must pass after every change.
- Headless IFC checks: generate fixtures with FreeCAD headless
  (`freecadcmd.exe` + bundled `ifcopenshell` 0.8.4; `importIFC` is NOT available
  headless — author STEP entities directly). Parse/verify with Node using a
  `module.register` resolve hook for the extensionless `BufferGeometryUtils`
  import, `setWasmPath('./')`, cwd = nested `web-ifc` dir.
- Fixture scripts live OUTSIDE the repo
  (`$env:LOCALAPPDATA\Temp\opencode\ifctest\`); temp `*.tmp.mjs` shims go in the
  repo root only during verification and MUST be deleted afterwards.
- Test IFC4 files available: `test_concrete.ifc` (beam+column, containment),
  `test_agg.ifc` (containment + storey-aggregate + assembly decoy).

## Edit discipline

- Read before Edit (tool-enforced); keep diffs minimal; don't reformat.
- **Never place hooks after early returns** (React #310 blanked the whole app
  once — SectionBox). All hooks must run unconditionally every render.
- No new files unless required; prefer editing existing modules.
- Clipping planes (`sectionPlanes`) are mutated in place and shared by
  reference — never replace the array, never change its length (avoids shader
  recompiles). Disabled = constants parked at ±1e6.
- Stencil-cap pattern (three.js clipping-stencil): per plane, back-face INC +
  front-face DEC mark meshes (colour/depth writes off, own renderOrders) then a
  cap quad (`NotEqualStencilFunc` on its own bit). Each plane owns one stencil
  bit (masks on marks + caps), so caps never depend on inter-plane clear
  timing; the per-face `clearStencil` (imperative `onAfterRender` via ref, NOT
  the prop) is belt-and-braces.
  Mark/cap materials are module singletons; quads are box-group children.
- Pick-to-place/select (`PickHandler` in Scene.jsx): DOM pointer tracking +
  manual raycast against `userData.pickRoot` roots only (`ifc` group, concrete
  meshes, rebar groups), skipping hidden subtrees + `userData.stencil` ghosts.
  Reads live store (no stale closures). IFC hits use model-unit→mm math;
  concrete/rebar use scene→app-mm mapping. R3F event bubbling is NOT used
  (unreliable for imperative subset meshes); `lastPick` in store is the proof.
- Mouse map is Blender-like: LMB select (or orbit via `navMode` switch), MMB
  rotate, RMB pan, wheel zoom-to-cursor; status-bar hints derive from `navMode`.
- Caps are attached ONLY for `SOLID_CAP_TYPES` (beams/columns/slabs/walls/
  footings/piles/stairs/ramps). Thin shells (plates, members, roofs, proxies)
  project whole-surface fills instead of cut lines, so they clip hollow-only.

## Headless visual verification (use it)

- `scripts/cdp-section.mjs` drives headless Edge over CDP (no extra deps —
  Node 24 global WebSocket): loads `?autotest=section` (auto-enables + cuts),
  polls `#autotest-dump`, screenshots to Temp. Run: `node scripts/cdp-section.mjs
  [url] [out.png]`. Needs the `:5174` preview server up.
- `?autotest=section` (App timer + `AutotestDump` in Scene) self-drives the
  section; `&showmarks=1` makes stencil mark passes visible (red/blue);
  `&captest=eq0|eq1|eq255` maps stencil values; `&nomarks=1` drops mark meshes;
  `&oneplane=N` parks all but one plane.
  `&sample=1` loads `public/sample-concrete.ifc` (beam+column test model,
  same code path as upload) — full IFC+caps proof without a file dialog.
- `AutotestDump` writes `#autotest-dump` JSON every second: renderer flag,
  live plane constants, store, per-material plane refs, rebar-tube census
  (verts/NaN/visibility/world-bounds/program planes), and a pixel verdict
  (readPixels on known-outside bar points vs background).
- `scripts/cdp-section.mjs [url] [out.png] [clickText]` drives headless Edge
  over CDP: console + uncaught exceptions, dump polling, screenshot, and
  optional toolbar-button click (reproduces exact user actions — caught the
  #310 blank-page crash).
- `AutotestDump` also writes pixel ground truth (readPixels on known-outside
  bar points vs background) — trust pixels over screenshots, and screenshots
  over prop dumps.
- Lessons paid for: (1) `__BUILD_ID__` is UTC — compare against UTC or you
  will hallucinate staleness; dev-tab stamp freezes at server start anyway.
  (2) Verify the RENDER, not the props: flag/planes/materials can all read
  correct while nothing clips. (3) Old-headless CLI `--screenshot` works;
  `--dump-dom` never runs React — use CDP polling instead. (4) `npm install`
  needs `--legacy-peer-deps` (web-ifc-three peer) — plain install fails.
- Temp `*.tmp.mjs` shims belong in repo root only mid-investigation; the
  keepers live in `scripts/`.
