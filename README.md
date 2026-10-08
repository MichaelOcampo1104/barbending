# barbending — browser bar-bending schedule (BBS)

Draw concrete and rebar in 3D, optionally over your own IFC4 model, and export
a `rebar_scheduling.csv` that loads straight into the FreeCAD rebar macros.
Runs entirely in the browser — no server, no upload, no install beyond `npm`.

## Quickstart

```powershell
npm install
npm run dev        # → http://localhost:5173/ (opens automatically)
```

Production preview (what you demo/share):

```powershell
npm run build
npx vite preview --port 5174 --host   # → http://localhost:5174/
```

> The header shows a `build <date time>` stamp. If the app misbehaves after an
> update, check the stamp — a stale tab is the #1 cause. Hard-refresh with
> **`Ctrl+Shift+R`**, then reload your IFC file (models live in memory only).

## Features

- **Scratch concrete** — Beam/Slab/Column boxes with size + position.
- **Parametric rebar** — `straight, bent, crank, double_crank, c_link,
  c_link_with_hook, profile`; switch shape anytime (dimensions reset,
  position kept). `bent_up_down` / `hook_start`, diameters, rotation, planes.
  `profile` bars keep per-leg length + compass-heading parameters editable
  in a leg table (imported 1:1 from DXF section traces).
- **FreeCAD-style distribution** — Count/Spacing X·Y grid + offsets per bar;
  every copy drawn, weight uses total placed bars.
- **IFC4 reference** — load `.ifc` as ghost/solid geometry; per-level and
  per-element on/off, isolate, search, click-to-query properties (name, type,
  GlobalId, size/base in mm), 🎯 pick-to-place rebar, unit auto-detect +
  override, camera fit.
- **Section box (Revit-style)** — Faces (push/pull coloured grips), Move and
  Rotate gizmos, live mm size tag, **Test cut**, **Fit box**, **Solid cut**
  (filled cut faces) toggle.
- **Blender-style viewport** — unlimited zoom (dynamic clip planes +
  zoom-to-cursor), Solid / X-ray shading, FPS + camera readout in the status
  bar, collapsible panels.
- **True views (orthographic)** — Top, Bottom, Front, Back, Left and Right
  (toolbar `view ▾`, or a click on the axis gizmo) look exactly along the axis
  through a parallel camera, like the plan / elevation views of AutoCAD or
  Revit: no perspective, the same scale at every depth. Iso stays a perspective
  3D view. The pill under the gizmo ("Front · Orthographic") names the view and
  flips Perspective / Orthographic at any time (what you look at stays put).
  Orbiting keeps the current projection (the view reads "Free"); zoom-to-cursor,
  pan, Fit All, picking and the section box work in both. A bar pointing straight
  at the camera (a starter bar in the Front view, a vertical bar in the Top view)
  shows as a dot, like a rebar section in a drawing: a small dash when far away,
  the true round cross-section when you zoom in, and it can be clicked and selected.
- **Box & Lasso select** — the viewport toolbar's `⊞ Box [Shift+B]` and
  `➰ Lasso [Shift+L]` arm a one-shot selection: drag a rectangle or a free-form
  loop (Ctrl-drag adds to the selection, Esc cancels, a plain click just turns
  the tool off). A BBS row is selected when any bar of it actually touches the
  shape, in the perspective and the orthographic views alike (an end-on bar is a
  dot, so a loop around the dots works), so a shape in the gap between the copies
  of a wide set selects nothing. Hidden bars and members are skipped.
- **Snap-to-cover** — global cover (mm); 🎯 pick on a concrete/IFC face places
  the bar centreline cover + Ø/2 inside; stirrups fit to their host with one click.
- **Hide members & bars** — 👁 per concrete (hosted bars follow) and per bar;
  view-only, the schedule and CSV stay complete.
- **Measure** 📏 — click surfaces for points, live segment + total readouts,
  RMB removes last, Esc exits (view-only).
- **Snap on rebar** ⚓ — pick and measure snap to nearby bar ends/corners
  within a 14 px aperture (hidden bars excluded); 🧲 toggles it, and a pink
  magnet previews the exact landing spot on hover.
