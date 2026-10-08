# Standalone viewer: one-file `.html` export with a section box — design

Date: 2026-10-08 · Status: design approved in conversation, pending written-spec review
Branch: `feat/standalone-viewer`

## 1. Purpose and scope

When modelling and the BBS are done, the model should leave the app as **one lightweight file that anyone can open
in a browser, with nothing installed**, and that also works as the saved model. This spec adds a **`⤓ Viewer`**
export to the app. It writes one `.html` file holding the whole project and a read-only viewer with a section box.

A throwaway prototype (`prototype-viewer/`, untracked, deleted when this lands) proved the approach on the user's
Ent3 model: a 627 KB file that opens from `file://` in about 0.5 s with totals identical to the app's and 60 fps
while orbiting. The same viewer around a 1,002,336-bar project is 1.5 MB, opens in 1.2 s and orbits at 45 fps. This
spec turns the prototype into a feature and adds the section box.

### In scope

- A **`⤓ Viewer`** button in the app header: a title prompt, then the download of `barbending-viewer-….html`.
- The viewer (`src/standalone/`): 3D bars and concrete members, orbit / zoom / pan, Iso and the six true
  orthographic views, a perspective / orthographic switch, click-a-bar details, the BBS table (sortable, filterable,
  windowed), a diameter legend that hides and shows bars, a concrete toggle, end-on bars shown as dots, and a
  download of the project `.json`.
- A **section box** in the viewer with the app's controls: Section on / off; Faces (push / pull grips), Move and
  Rotate; Fit box; Test cut; Solid cut; show / hide the box; a size readout.
- Opening an exported `.html` in the app: `⤒ Project` and `⤒+ Insert` accept `.html`, so the file doubles as the save.
- A build step that produces `public/viewer-template.html`; `npm run dev` and `npm run build` run it.
- The pure section-box math moved into one module shared by the app's `SectionBox.jsx` and the viewer.
- Unit tests, a browser check (`scripts/perf/check_standalone.mjs`) and docs.

### Out of scope

The IFC reference model (27 MB would defeat the point); drawing reference lines (their data is kept in the file);
measure, query and snap tools; editing in the viewer; hosting or share links; printing; several models in one file;
the legacy renderer; a phone-specific layout beyond what pointer events give for free; saving the section-box state
in the file.

## 2. Decisions taken in the design conversation

1. One self-contained `.html` file: no server, no install, no network. (Chosen over glTF / GLB, which stores every bar
   as a mesh, carries no BBS and needs a viewer site, and over hosting the app, which needs internet and a host.)
2. The model travels as the app's parametric rows, not meshes, so the file stays small (the Ent3 data is about 22 KB
   gzipped) and the viewer rebuilds the geometry with the app's own code.
3. The section box matches the app's, including Move, Rotate and Solid cut. Solid cut (the filled cut faces) is the
   riskiest part; if it cannot be made reliable in the viewer it ships switched off and the CHANGELOG says so.
4. The file embeds everything `⤓ Project` saves (reference lines and selection included), though the viewer draws
   only bars and concrete.
5. IFC models are not included.
6. The same file reopens in the app.
7. The viewer is shipped as a generated template that the app fills in at export time, not bundled into the app.

## 3. Success criteria

Measured on the reference machine (Intel UHD, headless Edge, 1600×900, device pixel ratio 1), opening the file from
`file://`.

| Criterion | Budget |
|---|---|
| Viewer file for the Ent3 model (1,680 rows, 3,848 bars) | ≤ 0.8 MB |
| File for the 1M-bar synthetic project (25,000 rows) | ≤ 1.8 MB, opens in ≤ 3 s, orbits at ≥ 30 fps |
| Viewer script, minified | ≤ 0.8 MB |
| Export in the app at 1M bars (pack and download) | ≤ 3 s |
| Totals line in the viewer against the app's status line (rows, bars, kg, m³, kg/m³) | identical |
| Importing the exported file back into the app | bars, concretes, reference lines, cover and bond deep-equal the original |
| Section box: a cut agrees with the planes to 1 px; a face drag changes the size by exactly the pointer's movement along that axis; Solid cut fills the cut face of a concrete member | pass in the browser check |
| Existing checks (`check_field` 60, `check_views` section, `check_select` 45) and lint | unchanged |

### 3.1 Evidence behind the design (prototype, measured)

| Model | `.html` size | Zipped | Opens | Orbit |
|---|---|---|---|---|
| Ent3 (3,848 bars) | 627 KB | 175 KB | 0.4–0.6 s | 60 fps |
| 1M bars (25,000 rows) | 1,502 KB | 835 KB | 1.2 s | 45 fps |

