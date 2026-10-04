# Changelog — barbending progress record

## Unreleased (working tree → next push)

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
