# Changelog — barbending progress record

## Unreleased (working tree → next push)

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
- Possible follow-ups: hatch-pattern caps, BS 8666 shape codes + 2D bending
  diagrams, DXF/SVG export.
