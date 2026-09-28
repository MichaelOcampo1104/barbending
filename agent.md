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

- `bars`, `concretes`, `selectedBar`, `showConcrete`.
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
4. `mesh.onAfterRender` MUST be assigned imperatively via ref — R3F does not
   reliably forward the `onAfterRender` prop, and without per-face stencil
   clears the caps accumulate into full grey faces.
5. Face dragging uses **native window pointermove/up listeners**, not R3F
   pointer capture (which silently swallowed drags on the user's machine).
6. `useMemo` geometry deps for rebar tubes key on the whole `bar` object —
   a manual field list previously swallowed `bent_up_down` updates.

## Code-splitting (keep the parser lazy)

- `src/ifc/session.js` (imports `web-ifc-three`, ~6 MB) is loaded ONLY via
  dynamic `import()` — in `IfcPanel.loadFile`, remove/zoom/focus handlers.
- `src/viewer/IfcModel.jsx` is `React.lazy` + gated on `ifcActive`.
- `src/ifc/IfcPanel.jsx` and `src/ifc/units.js` are static-safe (no parser
  imports). Never add a static `web-ifc*` import outside the lazy boundary.

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