- **Auto-lap splice** 🔗 — click anchor + lapping bar (or dropdown + Apply);
  EC2 lap lengths by Ø and good/poor bond, collinear placement, one undo.
- **BBS table + CSV** — live cut lengths (bend deductions) and `D²/162`
  weights; one-click `rebar_scheduling.csv` export, CSV re-import.
- **Undo + save** — ↶ ↷ / Ctrl+Z / Ctrl+Y over bars, concrete and cover;
  💾 Save keeps your work in the browser and restores it on reload (IFC
  files reload by hand); ⤓/⤒ Project moves the project to another system
  as a `.json` file.

## Typical workflows

1. **From scratch:** Concrete tab → + Beam/Slab/Column → Rebar tab → + shape →
   set dims/position/distribution → BBS strip → Export CSV.
2. **From IFC:** Concrete tab → Load IFC4 → right rail toggles levels/elements
   → 🎯 Pick pos or type coordinates → detail bars against the ghost.
3. **Into FreeCAD:** take `rebar_scheduling.csv` → run `rebar_detailing.py`
   (reads the `Rebar_Type` column; extra columns are ignored).
4. **Coordination:** ⤒ Project opens one `.json` (replaces model), then
   **⤒+ Insert** merges another alongside it — concrete ids remap on clash,
   tags renumber, hosts follow (undoable).

## DXF plan → BBS importer (CLI)

Draft bar plans in CAD on the layer/tag protocol (`scripts/dxf_to_bbs.py`
header documents every keyword), then convert:

```powershell
# slab sample → bar_plan_bbs_auto.csv + bar_plan_bbs_auto_bbs.json
py scripts/dxf_to_bbs.py inputs/bar_plan_bbs.dxf

# 800 mm column sample (verticals + ties + base/top starters)
py scripts/dxf_to_bbs.py inputs/column_sample_800.dxf

# starter-section sample (drawn CIRCLEs, one starter bar each)
py scripts/dxf_to_bbs.py inputs/starter_bars.dxf --starter-host "P103 Stair Roof Slab"

# dia-ruled lengths / forced type+plane apply wherever tags are silent
# (tag L=/PLANE=/STRAIGHT always wins — see precedence below)
py scripts/dxf_to_bbs.py inputs/starter_bars.dxf --starter-type straight ^
  --starter-lengths "25:2000,40:3000,32:2500" --starter-plane YZ --starter-x 1500

# options: bond | stock length | fallback cover/gap | explicit output
py scripts/dxf_to_bbs.py inputs/bar_plan_bbs.dxf --bond auto --stock 12000 --cover 40 --gap 25 --out out.csv
```

(Windows venv without Python on PATH: use `.venv\Scripts\python.exe`
in place of `py`.)

- `--bond auto` (default: `B` marks good, `T` marks poor) or force `good`/`poor`.
- Bars over `--stock` split into lapped pieces (EC2 table); links/ties never split.
- Tag cheat-sheet: `101 H40-150 BOT MAIN`, `102 H40-150 BOT DIST ON=101`,
  `V1 VERT 8xH25 HOST=C1`, `T1 TIE SZ=150 HOST=C1`,
  `ST1 STARTER 8xH25 HOST=C1` (`AT=TOP` mirrors at the head).
- Open the `*_bbs.json` via ⤒ Project; the run log flags pairing guesses
  (`WARN … wins by N`), auto-zoned link fields (`NOTE`), and level sources
  (`zsrc=`) per bar.

### Drawn-circle starters (section detail)

Each `CIRCLE` is one starter bar: centre X = in-plane horizontal, centre Y =
elevation (App `Pos_z`), diameter = drawn diameter. Nearest open direction
line gives Length + aim fallback; nearest plain spec tag overrides everything:

```powershell
# tag syntax (all keywords optional, "=" optional):
#   L <len> ROT <deg: 0=+X, 90=+Y> [STRAIGHT | BENT] [H=<leg>]
#   [HOOK=START | END] [VIEW= | PLANE= XZ | YZ] [X= | Y= | Z= | POS Y <n>]
#   [H<dia> | DIA=] [HOST=] [GOOD | POOR]
# e.g. L 4700 ROT 270 STRAIGHT PLANE XZ POS Y 6600
```

