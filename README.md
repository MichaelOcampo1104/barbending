# barbending — browser bar-bending schedule (BBS)

Draw concrete and rebar in 3D, optionally over your own IFC4 model, and export
a `rebar_scheduling.csv` that loads straight into the FreeCAD rebar macros.
Runs entirely in the browser — no server, no upload, no install beyond `npm`.

## Quickstart

```powershell
cd "C:\Users\Michael Ocampo\Documents\P_Files\barbending"
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
  c_link_with_hook`; switch shape anytime (dimensions reset, position kept).
  `bent_up_down`, diameters, rotation, planes.
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
- **BBS table + CSV** — live cut lengths (bend deductions) and `D²/162`
  weights; one-click `rebar_scheduling.csv` export, CSV re-import.

## Typical workflows

1. **From scratch:** Concrete tab → + Beam/Slab/Column → Rebar tab → + shape →
   set dims/position/distribution → BBS strip → Export CSV.
2. **From IFC:** Concrete tab → Load IFC4 → right rail toggles levels/elements
   → 🎯 Pick pos or type coordinates → detail bars against the ghost.
3. **Into FreeCAD:** take `rebar_scheduling.csv` → run `rebar_detailing.py`
   (reads the `Rebar_Type` column; extra columns are ignored).

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
  viewer/            Scene, IFC model, FitIfc, SectionBox, planes, stencil mats
  ifc/               WASM loader session, control panel, units
public/web-ifc.wasm  IFC parser (must match bundled web-ifc version)
agent.md             contributor/agent conventions · overview.md  architecture
```

Built with Vite + React + Three.js (`@react-three/fiber/drei`) + zustand +
`web-ifc-three`. See `agent.md` before contributing.
