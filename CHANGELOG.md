# Changelog — barbending progress record

## Unreleased (working tree → next push)

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
  diagrams, snap-to-cover placement, DXF/SVG export.