- Output is transverse: main Length runs out of the section (XZ → ±Y,
  YZ → ±X, `Rot 0`), `ROT=` steers it as a plan compass; auto-plane keeps
  the length out-of-plane (aim ±X → YZ, ±Y → XZ).
- Bent (default) is hook-first with the run/corner seated **at** the circle
  elevation (upstand laps from underneath); `STRAIGHT` starts at the circle
  with no leg. Both protrude from the circle.
- Position: DXF X → App X (XZ) or App Y (YZ); the out-of-plane coordinate
  comes from tag `X=`/`Y=` (or `POS …`) else `--starter-x`/`--starter-y`.
- Host: tag `HOST=` wins per group, else `--starter-host` (lands in `Group`,
  links to a same-named concrete member on import; quoted names with spaces
  need the CLI flag).
- Precedence per bar: tag `L=` > `--starter-lengths` dia table >
  direction-line length > `--starter-length` (default 2000). `--starter-h`
  defaults the bent leg to max(150, 10·dia); `--starter-dia` pins the
  diameter; `--starter-mark` prefixes marks (`ST1…`); `--starter-z`
  overrides every elevation.
- Pairing is strictly nearest-tag-wins — one tag deep inside each
  length-zone; the log `WARN`s every close contest (`wins by N`) so
  re-run until zero WARNs for deterministic lengths.

### Drawn section profiles (`profile` bars)

Open section traces import verbatim — every leg length and heading stays an
editable parameter (leg table in the bar editor, add/remove legs):

```powershell
# tag next to each trace (needs H<dia>; nearest open 3+-pt polyline pairs):
#   PB1 PROFILE H25 [HOST=] [PLANE= XZ|YZ] [ROT=] [Z=] [X=|Y=] [GOOD|POOR]
py scripts/dxf_to_bbs.py inputs/additional_bar_shapes.dxf
```

- Legs are taken 1:1 as `[length, compass°]` (no crank/bend fitting);
  `DIMENSION` entities are ignored. Single piece (never stock-split),
  qty 1×1 — set copies/distribution in the app. Paired traces are
  consumed (no double chord rows); dia falls back to the `REBAR-H<dia>`
  layer; `PLANE XY` positions verbatim from the first vertex.
- `Pos` = first trace vertex (section X → App X on XZ / App Y on YZ),
  `Z=` wins else host bottom cover else 0; out-of-plane from tag or
  `--starter-x`/`--starter-y`.
- Plan cranks with no tags: `--profiles auto` converts every untagged
  open 3+-pt `REBAR-H/LINK` trace (dia from layer, XY unless
  `--starter-plane`, Z from `--starter-z` else 0); tagged bars keep
  their legacy straight-chord rows, and in plan 2-pt lines always stay
  straight: `py scripts/dxf_to_bbs.py inputs/Drawn_rebar.dxf --profiles auto`.
- Section drawings (`--profiles auto --starter-plane XZ|YZ`): the DXF is a
  section like the drawn-circle starters — X = in-plane horizontal, Y =
  **elevation**. Each trace's first vertex sets `Pos_z` (`--starter-z`
  pins every bar to one level instead), the out-of-plane coordinate comes
  from `--starter-y` (XZ) / `--starter-x` (YZ), and untagged 2-pt lines
  become straight bars in that plane (rot = chord angle, stock-split along
  the slope) that share the profiles' position, host and distribution.
  Diameters come from the layers (`REBAR-H20`, `REBAR-H25`), the host from
  `--starter-host`:
  ```powershell
  py scripts/dxf_to_bbs.py inputs/Drawn_rebar.dxf --profiles auto `
    --starter-plane XZ --starter-y 6600 --profile-n 20 `
    --profile-spacing -150 --profile-axis Y --starter-host "<concrete name>"
  ```
- Plane + position + distribution: `PLANE XZ` lays the section along X at
  fixed `Y=` (signed — either side), `PLANE YZ` along Y at fixed `X=`;
  copies distribute one-sided from `Pos` via tag `N=` + signed `SP=` +
  `AXIS=X|Y|Z` (axis defaults out-of-plane: XZ→Y, YZ→X, XY→X) or the
  `--profile-n` / `--profile-spacing` / `--profile-axis` flags, e.g.
  `--profile-n 4 --profile-spacing -150 --profile-axis Y` steps four
  planes at 0/−150/−300/−450.
