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
│ BBS panel: find · groups · windowed table · export / import  │
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
| `src/bbs/tableView.js` | Pure logic of the bottom BBS panel's table (Node-tested): the flat item list of group headers and rows (`flattenItems`), the window of rows to draw (`windowRange`, `clampScrollTop`), where to scroll to a row (`revealTop`), the find box (`makeRowFilter`, `filterGroups`), ▦ group grouping (`groupBySet`) and the Groups list order (`orderGroups`) |
| `src/bbs/BbsTable.jsx`, `BbsGroups.jsx` | The panel's windowed table (fixed 28 px rows, pinned group header, follows a selection made elsewhere) and its Groups overview (members and ▦ groups with totals, click to jump) |
| `src/viewer/Scene.jsx` | Canvas, lights, grid, `RebarMesh` (tube per bar × distribution copies; now only the selected / just-edited rows, `BarField` draws the rest), `ConcreteMesh`, `DiveZoom` (stall-free wheel dives), `PickHandler`, `RegionSelect` (box / lasso select), `MeasureHandler` + `MeasureView` (ephemeral measure) |
| `src/viewer/barfield/*` | Default bar renderer: worker-built chunked segments, line / instanced-tube LOD, row-state texture, ray picker, adaptive quality (`BarField.jsx` composes them) |
| `src/viewer/CameraRig.jsx` | Owns the two cameras (perspective + orthographic) and their OrbitControls; keeps `state.camera` / `state.controls` on the active pair and switches projection from the store (`projection`) without changing what you look at |
| `src/viewer/cameraMath.js` | Pure camera math (Node-tested): the preset view offsets / labels, `viewFromForward`, perspective ↔ orthographic zoom / distance, ortho zoom limits and zoom-about-cursor shift, fit zoom, `viewMetrics` |
| `src/viewer/cameraOps.js` | The few imperative camera / controls mutations (`switchProjection`, `setOrthoZoom`, `enableControls`), kept out of components for the React-compiler lint rules and so Node tests can run them |
| `src/viewer/AxisGizmo.jsx`, `ViewBadge.jsx` | Axis gizmo (heads request the exact true views) and the "Front · Orthographic" pill that names the view and toggles the projection |
| `src/viewer/regionSelect.js` | Pure geometry of the Box and Lasso tools: the shapes (`boxRegion`, `lassoRegion`), segment-vs-shape tests, projection of every bar copy through the camera's matrix with near / far clipping, and `selectBarsInRegion` (a row is selected when any of its bars touches the shape) |
| `src/viewer/barfield/endOn.js` | Pure helpers for end-on bars (a bar pointing straight at an orthographic camera): per-vertex axis tags written by `buildField`, and the axis a camera looks along; the line shader draws such bars as a dash, the tube shader as a disc |
| `src/viewer/tubeCaps.js` | Flat end caps for the classic rebar tube (`RebarMesh`), so a selected bar seen end-on shows as a disc |
| `src/viewer/IfcModel.jsx` | (lazy) IFC subsets, ghost/solid materials, click-select + highlight, pick-to-place |
| `src/viewer/FitIfc.jsx` | Camera fit to IFC bbox |
| `src/viewer/SectionBox.jsx` | Revit-style section box: push/pull faces, move/rotate gizmos, stencil cap quads, size tag |
| `src/viewer/sectionPlanes.js` | 6 shared world-space clip planes (mutated in place), box math, state migration |
| `src/viewer/stencilMats.js` | Shared stencil mark + cap materials (created once) |
| `src/viewer/sectionBoxMath.js` | Pure section-box maths shared by `SectionBox.jsx` and the standalone viewer: the faces, cap quads, the face-drag result, the Test cut size, the default box from bounds, the world size of a pixel (constant-size grips) |
| `src/standalone/pack.js`, `codec.js` | The single-file viewer format: fill the template with the title and the gzipped base64 project (`packViewerHtml`), read it back (`extractProjectFromHtml`, `parseProjectFile`) |
| `src/standalone/exportViewer.js` | Fetches the generated viewer template for `⤓ Viewer` (and recognises a dev server's `index.html` fallback) |
| `src/standalone/viewer.js`, `sectionBox.js`, `template.html` | The viewer inside the exported file: vanilla JS on three.js reusing the app's pure modules, its section box (grips, move / rotate gizmo, solid-cut caps) and the page shell; `scripts/build-viewer.mjs` bundles them into `public/viewer-template.html` |
| `src/ifc/session.js` | WASM loader singleton, `loadIfc`/`unloadIfc`, `collectStoreys`, index-aware `subsetBox` |
| `src/ifc/IfcPanel.jsx` | Right-rail outliner (levels → types → elements), search, opacity, units, property editor |
| `src/ifc/units.js` | Unit choice table (static-safe import) |

## Data flows

**Rebar:** form edit → `updateBar` → `genBarPoints` (local mm polyline) → BarField
(segments per distribution copy in chunks; the edited row shows as a classic tube until it moves
into a delta chunk) + `enrichBar` (cut length, `qty×qty_x×qty_y` weight) → BBS row → CSV export.

**IFC load:** file → `arrayBuffer` → STEP header sniff (IFC4 gate + unit regex) →
`IFCLoader.parse` (`COORDINATE_TO_ORIGIN`) → per-type id lists → per-element
subsets (+ names/GlobalIds/storeys/sizes) → three group + zustand meta →
outliner, camera fit. >1000 elements degrades to per-type subsets.

**Views:** toolbar `view ▾` / gizmo head → `requestView(name)` (also sets `projection`: orthographic
for Top / Bottom / Front / Back / Left / Right, perspective for Iso) → `ViewPreset` slerps the camera
direction on the orbit sphere to the exact axis offset → `CameraRig` switches the active camera + controls
when `projection` changes (same target, same direction, same visible region on the target plane) and
publishes `viewName` from the camera direction every frame, which labels the dropdown and the pill.

**Region select:** toolbar `⊞ Box` / `➰ Lasso` or Shift+B / Shift+L → `selectTool` ('box' | 'lasso') → one LMB drag
in `RegionSelect` draws the rectangle / loop (an SVG overlay) → `selectBarsInRegion` projects every copy of every
visible bar through the active camera and keeps the rows that touch the shape → `setSelectedBars`; the tool then
disarms (Esc too). Orthographic and perspective share the code, which only needs the camera's view-projection matrix.

**Section:** box state `{enabled, mode, center, size, quat, solidCut}` →
`updateSectionPlanesBox` mutates the 6 shared planes → all clipped materials
(rebar, concrete, IFC ghost/highlight) cut live. Solid-cut mode adds stencil
mark children (no colour/depth writes) + cap quads filled where stencil ≠ 0,
cleared per face via imperative `onAfterRender`.

**Viewer export:** `⤓ Viewer` → title prompt → `loadViewerTemplate` (fetch `viewer-template.html`) → `packViewerHtml(template,
_projectData(), { title })` (gzip + base64 into the template's data element) → download one `.html`. Opening it: the page's script
reads the data (`DecompressionStream`), rebuilds the rows with `enrichBar` and the field with `buildField` / `FieldView`, and renders on
demand; `⤒ Project` in the app reads the same data back with `extractProjectFromHtml`.

## Key conventions

- Lengths in state are **mm**; scene graph is **metres**; IFC metadata keeps
  **raw file units** and scales at render/fit time.
- Clipping plane array identity and length never change (only constants and
  normals mutate) so materials never recompile.
- Parser (~6 MB) stays out of the initial bundle via dynamic import + lazy
  component; verified in build output (`session-*.js` chunk).
- In-memory only: reloads drop the model, the box, and unexported edits
  (IFC view annotations persist per-file in `localStorage`).
