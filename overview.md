# overview.md — barbending architecture

## What it is

A lightweight, browser-only bar-bending-schedule (BBS) workstation. Model
concrete hosts (scratch boxes and/or an IFC4 reference model) and parametric
rebar in a Three.js viewport, and export `rebar_scheduling.csv` that loads
straight into the existing FreeCAD rebar macros. No backend, no database;
everything runs from static files.

## Layout

```
┌──────────────────────────────────────────────────────────────┐
│ header  barbending · subtitle · build <UTC stamp>            │
├──────────┬──────────────────────────────────┬────────────────┤
│ left     │  3D viewport (Three.js)          │ right          │
│ Rebar /  │  orbit · rebar tubes · concrete  │ IFC control    │
│ Concrete │  ghosts · IFC subsets · section  │ (after load)   │
│ tabs     │  box · toolbar overlays          │                │
├──────────┴──────────────────────────────────┴────────────────┤
│ BBS strip: rows · totals · export / import CSV               │
└──────────────────────────────────────────────────────────────┘
```

## Modules

| Path | Role |
|---|---|
| `src/App.jsx` | Layout + all panels (BarEditor, ConcreteEditor, ViewportBar, BbsStrip) |
| `src/store.js` | zustand store: bars, concretes, selection, IFC meta, section box |
| `src/bbs/shapes.js` | 6 shape generators → 3D polylines + cut lengths; `distCount`/`distOffsets` distribution grid; `applyTypeDefaults` for shape switching |
| `src/bbs/calc.js` | `D²/162.2` unit weights, bend deductions |
| `src/bbs/csv.js` | FreeCAD-compatible CSV export/import (`MASTER_HEADERS` superset) |
| `src/viewer/Scene.jsx` | Canvas, lights, grid, `RebarMesh` (tube per bar × distribution copies), `ConcreteMesh` |
| `src/viewer/IfcModel.jsx` | (lazy) IFC subsets, ghost/solid materials, click-select + highlight, pick-to-place |
| `src/viewer/FitIfc.jsx` | Camera fit to IFC bbox |
| `src/viewer/SectionBox.jsx` | Revit-style section box: push/pull faces, move/rotate gizmos, stencil cap quads, size tag |
| `src/viewer/sectionPlanes.js` | 6 shared world-space clip planes (mutated in place), box math, state migration |
| `src/viewer/stencilMats.js` | Shared stencil mark + cap materials (created once) |
| `src/ifc/session.js` | WASM loader singleton, `loadIfc`/`unloadIfc`, `collectStoreys`, index-aware `subsetBox` |
| `src/ifc/IfcPanel.jsx` | Right-rail outliner (levels → types → elements), search, opacity, units, property editor |
| `src/ifc/units.js` | Unit choice table (static-safe import) |

## Data flows

**Rebar:** form edit → `updateBar` → `genBarPoints` (local mm polyline) →
`TubeGeometry` per distribution copy + `enrichBar` (cut length, `qty×qty_x×qty_y`
weight) → BBS row → CSV export.

**IFC load:** file → `arrayBuffer` → STEP header sniff (IFC4 gate + unit regex) →
`IFCLoader.parse` (`COORDINATE_TO_ORIGIN`) → per-type id lists → per-element
subsets (+ names/GlobalIds/storeys/sizes) → three group + zustand meta →
outliner, camera fit. >1000 elements degrades to per-type subsets.

**Section:** box state `{enabled, mode, center, size, quat, solidCut}` →
`updateSectionPlanesBox` mutates the 6 shared planes → all clipped materials
(rebar, concrete, IFC ghost/highlight) cut live. Solid-cut mode adds stencil
mark children (no colour/depth writes) + cap quads filled where stencil ≠ 0,
cleared per face via imperative `onAfterRender`.

## Key conventions

- Lengths in state are **mm**; scene graph is **metres**; IFC metadata keeps
  **raw file units** and scales at render/fit time.
- Clipping plane array identity and length never change (only constants and
  normals mutate) so materials never recompile.
- Parser (~6 MB) stays out of the initial bundle via dynamic import + lazy
  component; verified in build output (`session-*.js` chunk).
- In-memory only: reloads drop the model, the box, and unexported edits
  (IFC view annotations persist per-file in `localStorage`).