The Ent3 project data is 805 KB as compact JSON and 22 KB gzipped (the saved project file, pretty-printed, is 1.17 MB and
25 KB gzipped). The viewer script is 592 KB minified (151 KB
gzipped), nearly all of it three.js. three's `TransformControls` is 50 KB of source, so Move / Rotate plus the
section-box code should add roughly 50–70 KB. The built app cannot be opened by double-click (module scripts load
from absolute `/assets/` paths), which is why a purpose-built single file is needed.

## 4. Architecture

### 4.1 Modules

| Path | Role |
|---|---|
| `src/standalone/pack.js` | Pure, used by the app and by Node tests. `packViewerHtml(template, project, { title })` and `extractProjectFromHtml(html)` (both async: gzip + base64), the token constants and the format version. Never bundled into the viewer. |
| `src/standalone/viewer.js` | The viewer entry, bundled to one IIFE. Vanilla JS on three.js. |
| `src/standalone/sectionBox.js` | The viewer's section box (state, planes, visuals, grips, gizmos, caps, panel). |
| `src/standalone/template.html` | The page shell and CSS, with the tokens of 4.3. |
| `src/viewer/sectionBoxMath.js` | Pure section-box math shared with `SectionBox.jsx` (6.9). |
| `scripts/build-viewer.mjs` | Bundles the viewer and writes the template (section 8). |
| `public/viewer-template.html` | Generated, git-ignored. |
| `src/App.jsx` | The `⤓ Viewer` button and the `.html` import. |

Reused unchanged by the viewer: `bbs/shapes.js`, `bbs/csv.js` (`enrichBar`, `concreteVolumeM3`), `barfield/buildField.js`,
`fieldObjects.js` (`FieldView`), `fieldShaders.js`, `lod.js`, `endOn.js`, `fieldPick.js`, `rowState.js`,
`qualityState.js`, `cameraMath.js`, `cameraOps.js`, `regionSelect.js` (`rowAppBox`), `sectionPlanes.js`, `stencilMats.js`.

### 4.2 Export flow

`⤓ Viewer` → title prompt → fetch `viewer-template.html` → `packViewerHtml(template, store._projectData(), { title })` →
download. The payload is the object `⤓ Project` saves, plus the title.

### 4.3 File format

The template contains exactly two tokens: `@@BARBENDING_TITLE@@` (in `<title>`, HTML-escaped on insertion) and
`@@BARBENDING_DATA@@` inside `<script id="model-data" type="text/plain">`. The data is base64 of the gzip of
`JSON.stringify({ ...project, viewerFormat: 1, title })`; `project` is the `_projectData()` object (`v: 1`, `app`,
`savedAt`, `bars`, `concretes`, `refLines`, `cover`, `bond`, `selectedBar`, `selectedBars`). A leading HTML comment
records the viewer build and the format. `packViewerHtml` throws unless each token occurs exactly once in the template;
`extractProjectFromHtml` throws `not a barbending viewer file` when the data element is missing or unreadable, and
`made by a newer barbending viewer` when `viewerFormat` is above the supported value. Compression uses
`CompressionStream` / `DecompressionStream` (Chrome and Edge 80+, Safari 16.4+, Firefox 113+); base64 is produced in
chunks so large payloads do not overflow the call stack.

## 5. The viewer

- **Renderer**: `WebGLRenderer({ antialias: true, stencil: true, powerPreference: 'high-performance' })`, ACES tone mapping,
  `localClippingEnabled = true`, the app's lights, background and grid colours; the grid cell is a 1-2-5 step giving about
  14 cells across the model. The pixel ratio is capped at 2; on `(pointer: coarse)` devices (phones and tablets) it is capped
  at 1.5 and the tube triangle budget is 1.5 million instead of 5 million. Render on demand: a frame is drawn only when the camera, a tween, the selection or the section box changes.
- **Header**: the title, the totals line and the saved date; the seven view buttons; Fit all; the Concrete toggle; the diameter
  legend (it hides and shows bars); `⤓ Project`, which downloads the embedded project as a `.json` the app opens; the `BBS`
  panel toggle; and the `◫ Section` toggle.
- **Cameras**: a perspective and an orthographic camera, one `OrbitControls` each, switched with the app's
  `switchProjection`; view presets slerp the camera direction; Fit uses the app's fit maths. Wheel zoom goes to the cursor.
- **Bars**: `buildField` on the main thread, `FieldView` for lines / tubes with the app's LOD and end-on dots, row states
  for hidden (hidden members, the diameter legend) and the white tint of the selected row.
- **Picking**: the app's `pickField` on a `Raycaster` ray; with the section box on, hits outside the box are rejected with
  `isWorldPointInSectionBox`, as in the app.