- Schedule: shape 99 (special), cut length in A with per-turn bend
  deductions; `legs` round-trips through CSV/project JSON.

## Large projects (BarField renderer)

Projects with hundreds of thousands to millions of physical bars stay interactive: bars are drawn in
spatial chunks as merged lines when far away and as instanced tubes near the camera, a small selection
and just-edited bars use the classic highlighted tube look, and the pixel ratio drops while the camera
moves.

- **Detail** (status bar, next to the fps readout): *Auto* (default, lines far / tubes near), *Lines*
  (fastest), *Tubes* (always tubes; slow on very large projects). Saved in the browser.
- A small selection (up to about 400 bar copies) is drawn as classic white-highlighted tubes on top; a
  bigger one (for example "All", or a row with thousands of copies) is tinted white in place so that
  selecting many rows stays fast.
- `?renderer=legacy` forces the old one-mesh-per-bar renderer (also used automatically without WebGL2).
- If the new renderer cannot be built, the classic renderer shows the first 20,000 bars and a notice.
- Measure and Pick-to-place still snap to bars (ends, midpoints, nearest points); a click that is not near
  a snap point no longer lands on the surface of a bar that is not selected.
- `scripts/perf/` measures it (synthetic projects, headless Edge on the real GPU):
  `node scripts/perf/gen_project.mjs 25000 40 p1m 7`, then
  `node scripts/perf/cdp_bench.mjs --url http://127.0.0.1:5188/ --project scripts/perf/out/p1m.json --expect 1002336 --budget p1m --enforce`.
  `node scripts/perf/check_field.mjs --url http://127.0.0.1:5188` checks placement, clipping, picking,
  edits, bulk changes and the fallback against the legacy renderer. See `scripts/perf/README.md`.
- Still slow at very large scale (separate follow-ups): the BBS table and bar dropdown render every row
  (the table takes seconds to render 25,000 rows), undo clones the whole bar list, Save uses
  `localStorage` (about 5 MB), and Measure / Pick snapping scans every bar.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Old behaviour after an update | Check header build stamp → `Ctrl+Shift+R` → reload IFC |
| Port 5173 busy / blank | `npm run dev -- --port 5174`, or kill the node process owning the port |
| IFC rejected | Only **IFC4** (`FILE_SCHEMA` gate); IFC2x3 is refused with a message |
| Levels section empty | Large models (>1000 elements) fall back to type-level control |
| Section caps look wrong / slow | Toggle **Solid cut** off (hollow view); caps add per-plane passes |
| Ghost too faint / too solid | Ghost ◧ / Solid ◼ toggle + opacity slider in the IFC rail |

## Limits (honest)

- IFC is a **reference ghost**, not editable BIM: renames/level moves are
  view annotations (kept per-file in the browser); the `.ifc` file is never
  modified. No IFC2x3 support.
- Section box is axis-aligned by default with a rotate gizmo; cut faces are
  flat fills (no hatch), capped via stencil (needs a stencil-capable GPU —
  universal on real hardware).
- BBS math is straight/hook/bend-deduction lengths + unit weights, not a full
  BS 8666 scheduler (shape codes, laps beyond the FreeCAD fields).

## Project structure

```
src/
  App.jsx            layout + panels + toolbar + BBS strip
  store.js           zustand state (bars, concrete, IFC meta, section)
  bbs/               shapes, BBS math, FreeCAD-compatible CSV
  viewer/            Scene, IFC model, FitIfc, SectionBox, planes, stencil mats,
                     CameraRig + cameraMath/cameraOps (perspective / orthographic views)
  ifc/               WASM loader session, control panel, units
public/web-ifc.wasm  IFC parser (must match bundled web-ifc version)
agent.md             contributor/agent conventions · overview.md  architecture
```

Built with Vite + React + Three.js (`@react-three/fiber/drei`) + zustand +
`web-ifc-three`. See `agent.md` before contributing.