- **BBS table**: rows from `enrichBar` (the app's numbers), windowed so 25,000 rows stay smooth, sortable, filterable;
  a click selects the row and zooms to it. Totals line identical to the app's status line.
- **Test hooks**: `window.__viewer` and `preserveDrawingBuffer` exist only when the URL has `?autotest`.
- **Errors**: no WebGL, no `DecompressionStream`, or unreadable data each show a plain message instead of a blank page.

## 6. The section box

### 6.1 State

The app's shape, normalised with `normalizeSection`: `{ enabled, mode: 'faces' | 'translate' | 'rotate', center, size,
quat, solidCut, showBox }`, in scene metres. It lives in the viewer for the session only. Turning Section on for the
first time sets the box to the model bounds padded by `max(0.2 m, 2% of the model's largest extent)` (the same as Fit box); later toggles keep the
last box. A selected row stays selected.

### 6.2 Clipping

The shared `sectionPlanes` are updated in place with `updateSectionPlanesBox` whenever the box changes. Bars use the
clipped `FieldView` programs while Section is on (`FieldView.setClipping`) and the faster unclipped ones when it is off.
Concrete meshes and their edge lines carry `clippingPlanes: sectionPlanes` always (the planes are enormous when off).
The grid and the box's own visuals are not clipped.

### 6.3 Visuals

A translucent box (`#38bdf8`, 5% opacity, no depth write) with edge lines, in a group that carries the box's position and
rotation. Hidden with `👁 Box`; the cut stays active, and the grips and gizmos disappear with it.

### 6.4 Faces (push / pull)

Six axis-coloured grips (red, green, blue) on leader lines outside the faces. Unlike the app's fixed 0.3 m cubes, the
grips keep a **constant size on screen** (a world size proportional to the camera distance, or to `1 / zoom` for the
orthographic camera) so they work at any model scale. Each grip has a hit area twice its visible size. A press on a grip
(captured before the orbit controls) starts a drag: orbit is disabled, the new size comes from `closestAxisParam` along
the face normal exactly as in the app, never below 50 mm, and the centre moves by half the change. Pointer events only
(mouse, touch, pen); a `blur` or `pointercancel` ends the drag and re-enables orbit.

### 6.5 Move and Rotate

three's `TransformControls` (`three/addons`) attached to the box group in `translate` / `rotate` mode; its drag
disables orbit; each change writes `center` and `quat` back to the state and updates the planes. Faces grips show only in
Faces mode.

### 6.6 Solid cut

Reuses `stencilMats.js` and the app's technique exactly: for each concrete mesh, six pairs of stencil-mark meshes
(back faces increment, front faces decrement, per plane, with `renderOrder` `3i` and `3i + 1`, not raycastable) and six
cap quads in the box group (`capMaterial(i)`, `renderOrder` `3i + 2`, `onAfterRender` clearing the stencil). Quad
transforms come from the shared `capQuad`. Rebar is not capped (as in the app). The renderer needs `stencil: true`.

### 6.7 Panel

A floating panel at the top left of the viewport, shown while Section is on, under a `◫ Section` toggle in the header:
the Faces | Move | Rotate selector, `Fit box`, `Test cut` (a third of the current size on each axis around the same centre, never below 50 mm),
`Solid cut`, `👁 Box`, and the size readout `2,667 × 1,333 × 2,667 mm`. (A readout in the panel replaces the app's
floating 3D label.)

### 6.8 Not carried over

The app's `Fit box` for an IFC model (there is no IFC in the viewer) and the `?captest` / `?oneplane` diagnostics.

### 6.9 Shared math (`src/viewer/sectionBoxMath.js`)

Extracted from `SectionBox.jsx` with the behaviour unchanged and used by both: `FACES`, `AXIS_COLORS`, `MIN_THICK`,
`capQuad(i, size)`, and a new pure `faceDragResult({ startCenter, startSize, axis, normal, delta })` returning
`{ center, size }` (what `applyDrag` computes today), plus `testCutSize(size)` and `boxFromBounds(min, max, pad)` for the
viewer. The app's section behaviour is protected by the existing browser checks, which are re-run after the refactor.

## 7. App integration

- **Export button** `⤓ Viewer` next to `⤓ Project`. The title prompt (`window.prompt`) defaults to `barbending model`;
  cancelling aborts; the title is trimmed and limited to 80 characters. The file name is
  `barbending-viewer-<slug>-<YYYYMMDD-HHMM>.html`, the slug being the title lower-cased with runs of other characters
  turned into `-` (omitted for the default title). While packing the button reads `Building…` and is disabled;
  failures use `alert`, as the other header buttons do. If the template cannot be fetched the message is
  `The viewer template is missing: run "npm run build:viewer", then reload.`
- **Import**: `⤒ Project` and `⤒+ Insert` accept `.json` and `.html`. A file whose name ends in `.html`, or whose text
  starts with `<`, goes through `extractProjectFromHtml` and then the existing `importProject` / `appendProject`;
  anything else is parsed as JSON as today.

## 8. Build integration

`scripts/build-viewer.mjs` runs Vite's `build()` in library mode (IIFE, minified, `three` bundled) on
`src/standalone/viewer.js`, inlines the result into `src/standalone/template.html` (replacing `@@BARBENDING_SCRIPT@@` and
`@@BARBENDING_BUILD@@`), checks that the remaining two tokens occur exactly once and that the script contains none of
them, escapes `</script` in the script, writes `public/viewer-template.html` and prints the sizes. `package.json` gains
`build:viewer`, `predev` and `prebuild`; `.gitignore` gains `public/viewer-template.html`. A failing build aborts
`dev` / `build`. Vite copies `public/` to `dist/`, so the preview and any static host serve the template at
`viewer-template.html` (fetched relative to `import.meta.env.BASE_URL`). The dev server does not watch the viewer source:
after changing it, run `npm run build:viewer` (documented in `agent.md`).

## 9. Testing

Unit tests (`npm test`, `tests/standalone/`):

- `pack.test.mjs`: pack then extract returns the payload; a Unicode title and `</script>` inside a title or a bar mark are
  safe; a missing or duplicated token throws; a 25,000-row payload round-trips; non-viewer HTML, corrupt base64 and a newer
  `viewerFormat` are rejected with the messages of 4.3.
- `sectionBoxMath.test.mjs`: `faceDragResult` on each axis and sign for an axis-aligned and a rotated box, the 50 mm clamp
  and the centre shift; `testCutSize`; `boxFromBounds`; `capQuad` against the six values `SectionBox.jsx` uses today.

Browser check `scripts/perf/check_standalone.mjs` (headless Edge, trusted mouse and key events), on the production
preview and on a dev server:

- `export`: from the real app, import a known project, click `⤓ Viewer`, capture the download; the file is within budget
  and contains the data.
- `viewer`: opened from `file://` with `?autotest`: ready in budget, the totals line equals the app's, a click picks, the
  table sorts and filters, the six views are orthographic, end-on bars show as dots, the legend hides a diameter.
- `section`: Test cut clips the bars to the expected width (pixel measure); a face-grip drag changes the size by the
  pointer's movement along the axis; Move and Rotate attach their gizmos; Solid cut fills the cut face of a concrete
  member; `👁 Box` hides the box but keeps the cut; a click on a cut-away bar does not select it.
- `roundtrip`: import the exported `.html` into the app; the bars, concretes and reference lines equal the original.
- `scale`: the 1M-bar file's size, open time, export time and orbit rate against section 3.

Existing checks re-run after the `SectionBox.jsx` refactor: `check_field.mjs`, `check_views.mjs --only section`,
`check_select.mjs`. Lint stays at its baseline.

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Solid cut (stencil caps) misbehaves in vanilla three | Same materials, order and clears as the app, a pixel check, and the agreed fallback: ship it off and say so. |
| The `predev` / `prebuild` hook adds a few seconds, and an outdated template after a viewer change | Documented `npm run build:viewer`; the export button names the fix when the template is missing. |
| Old browsers lack compression streams | A plain message in the viewer; the app is already modern-browser only. |
| A million-bar model builds on the main thread (about 1 s) | A "Building…" screen; measured in the `scale` check. |
| Weak GPUs or phones | Tube budget and pixel ratio lowered for coarse pointers; no adaptive quality in v1. |
| Touch handling of grips | Pointer events, `touch-action: none`, a doubled hit area; tried with synthetic pointers in the check, not on a real phone. |

## 11. Work breakdown (the implementation plan will detail it)

1. `pack.js` with its tests.
2. `sectionBoxMath.js` extracted from `SectionBox.jsx` with its tests; the app's section checks re-run.
3. Move the prototype into `src/standalone/`, the build script, the npm hooks and the git-ignore; the viewer at parity with the prototype.
4. The `⤓ Viewer` button, the title prompt, the template fetch and the download.
5. `.html` import in `⤒ Project` and `⤒+ Insert`.
6. Viewer section box core: state, planes, clipping, panel (toggle, Fit box, Test cut, `👁 Box`, readout).
7. Faces grips.
8. Move and Rotate.
9. Solid cut.
10. `check_standalone.mjs`, run on preview and dev, plus the 1M-bar scale run.
11. Docs: README, `agent.md`, `overview.md`, the perf README; the CHANGELOG entry when recorded. Delete `prototype-viewer/`.
