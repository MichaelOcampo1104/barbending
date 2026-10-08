# Standalone viewer (single-file `.html` export with a section box) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `⤓ Viewer` export that writes the whole model as ONE self-contained `.html` file (3D bars and concrete, BBS table, a section box) that opens in any recent browser with nothing installed, and that the app can open again as a project file.

**Architecture:** A pure `pack.js` gzips the project JSON into base64 and drops it, with the title, into a generated template (`public/viewer-template.html`) that the app fetches at export time. The template holds a vanilla-JS viewer (`src/standalone/viewer.js`) bundled with three.js and the app's own pure modules (bar geometry, the chunked line / tube renderer, picking, camera maths, the section planes and stencil materials) by a Vite library build. The section box math moves out of `SectionBox.jsx` into a pure shared module so the app and the viewer cannot drift apart.

**Tech Stack:** Vite 8 (rolldown, library mode for the viewer), three 0.186 (+ `three/addons` OrbitControls and TransformControls), React 19 / zustand 5 (app only), Node 24 `node --test`, `CompressionStream` / `DecompressionStream`, headless Edge over CDP for browser checks.

**Spec:** `docs/superpowers/specs/2026-10-08-standalone-viewer-design.md` (read it first; this plan implements all of it). A throwaway prototype of the viewer without the section box is in `prototype-viewer/` (untracked); Task 3 turns it into `src/standalone/` and Task 11 deletes it.

## Global Constraints

Every task's requirements implicitly include this section. Values are copied from the spec.

- **One self-contained file**: no server, no install, no network. The model travels as the app's parametric rows (gzip + base64 in `<script id="model-data" type="text/plain">`), never as meshes.
- **Template tokens**: `@@BARBENDING_TITLE@@` (in `<title>`, HTML-escaped on insertion) and `@@BARBENDING_DATA@@` must each occur **exactly once** in the template. `@@BARBENDING_SCRIPT@@` and `@@BARBENDING_BUILD@@` are build-time only. `packViewerHtml` throws unless the first two occur exactly once; the build script checks all four.
- **Payload**: `_projectData()` plus `{ viewerFormat: 1, title }`. `extractProjectFromHtml` throws `not a barbending viewer file` (data element missing or unreadable) and `made by a newer barbending viewer` (`viewerFormat` above the supported value). `pack.js` is never bundled into the viewer.
- **Missing template message** (exact): `The viewer template is missing: run "npm run build:viewer", then reload.`
- **Export button**: `⤓ Viewer` next to `⤓ Project`; the title prompt (`window.prompt`) defaults to `barbending model`, cancel aborts, the title is trimmed and limited to 80 characters; the file is `barbending-viewer-<slug>-<YYYYMMDD-HHMM>.html` (slug = the title lower-cased with runs of other characters turned into `-`, omitted for the default title); while packing the button reads `Building…` and is disabled; failures use `alert`.
- **Import**: `⤒ Project` and `⤒+ Insert` accept `.json` and `.html`; a name ending `.html`, or text starting with `<`, goes through `extractProjectFromHtml`.
- **Browser support**: `CompressionStream` / `DecompressionStream` (Chrome and Edge 80+, Safari 16.4+, Firefox 113+). The viewer shows a plain message instead of a blank page when WebGL, `DecompressionStream` or the data is unavailable.
- **Renderer**: `WebGLRenderer({ antialias: true, stencil: true, powerPreference: 'high-performance' })`, ACES tone mapping, `localClippingEnabled = true`, pixel ratio capped at 2 (1.5 on `(pointer: coarse)`, where the tube budget is 1.5 million triangles instead of 5 million), render on demand. `window.__viewer` and `preserveDrawingBuffer` exist **only** when the URL has `?autotest` (`?autotest=nobuffer` keeps the hooks but not the readable canvas, for fps runs).
- **Section box**: state `{ enabled, mode: 'faces' | 'translate' | 'rotate', center, size, quat, solidCut, showBox }` in scene metres, session only, never saved in the file; default box = model bounds padded by `max(0.2 m, 2 % of the largest extent)`; minimum size 50 mm; Test cut = a third of each size around the same centre (min 50 mm); box colour `#38bdf8` at 5 % opacity; face grips red / green / blue (`#ef4444`, `#22c55e`, `#3b82f6`) of constant screen size with a doubled hit area; Move / Rotate through three's `TransformControls`; Solid cut with the app's stencil technique; rebar is not capped. If Solid cut cannot be made reliable it ships switched off and the CHANGELOG says so.
- **Budgets** (reference machine: Intel UHD, headless Edge, 1600×900, DPR 1, opened from `file://`): Ent3 file (1,680 rows, 3,848 bars) ≤ 0.8 MB; 1M-bar file (25,000 rows) ≤ 1.8 MB, opens in ≤ 3 s, orbits at ≥ 30 fps; viewer script minified ≤ 0.8 MB; export at 1M bars ≤ 3 s; the totals line equals the app's BBS header; the exported file imported back into the app gives deep-equal bars, concretes, reference lines, cover and bond; a cut agrees with the planes to 1 px; a face drag changes the size by exactly the pointer's movement along that axis.
- **Nothing existing changes behaviour**: `check_field` (60 checks), `check_views`, `check_select` (45) and `npm test` (136 tests before this work) keep passing; lint stays at **29 warnings, 0 errors** on tracked folders (`npx oxlint src scripts tests 2>&1 | grep -c ": warning "` prints 29).
- **No new runtime dependencies.** Relative imports keep their `.js` / `.jsx` extension so plain Node tests can load the pure modules. Pure modules (`codec.js`, `pack.js`, `exportViewer.js`, `sectionBoxMath.js`) touch no DOM and import no three.js or React.
- **Platform**: Windows 11 + Git Bash, Node 24. The browser rig drives Microsoft Edge (`EDGE_PATH` overrides `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`). Run my own servers on **5189** (dev) and **5188** (preview) and stop only those; never touch the user's server on :5173. Stopping a background `npx vite` with the task tool can leave its node child listening: confirm with `netstat -ano | grep -E ":(5189|5188) " | grep LISTEN`, check the command line of the PID (it must be vite on that port), kill it with `taskkill //F //PID <pid>`, and look for leftover rig browsers (msedge processes whose command line contains `barbending-perf-edge`). Do not `cd` into a scratch folder in the persistent shell (use a subshell): a shell standing in a folder blocks deleting it.
- **Files with backslashes** (regexes, escapes) are written with the Write / Edit tools, never with shell heredocs (the Bash tool alters backslashes). Benchmarks on this machine are noisy: alternate A/B runs and use medians.
- **Git**: work on branch `feat/standalone-viewer`. Commit each task with explicit `git add <paths>` (never `git add -A`: `inputs/`, `prototype-viewer/` and the spec / plan files are untracked on purpose), message `type(scope): subject`, and the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. **Never push.** The CHANGELOG entry, the commit of the spec and plan, and the push wait for the user's "record, commit and push".
- **After every task**: `npm test` passes, the lint count above is 29 / 0, and the task's own check passes, then commit.

## Deviations from the spec (small, deliberate)

1. `src/standalone/codec.js` (gzip / gunzip / base64 helpers) is shared by `pack.js` and the viewer, so the viewer does not duplicate them and `pack.js` still never ships inside it.
2. `src/standalone/exportViewer.js` holds the template fetch (`loadViewerTemplate`) so it is unit-testable in Node. A dev server answers an unknown path with `index.html` and status 200, so the fetch also requires both template tokens in the answer.
3. The viewer's totals line copies the app's BBS header format exactly (`N rows · N bars · W kg · V m³ concrete · R kg/m³`: no thousands separators, V to 3 decimals, R to 1, `n/a` without concrete) and sums every member, hidden or not, as the app does, so "identical" is a string comparison. The saved date is a separate element. (The prototype used thousands separators and skipped hidden members.)
4. The solid-cut caps are part of the box visuals, so they disappear with `👁 Box` (as in the app); the stencil marks stay, so the cut itself is unchanged.

## Dry run of this plan's code

Before this plan was handed over, the code blocks and edits of Tasks 1–9 were applied, by script, to a scratch copy of the repository (a git-ignored folder, nothing tracked was touched) and run: every "replace X with Y" anchor matched exactly once; the 23 new unit tests pass (10 pack, 10 section math, 3 template fetch); `check_standalone.mjs` passes its `viewer` (24 checks), `section` (41: core, faces, gizmo, solid), `export` (13) and `roundtrip` (6) sections against a dev server of the scratch copy; the Task 2 grip-drag assertion passes on the untouched app and on the refactored one with identical numbers; `oxlint` reports no new warning at any task boundary; the viewer script builds to 630 KB (162 KB gzipped) and the template to 637 KB; the dev server serves `viewer-template.html` byte for byte. Two mistakes found that way are already fixed in the text below (a float comparison in a unit test, a click in the Front view that landed on the depth-axis grips). **Not run yet:** the production build and preview path, the Ent3 and 1M-bar numbers (Task 10), and the documentation edits (their anchors and the README's CRLF handling were checked; the text itself was not). The numbers quoted in Tasks 3–9 come from the 4-row fixture, not from the user's model.

## File structure

| Path | Responsibility | Task |
|---|---|---|
| `src/standalone/codec.js` | `gzipBytes`, `gunzipBytes`, `toBase64`, `fromBase64` | 1 |
| `src/standalone/pack.js` | tokens, `packViewerHtml`, `extractProjectFromHtml`, `parseProjectFile`, `cleanViewerTitle`, `viewerFileName` | 1 |
| `tests/standalone/pack.test.mjs` | unit tests for the two files above | 1 |
| `src/viewer/sectionBoxMath.js` | `FACES`, `AXIS_COLORS`, `MIN_THICK`, `capQuad`, `faceDragResult`, `testCutSize`, `boxFromBounds`, `pixelWorldSize` | 2 |
| `tests/standalone/sectionBoxMath.test.mjs` | unit tests, including equivalence with the old `applyDrag` | 2 |
| `src/viewer/SectionBox.jsx` | uses the shared math (behaviour unchanged) | 2 |
| `scripts/perf/check_views.mjs` | gains a face-grip drag assertion in `section()` (characterises the refactor) | 2 |
| `src/standalone/template.html` | page shell, CSS, the four tokens | 3 |
| `src/standalone/viewer.js` | the viewer entry (vanilla JS on three.js) | 3, 6 |
| `scripts/build-viewer.mjs` | bundles the viewer into `public/viewer-template.html` | 3 |
| `package.json`, `.gitignore` | `build:viewer`, `predev`, `prebuild`; ignore the generated template | 3 |
| `scripts/perf/check_standalone.mjs` | browser checks: `viewer`, `export`, `roundtrip`, `section`, `scale` | 3–10 |
| `src/standalone/exportViewer.js` | `loadViewerTemplate` | 4 |
| `tests/standalone/exportViewer.test.mjs` | unit tests for it | 4 |
| `src/App.jsx` | `⤓ Viewer` button; `.html` accepted by `⤒ Project` and `⤒+ Insert` | 4, 5 |
| `src/standalone/sectionBox.js` | the viewer's section box (state, planes, visuals, grips, gizmo, caps, panel) | 6–9 |
| `README.md`, `agent.md`, `overview.md`, `scripts/perf/README.md` | docs | 11 |

---

### Task 1: Pack and unpack the single file (`codec.js`, `pack.js`)

**Files:**
- Create: `src/standalone/codec.js`
- Create: `src/standalone/pack.js`
- Test: `tests/standalone/pack.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces (later tasks rely on these exact names):
  - `codec.js`: `gzipBytes(bytes: Uint8Array): Promise<Uint8Array>`, `gunzipBytes(bytes): Promise<Uint8Array>`, `toBase64(bytes): string`, `fromBase64(b64: string): Uint8Array`.
  - `pack.js`: constants `VIEWER_FORMAT = 1`, `TOKEN_TITLE`, `TOKEN_DATA`, `TOKEN_SCRIPT`, `TOKEN_BUILD`, `DEFAULT_VIEWER_TITLE = 'barbending model'`, `MAX_TITLE_LENGTH = 80`; `countOf(text, token): number`; `cleanViewerTitle(raw): string`; `viewerFileName(title, when = new Date()): string`; `packViewerHtml(template, project, { title }): Promise<string>`; `extractProjectFromHtml(html): Promise<object>`; `parseProjectFile(name, text): Promise<object>`.

- [ ] **Step 1: Write the failing tests**

Create `tests/standalone/pack.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VIEWER_FORMAT, TOKEN_TITLE, TOKEN_DATA, DEFAULT_VIEWER_TITLE, countOf, cleanViewerTitle, viewerFileName,
  packViewerHtml, extractProjectFromHtml, parseProjectFile,
} from '../../src/standalone/pack.js';
import { gzipBytes, toBase64 } from '../../src/standalone/codec.js';
import { straightRow, spreadRows } from '../barfield/helpers.mjs';

const TEMPLATE = `<!doctype html><html><head><title>${TOKEN_TITLE}</title></head><body>`
  + `<script id="model-data" type="text/plain">${TOKEN_DATA}</script><script>var viewer = 1;</script></body></html>`;

const plain = (x) => JSON.parse(JSON.stringify(x));
const project = (over = {}) => ({
  v: 1, app: 'barbending', savedAt: 1760000000000,
  bars: [straightRow({ Rebar_tag: 1, Bar_mark: 'T1' })],
  concretes: [{ id: 'c1', name: 'Beam', lx: 3500, ly: 400, lz: 600, x: 0, y: 0, z: 0 }],
  refLines: [{ id: 'ref_1', p1: [0, 0, 0], p2: [1000, 0, 0] }],
  cover: 40, bond: 'poor', selectedBar: 0, selectedBars: [0], ...over,
});
const wrap = (b64) => `<script id="model-data" type="text/plain">${b64}</script>`;
const zipped = async (obj) => toBase64(await gzipBytes(new TextEncoder().encode(JSON.stringify(obj))));

test('pack then extract returns the project with the viewer fields added', async () => {
  const p = project();
  const html = await packViewerHtml(TEMPLATE, p, { title: 'My model' });
  assert.deepEqual(await extractProjectFromHtml(html), plain({ ...p, viewerFormat: VIEWER_FORMAT, title: 'My model' }));
  assert.equal(countOf(html, TOKEN_TITLE), 0);
  assert.equal(countOf(html, TOKEN_DATA), 0);
});

test('a title with Unicode, HTML characters and replacement patterns is escaped in <title> and kept in the data', async () => {
  const title = 'Torre 塔 ñ <b>&"x" $& $1';
  const html = await packViewerHtml(TEMPLATE, project(), { title });
  assert.ok(html.includes('<title>Torre 塔 ñ &lt;b&gt;&amp;&quot;x&quot; $&amp; $1</title>'));
  assert.equal((await extractProjectFromHtml(html)).title, title);
});

test('"</script>" in a title or a bar mark cannot end the page early', async () => {
  const mark = '</script><script>alert(1)</script>';
  const html = await packViewerHtml(TEMPLATE, project({ bars: [straightRow({ Bar_mark: mark })] }), { title: '</script><img src=x>' });
  assert.equal(countOf(html, '</script'), countOf(TEMPLATE, '</script'));
  assert.equal(countOf(html, '<script'), countOf(TEMPLATE, '<script'));
  assert.equal((await extractProjectFromHtml(html)).bars[0].Bar_mark, mark);
});

test('a template without a token, or with one twice, is refused', async () => {
  await assert.rejects(packViewerHtml('<html></html>', project()), /@@BARBENDING_TITLE@@ exactly once \(found 0\)/);
  await assert.rejects(packViewerHtml(TEMPLATE + TOKEN_DATA, project()), /@@BARBENDING_DATA@@ exactly once \(found 2\)/);
});

test('a 25,000-row project round-trips and stays small', async () => {
  const rows = spreadRows(25000, 40);
  const html = await packViewerHtml(TEMPLATE, project({ bars: rows }), { title: 'big' });
  const out = await extractProjectFromHtml(html);
  assert.equal(out.bars.length, 25000);
  assert.deepEqual(out.bars[24999], plain(rows[24999]));
  assert.ok(html.length < 3_000_000, `file is ${html.length} bytes`);
});

test('files that are not barbending viewer files are refused with a plain message', async () => {
  const bad = /not a barbending viewer file/;
  await assert.rejects(extractProjectFromHtml('<html><body>hello</body></html>'), bad); // no data element
  await assert.rejects(extractProjectFromHtml(wrap('%%%%')), bad); // not base64
  await assert.rejects(extractProjectFromHtml(wrap(Buffer.from('plain text').toString('base64'))), bad); // not gzip
  await assert.rejects(extractProjectFromHtml(wrap(await zipped({ bars: [] }))), bad); // gzip of something else
});

test('a file made by a newer viewer is refused', async () => {
  await assert.rejects(
    extractProjectFromHtml(wrap(await zipped({ viewerFormat: VIEWER_FORMAT + 1, bars: [] }))),
    /made by a newer barbending viewer/,
  );
});

test('parseProjectFile reads .json as JSON and .html (or text starting with <) as a viewer file', async () => {
  const p = project();
  assert.deepEqual(await parseProjectFile('a.json', JSON.stringify(p)), plain(p));
  const html = await packViewerHtml(TEMPLATE, p, { title: 't' });
  assert.equal((await parseProjectFile('a.html', html)).bars.length, 1);
  assert.equal((await parseProjectFile('renamed.txt', html)).bars.length, 1, 'recognised by its text');
  await assert.rejects(parseProjectFile('a.json', '{not json'), SyntaxError);
  await assert.rejects(parseProjectFile('a.html', '<html></html>'), /not a barbending viewer file/);
});

test('cleanViewerTitle trims, collapses spaces, limits to 80 characters and never returns an empty title', () => {
  assert.equal(cleanViewerTitle('  Tower   A \n L3  '), 'Tower A L3');
  assert.equal(cleanViewerTitle(''), DEFAULT_VIEWER_TITLE);
  assert.equal(cleanViewerTitle('   '), DEFAULT_VIEWER_TITLE);
  assert.equal(cleanViewerTitle(null), DEFAULT_VIEWER_TITLE);
  assert.equal(Array.from(cleanViewerTitle('x'.repeat(200))).length, 80);
  assert.equal(Array.from(cleanViewerTitle('😀'.repeat(100))).length, 80, 'never cuts an emoji in half');
});

test('viewerFileName: slug from the title, omitted for the default title or when nothing is left', () => {
  const when = new Date(2026, 9, 8, 14, 5);
  assert.equal(viewerFileName(DEFAULT_VIEWER_TITLE, when), 'barbending-viewer-20261008-1405.html');
  assert.equal(viewerFileName('Tower A — L3 (final)', when), 'barbending-viewer-tower-a-l3-final-20261008-1405.html');
  assert.equal(viewerFileName('塔楼', when), 'barbending-viewer-20261008-1405.html');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/standalone/pack.test.mjs`
Expected: FAIL with `Cannot find module '.../src/standalone/pack.js'` (or `codec.js`).

- [ ] **Step 3: Write `src/standalone/codec.js`**

```js
// Gzip and base64 helpers shared by the exporter (pack.js) and the viewer (viewer.js). The browser and Node 18+ both have
// CompressionStream, DecompressionStream, Blob, Response, btoa and atob, so there is no environment switch here.

export async function gzipBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzipBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// base64 in 32 KB slices: String.fromCharCode.apply on a whole megabyte overflows the call stack.
export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
```

- [ ] **Step 4: Write `src/standalone/pack.js`**

```js
// The single-file viewer format (spec section 4.3): a generated HTML template with two tokens, filled in with the title and the
// gzipped, base64-encoded project. Pure: no DOM, no three.js. Used by the app (export, import) and by Node tests and checks.
// Never bundled into the viewer itself, which only needs the codec.
import { gzipBytes, gunzipBytes, toBase64, fromBase64 } from './codec.js';

export const VIEWER_FORMAT = 1;
export const TOKEN_TITLE = '@@BARBENDING_TITLE@@';
export const TOKEN_DATA = '@@BARBENDING_DATA@@';
export const TOKEN_SCRIPT = '@@BARBENDING_SCRIPT@@'; // build time only (scripts/build-viewer.mjs)
export const TOKEN_BUILD = '@@BARBENDING_BUILD@@'; // build time only
export const DEFAULT_VIEWER_TITLE = 'barbending model';
export const MAX_TITLE_LENGTH = 80;

const NOT_A_VIEWER_FILE = 'not a barbending viewer file';
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function countOf(text, token) {
  let n = 0;
  for (let i = text.indexOf(token); i >= 0; i = text.indexOf(token, i + token.length)) n += 1;
  return n;
}

// Trimmed, single-spaced, at most 80 characters (never half an emoji), never empty.
export function cleanViewerTitle(raw) {
  const t = Array.from(String(raw ?? '').replace(/\s+/g, ' ').trim()).slice(0, MAX_TITLE_LENGTH).join('').trim();
  return t || DEFAULT_VIEWER_TITLE;
}

// barbending-viewer-<slug>-<YYYYMMDD-HHMM>.html; the slug is left out for the default title or when no letter or digit is left.
export function viewerFileName(title, when = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${when.getFullYear()}${p(when.getMonth() + 1)}${p(when.getDate())}-${p(when.getHours())}${p(when.getMinutes())}`;
  const slug = title === DEFAULT_VIEWER_TITLE ? '' : title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `barbending-viewer-${slug ? slug + '-' : ''}${stamp}.html`;
}

export async function packViewerHtml(template, project, { title = DEFAULT_VIEWER_TITLE } = {}) {
  for (const token of [TOKEN_TITLE, TOKEN_DATA]) {
    const n = countOf(template, token);
    if (n !== 1) throw new Error(`The viewer template must contain ${token} exactly once (found ${n}).`);
  }
  const clean = cleanViewerTitle(title);
  const payload = { ...project, viewerFormat: VIEWER_FORMAT, title: clean };
  const data = toBase64(await gzipBytes(new TextEncoder().encode(JSON.stringify(payload))));
  // Function replacers: a title or data containing "$&" or "$1" must not be read as a replacement pattern.
  return template.replace(TOKEN_TITLE, () => escapeHtml(clean)).replace(TOKEN_DATA, () => data);
}

const DATA_ELEMENT = /<script id="model-data" type="text\/plain">([^<]*)<\/script>/;

export async function extractProjectFromHtml(html) {
  const m = DATA_ELEMENT.exec(String(html));
  if (!m) throw new Error(NOT_A_VIEWER_FILE);
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(await gunzipBytes(fromBase64(m[1].trim()))));
  } catch {
    throw new Error(NOT_A_VIEWER_FILE);
  }
  if (!payload || typeof payload !== 'object' || !Number.isInteger(payload.viewerFormat)) throw new Error(NOT_A_VIEWER_FILE);
  if (payload.viewerFormat > VIEWER_FORMAT) throw new Error('made by a newer barbending viewer');
  return payload;
}

// A project file chosen in the app: the .json that "⤓ Project" writes, or the .html that "⤓ Viewer" writes.
export async function parseProjectFile(name, text) {
  const isHtml = /\.html$/i.test(String(name)) || /^\s*</.test(text);
  return isHtml ? extractProjectFromHtml(text) : JSON.parse(text);
}
```

- [ ] **Step 5: Run the tests, the whole suite and lint**

Run: `node --test tests/standalone/pack.test.mjs`
Expected: PASS (10 tests).

Run: `npm test 2>&1 | tail -8`
Expected: `tests 146`, `pass 146`, `fail 0`.

Run: `npx oxlint src scripts tests 2>&1 | grep -c ": warning "`
Expected: `29`.

- [ ] **Step 6: Commit**

```bash
git add src/standalone/codec.js src/standalone/pack.js tests/standalone/pack.test.mjs
git commit -m "feat(viewer-export): pack and unpack the single-file viewer (gzip + base64) with tests" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Share the section-box math (`sectionBoxMath.js`) and refactor `SectionBox.jsx` onto it

**Files:**
- Create: `src/viewer/sectionBoxMath.js`
- Modify: `src/viewer/SectionBox.jsx` (imports, the `capQuad` function, `applyDrag`)
- Modify: `scripts/perf/check_views.mjs` (`section()`: a face-grip drag assertion)
- Test: `tests/standalone/sectionBoxMath.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (Tasks 6–9 import these from `../viewer/sectionBoxMath.js`):
  - `FACES: {axis: 0|1|2, sign: -1|1}[6]` (order: -X, +X, -Y, +Y, -Z, +Z in box-local axes), `AXIS_COLORS: string[3]`, `MIN_THICK = 0.05`.
  - `capQuad(i: 0..5, size: [sx, sy, sz]): { args: [w, h], pos: [x, y, z], rot: [rx, ry, rz] }`.
  - `faceDragResult({ startCenter, startSize, axis, normal, delta }): { center: number[3], size: number[3] }`.
  - `testCutSize(size): number[3]`, `boxFromBounds(min, max, pad?): { center, size }`.
  - `pixelWorldSize({ ortho, zoom, depth, fovRad, viewportHeightPx }): number` (world metres per screen pixel).

The refactor must not change the app: a browser assertion is added **first** and must pass on the untouched code, then again after the refactor.

- [ ] **Step 1: Add the face-grip drag assertion to the app's section check (characterisation)**

In `scripts/perf/check_views.mjs`, inside `section()`, insert this block right before the line `await b.ev('window.__store.getState().toggleSection()');` that follows `const expectPx = keptM * zoom * dpr;` (the second `toggleSection`, which switches the box off). Use the Edit tool with this unique anchor: the two lines `    const expectPx = keptM * zoom * dpr;` / `    await b.ev('window.__store.getState().toggleSection()');`.

```js
    // Dragging a face grip resizes the box by exactly the pointer's movement along that axis (pins the drag maths that
    // moved into sectionBoxMath.js): the +X grip sits 0.7 m outside the face; the opposite face must not move.
    await b.ev('window.__store.getState().setSection({ mode: "faces", showBox: true })');
    await sleep(600);
    const secA = await b.ev('window.__store.getState().section');
    const rectA = await rectOf(b);
    const gripPt = await toScreen(b, [secA.center[0] + secA.size[0] / 2 + 0.7, secA.center[1], secA.center[2]]);
    const gripFrom = [rectA.x + gripPt[0], rectA.y + gripPt[1]];
    const dragPx = 90;
    await drag(b, gripFrom, [gripFrom[0] + dragPx, gripFrom[1]], 'left', 10);
    await sleep(600);
    const secB = await b.ev('window.__store.getState().section');
    const dW = secB.size[0] - secA.size[0];
    const leftA = secA.center[0] - secA.size[0] / 2;
    const leftB = secB.center[0] - secB.size[0] / 2;
    console.log(`      section grip: +X grip dragged ${dragPx} px -> width ${secA.size[0].toFixed(4)} -> ${secB.size[0].toFixed(4)} m (expected +${(dragPx / zoom).toFixed(4)})`);
    report(near(dW, dragPx / zoom, 0.004) && near(leftB, leftA, 1e-6) && near(secB.size[1], secA.size[1], 1e-9) && near(secB.size[2], secA.size[2], 1e-9),
      `section: dragging the +X face grip ${dragPx} px widens the box by ${dW.toFixed(4)} m (expected ${(dragPx / zoom).toFixed(4)}); the opposite face and the other sizes stay put`);
```

`drag`, `toScreen` and `rectOf` are existing module-level helpers in the file; `zoom` and `near` are already in scope in `section()`.

- [ ] **Step 2: Run the app's dev server and the section check on the UNCHANGED code**

```bash
npx vite --port 5189 --strictPort
```
(run this with `run_in_background`; wait until `curl -s -o /dev/null -w "%{http_code}" http://localhost:5189/` prints `200`.)

Run: `node scripts/perf/check_views.mjs --url http://localhost:5189 --only section`
Expected: every line `PASS`, including the new `section: dragging the +X face grip 90 px widens the box ...` line, then `RESULT: PASS`.

If the new assertion cannot pass on the untouched code (for example the grip cannot be hit by the trusted mouse), investigate before going on (print `secA`, `gripPt`, `rectA`); do not refactor an unpinned drag. If, after investigation, the grip genuinely cannot be driven in headless Edge, delete this block, say so in the commit message, and rely on the unit-test equivalence of Step 3 instead.

- [ ] **Step 3: Write the failing unit tests**

Create `tests/standalone/sectionBoxMath.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  FACES, AXIS_COLORS, MIN_THICK, capQuad, faceDragResult, testCutSize, boxFromBounds, pixelWorldSize,
} from '../../src/viewer/sectionBoxMath.js';
import { sectionPlanes, updateSectionPlanesBox } from '../../src/viewer/sectionPlanes.js';
import { rng } from '../barfield/helpers.mjs';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// The drag formula exactly as SectionBox.jsx had it before it moved into sectionBoxMath.js (three.js vectors).
function oldApplyDrag({ startCenter, startSize, axis, N, delta }) {
  const newSize = [...startSize];
  newSize[axis] = Math.max(0.05, startSize[axis] + delta);
  const applied = newSize[axis] - startSize[axis];
  const nc = new THREE.Vector3(...startCenter).addScaledVector(N, applied / 2);
  return { center: [nc.x, nc.y, nc.z], size: newSize };
}

test('faceDragResult is bit-for-bit the old applyDrag, for any axis, sign, rotation and delta', () => {
  const r = rng(7);
  for (let k = 0; k < 2000; k++) {
    const startCenter = [r() * 40 - 20, r() * 40 - 20, r() * 40 - 20];
    const startSize = [0.05 + r() * 10, 0.05 + r() * 10, 0.05 + r() * 10];
    const axis = Math.floor(r() * 3);
    const sign = r() < 0.5 ? -1 : 1;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 6.28, r() * 6.28, r() * 6.28));
    const N = new THREE.Vector3();
    N.setComponent(axis, sign).applyQuaternion(q);
    const delta = r() * 24 - 12; // large negatives reach the 50 mm clamp
    const want = oldApplyDrag({ startCenter, startSize, axis, N, delta });
    const got = faceDragResult({ startCenter, startSize, axis, normal: N.toArray(), delta });
    assert.deepEqual(got, want, `case ${k}`);
  }
});

test('dragging the +X face outwards widens the box and shifts the centre by half; the -X face stays', () => {
  const out = faceDragResult({ startCenter: [0, 0, 0], startSize: [2, 2, 2], axis: 0, normal: [1, 0, 0], delta: 0.5 });
  assert.deepEqual(out.size, [2.5, 2, 2]);
  assert.deepEqual(out.center, [0.25, 0, 0]);
  assert.ok(near(out.center[0] - out.size[0] / 2, -1));
  const minus = faceDragResult({ startCenter: [0, 0, 0], startSize: [2, 2, 2], axis: 0, normal: [-1, 0, 0], delta: 0.5 });
  assert.deepEqual(minus.size, [2.5, 2, 2]);
  assert.deepEqual(minus.center, [-0.25, 0, 0]);
  assert.ok(near(minus.center[0] + minus.size[0] / 2, 1));
});

test('a face cannot be dragged past 50 mm, and the opposite face still does not move', () => {
  const out = faceDragResult({ startCenter: [0, 0, 0], startSize: [2, 2, 2], axis: 0, normal: [1, 0, 0], delta: -5 });
  assert.equal(out.size[0], MIN_THICK);
  assert.ok(near(out.center[0] - out.size[0] / 2, -1));
});

test('a rotated box moves along its own face normal', () => {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2); // +X maps to -Z
  const N = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const out = faceDragResult({ startCenter: [1, 2, 3], startSize: [2, 2, 2], axis: 0, normal: N.toArray(), delta: 1 });
  assert.deepEqual(out.size, [3, 2, 2]);
  assert.ok(near(out.center[0], 1) && near(out.center[1], 2) && near(out.center[2], 2.5));
});

test('testCutSize is a third of each size, never below 50 mm', () => {
  const out = testCutSize([3, 0.6, 0.09]);
  assert.ok(near(out[0], 1) && near(out[1], 0.2) && out[2] === MIN_THICK, `got ${out}`);
});

test('boxFromBounds pads by max(0.2 m, 2 % of the largest extent) unless told otherwise', () => {
  const a = boxFromBounds([0, 0, 0], [10, 2, 4]);
  assert.deepEqual(a.center, [5, 1, 2]);
  assert.ok(a.size.every((v, i) => near(v, [10.4, 2.4, 4.4][i])));
  const small = boxFromBounds([0, 0, 0], [1, 1, 1]);
  assert.ok(small.size.every((v) => near(v, 1.4)), 'the 0.2 m floor');
  const big = boxFromBounds([0, 0, 0], [100, 10, 10]);
  assert.ok(near(big.size[0], 104) && near(big.size[1], 14), 'the 2 % rule');
  assert.deepEqual(boxFromBounds([0, 0, 0], [4, 2, 1], 0).size, [4, 2, 1]);
});

test('capQuad gives the six values SectionBox.jsx used', () => {
  const s = [2, 4, 6];
  const want = [
    { args: [6, 4], pos: [1, 0, 0], rot: [0, Math.PI / 2, 0] },
    { args: [6, 4], pos: [-1, 0, 0], rot: [0, -Math.PI / 2, 0] },
    { args: [2, 6], pos: [0, 2, 0], rot: [-Math.PI / 2, 0, 0] },
    { args: [2, 6], pos: [0, -2, 0], rot: [Math.PI / 2, 0, 0] },
    { args: [2, 4], pos: [0, 0, 3], rot: [0, 0, 0] },
    { args: [2, 4], pos: [0, 0, -3], rot: [0, Math.PI, 0] },
  ];
  want.forEach((w, i) => assert.deepEqual(capQuad(i, s), w, `plane ${i}`));
});

test('every cap quad lies on its own clipping plane (the index pairing with sectionPlanes)', () => {
  for (const quat of [[0, 0, 0, 1], new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 1.1, -0.7)).toArray()]) {
    const center = [1, 2, 3];
    const size = [2, 4, 6];
    updateSectionPlanesBox(center, size, quat);
    const q = new THREE.Quaternion().fromArray(quat);
    for (let i = 0; i < 6; i++) {
      const cq = capQuad(i, size);
      const world = new THREE.Vector3(...cq.pos).applyQuaternion(q).add(new THREE.Vector3(...center));
      assert.ok(near(sectionPlanes[i].distanceToPoint(world), 0, 1e-9), `cap ${i} is on plane ${i}`);
    }
  }
});

test('FACES and AXIS_COLORS describe the six faces and three axes', () => {
  assert.equal(FACES.length, 6);
  assert.deepEqual(FACES.map((f) => f.axis), [0, 0, 1, 1, 2, 2]);
  assert.deepEqual(FACES.map((f) => f.sign), [-1, 1, -1, 1, -1, 1]);
  assert.deepEqual(AXIS_COLORS, ['#ef4444', '#22c55e', '#3b82f6']);
});

test('pixelWorldSize: orthographic by zoom, perspective by depth and field of view', () => {
  assert.ok(near(pixelWorldSize({ ortho: true, zoom: 200 }), 0.005));
  const fov = Math.PI / 4;
  assert.ok(near(pixelWorldSize({ ortho: false, depth: 10, fovRad: fov, viewportHeightPx: 800 }), (2 * 10 * Math.tan(fov / 2)) / 800));
  assert.ok(pixelWorldSize({ ortho: false, depth: -5, fovRad: fov, viewportHeightPx: 800 }) > 0, 'behind the camera stays positive');
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `node --test tests/standalone/sectionBoxMath.test.mjs`
Expected: FAIL with `Cannot find module '.../src/viewer/sectionBoxMath.js'`.

- [ ] **Step 5: Write `src/viewer/sectionBoxMath.js`**

```js
// Pure section-box maths shared by the app's SectionBox.jsx and the standalone viewer's section box. Arrays in, arrays out:
// no three.js and no DOM, so plain Node tests can load it.

// The six faces in box-local axes, in the order the grips use: -X, +X, -Y, +Y, -Z, +Z. This is NOT the clipping-plane order of
// sectionPlanes.js, which capQuad(i) follows: +X, -X, +Y, -Y, +Z, -Z (planes 2k is the + face of axis k, 2k + 1 the - face).
export const FACES = [
  { axis: 0, sign: -1 }, { axis: 0, sign: 1 },
  { axis: 1, sign: -1 }, { axis: 1, sign: 1 },
  { axis: 2, sign: -1 }, { axis: 2, sign: 1 },
];
export const AXIS_COLORS = ['#ef4444', '#22c55e', '#3b82f6'];
export const MIN_THICK = 0.05; // 50 mm

// Cap quad transforms per plane, in box-local coords (box centred at origin).
export function capQuad(i, size) {
  const [sx, sy, sz] = size;
  switch (i) {
    case 0: return { args: [sz, sy], pos: [sx / 2, 0, 0], rot: [0, Math.PI / 2, 0] };
    case 1: return { args: [sz, sy], pos: [-sx / 2, 0, 0], rot: [0, -Math.PI / 2, 0] };
    case 2: return { args: [sx, sz], pos: [0, sy / 2, 0], rot: [-Math.PI / 2, 0, 0] };
    case 3: return { args: [sx, sz], pos: [0, -sy / 2, 0], rot: [Math.PI / 2, 0, 0] };
    case 4: return { args: [sx, sy], pos: [0, 0, sz / 2], rot: [0, 0, 0] };
    default: return { args: [sx, sy], pos: [0, 0, -sz / 2], rot: [0, Math.PI, 0] };
  }
}

// Push / pull one face: `delta` is how far the pointer moved along the face's outward unit `normal` (world space, metres). The size
// along `axis` follows it but never drops below MIN_THICK; the centre moves by half the applied change, so the opposite face stays.
// The arithmetic is the order the app has always used (x + n * (applied / 2)), so results are identical to the last bit.
export function faceDragResult({ startCenter, startSize, axis, normal, delta }) {
  const size = [...startSize];
  size[axis] = Math.max(MIN_THICK, startSize[axis] + delta);
  const half = (size[axis] - startSize[axis]) / 2;
  return {
    center: [startCenter[0] + normal[0] * half, startCenter[1] + normal[1] * half, startCenter[2] + normal[2] * half],
    size,
  };
}

// "Test cut": a third of each size around the same centre (never below MIN_THICK) so the cut is visible at once.
export function testCutSize(size) {
  return size.map((v) => Math.max(MIN_THICK, v / 3));
}

// The default box around model bounds (scene metres): padded by max(0.2 m, 2 % of the largest extent) unless `pad` is given.
export function boxFromBounds(min, max, pad) {
  const ext = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const p = pad ?? Math.max(0.2, 0.02 * Math.max(ext[0], ext[1], ext[2]));
  return {
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    size: [ext[0] + 2 * p, ext[1] + 2 * p, ext[2] + 2 * p],
  };
}

// World metres covered by one screen pixel at a point: an orthographic camera by its zoom (pixels per metre), a perspective one by
// the point's depth along the view axis, the vertical field of view and the viewport height. Keeps the viewer's grips a constant size.
export function pixelWorldSize({ ortho, zoom = 1, depth = 1, fovRad = Math.PI / 4, viewportHeightPx = 800 }) {
  if (ortho) return 1 / Math.max(zoom, 1e-9);
  return (2 * Math.max(depth, 1e-4) * Math.tan(fovRad / 2)) / Math.max(viewportHeightPx, 1);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/standalone/sectionBoxMath.test.mjs`
Expected: PASS (10 tests).

- [ ] **Step 7: Refactor `SectionBox.jsx` onto the shared module**

Three edits with the Edit tool on `src/viewer/SectionBox.jsx`.

Edit 1, imports and constants. Replace
```
import { stencilMats, capMaterial } from './stencilMats.js';

const FACES = [
  { axis: 0, sign: -1 }, { axis: 0, sign: 1 },
  { axis: 1, sign: -1 }, { axis: 1, sign: 1 },
  { axis: 2, sign: -1 }, { axis: 2, sign: 1 },
];
const AXIS_COLORS = ['#ef4444', '#22c55e', '#3b82f6'];
const MIN_THICK = 0.05; // 50 mm
const noHitRaycast = () => null;
```
with
```
import { stencilMats, capMaterial } from './stencilMats.js';
import { FACES, AXIS_COLORS, capQuad, faceDragResult } from './sectionBoxMath.js';

const noHitRaycast = () => null;
```

Edit 2, remove the local `capQuad`. Replace
```
// Cap quad transforms per plane, in box-local coords (box centred at origin).
function capQuad(i, size) {
  const [sx, sy, sz] = size;
  switch (i) {
    case 0: return { args: [sz, sy], pos: [sx / 2, 0, 0], rot: [0, Math.PI / 2, 0] };
    case 1: return { args: [sz, sy], pos: [-sx / 2, 0, 0], rot: [0, -Math.PI / 2, 0] };
    case 2: return { args: [sx, sz], pos: [0, sy / 2, 0], rot: [-Math.PI / 2, 0, 0] };
    case 3: return { args: [sx, sz], pos: [0, -sy / 2, 0], rot: [Math.PI / 2, 0, 0] };
    case 4: return { args: [sx, sy], pos: [0, 0, sz / 2], rot: [0, 0, 0] };
    default: return { args: [sx, sy], pos: [0, 0, -sz / 2], rot: [0, Math.PI, 0] };
  }
}
const noopRaycast = () => null;
```
with
```
const noopRaycast = () => null;
```

Edit 3, the drag. Replace
```
    const delta = closestAxisParam(ray.origin, ray.direction, d.A0, d.N) - d.t0;
    const newSize = [...d.startSize];
    newSize[d.axis] = Math.max(MIN_THICK, d.startSize[d.axis] + delta);
    const applied = newSize[d.axis] - d.startSize[d.axis];
    const nc = new THREE.Vector3(...d.startCenter).addScaledVector(d.N, applied / 2);
    setSection({ center: [nc.x, nc.y, nc.z], size: newSize });
```
with
```
    const delta = closestAxisParam(ray.origin, ray.direction, d.A0, d.N) - d.t0;
    const next = faceDragResult({ startCenter: d.startCenter, startSize: d.startSize, axis: d.axis, normal: d.N.toArray(), delta });
    setSection({ center: next.center, size: next.size });
```

- [ ] **Step 8: Verify the app is unchanged**

Run: `npm test 2>&1 | tail -8` — expected `tests 156`, `pass 156`, `fail 0`.
Run: `npx oxlint src scripts tests 2>&1 | grep -c ": warning "` — expected `29`.
Run (the dev server from Step 2 is still up, hot-reloaded): `node scripts/perf/check_views.mjs --url http://localhost:5189 --only section`
Expected: all `PASS` including the face-grip drag, `RESULT: PASS`.
Run: `node scripts/perf/check_field.mjs --url http://localhost:5189` — expected 60 `PASS`, `RESULT: PASS`.
Run: `node scripts/perf/check_select.mjs --url http://localhost:5189` — expected 45 `PASS`, `RESULT: PASS`.

Stop only the dev server you started on 5189 when you are done with it (or keep it for Task 4).

- [ ] **Step 9: Commit**

```bash
git add src/viewer/sectionBoxMath.js src/viewer/SectionBox.jsx tests/standalone/sectionBoxMath.test.mjs scripts/perf/check_views.mjs
git commit -m "refactor(section): move the section-box maths into a pure shared module, pinned by a grip-drag check" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 3: The viewer at parity with the prototype, the build script and the first browser check

**Files:**
- Create: `src/standalone/template.html`
- Create: `src/standalone/viewer.js`
- Create: `scripts/build-viewer.mjs`
- Create: `scripts/perf/check_standalone.mjs` (helpers + the `viewer` section)
- Modify: `package.json` (scripts), `.gitignore`

**Interfaces:**
- Consumes: from Task 1 `codec.js` (`gunzipBytes`, `fromBase64`) in the viewer, and `pack.js` (`TOKEN_*`, `countOf`, `VIEWER_FORMAT`, `packViewerHtml`) in the build script and the check.
- Produces:
  - `npm run build:viewer` → `public/viewer-template.html` (git-ignored; copied to `dist/` by `vite build`); `predev` and `prebuild` run it.
  - Viewer DOM ids the later tasks and checks rely on: `#title`, `#stats`, `#saved`, `#views`, `#fit`, `#concrete`, `#legend` (`.chip`), `#download`, `#toggle-panel`, `#gl` (canvas), `#viewport`, `#pill`, `#info`, `#panel`, `#filter`, `#panel-count`, `#tbl-head`, `#tbl-scroll`, `#tbl-rows` (`.r`), `#loading`.
  - Test hooks, only with `?autotest`: `window.__viewer = { rows, bars, view, data, scene, renderer, bounds: { min, max }, cam, ctl, frames, selected, select(i, opts), goView(name), fitAll(instant), switchTo('persp'|'ortho'), pick(clientX, clientY, touch) }` (Task 6 adds `section`).
  - `check_standalone.mjs` exports nothing; later tasks add sections to its `sections` registry and reuse its helpers `openViewer`, `settle`, `toScreen`, `click`, `dotProbe`, `writeViewer`, `makeProject`, `report`, `CAPTURE_DOWNLOADS`. Each later task adds the helpers it is the first to use (`near` and `rectOf` in Task 6, `prep` and `drag` in Task 7, `bigFile` in Task 10) so that no task leaves an unused helper behind (the lint count must stay at 29).

- [ ] **Step 1: Write the browser check first (it cannot run yet)**

Create `scripts/perf/check_standalone.mjs`:

```js
// Browser checks for the standalone viewer (the single-file .html that "⤓ Viewer" writes), in headless Edge (real GPU).
// usage: node scripts/perf/check_standalone.mjs [--url <app base url>] [--only <name>] [--project file.json] [--big file.json] [--max-kb n]
// The viewer sections build their .html from public/viewer-template.html (run `npm run build:viewer` first) and need no app.
// viewer   : opens from file:// within budget, the totals line has the app's format, a click picks, the table sorts / filters / zooms,
//            the six views are orthographic, end-on bars show as dots, the legend hides a diameter, ⤓ Project hands back the data,
//            the test hooks exist only with ?autotest, a damaged file shows a plain message, an empty project opens.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser, sleep } from './lib/cdp.mjs';
import { packViewerHtml } from '../../src/standalone/pack.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const outDir = path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });
const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
};
const base = (arg('url') || '').replace(/\/$/, '');
const only = arg('only', '');
const projectFile = arg('project', '');
const maxKb = Number(arg('max-kb', '0'));
const templatePath = path.join(repo, 'public', 'viewer-template.html');
if (!fs.existsSync(templatePath)) { console.error('public/viewer-template.html is missing: run "npm run build:viewer" first'); process.exit(2); }

let failures = 0;
const report = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures += 1; };

// A beam (c1) with four bars. App mm -> scene m: x, z (up), -y (depth). T1 (Ø16, amber) runs x 0..3 m at 1.5 m up and 0.2 m deep, in the
// middle of the model, so a Test cut keeps part of it; T2 (Ø20, red) and T3 (Ø25, purple) lie below and above that window and are cut away
// entirely; E4 (Ø32, blue) runs along app Y, straight at the Front camera, so it is a dot there.
function makeProject() {
  const bar = (tag, over) => ({
    Rebar_tag: tag, Bar_mark: `T${tag}`, Rebar_Type: 'straight', Plane: 'XY', Dia: 16, 'Length of Bar': 3000, host: 'c1',
    Pos_x: 0, Pos_y: 200, Pos_z: 1500, Pos_Rotation: 0, qty: 1, qty_x: 1, spacing_x: 150, qty_y: 1, spacing_y: 150,
    Group: 'main', bond_condition: 'poor', Visible: 1, ...over,
  });
  return {
    v: 1, app: 'barbending', savedAt: Date.now(),
    bars: [
      bar(1, {}),
      bar(2, { Dia: 20, Pos_y: 100, Pos_z: 1300 }),
      bar(3, { Dia: 25, Pos_y: 300, Pos_z: 1700, Bar_mark: 'S3' }),
      bar(4, { Dia: 32, Pos_x: 1500, Pos_y: 100, Pos_z: 1600, Pos_Rotation: 90, 'Length of Bar': 300, Bar_mark: 'E4' }),
    ],
    concretes: [{ id: 'c1', name: 'Beam B1', lx: 3500, ly: 400, lz: 600, x: -500, y: 0, z: 1200 }],
    refLines: [{ id: 'ref_1', visible: true, color: '#f59e0b', name: 'Ref Line 1', p1: [0, 0, 1200], p2: [3000, 0, 1200], host: 'c1' }],
    cover: 40, bond: 'poor', selectedBar: 0, selectedBars: [0],
  };
}

// Packs a project into the real template and writes it to scripts/perf/out/<name>.html.
async function writeViewer(project, name, title) {
  const html = await packViewerHtml(fs.readFileSync(templatePath, 'utf8'), project, { title });
  const file = path.join(outDir, `${name}.html`);
  fs.writeFileSync(file, html);
  return { file, bytes: Buffer.byteLength(html) };
}

// Opens a viewer file from file:// and waits until the loading screen is gone; returns the time it took (ms).
// autotest: true (hooks + readable canvas), 'nobuffer' (hooks only, for fps runs) or false (a visitor's page: no hooks).
async function openViewer(b, file, { autotest = true } = {}) {
  const t0 = Date.now();
  const query = autotest === 'nobuffer' ? '?autotest=nobuffer' : autotest ? '?autotest' : '';
  await b.send('Page.navigate', { url: pathToFileURL(file).href + query });
  for (let i = 0; i < 600; i++) {
    const ready = await b.ev(`(() => { const l = document.getElementById('loading'); return !!l && getComputedStyle(l).display === 'none'; })()`, 5000).catch(() => false);
    if (ready) return Date.now() - t0;
    await sleep(100);
  }
  const why = await b.ev(`(document.getElementById('loading') || { textContent: '?' }).textContent`).catch(() => '?');
  throw new Error('the viewer did not become ready: ' + why);
}

// Waits until the camera has not moved (position, orientation, zoom) for 0.7 s, then a moment for the last frame.
async function settle(b, maxMs = 15000) {
  const t0 = Date.now();
  let prev = null;
  let since = Date.now();
  while (Date.now() - t0 < maxMs) {
    const p = await b.ev('(() => { const c = window.__viewer.cam; return c.position.toArray().concat(c.quaternion.toArray(), [c.zoom]).join(","); })()', 15000).catch(() => 'err');
    if (p === prev) { if (Date.now() - since >= 700) { await sleep(250); return; } } else { prev = p; since = Date.now(); }
    await sleep(120);
  }
}

// World point -> canvas CSS pixels with the live camera.
const toScreen = (b, [x, y, z]) => b.ev(`(() => { const c = window.__viewer.cam; const cv = document.getElementById('gl'); const p = new c.position.constructor(${x}, ${y}, ${z}).project(c);
  return [(p.x * 0.5 + 0.5) * cv.clientWidth, (-p.y * 0.5 + 0.5) * cv.clientHeight]; })()`);

// Trusted mouse click (page pixels).
const click = async (b, pt) => {
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt[0], y: pt[1] });
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt[0], y: pt[1], button: 'left', buttons: 1, clickCount: 1 });
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt[0], y: pt[1], button: 'left', buttons: 0, clickCount: 1 });
};

// Pixels near (cx, cy) (canvas CSS px) that differ from the local background in the direction of `color`: anti-aliasing blends a thin
// dash or a small dot with the background, so this looks at hue and strength, not an exact colour. (Same probe as check_views.mjs.)
const dotProbe = (cx, cy, color) => `(() => {
  const c = document.getElementById('gl'); const k = c.width / c.clientWidth;
  const t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
  const x = t.getContext('2d', { willReadFrequently: true }); x.drawImage(c, 0, 0);
  const R = Math.round(5 * k), px = Math.round(${cx} * k), py = Math.round(${cy} * k);
  const x0 = Math.max(0, px - R), y0 = Math.max(0, py - R), w = Math.min(t.width - x0, 2 * R + 1), h = Math.min(t.height - y0, 2 * R + 1);
  const d = x.getImageData(x0, y0, w, h).data;
  const bg = [d[0], d[1], d[2]]; const col = ${JSON.stringify(color)};
  const cv = [col[0] - bg[0], col[1] - bg[1], col[2] - bg[2]]; const cn = Math.hypot(cv[0], cv[1], cv[2]);
  let n = 0, best = 0;
  for (let i = 0; i < d.length; i += 4) {
    const pv = [d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]]; const pn = Math.hypot(pv[0], pv[1], pv[2]);
    if (pn < 0.25 * cn) continue;
    const cos = (pv[0] * cv[0] + pv[1] * cv[1] + pv[2] * cv[2]) / (pn * cn);
    if (cos > 0.85) { n++; best = Math.max(best, pn / cn); }
  }
  return { n, best };
})()`;

// Replaces window.prompt / alert and the anchor click so a download can be read back as text.
const CAPTURE_DOWNLOADS = `(() => {
  window.__dl = null;
  HTMLAnchorElement.prototype.click = function () {
    const name = this.download;
    fetch(this.href).then((r) => r.text()).then((text) => { window.__dl = { name, text }; });
  };
})()`;

async function viewer() {
  const project = projectFile ? JSON.parse(fs.readFileSync(projectFile, 'utf8')) : makeProject();
  const { file, bytes } = await writeViewer(project, 'viewer-check', 'Viewer check');
  console.log(`      viewer file: ${(bytes / 1024).toFixed(0)} KB for ${project.bars.length} rows`);
  if (maxKb) report(bytes <= maxKb * 1024, `viewer: the file is ${(bytes / 1024).toFixed(0)} KB (budget ${maxKb} KB)`);
  const b = await launchBrowser();
  try {
    const ms = await openViewer(b, file);
    report(ms <= 3000, `viewer: opened from file:// and ready in ${ms} ms (budget 3000)`);
    const info = await b.ev(`({ tab: document.title, head: document.getElementById('title').textContent, stats: document.getElementById('stats').textContent })`);
    report(info.tab === 'Viewer check' && info.head === 'Viewer check', `viewer: the title is "${info.head}" in the page and the tab`);
    report(/^\d+ rows · \d+ bars · [\d.]+ kg · [\d.]+ m³ concrete · ([\d.]+ kg\/m³|n\/a)$/.test(info.stats), `viewer: the totals line has the app's format ("${info.stats}")`);

    // A trusted click on a bar picks the nearest bar there.
    await b.ev('window.__viewer.fitAll(true)');
    await settle(b);
    const target = await b.ev(`(() => { const v = window.__viewer; const d = v.data; const c = document.getElementById('gl').getBoundingClientRect();
      const x = (d.seg[0] + d.seg[3]) / 2, y = (d.seg[1] + d.seg[4]) / 2, z = (d.seg[2] + d.seg[5]) / 2;
      const p = new v.cam.position.constructor(x, y, z).project(v.cam);
      return { x: c.left + (p.x * 0.5 + 0.5) * c.width, y: c.top + (-p.y * 0.5 + 0.5) * c.height, row: d.rowOfVtx[0] }; })()`);
    await click(b, [target.x, target.y]);
    await sleep(400);
    const picked = await b.ev('window.__viewer.selected');
    report(picked !== null && (projectFile || picked === target.row), `viewer: a click on a bar picks it (row ${picked}; aimed at row ${target.row})`);
    report(await b.ev('!document.getElementById("info").hidden'), 'viewer: the info card shows the picked bar');

    // The table: a click selects and zooms, sorting orders the rows, the filter narrows them.
    await b.ev('window.__viewer.select(null)');
    const rowIdx = await b.ev(`(() => { const r = document.querySelector('#tbl-rows .r:nth-child(2)'); r.click(); return Number(r.dataset.i); })()`);
    await sleep(900);
    report((await b.ev('window.__viewer.selected')) === rowIdx, `viewer: clicking a table row selects that row (${rowIdx}) and zooms to it`);
    await b.ev('document.querySelector("#tbl-head [data-key=kg]").click()');
    await sleep(300);
    const kgs = await b.ev(`Array.from(document.querySelectorAll('#tbl-rows .r')).slice(0, 3).map((r) => Number(r.children[6].textContent.replace(/,/g, '')))`);
    report(kgs.length >= 2 && kgs[0] <= kgs[1], `viewer: sorting by weight orders the rows (${kgs.join(' <= ')})`);
    const mark = await b.ev('window.__viewer.rows[0].mark');
    await b.ev(`(() => { const f = document.getElementById('filter'); f.value = ${JSON.stringify(mark)}; f.dispatchEvent(new Event('input')); })()`);
    await sleep(300);
    const count = await b.ev('document.getElementById("panel-count").textContent');
    report(/^\d+ of \d+ rows$/.test(count), `viewer: filtering by "${mark}" narrows the table (${count})`);
    await b.ev(`(() => { const f = document.getElementById('filter'); f.value = ''; f.dispatchEvent(new Event('input')); })()`);
    await b.ev('window.__viewer.select(null)');

    // The six views are orthographic, Iso is a perspective view.
    for (const [name, label] of [['top', 'Top'], ['bottom', 'Bottom'], ['front', 'Front'], ['back', 'Back'], ['left', 'Left'], ['right', 'Right']]) {
      await b.ev(`window.__viewer.goView(${JSON.stringify(name)})`);
      await settle(b);
      const s = await b.ev(`({ ortho: !!window.__viewer.cam.isOrthographicCamera, pill: document.getElementById('pill').textContent })`);
      report(s.ortho && s.pill.startsWith(label) && /Orthographic/.test(s.pill), `viewer: ${label} is an orthographic view ("${s.pill}")`);
    }
    await b.ev('window.__viewer.goView("iso")');
    await settle(b);
    const iso = await b.ev(`({ ortho: !!window.__viewer.cam.isOrthographicCamera, pill: document.getElementById('pill').textContent })`);
    report(!iso.ortho && /Perspective/.test(iso.pill), `viewer: Iso is a perspective view ("${iso.pill}")`);

    // The pill switches the projection, the BBS button hides and shows the table.
    await b.ev('document.getElementById("pill").click()');
    await sleep(300);
    const toOrtho = await b.ev('!!window.__viewer.cam.isOrthographicCamera');
    await b.ev('document.getElementById("pill").click()');
    await sleep(300);
    report(toOrtho && (await b.ev('!!window.__viewer.cam.isPerspectiveCamera')), 'viewer: the pill switches between orthographic and perspective');
    await b.ev('document.getElementById("toggle-panel").click()');
    const closed = await b.ev('document.getElementById("panel").classList.contains("closed")');
    await b.ev('document.getElementById("toggle-panel").click()');
    report(closed && !(await b.ev('document.getElementById("panel").classList.contains("closed")')), 'viewer: the BBS button hides and shows the table');

    // End-on bars are dots (fixture only: E4 runs along app Y, straight at the Front camera).
    if (!projectFile) {
      await b.ev('window.__viewer.goView("front")');
      await settle(b);
      const [dx, dy] = await toScreen(b, [1.5, 1.6, -0.1]);
      const dot = await b.ev(dotProbe(dx, dy, [59, 130, 246]));
      report(dot.n > 0, `viewer: an end-on Ø32 bar is a blue dot in the Front view (${dot.n} px)`);
      await b.ev('window.__viewer.goView("iso")');
      await settle(b);
    }

    // The legend hides and shows a diameter.
    const hiddenCount = () => b.ev('(() => { const v = window.__viewer; let n = 0; for (let i = 0; i < v.rows.length; i++) if (v.view.states[i] === 1) n++; return n; })()');
    const h0 = await hiddenCount();
    await b.ev('document.querySelector("#legend .chip").click()');
    await sleep(300);
    const h1 = await hiddenCount();
    await b.ev('document.querySelector("#legend .chip").click()');
    await sleep(300);
    const h2 = await hiddenCount();
    report(h1 > h0 && h2 === h0, `viewer: a legend chip hides its diameter and shows it again (hidden rows ${h0} -> ${h1} -> ${h2})`);

    // ⤓ Project hands back the embedded project.
    await b.ev(CAPTURE_DOWNLOADS);
    await b.ev('document.getElementById("download").click()');
    for (let i = 0; i < 80 && !(await b.ev('!!window.__dl')); i++) await sleep(100);
    const dl = await b.ev('window.__dl');
    const back = dl ? JSON.parse(dl.text) : null;
    report(!!back && back.v === 1 && JSON.stringify(back.bars) === JSON.stringify(project.bars) && !('viewerFormat' in back) && /\.json$/.test(dl.name),
      `viewer: ⤓ Project hands back the project as ${dl && dl.name}`);
    report(b.consoleErrors.length === 0, `viewer: no errors logged${b.consoleErrors.length ? ': ' + b.consoleErrors[0] : ''}`);

    // The test hooks exist only with ?autotest.
    await openViewer(b, file, { autotest: false });
    report(await b.ev('typeof window.__viewer === "undefined"'), 'viewer: without ?autotest there is no window.__viewer');

    // A damaged file shows a plain message instead of a blank page.
    const bad = path.join(outDir, 'viewer-check-bad.html');
    fs.writeFileSync(bad, fs.readFileSync(file, 'utf8').replace(/(<script id="model-data" type="text\/plain">)[^<]*/, '$1AAAA'));
    await b.send('Page.navigate', { url: pathToFileURL(bad).href });
    await sleep(1500);
    const err = await b.ev(`(() => { const l = document.getElementById('loading'); return { shown: getComputedStyle(l).display !== 'none', err: l.classList.contains('err'), text: l.textContent }; })()`);
    report(err.shown && err.err && /could not be read/.test(err.text), `viewer: a damaged file shows a plain message ("${err.text}")`);

    // An empty project opens.
    const empty = await writeViewer({ ...makeProject(), bars: [], concretes: [], refLines: [] }, 'viewer-empty', 'Empty model');
    await openViewer(b, empty.file);
    const emptyStats = await b.ev('document.getElementById("stats").textContent');
    report(/^0 rows · 0 bars · 0\.0 kg/.test(emptyStats) && b.consoleErrors.length === 0, `viewer: an empty project opens ("${emptyStats}")`);
  } finally {
    b.close();
  }
}

const sections = { viewer };
const needsApp = new Set(['export', 'roundtrip', 'scale']);
try {
  for (const [name, fn] of Object.entries(sections)) {
    if (only && only !== name) continue;
    if (needsApp.has(name) && !base) {
      if (only) { console.error(`${name} needs --url <app base url>`); process.exit(2); }
      console.log(`SKIP  ${name} (needs --url)`);
      continue;
    }
    await fn();
  }
} catch (e) {
  console.error('ERROR', e.message);
  failures += 1;
}
console.log(failures ? `RESULT: FAIL (${failures})` : 'RESULT: PASS');
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run the check to verify it fails**

Run: `node scripts/perf/check_standalone.mjs --only viewer`
Expected: exit code 2 with `public/viewer-template.html is missing: run "npm run build:viewer" first`.

- [ ] **Step 3: Write the page shell, `src/standalone/template.html`**

```html
<!doctype html>
<!-- barbending standalone viewer, format 1, built @@BARBENDING_BUILD@@. Open this file in any recent browser; the barbending app opens it too (Project > Open). -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>@@BARBENDING_TITLE@@</title>
<style>
:root { color-scheme: dark; --bg: #0b1220; --panel: #0d1730; --panel2: #111c33; --line: #243352; --text: #dbe4f5; --dim: #93a4c4; --accent: #1d4ed8; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { height: 100%; margin: 0; background: var(--bg); color: var(--text); font: 13px/1.35 system-ui, "Segoe UI", Roboto, sans-serif; overflow: hidden; }
button { font: inherit; color: var(--text); background: rgba(22, 35, 63, .9); border: 1px solid #2b3d63; border-radius: 6px; padding: 5px 10px; cursor: pointer; }
button:hover { border-color: #60a5fa; }
button.on { background: var(--accent); }
input[type=search] { font: inherit; color: var(--text); background: #0b1528; border: 1px solid #2b3d63; border-radius: 6px; padding: 5px 8px; width: 100%; }
#root { display: flex; flex-direction: column; height: 100%; }
header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 8px 12px; background: #111c33; border-bottom: 1px solid var(--line); }
#head-title { display: flex; flex-direction: column; min-width: 0; margin-right: auto; }
#title { font-size: 15px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#meta { color: var(--dim); font-size: 12px; }
#saved:not(:empty)::before { content: ' · '; }
.seg { display: inline-flex; }
.seg button { border-radius: 0; margin-left: -1px; }
.seg button:first-child { border-radius: 6px 0 0 6px; margin-left: 0; }
.seg button:last-child { border-radius: 0 6px 6px 0; }
#legend { display: flex; flex-wrap: wrap; gap: 4px; }
.chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; }
.chip i { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.chip.off { opacity: .4; }
.chk { display: inline-flex; align-items: center; gap: 5px; color: var(--dim); cursor: pointer; }
main { flex: 1; min-height: 0; display: flex; }
#viewport { position: relative; flex: 1; min-width: 0; }
#gl { display: block; width: 100%; height: 100%; touch-action: none; outline: none; }
#pill { position: absolute; right: 12px; bottom: 34px; background: rgba(15, 23, 42, .85); }
#info { position: absolute; left: 12px; bottom: 34px; max-width: min(460px, calc(100% - 24px)); background: rgba(15, 23, 42, .92); border: 1px solid #334155; border-radius: 8px; padding: 8px 12px; }
#info .dim, .dim { color: var(--dim); }
#hint { position: absolute; left: 12px; right: 12px; bottom: 8px; color: var(--dim); font-size: 11px; pointer-events: none; text-shadow: 0 0 4px #0b1220; }
#panel { width: 500px; max-width: 58vw; display: flex; flex-direction: column; background: var(--panel); border-left: 1px solid var(--line); }
#panel.closed { display: none; }
#panel-top { padding: 8px; border-bottom: 1px solid var(--line); display: flex; gap: 8px; align-items: center; }
#panel-count { color: var(--dim); font-size: 12px; white-space: nowrap; }
.g { display: grid; grid-template-columns: 34px 66px 90px 30px 40px 60px 58px minmax(70px, 1fr); gap: 4px; align-items: center; padding: 0 8px; }
.head { background: var(--panel2); border-bottom: 1px solid var(--line); height: 28px; font-weight: 600; color: var(--dim); font-size: 12px; }
.head span { cursor: pointer; white-space: nowrap; user-select: none; }
.head span:hover { color: var(--text); }
.num { text-align: right; }
#tbl-scroll { position: relative; flex: 1; overflow: auto; }
#tbl-spacer { position: relative; }
#tbl-rows { position: absolute; left: 0; right: 0; top: 0; }
.r { height: 24px; border-bottom: 1px solid #16233f; cursor: pointer; white-space: nowrap; overflow: hidden; }
.r span { overflow: hidden; text-overflow: ellipsis; }
.r:hover { background: #14213d; }
.r.sel { background: #1d4ed8; }
#loading { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: var(--bg); color: var(--dim); font-size: 15px; text-align: center; padding: 24px; z-index: 10; }
#loading.err { color: #fca5a5; }
@media (max-width: 820px) {
  header { flex-wrap: nowrap; overflow-x: auto; gap: 8px; }
  header > * { flex: 0 0 auto; }
  #head-title { min-width: 220px; margin-right: 4px; }
  #legend { flex-wrap: nowrap; }
  main { flex-direction: column; }
  #panel { width: 100%; max-width: none; height: 42%; border-left: 0; border-top: 1px solid var(--line); }
  #hint { display: none; }
  #info { bottom: 8px; }
  #pill { bottom: 8px; }
}
</style>
</head>
<body>
<div id="root">
  <header>
    <div id="head-title"><span id="title">barbending model</span><span id="meta"><span id="stats"></span><span id="saved"></span></span></div>
    <div class="seg" id="views"></div>
    <button id="fit" title="Fit the whole model in view (F)">Fit all</button>
    <label class="chk"><input type="checkbox" id="concrete" checked> Concrete</label>
    <div id="legend" title="Click a diameter to hide or show it"></div>
    <button id="download" title="Download the project file (.json) to open in the barbending app">⤓ Project</button>
    <button id="toggle-panel" class="on">BBS</button>
  </header>
  <main>
    <section id="viewport">
      <canvas id="gl" tabindex="0"></canvas>
      <button id="pill" title="Switch between orthographic and perspective"></button>
      <div id="info" hidden></div>
      <div id="hint">drag = orbit · wheel = zoom · right-drag = pan · click a bar for its details · F = fit · Esc = deselect</div>
    </section>
    <aside id="panel">
      <div id="panel-top"><input type="search" id="filter" placeholder="Filter by mark, type, Ø or member"><span id="panel-count"></span></div>
      <div class="g head" id="tbl-head"></div>
      <div id="tbl-scroll"><div id="tbl-spacer"><div id="tbl-rows"></div></div></div>
    </aside>
  </main>
</div>
<div id="loading">Loading model…<noscript> This viewer needs JavaScript.</noscript></div>
<script id="model-data" type="text/plain">@@BARBENDING_DATA@@</script>
<script>
@@BARBENDING_SCRIPT@@
</script>
</body>
</html>
```

- [ ] **Step 4: Write the viewer, `src/standalone/viewer.js`**

This is the prototype (`prototype-viewer/src/viewer.js`) with its import paths moved, the data read through the shared codec, the totals line in the app's format, the renderer settings of the spec, and the test hooks behind `?autotest`.

```js
// The standalone viewer: a whole barbending project in ONE .html file. This script is the app's own pure modules (bar geometry, the
// chunked line / tube renderer with its level of detail and end-on dots, picking, camera maths and the BBS calculations) bundled with
// three.js, plus a small vanilla UI. The project sits in <script id="model-data"> as gzipped, base64-encoded JSON (see pack.js), so the
// file needs no server, no install and no network.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildField, DIA_PALETTE } from '../viewer/barfield/buildField.js';
import { FieldView } from '../viewer/barfield/fieldObjects.js';
import { chooseTubeChunks } from '../viewer/barfield/lod.js';
import { cameraEndOnAxis } from '../viewer/barfield/endOn.js';
import { pickField } from '../viewer/barfield/fieldPick.js';
import { STATE, computeHiddenMask } from '../viewer/barfield/rowState.js';
import { qualityState } from '../viewer/barfield/qualityState.js';
import { PALETTE_HEX } from '../viewer/barfield/fieldShaders.js';
import {
  VIEW_OFFSETS, VIEW_LABELS, isAxisView, viewFromForward, viewMetrics, slerpDirection, boxHalfExtentsAlong,
  fitZoomForBox, clampOrthoZoom, PERSP_FOV_DEG, ORTHO_DEPTH, MIN_VISIBLE_M, MAX_VISIBLE_M,
} from '../viewer/cameraMath.js';
import { switchProjection, setOrthoZoom } from '../viewer/cameraOps.js';
import { enrichBar, concreteVolumeM3, rebarRatioKgM3 } from '../bbs/csv.js';
import { rowAppBox } from '../viewer/regionSelect.js';
import { gunzipBytes, fromBase64 } from './codec.js';

const S = 0.001; // app mm -> scene metres (x, z up, -y)
const ROW_H = 24;
const qs = new URLSearchParams(window.location.search);
const AUTOTEST = qs.has('autotest'); // test hooks (window.__viewer) and a readable canvas, only when asked for
const KEEP_BUFFER = AUTOTEST && qs.get('autotest') !== 'nobuffer'; // ?autotest=nobuffer: the hooks without the slower readable canvas (fps runs)
const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches; // phones and tablets
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n, d = 0) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const nextPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const failScreen = (msg) => { const l = $('loading'); l.className = 'err'; l.textContent = msg; l.hidden = false; };
const typeLabel = (t) => String(t || '').replace(/_/g, ' ');

async function loadModel() {
  const text = new TextDecoder().decode(await gunzipBytes(fromBase64($('model-data').textContent.trim())));
  return JSON.parse(text);
}

async function main() {
  if (typeof DecompressionStream === 'undefined') {
    failScreen('This browser is too old to open the model. Please use a recent Chrome, Edge, Firefox or Safari.');
    return;
  }
  let project;
  try { project = await loadModel(); } catch (e) { failScreen('The model data in this file could not be read: ' + e.message); return; }
  const bars = project.bars || [];
  const concretes = project.concretes || [];
  $('title').textContent = project.title || 'barbending model';
  $('loading').textContent = `Building ${fmt(bars.length)} rows…`;
  await nextPaint();

  // ---- the BBS rows and totals (the same numbers, in the same words, as the app's BBS header) ----
  const hostNames = new Map(concretes.map((c) => [c.id, c.name || c.id]));
  const rows = bars.map((b, i) => {
    const e = enrichBar(b, concretes);
    return {
      i, mark: String(e.Bar_mark || ''), type: typeLabel(e.Rebar_Type), dia: Number(e.Dia) || 0, copies: e._copies, cut: e._cut,
      kg: e.Weight_kg, host: hostNames.get(e.host) || e.host || '',
    };
  });
  const totalBars = rows.reduce((s, r) => s + (r.copies || 1), 0);
  const totalKg = rows.reduce((s, r) => s + (r.kg || 0), 0);
  const concM3 = concretes.reduce((s, c) => s + concreteVolumeM3(c), 0); // every member, hidden or not, as the app's BBS header does
  const ratio = rebarRatioKgM3(totalKg, concM3);
  $('stats').textContent = `${rows.length} rows · ${totalBars} bars · ${totalKg.toFixed(1)} kg · ${concM3.toFixed(3)} m³ concrete · ${ratio == null ? 'n/a' : `${ratio.toFixed(1)} kg/m³`}`;
  $('saved').textContent = project.savedAt ? `saved ${new Date(project.savedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : '';

  // ---- renderer, scene ----
  const canvas = $('gl');
  const viewport = $('viewport');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true, powerPreference: 'high-performance', preserveDrawingBuffer: KEEP_BUFFER });
  } catch {
    failScreen('This browser could not start WebGL, which the 3D view needs.');
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, COARSE ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; // what the app's canvas uses
  renderer.localClippingEnabled = true; // the section box cuts through material clipping planes
  if (COARSE) qualityState.budgetTris = 1_500_000; // weaker GPUs: fewer tube triangles
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0f172a');
  scene.add(new THREE.AmbientLight('#ffffff', 0.7));
  scene.add(new THREE.HemisphereLight('#ffffff', '#475569', 0.55));
  const sun = new THREE.DirectionalLight('#ffffff', 1.2);
  sun.position.set(8, 10, 6);
  scene.add(sun);

  // ---- the bars: the app's chunked field (lines far, tubes near) ----
  const data = buildField(bars);
  const view = new FieldView(data, { deltaCapacity: 0, clipping: false });
  scene.add(view.group);
  const hiddenMask = computeHiddenMask({ bars, concretes });
  const slotOf = data.rows.colorIdx;

  // ---- the concrete members (ghost boxes or exact meshes, like the app's default look) ----
  const concreteGroup = new THREE.Group();
  const ghost = new THREE.MeshStandardMaterial({ color: '#94a3b8', transparent: true, opacity: 0.25, roughness: 0.8, metalness: 0, depthWrite: false, side: THREE.DoubleSide });
  const edgeMat = new THREE.LineBasicMaterial({ color: '#475569', transparent: true, opacity: 0.85 });
  const box = new THREE.Box3();
  for (const c of concretes) {
    if (c.visible === false) continue;
    let g;
    const md = c.meshData;
    if (md && md.positions && md.positions.length && md.indices && md.indices.length) {
      g = new THREE.BufferGeometry();
      const p = md.positions;
      const out = new Float32Array(p.length);
      for (let k = 0; k < p.length; k += 3) { out[k] = p[k] * S; out[k + 1] = p[k + 2] * S; out[k + 2] = -p[k + 1] * S; }
      g.setAttribute('position', new THREE.BufferAttribute(out, 3));
      g.setIndex(md.indices);
      g.computeVertexNormals();
    } else {
      g = new THREE.BoxGeometry(c.lx * S, c.lz * S, c.ly * S);
      g.translate((c.x + c.lx / 2) * S, (c.z + c.lz / 2) * S, -((c.y + c.ly / 2) * S));
    }
    g.computeBoundingBox();
    box.union(g.boundingBox);
    concreteGroup.add(new THREE.Mesh(g, ghost));
    concreteGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), edgeMat));
  }
  scene.add(concreteGroup);
  if (data.segCount > 0) box.union(new THREE.Box3(new THREE.Vector3(...data.bounds.min), new THREE.Vector3(...data.bounds.max)));
  if (box.isEmpty()) box.set(new THREE.Vector3(-5, -2, -5), new THREE.Vector3(5, 3, 5));
  const modelSize = box.getSize(new THREE.Vector3());
  const modelRadius = Math.max(0.5 * modelSize.length(), 1);
  // Grid cells that suit the model: a 1-2-5 step giving about 14 cells across it.
  const niceStep = (x) => { const p = 10 ** Math.floor(Math.log10(x)); const m = x / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; };
  const extent = Math.max(modelSize.x, modelSize.z, 1);
  const gridStep = niceStep(Math.max(extent / 14, 0.25));
  const gridSize = Math.ceil((extent * 1.6) / gridStep) * gridStep;
  const grid = new THREE.GridHelper(gridSize, Math.round(gridSize / gridStep), '#334155', '#1e293b');
  grid.position.set(box.getCenter(new THREE.Vector3()).x, -0.01, box.getCenter(new THREE.Vector3()).z);
  scene.add(grid);

  // ---- two cameras, one set of orbit controls each; only one pair is active ----
  const persp = new THREE.PerspectiveCamera(PERSP_FOV_DEG, 1, Math.max(0.005, modelRadius / 4000), Math.max(1000, modelRadius * 40));
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -ORTHO_DEPTH, ORTHO_DEPTH);
  const ctlP = new OrbitControls(persp, canvas);
  const ctlO = new OrbitControls(ortho, canvas);
  for (const c of [ctlP, ctlO]) Object.assign(c, { enableDamping: true, dampingFactor: 0.12, zoomToCursor: true, screenSpacePanning: true, zoomSpeed: 1.1 });
  ctlP.minDistance = 0.004;
  ctlP.maxDistance = Math.max(600, modelRadius * 30);
  ctlO.enabled = false;
  let cam = persp;
  let ctl = ctlP;
  let needsRender = true;
  const dirty = () => { needsRender = true; };
  ctlP.addEventListener('change', dirty);
  ctlO.addEventListener('change', dirty);

  function resize() {
    const w = Math.max(viewport.clientWidth, 1);
    const h = Math.max(viewport.clientHeight, 1);
    renderer.setSize(w, h, false);
    persp.aspect = w / h;
    persp.updateProjectionMatrix();
    ortho.left = -w / 2; ortho.right = w / 2; ortho.top = h / 2; ortho.bottom = -h / 2;
    ctlO.minZoom = h / MAX_VISIBLE_M;
    ctlO.maxZoom = h / MIN_VISIBLE_M;
    ortho.updateProjectionMatrix();
    dirty();
  }
  new ResizeObserver(resize).observe(viewport);
  resize();

  // ---- tweens (view changes and fits) ----
  let tween = null;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
  const animate = (ms, fn) => { tween = { t0: performance.now(), ms, fn }; };
  function tweenStep(now) {
    if (!tween) return;
    const t = Math.min(1, (now - tween.t0) / tween.ms);
    tween.fn(ease(t));
    dirty();
    if (t >= 1) tween = null;
  }

  function switchTo(next) {
    const toOrtho = next === 'ortho';
    if (toOrtho === !!cam.isOrthographicCamera) return;
    const to = toOrtho ? { cam: ortho, ctl: ctlO } : { cam: persp, ctl: ctlP };
    switchProjection({
      next, fromCam: cam, fromCtl: ctl, toCam: to.cam, toCtl: to.ctl, width: viewport.clientWidth, height: viewport.clientHeight, perspFovDeg: PERSP_FOV_DEG,
    });
    cam = to.cam;
    ctl = to.ctl;
    ctl.update();
    dirty();
  }

  function goView(name) {
    switchTo(isAxisView(name) ? 'ortho' : 'persp');
    const startVec = cam.position.clone().sub(ctl.target);
    const dist = Math.max(startVec.length(), 1e-3);
    const a = startVec.toArray();
    const b = VIEW_OFFSETS[name];
    animate(450, (t) => {
      const d = slerpDirection(a, b, t);
      cam.position.set(ctl.target.x + d[0] * dist, ctl.target.y + d[1] * dist, ctl.target.z + d[2] * dist);
      ctl.update();
    });
  }

  // Frame a box (scene metres), keeping the view direction.
  function fitTo(b3, instant = false) {
    const center = b3.getCenter(new THREE.Vector3());
    const size = b3.getSize(new THREE.Vector3());
    const half = [size.x / 2, size.y / 2, size.z / 2];
    const dirNow = cam.position.clone().sub(ctl.target).normalize();
    const startTarget = ctl.target.clone();
    const startPos = cam.position.clone();
    const startZoom = cam.zoom;
    const radius = Math.max(Math.hypot(...half), 0.05);
    let endPos;
    let endZoom = startZoom;
    if (cam.isOrthographicCamera) {
      cam.updateMatrixWorld(true);
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).toArray();
      const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).toArray();
      const [hx, hy] = boxHalfExtentsAlong(half, right, up);
      const h = viewport.clientHeight;
      endZoom = clampOrthoZoom(fitZoomForBox({
        halfExtentX: Math.max(hx, 0.05), halfExtentY: Math.max(hy, 0.05), viewportWidthPx: viewport.clientWidth, viewportHeightPx: h, margin: 1.15,
      }), h);
      endPos = center.clone().addScaledVector(dirNow, startPos.distanceTo(startTarget));
    } else {
      const fovV = (PERSP_FOV_DEG * Math.PI) / 180;
      const fovH = 2 * Math.atan(Math.tan(fovV / 2) * persp.aspect);
      endPos = center.clone().addScaledVector(dirNow, Math.max((radius * 1.08) / Math.sin(Math.min(fovV, fovH) / 2), 0.02));
    }
    const apply = (t) => {
      ctl.target.lerpVectors(startTarget, center, t);
      cam.position.lerpVectors(startPos, endPos, t);
      if (cam.isOrthographicCamera) setOrthoZoom(cam, startZoom * Math.pow(endZoom / startZoom, t));
      ctl.update();
    };
    if (instant) apply(1); else animate(400, apply);
  }
  const fitAll = (instant = false) => fitTo(box.clone().expandByScalar(0.05), instant);
  const rowBox = (i) => {
    const a = rowAppBox(bars[i]);
    if (!a) return box;
    return new THREE.Box3(new THREE.Vector3(a[0] * S, a[2] * S, -a[4] * S), new THREE.Vector3(a[3] * S, a[5] * S, -a[1] * S)).expandByScalar(0.25);
  };

  // ---- level of detail, rendering (on demand: a frame is drawn only when something changed) ----
  const lod = { last: 0, prev: new Set(), cam: new THREE.Matrix4(), zoom: 0, ortho: false, budget: 0 };
  const frustum = new THREE.Frustum();
  const projView = new THREE.Matrix4();
  const fwd = new THREE.Vector3();
  const bufSize = new THREE.Vector2();
  let frames = 0;
  function renderNow(now) {
    cam.updateMatrixWorld();
    const ortho = !!cam.isOrthographicCamera;
    cam.getWorldDirection(fwd);
    renderer.getDrawingBufferSize(bufSize);
    // End-on bars (a bar pointing straight at an orthographic camera) become dots, not nothing.
    view.setCameraState({
      endOnAxis: ortho ? cameraEndOnAxis([fwd.x, fwd.y, fwd.z]) : 0, pxX: 2 / Math.max(bufSize.x, 1), pxY: 2 / Math.max(bufSize.y, 1), ortho, forward: fwd,
    });
    const unchanged = lod.ortho === ortho && lod.budget === qualityState.budgetTris && lod.cam.equals(cam.matrixWorld) && lod.zoom === cam.zoom;
    if (!unchanged) {
      if (now - lod.last >= 100) {
        lod.last = now; lod.ortho = ortho; lod.budget = qualityState.budgetTris; lod.zoom = cam.zoom; lod.cam.copy(cam.matrixWorld);
        projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        frustum.setFromProjectionMatrix(projView);
        const tubes = chooseTubeChunks({
          chunks: view.items.map((it) => it.chunk),
          cameraPos: ortho ? [ctl.target.x, ctl.target.y, ctl.target.z] : [cam.position.x, cam.position.y, cam.position.z],
          ...viewMetrics(cam, viewport.clientHeight || 800),
          budgetTris: qualityState.budgetTris,
          prevTubes: lod.prev,
          detail: 'auto',
          isVisible: (i) => frustum.intersectsSphere(view.items[i].sphere),
        });
        view.applyTubeSet(tubes);
        lod.prev = tubes;
      } else {
        dirty(); // too soon after the last level-of-detail pass: look again next frame
      }
    }
    renderer.render(scene, cam);
    frames += 1;
    $('pill').textContent = `${VIEW_LABELS[viewFromForward([fwd.x, fwd.y, fwd.z])] || 'Free'} · ${ortho ? 'Orthographic' : 'Perspective'}`;
  }
  (function frame(now) {
    requestAnimationFrame(frame);
    tweenStep(now);
    const moved = ctl.update();
    if (moved || needsRender) { needsRender = false; renderNow(now); }
  })(performance.now());

  // ---- selection (a clicked bar or table row is tinted white) ----
  let selected = null;
  const hiddenSlots = new Set();
  function applyStates() {
    const st = new Uint8Array(view.texelCount);
    for (let i = 0; i < data.rowCount; i++) st[i] = hiddenMask[i] || hiddenSlots.has(slotOf[i]) ? STATE.HIDDEN : STATE.NORMAL;
    if (selected !== null && st[selected] !== STATE.HIDDEN) st[selected] = STATE.TINT;
    view.setStates(st);
    dirty();
  }
  function showInfo() {
    const card = $('info');
    if (selected === null) { card.hidden = true; return; }
    const r = rows[selected];
    const b = bars[selected];
    card.innerHTML = `<b>${esc(r.mark || '(no mark)')}</b> · ${esc(r.type)} · Ø${r.dia}<br>`
      + `${fmt(r.copies)} bar${r.copies === 1 ? '' : 's'} · cut length ${fmt(r.cut)} mm · ${fmt(r.kg, 2)} kg<br>`
      + `<span class="dim">${esc(r.host || 'no member')} · from ${fmt(b.Pos_x)}, ${fmt(b.Pos_y)}, ${fmt(b.Pos_z)} mm</span>`;
    card.hidden = false;
  }
  function select(i, { zoom = false, scrollTable = true } = {}) {
    selected = i;
    applyStates();
    showInfo();
    if (i !== null && scrollTable) {
      const k = order.indexOf(i);
      const sc = $('tbl-scroll');
      if (k >= 0 && (k * ROW_H < sc.scrollTop || (k + 1) * ROW_H > sc.scrollTop + sc.clientHeight)) sc.scrollTop = Math.max(0, (k - 3) * ROW_H);
    }
    renderTable();
    if (zoom && i !== null) fitTo(rowBox(i));
  }

  // ---- picking: the app's ray picker on the bar data ----
  const raycaster = new THREE.Raycaster();
  function pickAt(clientX, clientY, touch) {
    const r = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), cam);
    const m = viewMetrics(cam, r.height);
    const hit = pickField(data, { origin: raycaster.ray.origin.toArray(), dir: raycaster.ray.direction.toArray() }, {
      fovRad: m.fovRad, viewportHeightPx: m.viewportHeightPx, tolPx: touch ? 14 : 7, rowStates: view.states, rowRadiusM: view.radiusM,
      worldPerPixel: m.pxPerMeter ? 1 / m.pxPerMeter : null,
    });
    return hit ? hit.row : null;
  }
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button }; });
  canvas.addEventListener('pointerup', (e) => {
    if (down && down.button === 0 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5 && performance.now() - down.t < 700) {
      select(pickAt(e.clientX, e.clientY, e.pointerType === 'touch'));
    }
    down = null;
  });

  // ---- the BBS table: sortable, filterable, windowed (only the visible rows are in the page) ----
  const cols = [['#', 'i', true], ['Mark', 'mark'], ['Type', 'type'], ['Ø', 'dia', true], ['Bars', 'copies', true], ['Cut (mm)', 'cut', true], ['Wt (kg)', 'kg', true], ['Member', 'host']];
  $('tbl-head').innerHTML = cols.map(([label, key, num]) => `<span data-key="${key}"${num ? ' class="num"' : ''}>${label}</span>`).join('');
  let order = rows.map((r) => r.i);
  let sortKey = 'i';
  let sortDir = 1;
  function rebuildOrder() {
    const q = $('filter').value.trim().toLowerCase();
    let list = rows;
    if (q) list = rows.filter((r) => `${r.mark} ${r.type} ${r.dia} ${r.host}`.toLowerCase().includes(q));
    const num = typeof rows[0]?.[sortKey] === 'number';
    list = list.slice().sort((a, b) => (num ? a[sortKey] - b[sortKey] : String(a[sortKey]).localeCompare(String(b[sortKey]), undefined, { numeric: true })) * sortDir || a.i - b.i);
    order = list.map((r) => r.i);
    $('panel-count').textContent = q ? `${fmt(order.length)} of ${fmt(rows.length)} rows` : `${fmt(rows.length)} rows`;
    $('tbl-scroll').scrollTop = 0;
    renderTable();
  }
  function renderTable() {
    const sc = $('tbl-scroll');
    const first = Math.max(0, Math.floor(sc.scrollTop / ROW_H) - 6);
    const last = Math.min(order.length, Math.ceil((sc.scrollTop + sc.clientHeight) / ROW_H) + 6);
    $('tbl-spacer').style.height = `${order.length * ROW_H}px`;
    let html = '';
    for (let k = first; k < last; k++) {
      const r = rows[order[k]];
      html += `<div class="g r${r.i === selected ? ' sel' : ''}" data-i="${r.i}"><span class="num">${r.i + 1}</span><span>${esc(r.mark)}</span><span>${esc(r.type)}</span>`
        + `<span class="num">${r.dia}</span><span class="num">${fmt(r.copies)}</span><span class="num">${fmt(r.cut)}</span><span class="num">${fmt(r.kg, 2)}</span><span>${esc(r.host)}</span></div>`;
    }
    const el = $('tbl-rows');
    el.style.transform = `translateY(${first * ROW_H}px)`;
    el.innerHTML = html;
  }
  let scrollQueued = false;
  $('tbl-scroll').addEventListener('scroll', () => { if (!scrollQueued) { scrollQueued = true; requestAnimationFrame(() => { scrollQueued = false; renderTable(); }); } });
  $('tbl-rows').addEventListener('click', (e) => { const r = e.target.closest('.r'); if (r) select(Number(r.dataset.i), { zoom: true, scrollTable: false }); });
  $('tbl-head').addEventListener('click', (e) => {
    const key = e.target.dataset && e.target.dataset.key;
    if (!key) return;
    sortDir = key === sortKey ? -sortDir : 1;
    sortKey = key;
    rebuildOrder();
  });
  $('filter').addEventListener('input', rebuildOrder);
  new ResizeObserver(renderTable).observe($('tbl-scroll'));

  // ---- toolbar ----
  $('views').innerHTML = ['iso', 'front', 'back', 'left', 'right', 'top', 'bottom'].map((n) => `<button data-v="${n}">${VIEW_LABELS[n] || n}</button>`).join('');
  $('views').addEventListener('click', (e) => { const n = e.target.dataset && e.target.dataset.v; if (n) goView(n); });
  $('fit').addEventListener('click', () => fitAll());
  $('pill').addEventListener('click', () => switchTo(cam.isOrthographicCamera ? 'persp' : 'ortho'));
  $('concrete').addEventListener('change', (e) => { concreteGroup.visible = e.target.checked; dirty(); });
  $('toggle-panel').addEventListener('click', (e) => { $('panel').classList.toggle('closed'); e.target.classList.toggle('on'); });
  // ⤓ Project: the embedded project, as the .json the app's ⤒ Project opens.
  $('download').addEventListener('click', () => {
    const projectOnly = Object.fromEntries(Object.entries(project).filter(([k]) => k !== 'viewerFormat' && k !== 'title'));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(projectOnly, null, 2)], { type: 'application/json' }));
    a.download = `${(project.title || 'barbending-model').replace(/[^\w.-]+/g, '_')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  // The diameter legend doubles as a filter.
  const slotCount = new Array(PALETTE_HEX.length).fill(0);
  for (let i = 0; i < data.rowCount; i++) slotCount[slotOf[i]] += 1;
  $('legend').innerHTML = slotCount.map((n, s) => (n ? `<button class="chip" data-s="${s}"><i style="background:${PALETTE_HEX[s]}"></i>${s < DIA_PALETTE.length ? `Ø${DIA_PALETTE[s]}` : 'other Ø'}</button>` : '')).join('');
  $('legend').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    const s = Number(btn.dataset.s);
    if (hiddenSlots.has(s)) hiddenSlots.delete(s); else hiddenSlots.add(s);
    btn.classList.toggle('off', hiddenSlots.has(s));
    applyStates();
  });
  window.addEventListener('keydown', (e) => {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    if (e.key === 'Escape') select(null);
    else if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); fitAll(); }
  });

  // ---- go ----
  if (window.innerWidth <= 820) { $('panel').classList.add('closed'); $('toggle-panel').classList.remove('on'); } // phones: the table opens on demand
  rebuildOrder();
  applyStates();
  cam.position.set(...VIEW_OFFSETS.iso);
  ctl.target.set(0, 0, 0);
  fitAll(true);
  showInfo();
  $('loading').hidden = true;
  if (AUTOTEST) {
    window.__viewer = {
      rows, bars, view, data, scene, renderer, bounds: { min: box.min.toArray(), max: box.max.toArray() },
      get cam() { return cam; }, get ctl() { return ctl; }, get frames() { return frames; }, get selected() { return selected; },
      select, goView, fitAll, switchTo, pick: pickAt,
    };
  }
}

main().catch((e) => { console.error(e); failScreen('Something went wrong opening the model: ' + (e && e.message ? e.message : e)); });
```

- [ ] **Step 5: Write the build script, `scripts/build-viewer.mjs`**

```js
// Builds the standalone viewer template: public/viewer-template.html (git-ignored; copied to dist/ by `vite build`).
// usage: node scripts/build-viewer.mjs        (npm run build:viewer; `predev` and `prebuild` run it)
// src/standalone/viewer.js (with three.js and the app's own pure modules) is bundled to one IIFE with Vite's library mode and written
// inline into src/standalone/template.html. What is left to fill in at export time are the two tokens the app replaces: the title and
// the data (see src/standalone/pack.js). A failing build exits 1, which aborts `npm run dev` / `npm run build`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { TOKEN_TITLE, TOKEN_DATA, TOKEN_SCRIPT, TOKEN_BUILD, countOf } from '../src/standalone/pack.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const fail = (msg) => { console.error(`build-viewer: ${msg}`); process.exit(1); };
const MAX_SCRIPT_BYTES = 800 * 1024; // the spec's budget for the minified viewer script

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'barbending-viewer-'));
try {
  await build({
    configFile: false,
    root,
    logLevel: 'warn',
    build: {
      lib: { entry: path.join(root, 'src', 'standalone', 'viewer.js'), formats: ['iife'], name: 'BarbendingViewer', fileName: () => 'viewer.js' },
      outDir: tmp,
      emptyOutDir: true,
      copyPublicDir: false,
      minify: true,
      target: 'es2020',
      sourcemap: false,
    },
  });
  // Nothing in the inline script may end it early: "</script" and the comment opener "<!--" are escaped (both are valid inside JS strings).
  const js = fs.readFileSync(path.join(tmp, 'viewer.js'), 'utf8').replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  if (Buffer.byteLength(js) > MAX_SCRIPT_BYTES) fail(`the viewer script is ${kb(Buffer.byteLength(js))}, over the ${kb(MAX_SCRIPT_BYTES)} budget`);

  let html = fs.readFileSync(path.join(root, 'src', 'standalone', 'template.html'), 'utf8');
  for (const token of [TOKEN_TITLE, TOKEN_DATA, TOKEN_SCRIPT, TOKEN_BUILD]) {
    if (countOf(html, token) !== 1) fail(`src/standalone/template.html must contain ${token} exactly once`);
  }
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  html = html.replace(TOKEN_BUILD, () => stamp).replace(TOKEN_SCRIPT, () => js);
  for (const token of [TOKEN_TITLE, TOKEN_DATA]) {
    const n = countOf(html, token);
    if (n !== 1) fail(`${token} appears ${n} times in the built template (the viewer script must not contain it)`);
  }
  if (countOf(html, '<script') !== 2 || countOf(html, '</script') !== 2) fail('the built template must have exactly two script elements');

  const outFile = path.join(root, 'public', 'viewer-template.html');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, html);
  const size = Buffer.byteLength(html);
  console.log(`build-viewer: public/viewer-template.html  script ${kb(Buffer.byteLength(js))} (${kb(zlib.gzipSync(js).length)} gzipped), template ${kb(size)} (${kb(zlib.gzipSync(html).length)} gzipped)`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
```

- [ ] **Step 6: Wire the npm scripts and the git-ignore**

In `package.json` replace
```
    "dev": "vite --open --host",
    "build": "vite build",
```
with
```
    "dev": "vite --open --host",
    "predev": "npm run build:viewer",
    "build": "vite build",
    "prebuild": "npm run build:viewer",
    "build:viewer": "node scripts/build-viewer.mjs",
```

Append to `.gitignore` (after the `scripts/perf/out/` line):
```

# Generated standalone-viewer template (npm run build:viewer)
public/viewer-template.html
```

- [ ] **Step 7: Build the template**

Run: `npm run build:viewer`
Expected: `build-viewer: public/viewer-template.html  script ~6xx KB (~1xx KB gzipped), template ~6xx KB (...)`, exit 0. (The prototype's script was 592 KB; anything under 800 KB passes.)

Run: `git status --short public/` — expected: no output (the file is ignored).

- [ ] **Step 8: Run the check**

Run: `node scripts/perf/check_standalone.mjs --only viewer`
Expected: every line `PASS`, ending `RESULT: PASS`. The fixture file is a few KB over the template size (about 620 KB), opening takes well under 3 s.

If the empty-project step fails (`buildField([])` or `box` handling), fix the viewer (an empty project must open with a loading screen that goes away) and re-run. If the six views report a label other than `Top`, `Bottom`, `Front`, `Back`, `Left`, `Right`, read `VIEW_LABELS` in `src/viewer/cameraMath.js` and correct the check's table, not the viewer.

Also run the check on the user's real model, if its save is present (not part of the commit):
`node scripts/perf/check_standalone.mjs --only viewer --project inputs/saves/barbending-project-20261007-1814_ent3_with_group.json --max-kb 800`
Expected: `PASS` for the 800 KB budget (the prototype's file was 627 KB).

- [ ] **Step 9: Check the hooks and the production build**

Run: `npm run predev` — expected: the same `build-viewer:` line, exit 0.
Run: `npm run build 2>&1 | tail -6` — expected: the `build-viewer:` line first, then Vite's build output, exit 0.
Run: `ls dist/viewer-template.html` — expected: the file exists (Vite copied `public/`).
Run: `npm test 2>&1 | tail -6` and `npx oxlint src scripts tests 2>&1 | grep -c ": warning "` — expected: all tests pass; `29`.

- [ ] **Step 10: Commit**

```bash
git add src/standalone/template.html src/standalone/viewer.js scripts/build-viewer.mjs scripts/perf/check_standalone.mjs package.json .gitignore
git commit -m "feat(viewer-export): the standalone viewer, its build script and a browser check" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 4: The `⤓ Viewer` button

**Files:**
- Create: `src/standalone/exportViewer.js`
- Create: `tests/standalone/exportViewer.test.mjs`
- Modify: `src/App.jsx` (imports; `FileBar`: state, handler, button)
- Modify: `scripts/perf/check_standalone.mjs` (the app helpers and the `export` section)

**Interfaces:**
- Consumes: from Task 1 `packViewerHtml`, `cleanViewerTitle`, `viewerFileName`, `DEFAULT_VIEWER_TITLE`, `TOKEN_TITLE`, `TOKEN_DATA`; from Task 3 `public/viewer-template.html` and the `check_standalone.mjs` helpers.
- Produces:
  - `exportViewer.js`: `MISSING_TEMPLATE` (the exact message) and `loadViewerTemplate({ url, fetchFn? }): Promise<string>`.
  - `check_standalone.mjs` helpers for the app: `waitFor(b, expr, ms)`, `importFile(b, filePath, which)` (0 = `⤒ Project` input, 1 = `⤒+ Insert` input), `openApp(b, projectPath, rowCount, query?)`, `exportFromApp(b, title)` → `{ dl: { name, text } | null, ms, alerts }`, `viewerButtonState(b)`, `clickViewerButton(b)`.

- [ ] **Step 1: Write the failing unit tests**

Create `tests/standalone/exportViewer.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadViewerTemplate, MISSING_TEMPLATE } from '../../src/standalone/exportViewer.js';
import { TOKEN_TITLE, TOKEN_DATA } from '../../src/standalone/pack.js';

const TEMPLATE = `<title>${TOKEN_TITLE}</title><script id="model-data" type="text/plain">${TOKEN_DATA}</script>`;
const url = '/viewer-template.html';

test('the message is the one the spec gives', () => {
  assert.equal(MISSING_TEMPLATE, 'The viewer template is missing: run "npm run build:viewer", then reload.');
});

test('a served template is returned as it is', async () => {
  const seen = [];
  const fetchFn = async (u, opts) => { seen.push([u, opts]); return new Response(TEMPLATE); };
  assert.equal(await loadViewerTemplate({ url, fetchFn }), TEMPLATE);
  assert.equal(seen[0][0], url);
  assert.equal(seen[0][1].cache, 'no-cache', 'a rebuilt template is picked up without clearing the cache');
});

test('a 404, a failed request, and an index.html answered with status 200 all mean "template missing"', async () => {
  const answers = [
    async () => new Response('not found', { status: 404 }),
    async () => { throw new TypeError('Failed to fetch'); },
    async () => new Response('<!doctype html><html><body><div id="root"></div></body></html>', { status: 200 }), // a dev server's fallback
    async () => new Response(`<title>${TOKEN_TITLE}</title>`, { status: 200 }), // only one of the two tokens
  ];
  for (const fetchFn of answers) {
    await assert.rejects(loadViewerTemplate({ url, fetchFn }), (err) => err.message === MISSING_TEMPLATE);
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/standalone/exportViewer.test.mjs`
Expected: FAIL (`Cannot find module '.../exportViewer.js'`).

- [ ] **Step 3: Write `src/standalone/exportViewer.js`**

```js
// The app's side of "⤓ Viewer": fetch the generated viewer template (public/viewer-template.html, built by `npm run build:viewer`).
// `url` and `fetchFn` are parameters so this module touches no browser global at import time and Node tests can drive it.
import { TOKEN_TITLE, TOKEN_DATA } from './pack.js';

export const MISSING_TEMPLATE = 'The viewer template is missing: run "npm run build:viewer", then reload.';

export async function loadViewerTemplate({ url, fetchFn = (...args) => fetch(...args) }) {
  let text = '';
  try {
    const res = await fetchFn(url, { cache: 'no-cache' });
    if (res && res.ok) text = await res.text();
  } catch {
    // offline, or nothing is served there: handled as a missing template below
  }
  // A dev server answers an unknown path with index.html and status 200, so look for the template's own two tokens.
  if (!text.includes(TOKEN_TITLE) || !text.includes(TOKEN_DATA)) throw new Error(MISSING_TEMPLATE);
  return text;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/standalone/exportViewer.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the `export` check (it fails: there is no button yet)**

In `scripts/perf/check_standalone.mjs`:

1. Replace the import line `import { packViewerHtml } from '../../src/standalone/pack.js';` with
```js
import { isDeepStrictEqual } from 'node:util';
import { packViewerHtml, extractProjectFromHtml } from '../../src/standalone/pack.js';
```

2. Replace the line `const sections = { viewer };` with the following block (the functions, then the registry line):

```js
// ---- sections that drive the real app (need --url) ----
async function waitFor(b, expr, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await b.ev(expr, 15000).catch(() => false)) return true;
    await sleep(150);
  }
  return false;
}

// Gives one of the app's hidden file inputs (0 = ⤒ Project, 1 = ⤒+ Insert) a file, as a user picking it would.
async function importFile(b, filePath, which = 0) {
  const root = await b.send('DOM.getDocument', { depth: 0 });
  const q = await b.send('DOM.querySelectorAll', { nodeId: root.root.nodeId, selector: 'input[type=file]' });
  await b.send('DOM.setFileInputFiles', { files: [filePath], nodeId: q.nodeIds[which] });
}

// Opens the app and imports a project file; waits until the store holds all its rows.
async function openApp(b, projectPath, rowCount, query = 'autotest=standalone') {
  await b.send('Page.navigate', { url: `${base}/?${query}` });
  if (!(await waitFor(b, '!!document.querySelector("canvas") && !!window.__store', 45000))) throw new Error('the app did not start at ' + base);
  await importFile(b, projectPath, 0);
  if (!(await waitFor(b, `window.__store.getState().bars.length === ${rowCount}`, 120000))) throw new Error('the app did not take the project');
  await sleep(800);
}

const VIEWER_BUTTON = `Array.from(document.querySelectorAll('button')).find((x) => ['⤓ Viewer', 'Building…'].includes(x.textContent.trim()))`;
const clickViewerButton = (b) => b.ev(`${VIEWER_BUTTON}.click()`);
const viewerButtonState = (b) => b.ev(`(() => { const x = ${VIEWER_BUTTON}; return x ? { text: x.textContent.trim(), disabled: x.disabled } : null; })()`);

// Clicks ⤓ Viewer with the title prompt answered and the download captured; returns the file ({ name, text }), the time it took and any alerts.
async function exportFromApp(b, title) {
  await b.ev(`(() => {
    window.__dl = null; window.__alerts = [];
    window.prompt = () => ${JSON.stringify(title)};
    window.alert = (m) => { window.__alerts.push(String(m)); };
    HTMLAnchorElement.prototype.click = function () {
      const name = this.download;
      fetch(this.href).then((r) => r.text()).then((text) => { window.__dl = { name, text }; });
    };
  })()`);
  const t0 = Date.now();
  await clickViewerButton(b);
  await waitFor(b, '!!window.__dl || window.__alerts.length > 0', 60000);
  return { dl: await b.ev('window.__dl'), ms: Date.now() - t0, alerts: await b.ev('window.__alerts') };
}

async function exportCheck() {
  const project = projectFile ? JSON.parse(fs.readFileSync(projectFile, 'utf8')) : makeProject();
  const srcPath = path.join(outDir, 'standalone-source.json');
  fs.writeFileSync(srcPath, JSON.stringify(project));
  const b = await launchBrowser();
  try {
    await openApp(b, srcPath, project.bars.length);
    const appTotals = await b.ev(`(() => { const e = document.querySelector('.bbstool strong'); return e ? e.textContent : null; })()`);
    report(!!appTotals && /^BBS · /.test(appTotals), `export: the app's BBS header reads "${appTotals}"`);

    // The button reads "Building…" while it packs (the template fetch is slowed to make that visible), then the file arrives.
    const TITLE = 'Check Tower — L3';
    await b.ev(`(() => { const real = window.fetch.bind(window); window.__realFetch = real;
      window.fetch = (u, ...r) => (String(u).includes('viewer-template') ? new Promise((res) => setTimeout(res, 700)).then(() => real(u, ...r)) : real(u, ...r)); })()`);
    const pending = exportFromApp(b, TITLE);
    pending.catch(() => {}); // a failure is reported where `pending` is awaited below, not as an unhandled rejection
    await sleep(300);
    const building = await viewerButtonState(b);
    report(!!building && building.text === 'Building…' && building.disabled, `export: while packing the button reads "${building && building.text}" and is disabled`);
    const { dl } = await pending;
    const after = await viewerButtonState(b);
    report(!!after && after.text === '⤓ Viewer' && !after.disabled, 'export: the button is back to "⤓ Viewer" when done');
    report(!!dl && /^barbending-viewer-check-tower-l3-\d{8}-\d{4}\.html$/.test(dl.name), `export: the file is named ${dl && dl.name}`);
    const exported = dl ? await extractProjectFromHtml(dl.text) : null;
    report(!!exported && exported.title === TITLE && exported.viewerFormat === 1
      && ['bars', 'concretes', 'refLines', 'cover', 'bond'].every((k) => isDeepStrictEqual(exported[k], project[k])),
    'export: the file holds the title and the project (bars, concretes, reference lines, cover, bond)');
    const kb = dl ? Buffer.byteLength(dl.text) / 1024 : 0;
    report(!!dl && kb <= (maxKb || 800), `export: the file is ${kb.toFixed(0)} KB (budget ${maxKb || 800} KB)`);

    // Cancelling the prompt exports nothing.
    await b.ev(`(() => { window.fetch = window.__realFetch; window.__dl = null; window.__alerts = []; window.prompt = () => null; })()`);
    await clickViewerButton(b);
    await sleep(700);
    report(!(await b.ev('window.__dl')) && (await b.ev('window.__alerts.length')) === 0, 'export: cancelling the title prompt exports nothing');

    // No template (a 404, or a dev server answering with index.html): the alert names the fix and the button comes back.
    const missing = 'The viewer template is missing: run "npm run build:viewer", then reload.';
    for (const [what, answer] of [['a 404', "new Response('', { status: 404 })"], ['index.html in place of the template', "new Response('<!doctype html><div id=root></div>', { status: 200 })"]]) {
      await b.ev(`(() => { window.__dl = null; window.__alerts = []; window.prompt = () => 'x';
        window.fetch = (u, ...r) => (String(u).includes('viewer-template') ? Promise.resolve(${answer}) : window.__realFetch(u, ...r)); })()`);
      await clickViewerButton(b);
      await waitFor(b, 'window.__alerts.length > 0', 10000);
      const alerts = await b.ev('window.__alerts');
      report(alerts.length === 1 && alerts[0] === missing && !(await b.ev('window.__dl')), `export: with ${what} the alert says the template is missing`);
      const st = await viewerButtonState(b);
      report(!!st && st.text === '⤓ Viewer' && !st.disabled, 'export: and the button comes back');
    }

    // The exported file shows the same totals as the app's BBS header.
    const file = path.join(outDir, 'standalone-export.html');
    fs.writeFileSync(file, dl.text);
    await openViewer(b, file);
    const viewerTotals = await b.ev('document.getElementById("stats").textContent');
    report(!!appTotals && appTotals.replace(/^BBS · /, '') === viewerTotals, `export: the viewer's totals equal the app's ("${viewerTotals}")`);
    report(b.consoleErrors.length === 0, `export: no errors logged${b.consoleErrors.length ? ': ' + b.consoleErrors[0] : ''}`);
  } finally {
    b.close();
  }
}

const sections = { viewer, export: exportCheck };
```

- [ ] **Step 6: Run the dev server and the check to verify it fails**

If the dev server from Task 2 is not running, start it: `npx vite --port 5189 --strictPort` (background; wait for `curl -s -o /dev/null -w "%{http_code}" http://localhost:5189/` → `200`).

Run: `node scripts/perf/check_standalone.mjs --url http://localhost:5189 --only export`
Expected: FAIL: the BBS header line passes, the `Building…` line fails (`reads "undefined"`: there is no `⤓ Viewer` button yet), then `ERROR` with `Cannot read properties of undefined (reading 'click')` and `RESULT: FAIL (2)`.

- [ ] **Step 7: Add the button to `src/App.jsx`**

Four edits with the Edit tool.

Edit 1, imports. Replace
```
import IfcPanel, { IfcLoadButton, fitIfcLive } from './ifc/IfcPanel.jsx';
```
with
```
import IfcPanel, { IfcLoadButton, fitIfcLive } from './ifc/IfcPanel.jsx';
import { packViewerHtml, cleanViewerTitle, viewerFileName, DEFAULT_VIEWER_TITLE } from './standalone/pack.js';
import { loadViewerTemplate } from './standalone/exportViewer.js';
```

Edit 2, state in `FileBar`. Replace
```
  const fileRef = useRef(null);
  const insertRef = useRef(null);
```
with
```
  const fileRef = useRef(null);
  const insertRef = useRef(null);
  const [building, setBuilding] = useState(false);
```

Edit 3, the handler, between `downloadFile` and `onOpenFile`. Replace
```
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const onOpenFile = (e) => {
```
with
```
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  // ⤓ Viewer: the whole model as ONE .html file that opens in any browser (src/standalone/). Cancelling the title prompt aborts.
  const downloadViewer = async () => {
    const raw = window.prompt('Title for the viewer file:', DEFAULT_VIEWER_TITLE);
    if (raw === null) return;
    const title = cleanViewerTitle(raw);
    setBuilding(true);
    try {
      const template = await loadViewerTemplate({ url: `${import.meta.env.BASE_URL}viewer-template.html` });
      const html = await packViewerHtml(template, useStore.getState()._projectData(), { title });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      a.download = viewerFileName(title, new Date());
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      console.info(`[save] exported viewer file: ${a.download} (${Math.round(html.length / 1024)} KB)`);
    } catch (err) { alert(err && err.message ? err.message : String(err)); }
    finally { setBuilding(false); }
  };
  const onOpenFile = (e) => {
```

Edit 4, the button. Replace
```
      >⤓ Project</button>
      <button
        className="hbtn" onClick={() => fileRef.current?.click()}
```
with
```
      >⤓ Project</button>
      <button
        className="hbtn" onClick={downloadViewer} disabled={building}
        title="Download the whole model as ONE .html file (3D view with a section box, and the BBS table) that opens in any browser with nothing installed — ⤒ Project opens it again"
      >{building ? 'Building…' : '⤓ Viewer'}</button>
      <button
        className="hbtn" onClick={() => fileRef.current?.click()}
```

- [ ] **Step 8: Check the dev server serves the template byte for byte**

```bash
curl -s -o scripts/perf/out/served-template.html http://localhost:5189/viewer-template.html && cmp public/viewer-template.html scripts/perf/out/served-template.html && echo identical
```
Expected: `identical`. If the dev server injected anything (for example Vite's client script), the exported file would carry it: fix by serving the template from a name Vite does not treat as a page (rename the generated file in `build-viewer.mjs`, `exportViewer` callers and the spec's section 8, and say so in the commit message).

- [ ] **Step 9: Run the checks**

Run: `node scripts/perf/check_standalone.mjs --url http://localhost:5189 --only export`
Expected: all `PASS`, `RESULT: PASS`.

Run: `npm test 2>&1 | tail -6` (expected `tests 159`, `fail 0`), `npx oxlint src scripts tests 2>&1 | grep -c ": warning "` (expected `29`).

- [ ] **Step 10: Commit**

```bash
git add src/standalone/exportViewer.js tests/standalone/exportViewer.test.mjs src/App.jsx scripts/perf/check_standalone.mjs
git commit -m "feat(viewer-export): the Viewer button writes the whole model as one .html file" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Open the exported `.html` in the app (`⤒ Project`, `⤒+ Insert`)

**Files:**
- Modify: `src/App.jsx` (import, `onOpenFile`, `onInsertFile`, the two file inputs and their tooltips)
- Modify: `scripts/perf/check_standalone.mjs` (the `roundtrip` section)

**Interfaces:**
- Consumes: `parseProjectFile(name, text)` from Task 1; the app helpers of Task 4 (`openApp`, `importFile`, `exportFromApp`, `waitFor`).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Add the `roundtrip` check (it fails: `.html` is not accepted yet)**

In `scripts/perf/check_standalone.mjs`, extend the pack import:
```js
import { packViewerHtml, extractProjectFromHtml } from '../../src/standalone/pack.js';
```
becomes
```js
import { packViewerHtml, extractProjectFromHtml } from '../../src/standalone/pack.js';
import { gzipBytes, toBase64 } from '../../src/standalone/codec.js';
```
and replace the line `const sections = { viewer, export: exportCheck };` with:

```js
async function roundtrip() {
  const project = projectFile ? JSON.parse(fs.readFileSync(projectFile, 'utf8')) : makeProject();
  const n = project.bars.length;
  const importMs = Math.max(30000, n * 4); // generous: an import normally takes a few seconds
  const srcPath = path.join(outDir, 'standalone-source.json');
  fs.writeFileSync(srcPath, JSON.stringify(project));
  const b = await launchBrowser();
  try {
    await openApp(b, srcPath, n);
    const snap = async () => JSON.parse(await b.ev(`(() => { const s = window.__store.getState(); return JSON.stringify({ bars: s.bars, concretes: s.concretes, refLines: s.refLines, cover: s.cover, bond: s.bond }); })()`));
    const original = await snap();
    const { dl } = await exportFromApp(b, 'Round trip');
    const exportedPath = path.join(outDir, 'standalone-roundtrip.html');
    fs.writeFileSync(exportedPath, dl.text);

    // ⤒ Project of the .html replaces the model: first empty the app (with other cover and bond), then open the file.
    const emptyPath = path.join(outDir, 'standalone-empty.json');
    fs.writeFileSync(emptyPath, JSON.stringify({ v: 1, app: 'barbending', bars: [], concretes: [], refLines: [], cover: 25, bond: 'good', selectedBar: 0, selectedBars: [] }));
    await importFile(b, emptyPath, 0);
    await waitFor(b, 'window.__store.getState().bars.length === 0', 20000);
    await importFile(b, exportedPath, 0);
    const took = await waitFor(b, `window.__store.getState().bars.length === ${n}`, importMs);
    report(took && isDeepStrictEqual(await snap(), original), 'roundtrip: ⤒ Project of the exported .html gives back the same bars, concretes, reference lines, cover and bond');

    // ⤒+ Insert appends it: twice the rows, fresh member ids.
    await importFile(b, exportedPath, 1);
    await waitFor(b, `window.__store.getState().bars.length === ${2 * n}`, importMs * 2);
    const merged = await snap();
    report(merged.bars.length === 2 * n && merged.concretes.length === 2 * original.concretes.length
      && new Set(merged.concretes.map((c) => c.id)).size === merged.concretes.length,
    `roundtrip: ⤒+ Insert of the exported .html appends the model (${merged.bars.length} rows, ${merged.concretes.length} members with distinct ids)`);

    // Files that are not viewer files are refused with a plain alert and change nothing.
    const plainHtml = path.join(outDir, 'standalone-not-a-viewer.html');
    fs.writeFileSync(plainHtml, '<!doctype html><html><body>just a page</body></html>');
    const newerHtml = path.join(outDir, 'standalone-newer.html');
    const newerData = toBase64(await gzipBytes(new TextEncoder().encode(JSON.stringify({ viewerFormat: 99, v: 1, bars: [], concretes: [] }))));
    fs.writeFileSync(newerHtml, `<script id="model-data" type="text/plain">${newerData}</script>`);
    for (const [file, text] of [[plainHtml, 'Project open failed: not a barbending viewer file'], [newerHtml, 'Project open failed: made by a newer barbending viewer']]) {
      await b.ev('window.__alerts = []; window.alert = (m) => { window.__alerts.push(String(m)); }');
      await importFile(b, file, 0);
      await waitFor(b, 'window.__alerts.length > 0', 10000);
      const alerts = await b.ev('window.__alerts');
      report(alerts.length === 1 && alerts[0] === text && (await snap()).bars.length === 2 * n, `roundtrip: ${path.basename(file)} is refused ("${alerts[0]}") and the model is untouched`);
    }

    // The .json path still works.
    await importFile(b, srcPath, 0);
    await waitFor(b, `window.__store.getState().bars.length === ${n}`, importMs);
    report(isDeepStrictEqual(await snap(), original), 'roundtrip: ⤒ Project of the .json still works');
    report(b.consoleErrors.length === 0, `roundtrip: no errors logged${b.consoleErrors.length ? ': ' + b.consoleErrors[0] : ''}`);
  } finally {
    b.close();
  }
}

const sections = { viewer, export: exportCheck, roundtrip };
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/perf/check_standalone.mjs --url http://localhost:5189 --only roundtrip`
Expected: FAIL, after a minute or two of waiting for imports that never happen: the first assertion fails (the `.html` is parsed as JSON, so the app alerts `Project open failed: Unexpected token '<'`), and so do the Insert and the refusal checks; `RESULT: FAIL (n)`.

- [ ] **Step 3: Teach the two handlers to read `.html`**

Edits to `src/App.jsx`.

Edit 1, the import added in Task 4. Replace
```
import { packViewerHtml, cleanViewerTitle, viewerFileName, DEFAULT_VIEWER_TITLE } from './standalone/pack.js';
```
with
```
import { packViewerHtml, cleanViewerTitle, viewerFileName, parseProjectFile, DEFAULT_VIEWER_TITLE } from './standalone/pack.js';
```

Edit 2, `onOpenFile`. Replace
```
    rd.onload = () => {
      try {
        const d = JSON.parse(String(rd.result));
        if (!useStore.getState().importProject(d)) throw new Error('not a barbending project file (v1 with bars + concretes arrays)');
```
with
```
    rd.onload = async () => {
      try {
        const d = await parseProjectFile(f.name, String(rd.result));
        if (!useStore.getState().importProject(d)) throw new Error('not a barbending project file (v1 with bars + concretes arrays)');
```

Edit 3, `onInsertFile`. Replace
```
    rd.onload = () => {
      try {
        const d = JSON.parse(String(rd.result));
        const r = useStore.getState().appendProject(d);
```
with
```
    rd.onload = async () => {
      try {
        const d = await parseProjectFile(f.name, String(rd.result));
        const r = useStore.getState().appendProject(d);
```

Edit 4, the two inputs and their tooltips. Replace
```
        title="Open a project .json file — replaces current bars + concrete"
      >⤒ Project</button>
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onOpenFile} />
```
with
```
        title="Open a project .json file, or a ⤓ Viewer .html file — replaces current bars + concrete"
      >⤒ Project</button>
      <input ref={fileRef} type="file" accept=".json,application/json,.html,text/html" hidden onChange={onOpenFile} />
```
and replace
```
        title="Insert another project .json file alongside the current model (ids/tags remapped, undoable) — for coordination"
      >⤒+ Insert</button>
      <input ref={insertRef} type="file" accept=".json,application/json" hidden onChange={onInsertFile} />
```
with
```
        title="Insert another project .json (or ⤓ Viewer .html) file alongside the current model (ids/tags remapped, undoable) — for coordination"
      >⤒+ Insert</button>
      <input ref={insertRef} type="file" accept=".json,application/json,.html,text/html" hidden onChange={onInsertFile} />
```

- [ ] **Step 4: Run to verify it passes**

Run: `node scripts/perf/check_standalone.mjs --url http://localhost:5189 --only roundtrip`
Expected: all `PASS`, `RESULT: PASS`.

Run: `node scripts/perf/check_standalone.mjs --url http://localhost:5189 --only export` — still `PASS`.
Run: `npm test 2>&1 | tail -6` and `npx oxlint src scripts tests 2>&1 | grep -c ": warning "` — tests pass, `29`.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx scripts/perf/check_standalone.mjs
git commit -m "feat(viewer-export): open an exported viewer .html with Project and Insert" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The viewer's section box, core (state, planes, clipping, panel)

**Files:**
- Create: `src/standalone/sectionBox.js`
- Modify: `src/standalone/template.html` (header button, panel, CSS)
- Modify: `src/standalone/viewer.js` (imports, concrete materials clipped, create the box, pick filter, hook)
- Modify: `scripts/perf/check_standalone.mjs` (the `section` section: `prep`, `sectionCore`)

**Interfaces:**
- Consumes: `sectionPlanes`, `updateSectionPlanes`, `updateSectionPlanesBox`, `isWorldPointInSectionBox` (`src/viewer/sectionPlanes.js`, unchanged); `testCutSize`, `boxFromBounds` (Task 2); `FieldView.setClipping(on)`; the viewer's `box` (Box3 of the model) and `dirty()`.
- Produces — `createSectionBox({ scene, field, bounds, dirty })` returns `api`:
  - `api.state` (live object `{ enabled, mode, center, size, quat, solidCut, showBox }`), `api.planes` (the shared `sectionPlanes`), `api.boxGroup` (THREE.Group, position = centre, quaternion = rotation).
  - `api.set(patch)` (merge a partial state, e.g. `{ enabled: true, center, size, quat, mode, solidCut, showBox }`, then apply), `api.toggle()`, `api.fitBox()`, `api.testCut()`, `api.contains([x, y, z]): boolean` (true when no cut or the point survives it).
  - Parts register with the internal `parts` array: `(live: boolean) => void`, called by `apply()` on every state change (Tasks 7–9 add grips, gizmo, caps).
  - Panel DOM ids: `#section` (header toggle), `#sec-panel`, `#sec-mode` (buttons with `data-mode`), `#sec-fit`, `#sec-test`, `#sec-solid`, `#sec-show`, `#sec-size`.
  - Check helpers added here and reused by Tasks 7–9: `near`, `rectOf`, `AMBER`, `sectionCore(b)`, `section()`.

- [ ] **Step 1: Write the failing check**

In `scripts/perf/check_standalone.mjs`:

1. Replace the import line `import { packViewerHtml, extractProjectFromHtml } from '../../src/standalone/pack.js';` (the first of the two pack-related lines; keep the `codec.js` line) with
```js
import { packViewerHtml, extractProjectFromHtml } from '../../src/standalone/pack.js';
import { boxFromBounds, testCutSize } from '../../src/viewer/sectionBoxMath.js';
```

2. Replace the line `const sections = { viewer, export: exportCheck, roundtrip };` with:

```js
const near = (a, b, tol) => Math.abs(a - b) <= tol;
// The canvas rectangle in page pixels (for trusted mouse input).
const rectOf = (b) => b.ev(`(() => { const r = document.getElementById('gl').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);

// ---- the section box (viewer) ----
// Amber pixels of the canvas (the Ø16 bar): count and horizontal extent, in canvas pixels.
const AMBER = `(() => {
  const c = document.getElementById('gl'); const t = document.createElement('canvas');
  t.width = c.width; t.height = c.height;
  const x = t.getContext('2d', { willReadFrequently: true }); x.drawImage(c, 0, 0);
  const d = x.getImageData(0, 0, t.width, t.height).data;
  let n = 0, x0 = 1e9, x1 = -1;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r > 140 && g > 105 && g < 210 && b < 100 && r > g * 1.1) { n++; const px = p % t.width; if (px < x0) x0 = px; if (px > x1) x1 = px; }
  }
  return { n, x0, x1 };
})()`;

async function sectionCore(b) {
  const dpr = await b.ev('document.getElementById("gl").width / document.getElementById("gl").clientWidth');
  const st = () => b.ev('JSON.parse(JSON.stringify(window.__viewer.section.state))');
  const mm = (m) => Math.round(m * 1000).toLocaleString('en-US');
  const bounds = await b.ev('window.__viewer.bounds');
  await b.ev('window.__viewer.goView("front")');
  await settle(b);
  const sx = async (x) => (await toScreen(b, [x, 1.5, -0.2]))[0] * dpr; // the Ø16 bar's centre line, in canvas pixels

  const uncut = await b.ev(AMBER);
  report(uncut.n > 200 && near(uncut.x0, await sx(0), 3) && near(uncut.x1, await sx(3), 3), `section: the bar is drawn from x = 0 to 3 m (${uncut.x0}..${uncut.x1} px)`);

  // Control for the "selects nothing" results further down: with no cut, a click at x = 0.2 m picks the Ø16 bar (row 0) and a click
  // at the middle of the Ø20 bar picks that one (row 1), so those later results are the cut's doing and not a miss of the click.
  const rect = await rectOf(b);
  const at = async (x, up) => { const [px, py] = await toScreen(b, [x, up, -0.2]); return [rect.x + px, rect.y + py]; };
  await b.ev('window.__viewer.select(null)');
  await click(b, await at(0.2, 1.5));
  await sleep(300);
  const control1 = await b.ev('window.__viewer.selected');
  await b.ev('window.__viewer.select(null)');
  await click(b, await at(1.25, 1.3));
  await sleep(300);
  const control2 = await b.ev('window.__viewer.selected');
  await b.ev('window.__viewer.select(null)');
  report(control1 === 0 && control2 === 1, `section: with no cut a click at x = 0.2 m picks row ${control1} and a click on the Ø20 bar picks row ${control2}`);

  // The header toggle turns Section on with the default box: the model bounds plus padding. The panel opens with the readout.
  await b.ev('document.getElementById("section").click()');
  await sleep(300);
  const s1 = await st();
  const want = boxFromBounds(bounds.min, bounds.max);
  report(s1.enabled && s1.center.every((v, i) => near(v, want.center[i], 1e-9)) && s1.size.every((v, i) => near(v, want.size[i], 1e-9)),
    `section: ◫ Section turns on with the model bounds plus padding (size ${s1.size.map((v) => v.toFixed(3)).join(' x ')} m)`);
  report(await b.ev('!document.getElementById("sec-panel").hidden && document.getElementById("section").classList.contains("on")'), 'section: the panel opens and the header toggle lights');
  const readout = await b.ev('document.getElementById("sec-size").textContent');
  report(readout === `${mm(s1.size[0])} × ${mm(s1.size[1])} × ${mm(s1.size[2])} mm`, `section: the size readout shows "${readout}"`);

  // Test cut: a third of each size around the same centre. The bar is cut at the box faces, to a pixel.
  await b.ev('document.getElementById("sec-solid").click()'); // Solid cut off, so a cap does not hide the bar
  await b.ev('document.getElementById("sec-test").click()');
  await sleep(1200);
  const s2 = await st();
  const third = testCutSize(s1.size);
  report(s2.size.every((v, i) => near(v, third[i], 1e-9)) && s2.center.every((v, i) => near(v, s1.center[i], 1e-9)),
    `section: Test cut keeps the centre and shrinks each size to a third (${s2.size.map((v) => v.toFixed(3)).join(' x ')} m)`);
  const planes = await b.ev('window.__viewer.section.planes.map((p) => p.constant)');
  report(near(planes[0], s2.center[0] + s2.size[0] / 2, 1e-9) && near(planes[1], -(s2.center[0] - s2.size[0] / 2), 1e-9), 'section: the shared clipping planes follow the box');
  const cut = await b.ev(AMBER);
  const lo = Math.max(0, s2.center[0] - s2.size[0] / 2);
  const hi = Math.min(3, s2.center[0] + s2.size[0] / 2);
  const e0 = await sx(lo);
  const e1 = await sx(hi);
  report(cut.n > 100 && near(cut.x0, e0, 1.5) && near(cut.x1, e1, 1.5), `section: the cut agrees with the planes to 1 px (bar ${cut.x0}..${cut.x1}, planes ${e0.toFixed(1)}..${e1.toFixed(1)})`);

  // 👁 Box hides the box but the cut stays.
  await b.ev('document.getElementById("sec-show").click()');
  await sleep(600);
  const hid = await b.ev('({ visible: window.__viewer.section.boxGroup.visible, show: window.__viewer.section.state.showBox })');
  const still = await b.ev(AMBER);
  report(!hid.visible && !hid.show && near(still.x0, cut.x0, 1) && near(still.x1, cut.x1, 1), `section: 👁 Box hides the box but the cut stays (bar ${still.x0}..${still.x1} px)`);
  await b.ev('document.getElementById("sec-show").click()');
  await sleep(300);

  // Picking: the kept part of the bar can be clicked; the cut-away part and a bar cut away entirely cannot. (The kept part is clicked a
  // quarter of the way in, not at the middle: in the Front view the two grips of the depth axis sit on the middle of the box, and a
  // press on a grip drags the box instead of picking.)
  await b.ev('window.__viewer.select(null)');
  await click(b, await at(lo + 0.25 * (hi - lo), 1.5));
  await sleep(300);
  report((await b.ev('window.__viewer.selected')) === 0, 'section: a click on the kept part of the bar selects it');
  await b.ev('window.__viewer.select(null)');
  await click(b, await at(0.2, 1.5)); // x = 0.2 m is cut away (the window starts at 0.6 m)
  await sleep(300);
  report((await b.ev('window.__viewer.selected')) === null, 'section: a click on the cut-away part of the bar selects nothing');
  await click(b, await at((lo + hi) / 2, 1.3)); // the Ø20 bar lies below the window: cut away entirely
  await sleep(300);
  report((await b.ev('window.__viewer.selected')) === null, 'section: a click on a bar that is cut away entirely selects nothing');

  // Off restores the whole bar; on again keeps the last box.
  await b.ev('document.getElementById("section").click()');
  await sleep(1200);
  const off = await b.ev(AMBER);
  report(near(off.x0, uncut.x0, 1.5) && near(off.x1, uncut.x1, 1.5) && (await b.ev('document.getElementById("sec-panel").hidden')),
    `section: switching Section off restores the whole bar (${off.x0}..${off.x1} px) and closes the panel`);
  await b.ev('document.getElementById("section").click()');
  await sleep(300);
  const s3 = await st();
  report(s3.enabled && s3.size.every((v, i) => near(v, s2.size[i], 1e-9)) && s3.center.every((v, i) => near(v, s2.center[i], 1e-9)), 'section: switching it on again keeps the last box');
}

async function section() {
  const { file } = await writeViewer(makeProject(), 'viewer-section', 'Section check');
  const b = await launchBrowser();
  try {
    await openViewer(b, file);
    await sectionCore(b);
    report(b.consoleErrors.length === 0, `section: no errors logged${b.consoleErrors.length ? ': ' + b.consoleErrors[0] : ''}`);
  } finally {
    b.close();
  }
}

const sections = { viewer, section, export: exportCheck, roundtrip };
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/perf/check_standalone.mjs --only section`
Expected: the first two lines `PASS` (the bar is drawn; the control clicks pick rows 0 and 1 without a cut), then `ERROR` with `Cannot read properties of null (reading 'click')` (there is no `#section` button yet) and `RESULT: FAIL (1)`.

- [ ] **Step 3: Edit the template**

Three edits to `src/standalone/template.html`.

CSS: replace
```
#pill { position: absolute; right: 12px; bottom: 34px; background: rgba(15, 23, 42, .85); }
```
with
```
#pill { position: absolute; right: 12px; bottom: 34px; background: rgba(15, 23, 42, .85); }
#sec-panel { position: absolute; left: 12px; top: 12px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; max-width: min(520px, calc(100% - 24px)); padding: 8px; background: rgba(15, 23, 42, .92); border: 1px solid #334155; border-radius: 8px; }
#sec-size { flex-basis: 100%; color: var(--dim); font-size: 12px; font-variant-numeric: tabular-nums; }
```

Header button: replace
```
    <button id="download" title="Download the project file (.json) to open in the barbending app">⤓ Project</button>
```
with
```
    <button id="section" title="Section box: cut the model with an adjustable box">◫ Section</button>
    <button id="download" title="Download the project file (.json) to open in the barbending app">⤓ Project</button>
```

Panel: replace
```
      <div id="info" hidden></div>
```
with
```
      <div id="sec-panel" hidden>
        <div class="seg" id="sec-mode">
          <button data-mode="faces" class="on" title="Push and pull the faces of the box">Faces</button><button data-mode="translate" title="Move the box">Move</button><button data-mode="rotate" title="Rotate the box">Rotate</button>
        </div>
        <button id="sec-fit" title="Reset the box to the whole model">Fit box</button>
        <button id="sec-test" title="Shrink the box to a third of its size around its centre, to see the cut at once">Test cut</button>
        <button id="sec-solid" class="on" title="Fill the cut faces of the concrete members">Solid cut</button>
        <button id="sec-show" class="on" title="Show or hide the box (the cut stays)">👁 Box</button>
        <div id="sec-size"></div>
      </div>
      <div id="info" hidden></div>
```

- [ ] **Step 4: Write `src/standalone/sectionBox.js` (the core)**

```js
// The standalone viewer's section box: the app's Revit-style box rebuilt on plain three.js (spec section 6). The state
// { enabled, mode, center, size, quat, solidCut, showBox } is in scene metres and lives for the session only. The clipping planes are
// the app's shared sectionPlanes, updated in place; the materials do the cutting (the bar field's clipped programs, the concrete
// meshes). This module owns the box, its panel and, in later parts, the face grips, the move / rotate gizmo and the solid-cut caps.
import * as THREE from 'three';
import { sectionPlanes, updateSectionPlanes, updateSectionPlanesBox, isWorldPointInSectionBox } from '../viewer/sectionPlanes.js';
import { testCutSize, boxFromBounds } from '../viewer/sectionBoxMath.js';

const BOX_COLOR = '#38bdf8';
const mm = (m) => Math.round(m * 1000).toLocaleString('en-US');
const $ = (id) => document.getElementById(id);

export function createSectionBox({ scene, field, bounds, dirty }) {
  const state = { enabled: false, mode: 'faces', center: [0, 0, 0], size: [1, 1, 1], quat: [0, 0, 0, 1], solidCut: true, showBox: true };
  let boxReady = false; // false until the first box has been made from the model bounds
  const parts = []; // what the other parts of the box (grips, gizmo, caps) do when the state changes: (live) => void

  // ---- the box: a translucent volume with edges, in a group that carries its position and rotation ----
  const boxGroup = new THREE.Group();
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const volume = new THREE.Mesh(unit, new THREE.MeshBasicMaterial({ color: BOX_COLOR, transparent: true, opacity: 0.05, depthWrite: false }));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(unit), new THREE.LineBasicMaterial({ color: BOX_COLOR }));
  boxGroup.add(volume, edges);
  scene.add(boxGroup);

  function syncPanel() {
    $('sec-panel').hidden = !state.enabled;
    $('section').classList.toggle('on', state.enabled);
    for (const btn of $('sec-mode').children) btn.classList.toggle('on', btn.dataset.mode === state.mode);
    $('sec-solid').classList.toggle('on', state.solidCut);
    $('sec-show').classList.toggle('on', state.showBox);
    $('sec-size').textContent = `${mm(state.size[0])} × ${mm(state.size[1])} × ${mm(state.size[2])} mm`;
  }

  // Everything that depends on the state: the planes, the bar programs, the box, the parts, the panel.
  function apply() {
    if (state.enabled) updateSectionPlanesBox(state.center, state.size, state.quat);
    else updateSectionPlanes(null, null);
    field.setClipping(state.enabled);
    boxGroup.position.fromArray(state.center);
    boxGroup.quaternion.fromArray(state.quat);
    volume.scale.fromArray(state.size);
    edges.scale.fromArray(state.size);
    const live = state.enabled && state.showBox; // a hidden box keeps cutting but shows nothing and offers no handles
    boxGroup.visible = live;
    for (const part of parts) part(live);
    syncPanel();
    dirty();
  }

  function ensureBox() {
    if (boxReady) return;
    const b = boxFromBounds(bounds.min.toArray(), bounds.max.toArray());
    state.center = b.center;
    state.size = b.size;
    state.quat = [0, 0, 0, 1];
    boxReady = true;
  }

  const api = {
    state,
    planes: sectionPlanes,
    boxGroup,
    // A partial state change (the panel's buttons and the test hooks); the first time Section is on it gets the default box.
    set(patch) {
      if (patch.enabled) ensureBox();
      Object.assign(state, patch);
      if (patch.center || patch.size) boxReady = true;
      apply();
    },
    toggle() { api.set({ enabled: !state.enabled }); },
    fitBox() { boxReady = false; api.set({ enabled: true }); },
    testCut() { ensureBox(); api.set({ enabled: true, size: testCutSize(state.size) }); },
    // True when a scene point (metres) survives the cut: the picker ignores hits outside the box.
    contains: (p) => !state.enabled || isWorldPointInSectionBox(p, state),
  };

  $('section').addEventListener('click', () => api.toggle());
  $('sec-mode').addEventListener('click', (e) => { const m = e.target.dataset && e.target.dataset.mode; if (m) api.set({ mode: m }); });
  $('sec-fit').addEventListener('click', () => api.fitBox());
  $('sec-test').addEventListener('click', () => api.testCut());
  $('sec-solid').addEventListener('click', () => api.set({ solidCut: !state.solidCut }));
  $('sec-show').addEventListener('click', () => api.set({ showBox: !state.showBox }));

  apply();
  return api;
}
```

- [ ] **Step 5: Wire it into `src/standalone/viewer.js`**

Five edits with the Edit tool.

Edit 1, imports. Replace
```
import { gunzipBytes, fromBase64 } from './codec.js';
```
with
```
import { sectionPlanes } from '../viewer/sectionPlanes.js';
import { gunzipBytes, fromBase64 } from './codec.js';
import { createSectionBox } from './sectionBox.js';
```

Edit 2, the concrete is always cut by the planes (they sit 1,000 km away while the box is off). Replace
```
  const ghost = new THREE.MeshStandardMaterial({ color: '#94a3b8', transparent: true, opacity: 0.25, roughness: 0.8, metalness: 0, depthWrite: false, side: THREE.DoubleSide });
  const edgeMat = new THREE.LineBasicMaterial({ color: '#475569', transparent: true, opacity: 0.85 });
```
with
```
  const ghost = new THREE.MeshStandardMaterial({
    color: '#94a3b8', transparent: true, opacity: 0.25, roughness: 0.8, metalness: 0, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: sectionPlanes,
  });
  const edgeMat = new THREE.LineBasicMaterial({ color: '#475569', transparent: true, opacity: 0.85, clippingPlanes: sectionPlanes });
```

Edit 3, create the box once the cameras and `dirty` exist. Replace
```
  ctlP.addEventListener('change', dirty);
  ctlO.addEventListener('change', dirty);
```
with
```
  ctlP.addEventListener('change', dirty);
  ctlO.addEventListener('change', dirty);
  const section = createSectionBox({ scene, field: view, bounds: box, dirty });
```

Edit 4, the picker ignores hits outside the box. Replace
```
      worldPerPixel: m.pxPerMeter ? 1 / m.pxPerMeter : null,
    });
```
with
```
      worldPerPixel: m.pxPerMeter ? 1 / m.pxPerMeter : null,
      accept: (p) => section.contains(p),
    });
```

Edit 5, the test hook. Replace
```
      select, goView, fitAll, switchTo, pick: pickAt,
    };
```
with
```
      select, goView, fitAll, switchTo, pick: pickAt, section,
    };
```

- [ ] **Step 6: Rebuild the template and run the check**

Run: `npm run build:viewer` — expected: the `build-viewer:` line, exit 0.
Run: `node scripts/perf/check_standalone.mjs --only section`
Expected: all `PASS`, `RESULT: PASS`.

If "the cut agrees with the planes to 1 px" misses by more than 1.5 px, print `cut`, `e0`, `e1` and `dpr` and check which end is off before changing the tolerance: a systematic offset means the plane or the bar's end cap is wrong, not the tolerance.

Also run: `node scripts/perf/check_standalone.mjs --only viewer` (still `PASS`), `npm test 2>&1 | tail -6`, and `npx oxlint src scripts tests 2>&1 | grep -c ": warning "` (`29`).

- [ ] **Step 7: Commit**

```bash
git add src/standalone/sectionBox.js src/standalone/template.html src/standalone/viewer.js scripts/perf/check_standalone.mjs
git commit -m "feat(viewer-export): section box in the viewer: planes, clipping, Test cut, panel" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 7: Face grips (Faces mode)

**Files:**
- Modify: `src/standalone/sectionBox.js` (signature, imports, the grips block, API members)
- Modify: `src/standalone/viewer.js` (the `createSectionBox` call, `section.update` in the render)
- Modify: `scripts/perf/check_standalone.mjs` (`sectionFaces`)

**Interfaces:**
- Consumes: `FACES`, `AXIS_COLORS`, `faceDragResult`, `pixelWorldSize` (Task 2); `closestAxisParam` (`sectionPlanes.js`); the `parts` array and `apply()` of Task 6; from the viewer: `canvas`, `viewport`, `getCamera()` (the active camera), `getOrbit()` (the active OrbitControls).
- Produces: `createSectionBox({ scene, canvas, viewport, field, bounds, getCamera, getOrbit, dirty })`; `api.gripGroup`, `api.grips` (`{ root, core, hit }` per face, `root.scale.x` = world metres per screen pixel), `api.gripWorld(k): [x, y, z]` (world position of grip `k`'s centre; `k` indexes `FACES`), `api.update(cam, viewportHeightPx)` (call every rendered frame, before `renderer.render`). Check helpers `prep(b, { view, box, solidCut, mode, showBox })` (puts the viewer in a known state) and `drag(b, from, to, button?, steps?)` (a trusted mouse drag in page pixels), reused by Tasks 8 and 9.

- [ ] **Step 1: Write the failing check**

In `scripts/perf/check_standalone.mjs`, insert the following function directly before `async function section() {`, and in `section()` replace `    await sectionCore(b);` with
```js
    await sectionCore(b);
    await sectionFaces(b);
```

```js
// Puts the viewer in a known state: the view, then the section box (a given box, or the last / default one). Used by the checks of Tasks 7-9.
async function prep(b, { view = 'front', box = null, solidCut = false, mode = 'faces', showBox = true } = {}) {
  await b.ev('window.__viewer.section.set({ enabled: false })');
  await b.ev(`window.__viewer.goView(${JSON.stringify(view)})`);
  await settle(b);
  await b.ev(`window.__viewer.section.set(${JSON.stringify({ enabled: true, solidCut, mode, showBox, ...(box || {}) })})`);
  await sleep(400);
}

// Trusted mouse drag (page pixels), in steps.
const MOUSE = { left: [0, 1], middle: [1, 4], right: [2, 2] };
async function drag(b, from, to, button = 'left', steps = 12) {
  const mod = MOUSE[button][1];
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from[0], y: from[1] });
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from[0], y: from[1], button, buttons: mod, clickCount: 1 });
  for (let i = 1; i <= steps; i++) {
    await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from[0] + ((to[0] - from[0]) * i) / steps, y: from[1] + ((to[1] - from[1]) * i) / steps, button, buttons: mod });
    await sleep(16);
  }
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to[0], y: to[1], button, buttons: 0, clickCount: 1 });
}

async function sectionFaces(b) {
  const box = { center: [1.25, 1.5, -0.2], size: [1.3, 0.6, 0.4], quat: [0, 0, 0, 1] };
  const st = () => b.ev('JSON.parse(JSON.stringify(window.__viewer.section.state))');
  const pose = () => b.ev('window.__viewer.cam.position.toArray().join(",")');
  // Where a user presses to take grip k, in page pixels (dx: pixels to the right of the grip's centre).
  const gripAt = async (k, dx = 0) => {
    const rect = await rectOf(b);
    const [px, py] = await toScreen(b, await b.ev(`window.__viewer.section.gripWorld(${k})`));
    return [rect.x + px + dx, rect.y + py];
  };

  // A drag on the +X grip (index 1) changes the width by exactly the pointer's movement; the -X face stays; orbit is off during it.
  await prep(b, { view: 'front', box });
  let zoom = await b.ev('window.__viewer.cam.zoom');
  const s0 = await st();
  const pose0 = await pose();
  let from = await gripAt(1);
  await drag(b, from, [from[0] + 100, from[1]]);
  await sleep(400);
  const s1 = await st();
  const dW = s1.size[0] - s0.size[0];
  report(near(dW, 100 / zoom, 0.002), `faces: dragging the +X grip 100 px changes the width by ${dW.toFixed(4)} m (expected ${(100 / zoom).toFixed(4)})`);
  report(near(s1.center[0] - s1.size[0] / 2, s0.center[0] - s0.size[0] / 2, 1e-9) && near(s1.center[0] - s0.center[0], dW / 2, 1e-9),
    'faces: the -X face stays put and the centre moves by half the change');
  report(s1.size[1] === s0.size[1] && s1.size[2] === s0.size[2], 'faces: the other two sizes are untouched');
  report((await pose()) === pose0 && (await b.ev('window.__viewer.ctl.enabled')), 'faces: the camera did not orbit during the drag, and orbit is enabled again after it');

  // The pick area is twice the visible grip: a press 11 px beside the centre (the cube is 14 px wide) still takes it.
  from = await gripAt(1, 11);
  await drag(b, from, [from[0] - 60, from[1]]);
  await sleep(400);
  const s2 = await st();
  report(near(s2.size[0] - s1.size[0], -60 / zoom, 0.002), `faces: a press beside the visible grip still takes it (${(s2.size[0] - s1.size[0]).toFixed(4)} m, expected ${(-60 / zoom).toFixed(4)})`);

  // A face never gets thinner than 50 mm, and the opposite face still does not move.
  from = await gripAt(1);
  await drag(b, from, [from[0] - (s2.size[0] + 0.5) * zoom, from[1]], 'left', 20);
  await sleep(400);
  const s3 = await st();
  report(s3.size[0] === 0.05 && near(s3.center[0] - s3.size[0] / 2, s0.center[0] - s0.size[0] / 2, 1e-9), `faces: the width stops at 50 mm (${s3.size[0]} m) and the -X face has not moved`);

  // A grip keeps its size on screen: one grip unit is one pixel in the orthographic view whatever the zoom ...
  await prep(b, { view: 'front', box });
  zoom = await b.ev('window.__viewer.cam.zoom');
  const unit = () => b.ev('window.__viewer.section.grips[1].root.scale.x * window.__viewer.cam.zoom');
  const u0 = await unit();
  const rect = await rectOf(b);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, deltaX: 0, deltaY: -300 });
  await settle(b);
  const u1 = await unit();
  const z1 = await b.ev('window.__viewer.cam.zoom');
  report(near(u0, 1, 1e-6) && near(u1, 1, 1e-6) && z1 > zoom * 1.1, `faces: a grip keeps its screen size when the zoom changes (${zoom.toFixed(0)} -> ${z1.toFixed(0)} px/m; pixels per grip unit ${u0.toFixed(4)}, ${u1.toFixed(4)})`);
  // ... and about 14 px wide in the perspective view, measured through the real projection.
  await prep(b, { view: 'iso', box });
  const px14 = await b.ev(`(() => { const v = window.__viewer; const g = v.section.grips[3]; const cv = document.getElementById('gl'); const V = v.cam.position.constructor;
    v.cam.updateMatrixWorld(true);
    const c0 = new V().setFromMatrixPosition(g.core.matrixWorld);
    const right = new V().setFromMatrixColumn(v.cam.matrixWorld, 0);
    const a = c0.clone().project(v.cam);
    const c = c0.clone().addScaledVector(right, g.root.scale.x * 14).project(v.cam);
    return Math.hypot((c.x - a.x) * cv.clientWidth / 2, (c.y - a.y) * cv.clientHeight / 2); })()`);
  report(near(px14, 14, 0.7), `faces: in the perspective view a grip is ${px14.toFixed(2)} px wide (14 px)`);

  // A box turned 30 degrees about the vertical: the +X face moves along its own normal, by the pointer's movement along that line.
  const ang = Math.PI / 6;
  await prep(b, { view: 'front', box: { ...box, quat: [0, Math.sin(ang / 2), 0, Math.cos(ang / 2)] } });
  zoom = await b.ev('window.__viewer.cam.zoom');
  const r0 = await st();
  from = await gripAt(1);
  await drag(b, from, [from[0] + 100, from[1]]);
  await sleep(400);
  const r1 = await st();
  const dR = r1.size[0] - r0.size[0];
  const N = [Math.cos(ang), 0, -Math.sin(ang)];
  report(near(dR, 100 / (zoom * Math.cos(ang)), 0.003) && [0, 1, 2].every((i) => near(r1.center[i] - r0.center[i], (N[i] * dR) / 2, 1e-9)),
    `faces: on a box turned 30 degrees the +X face moves along its normal by ${dR.toFixed(4)} m (expected ${(100 / (zoom * Math.cos(ang))).toFixed(4)})`);

  // Touch: pointer events with pointerType "touch" (synthetic here; not tried on a real phone) take a grip the same way.
  await prep(b, { view: 'front', box });
  zoom = await b.ev('window.__viewer.cam.zoom');
  const t0 = await st();
  const [gx, gy] = await gripAt(1);
  const widthAfterTouch = await b.ev(`(() => {
    const cv = document.getElementById('gl');
    const fire = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    fire('pointerdown', ${gx}, ${gy});
    for (let i = 1; i <= 8; i++) fire('pointermove', ${gx} + i * 10, ${gy});
    fire('pointerup', ${gx} + 80, ${gy});
    return window.__viewer.section.state.size[0];
  })()`);
  report(near(widthAfterTouch - t0.size[0], 80 / zoom, 0.002) && (await b.ev('window.__viewer.ctl.enabled')), `faces: a touch drag of 80 px changes the width by ${(widthAfterTouch - t0.size[0]).toFixed(4)} m (expected ${(80 / zoom).toFixed(4)})`);

  // A press well outside the pick area is not a grip: the camera orbits and the box is left alone.
  await prep(b, { view: 'front', box });
  const n0 = await st();
  const poseN = await pose();
  from = await gripAt(1, 30);
  await drag(b, from, [from[0] + 40, from[1] + 40]);
  await sleep(500);
  report(isDeepStrictEqual((await st()).size, n0.size) && (await pose()) !== poseN, 'faces: a press outside the pick area orbits the camera and leaves the box alone');

  // With 👁 Box off the grips are gone.
  await prep(b, { view: 'front', box, showBox: false });
  const h0 = await st();
  from = await gripAt(1);
  await drag(b, from, [from[0] + 60, from[1]]);
  await sleep(400);
  report(isDeepStrictEqual((await st()).size, h0.size), 'faces: with 👁 Box off the grips cannot be grabbed');
  await b.ev('window.__viewer.section.set({ showBox: true })');
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/perf/check_standalone.mjs --only section`
Expected: the core checks pass, then `ERROR` from `window.__viewer.section.gripWorld is not a function` (or a failed first faces assertion) and `RESULT: FAIL`.

- [ ] **Step 3: Add the grips to `src/standalone/sectionBox.js`**

Five edits with the Edit tool.

Edit 1, imports. Replace
```
import { sectionPlanes, updateSectionPlanes, updateSectionPlanesBox, isWorldPointInSectionBox } from '../viewer/sectionPlanes.js';
import { testCutSize, boxFromBounds } from '../viewer/sectionBoxMath.js';
```
with
```
import {
  sectionPlanes, updateSectionPlanes, updateSectionPlanesBox, closestAxisParam, isWorldPointInSectionBox,
} from '../viewer/sectionPlanes.js';
import { FACES, AXIS_COLORS, faceDragResult, testCutSize, boxFromBounds, pixelWorldSize } from '../viewer/sectionBoxMath.js';
```

Edit 2, signature. Replace
```
export function createSectionBox({ scene, field, bounds, dirty }) {
```
with
```
export function createSectionBox({ scene, canvas, viewport, field, bounds, getCamera, getOrbit, dirty }) {
```

Edit 3, the grips and their drag, inserted before `syncPanel`. Replace
```
  function syncPanel() {
```
with
```
  // ---- face grips (Faces mode): constant size on screen, a pick area twice the visible size, an axis-coloured leader ----
  const GRIP_PX = 14; // the visible grip cube, in screen pixels
  const HIT_PX = 28; // its pick area
  const LEADER_PX = 36; // from the face to the grip centre
  const gripGroup = new THREE.Group();
  boxGroup.add(gripGroup);
  const grips = FACES.map((f) => {
    const dir = new THREE.Vector3();
    dir.setComponent(f.axis, f.sign);
    const color = AXIS_COLORS[f.axis];
    const root = new THREE.Group(); // at the face centre, scaled so that one unit is one screen pixel (see update())
    const leaderDims = [2.5, 2.5, 2.5];
    leaderDims[f.axis] = LEADER_PX;
    const leader = new THREE.Mesh(new THREE.BoxGeometry(...leaderDims), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthWrite: false }));
    leader.position.copy(dir).multiplyScalar(LEADER_PX / 2);
    // drawn on top (depthTest off, gizmo style) so a cap or the concrete never hides it
    const core = new THREE.Mesh(new THREE.BoxGeometry(GRIP_PX, GRIP_PX, GRIP_PX), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false }));
    core.position.copy(dir).multiplyScalar(LEADER_PX);
    core.renderOrder = 999;
    const hit = new THREE.Mesh(new THREE.BoxGeometry(HIT_PX, HIT_PX, HIT_PX)); // never drawn, only ray-tested (a Raycaster ignores `visible`)
    hit.position.copy(core.position);
    hit.visible = false;
    root.add(leader, core, hit);
    gripGroup.add(root);
    return { root, core, hit };
  });
  parts.push((live) => {
    gripGroup.visible = live && state.mode === 'faces';
    grips.forEach((g, k) => {
      g.root.position.set(0, 0, 0);
      g.root.position.setComponent(FACES[k].axis, (FACES[k].sign * state.size[FACES[k].axis]) / 2);
    });
  });

  // Per rendered frame: scale every grip so it covers the same number of pixels whatever the zoom or the distance.
  const toGrip = new THREE.Vector3();
  const viewDir = new THREE.Vector3();
  function update(cam, viewportHeightPx) {
    if (!gripGroup.visible) return;
    const ortho = !!cam.isOrthographicCamera;
    cam.getWorldDirection(viewDir);
    boxGroup.updateMatrixWorld(true);
    for (const g of grips) {
      const depth = toGrip.setFromMatrixPosition(g.root.matrixWorld).sub(cam.position).dot(viewDir);
      g.root.scale.setScalar(pixelWorldSize({ ortho, zoom: cam.zoom, depth, fovRad: ortho ? 0 : (cam.fov * Math.PI) / 180, viewportHeightPx }));
    }
  }

  // Dragging a grip. A press on a grip is caught on the viewport in the capture phase, so the orbit controls and the bar picker never see it;
  // the pointer is captured, the orbit is switched off, and the size follows the pointer along the face normal (the app's maths, shared).
  const caster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const aim = (e) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    caster.setFromCamera(ndc, getCamera());
    return caster.ray;
  };
  function gripAt(e) {
    if (!gripGroup.visible) return -1;
    aim(e);
    boxGroup.updateMatrixWorld(true);
    const hits = caster.intersectObjects(grips.map((g) => g.hit), false);
    return hits.length ? grips.findIndex((g) => g.hit === hits[0].object) : -1;
  }
  let drag = null;
  function onDragMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const ray = aim(e);
    const delta = closestAxisParam(ray.origin, ray.direction, drag.A0, drag.N) - drag.t0;
    const next = faceDragResult({ startCenter: drag.startCenter, startSize: drag.startSize, axis: drag.axis, normal: drag.N.toArray(), delta });
    state.center = next.center;
    state.size = next.size;
    apply();
  }
  function stopDrag() {
    if (!drag) return;
    const { id } = drag;
    drag = null;
    canvas.removeEventListener('pointermove', onDragMove);
    canvas.removeEventListener('pointerup', stopDrag);
    canvas.removeEventListener('pointercancel', stopDrag);
    try { canvas.releasePointerCapture(id); } catch { /* it was never captured */ }
    const orbit = getOrbit();
    if (orbit) orbit.enabled = true;
    canvas.style.cursor = '';
  }
  viewport.addEventListener('pointerdown', (e) => {
    if (e.target !== canvas || e.button !== 0 || drag) return;
    const k = gripAt(e);
    if (k < 0) return;
    e.stopPropagation();
    e.preventDefault();
    const f = FACES[k];
    const N = new THREE.Vector3();
    N.setComponent(f.axis, f.sign).applyQuaternion(new THREE.Quaternion().fromArray(state.quat));
    const A0 = new THREE.Vector3().fromArray(state.center).addScaledVector(N, state.size[f.axis] / 2);
    const ray = aim(e);
    drag = { id: e.pointerId, axis: f.axis, N, A0, t0: closestAxisParam(ray.origin, ray.direction, A0, N), startCenter: [...state.center], startSize: [...state.size] };
    const orbit = getOrbit();
    if (orbit) orbit.enabled = false;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer cannot be captured: its events still reach the canvas */ }
    canvas.style.cursor = 'grabbing';
    canvas.addEventListener('pointermove', onDragMove);
    canvas.addEventListener('pointerup', stopDrag);
    canvas.addEventListener('pointercancel', stopDrag);
  }, true);
  window.addEventListener('blur', stopDrag); // never leave the orbit off (alt-tab in the middle of a drag)
  canvas.addEventListener('pointermove', (e) => {
    if (!drag && e.pointerType !== 'touch') canvas.style.cursor = gripAt(e) >= 0 ? 'grab' : '';
  });

  function syncPanel() {
```

Edit 4, the API. Replace
```
  apply();
  return api;
```
with
```
  api.gripGroup = gripGroup;
  api.grips = grips;
  api.gripWorld = (k) => { boxGroup.updateMatrixWorld(true); return grips[k].core.getWorldPosition(new THREE.Vector3()).toArray(); };
  api.update = update;

  apply();
  return api;
```

(Edit 5 is the viewer, next step.)

- [ ] **Step 4: Wire the viewer**

Two edits to `src/standalone/viewer.js`.

Replace
```
  const section = createSectionBox({ scene, field: view, bounds: box, dirty });
```
with
```
  const section = createSectionBox({ scene, canvas, viewport, field: view, bounds: box, getCamera: () => cam, getOrbit: () => ctl, dirty });
```
and replace
```
    renderer.render(scene, cam);
    frames += 1;
```
with
```
    section.update(cam, viewport.clientHeight || 800);
    renderer.render(scene, cam);
    frames += 1;
```

- [ ] **Step 5: Rebuild and run**

Run: `npm run build:viewer && node scripts/perf/check_standalone.mjs --only section`
Expected: every line `PASS`, `RESULT: PASS`.

If a face drag is off by more than 2 mm in the orthographic view, check first that `OrbitControls` did not see the press (the camera pose line) and that `t0` is taken at the press, not at the grip centre. If the touch drag fails because OrbitControls reacted, the capture-phase `stopPropagation` is not reaching it: check that the listener is on `viewport` with `true` as the third argument.

Run also: `node scripts/perf/check_standalone.mjs --only viewer`, `npm test 2>&1 | tail -6`, `npx oxlint src scripts tests 2>&1 | grep -c ": warning "` (`29`).

- [ ] **Step 6: Commit**

```bash
git add src/standalone/sectionBox.js src/standalone/viewer.js scripts/perf/check_standalone.mjs
git commit -m "feat(viewer-export): push/pull face grips of constant screen size in the viewer's section box" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Move and Rotate (three's `TransformControls`)

**Files:**
- Modify: `src/standalone/sectionBox.js` (import, the gizmo block, API members)
- Modify: `src/standalone/viewer.js` (`switchTo`, the click guard)
- Modify: `scripts/perf/check_standalone.mjs` (`sectionGizmo`)

**Interfaces:**
- Consumes: `TransformControls` from `three/addons/controls/TransformControls.js` (constructor `(camera, domElement)`, `getHelper()`, `attach(object)`, `detach()`, `setMode('translate' | 'rotate')`, `size`, `enabled`, `camera`, `object`, `axis`, `dragging`; events `change`, `dragging-changed`, `objectChange`); the `parts` array, `getCamera`, `getOrbit`, `canvas` of Task 7.
- Produces: `api.gizmo` (the TransformControls), `api.gizmoBusy(): boolean` (the pointer is on a gizmo handle or dragging it), `api.setCamera(cam)` (the gizmo follows the active camera).

- [ ] **Step 1: Write the failing check**

In `scripts/perf/check_standalone.mjs`, insert before `async function section() {`, and add `    await sectionGizmo(b);` after `    await sectionFaces(b);` in `section()`:

```js
async function sectionGizmo(b) {
  const box = { center: [1.25, 1.5, -0.2], size: [1.3, 0.6, 0.4], quat: [0, 0, 0, 1] };
  await prep(b, { view: 'front', box });
  const info = () => b.ev(`(() => { const s = window.__viewer.section; const g = s.gizmo; return {
    mode: s.state.mode, attached: g.object === s.boxGroup, gizmoMode: g.mode, helper: g.getHelper().visible, enabled: g.enabled, grips: s.gripGroup.visible }; })()`);
  const state = () => b.ev('JSON.parse(JSON.stringify(window.__viewer.section.state))');
  const planes = () => b.ev('window.__viewer.section.planes.map((p) => p.constant)');

  // Faces: the grips show and the gizmo is detached. Move and Rotate attach the gizmo to the box and hide the grips.
  const faces = await info();
  report(faces.mode === 'faces' && !faces.attached && !faces.helper && !faces.enabled && faces.grips, 'gizmo: in Faces the grips show and the gizmo is detached');
  for (const [mode, label] of [['translate', 'Move'], ['rotate', 'Rotate']]) {
    await b.ev(`document.querySelector('#sec-mode [data-mode=${mode}]').click()`);
    await sleep(300);
    const m = await info();
    report(m.mode === mode && m.attached && m.gizmoMode === mode && m.helper && m.enabled && !m.grips, `gizmo: ${label} attaches the ${mode} gizmo to the box and hides the grips`);
  }

  // What the gizmo does to the box group is written back to the state and to the planes (the gizmo's own dragging is three.js's).
  await b.ev(`document.querySelector('#sec-mode [data-mode=translate]').click()`);
  await sleep(200);
  const before = await state();
  const planesBefore = await planes();
  await b.ev(`(() => { const s = window.__viewer.section; s.boxGroup.position.x += 0.4; s.gizmo.dispatchEvent({ type: 'objectChange' }); })()`);
  await sleep(300);
  const moved = await state();
  const planesMoved = await planes();
  report(near(moved.center[0] - before.center[0], 0.4, 1e-9) && near(planesMoved[0] - planesBefore[0], 0.4, 1e-9) && near(planesMoved[1] - planesBefore[1], -0.4, 1e-9),
    'gizmo: moving the box moves its centre and the cut with it');
  await b.ev(`document.querySelector('#sec-mode [data-mode=rotate]').click()`);
  await sleep(200);
  await b.ev(`(() => { const s = window.__viewer.section; s.boxGroup.rotation.y = Math.PI / 4; s.gizmo.dispatchEvent({ type: 'objectChange' }); })()`);
  await sleep(300);
  const rot = await b.ev(`({ q: window.__viewer.section.state.quat, g: window.__viewer.section.boxGroup.quaternion.toArray(), n: window.__viewer.section.planes[0].normal.toArray() })`);
  report(rot.q.every((v, i) => near(v, rot.g[i], 1e-12)) && near(rot.n[0], -Math.SQRT1_2, 1e-9) && near(rot.n[2], Math.SQRT1_2, 1e-9),
    'gizmo: turning the box turns its rotation and the planes with it');

  // A gizmo drag switches the orbit off and back on; a press on a gizmo handle is not a bar pick.
  await b.ev(`window.__viewer.section.gizmo.dispatchEvent({ type: 'dragging-changed', value: true })`);
  const locked = await b.ev('window.__viewer.ctl.enabled');
  await b.ev(`window.__viewer.section.gizmo.dispatchEvent({ type: 'dragging-changed', value: false })`);
  const freed = await b.ev('window.__viewer.ctl.enabled');
  report(locked === false && freed === true, 'gizmo: a gizmo drag switches the orbit off and back on');
  const busy = await b.ev(`(() => { const s = window.__viewer.section; s.gizmo.axis = 'X'; const on = s.gizmoBusy(); s.gizmo.axis = null; return [on, s.gizmoBusy()]; })()`);
  report(busy[0] === true && busy[1] === false, 'gizmo: a press on a gizmo handle counts as busy, otherwise not');

  // The gizmo follows the camera when the projection switches.
  const cams = await b.ev(`(() => { const v = window.__viewer; const g = v.section.gizmo; const a = g.camera === v.cam; v.switchTo('persp'); const p = g.camera === v.cam && !!g.camera.isPerspectiveCamera;
    v.switchTo('ortho'); return [a, p, g.camera === v.cam && !!g.camera.isOrthographicCamera]; })()`);
  report(cams.every(Boolean), 'gizmo: the gizmo follows the camera when the projection switches');

  // Back to Faces: the gizmo is detached again.
  await b.ev(`document.querySelector('#sec-mode [data-mode=faces]').click()`);
  await sleep(200);
  const back = await info();
  report(!back.attached && !back.helper && !back.enabled && back.grips, 'gizmo: back in Faces the gizmo is detached and the grips return');
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/perf/check_standalone.mjs --only section`
Expected: core and faces checks pass; `ERROR Cannot read properties of undefined (reading 'object')` (no `gizmo` yet) and `RESULT: FAIL`.

- [ ] **Step 3: Add the gizmo to `src/standalone/sectionBox.js`**

Three edits.

Edit 1, the import. Replace
```
import * as THREE from 'three';
```
with
```
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
```

Edit 2, the gizmo block, inserted before `syncPanel` (after the grips). Replace
```
  function syncPanel() {
```
with
```
  // ---- Move and Rotate: three's TransformControls on the box group (the app uses the same gizmo through drei) ----
  const gizmo = new TransformControls(getCamera(), canvas);
  gizmo.size = 0.85; // as in the app
  gizmo.enabled = false;
  scene.add(gizmo.getHelper());
  gizmo.addEventListener('change', dirty);
  gizmo.addEventListener('dragging-changed', (e) => { const orbit = getOrbit(); if (orbit) orbit.enabled = !e.value; });
  gizmo.addEventListener('objectChange', () => { // the gizmo moved or turned the group: the state, the planes and the panel follow
    state.center = boxGroup.position.toArray();
    state.quat = boxGroup.quaternion.toArray();
    apply();
  });
  parts.push((live) => {
    const on = live && state.mode !== 'faces';
    gizmo.enabled = on;
    if (on) {
      gizmo.setMode(state.mode);
      if (gizmo.object !== boxGroup) gizmo.attach(boxGroup);
    } else if (gizmo.object) {
      gizmo.detach();
    }
  });

  function syncPanel() {
```

Edit 3, the API. Replace
```
  api.update = update;
```
with
```
  api.update = update;
  api.gizmo = gizmo;
  api.gizmoBusy = () => gizmo.enabled && (gizmo.axis !== null || gizmo.dragging);
  api.setCamera = (cam) => { if (gizmo.camera !== cam) gizmo.camera = cam; };
```

- [ ] **Step 4: Wire the viewer**

Two edits to `src/standalone/viewer.js`.

In `switchTo`, replace
```
    cam = to.cam;
    ctl = to.ctl;
    ctl.update();
    dirty();
  }
```
with
```
    cam = to.cam;
    ctl = to.ctl;
    section.setCamera(cam);
    ctl.update();
    dirty();
  }
```
and in the click handling, replace
```
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button }; });
  canvas.addEventListener('pointerup', (e) => {
    if (down && down.button === 0 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5 && performance.now() - down.t < 700) {
```
with
```
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button, onGizmo: section.gizmoBusy() }; });
  canvas.addEventListener('pointerup', (e) => {
    if (down && down.button === 0 && !down.onGizmo && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5 && performance.now() - down.t < 700) {
```
(These listeners are registered after `createSectionBox`, so the gizmo's own pointer handlers have already run when `gizmoBusy()` is asked.)

- [ ] **Step 5: Rebuild and run**

Run: `npm run build:viewer && node scripts/perf/check_standalone.mjs --only section`
Expected: every line `PASS`, `RESULT: PASS`.

Run also: `node scripts/perf/check_standalone.mjs --only viewer`, `npm test 2>&1 | tail -6`, `npx oxlint src scripts tests 2>&1 | grep -c ": warning "` (`29`), and check the script size still passes the build's 800 KB budget (the `build-viewer:` line).

- [ ] **Step 6: Commit**

```bash
git add src/standalone/sectionBox.js src/standalone/viewer.js scripts/perf/check_standalone.mjs
git commit -m "feat(viewer-export): Move and Rotate for the viewer's section box (three.js TransformControls)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Solid cut (stencil caps on the concrete)

**Files:**
- Modify: `src/standalone/sectionBox.js` (imports, signature, the caps and marks block)
- Modify: `src/standalone/viewer.js` (collect the concrete geometries, pass them in)
- Modify: `scripts/perf/check_standalone.mjs` (`regionProbe`, `sectionSolid`)

**Interfaces:**
- Consumes: `stencilMats` (`[planeIndex] -> { back, front }` mark materials) and `capMaterial(planeIndex)` (`src/viewer/stencilMats.js`, unchanged); `capQuad(i, size)` (Task 2); the renderer's `stencil: true` (Task 3); the viewer's `concreteGroup` and the geometries of its concrete meshes.
- Produces: `createSectionBox({ ..., concreteGroup, concreteGeoms, ... })`. Nothing new in the API: the `Solid cut` button and `api.set({ solidCut })` already exist and now have an effect.

The technique is the app's, unchanged: for each plane `i` and each concrete mesh, back faces increment and front faces decrement the stencil where plane `i` clips the mesh (render orders `3i` and `3i + 1`); then a cap quad on the box face draws where the stencil is not zero (render order `3i + 2`) and clears the stencil. Rebar is not capped (the cap hides the bars behind it, as in the app). **If this cannot be made reliable, see "If Solid cut cannot be made reliable" at the end of Task 10.**

- [ ] **Step 1: Write the failing check**

In `scripts/perf/check_standalone.mjs`, insert before `async function section() {`, and add `    await sectionSolid(b);` after `    await sectionGizmo(b);` in `section()`:

```js
// Brightness at the middle of a rectangle (canvas CSS px), and the share of its pixels within 25 of that brightness.
const regionProbe = (x0, y0, x1, y1) => `(() => {
  const c = document.getElementById('gl'); const k = c.width / c.clientWidth;
  const t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
  const x = t.getContext('2d', { willReadFrequently: true }); x.drawImage(c, 0, 0);
  const X0 = Math.round(${x0} * k), Y0 = Math.round(${y0} * k), W = Math.max(1, Math.round((${x1} - ${x0}) * k)), H = Math.max(1, Math.round((${y1} - ${y0}) * k));
  const d = x.getImageData(X0, Y0, W, H).data;
  const lum = (i) => (d[i] + d[i + 1] + d[i + 2]) / 3;
  const mid = lum((Math.floor(H / 2) * W + Math.floor(W / 2)) * 4);
  let close = 0;
  for (let i = 0; i < d.length; i += 4) if (Math.abs(lum(i) - mid) <= 25) close++;
  return { mid, share: close / (d.length / 4) };
})()`;

async function sectionSolid(b) {
  // The +Z face of this box (z = -0.15) cuts the beam (z -0.4..0) through its depth: the cut face is the beam's cross section,
  // x 0.5..2.0 and up 1.2..1.8 m. The box face is taller than the beam (up 1.1..1.9), so part of the face lies outside the concrete.
  // No face of the box lies on a face of the beam (that would be a degenerate stencil case).
  const box = { center: [1.25, 1.5, -0.25], size: [1.5, 0.8, 0.2], quat: [0, 0, 0, 1] };
  await prep(b, { view: 'front', box, solidCut: false });
  const rectOf2 = (p, q) => [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])];
  const at = (x, up) => toScreen(b, [x, up, -0.2]);
  const inBeam = rectOf2(await at(0.6, 1.25), await at(1.9, 1.42)); // inside the cross section, clear of the bar at up 1.5
  const outsideBeam = rectOf2(await at(0.6, 1.12), await at(1.9, 1.17)); // on the box face, below the beam
  const probe = (r) => b.ev(regionProbe(...r));

  const off = await probe(inBeam);
  await b.ev('document.getElementById("sec-solid").click()');
  await sleep(700);
  const on = await probe(inBeam);
  const out = await probe(outsideBeam);
  report(on.mid > off.mid + 50 && on.share > 0.9, `solid: Solid cut fills the beam's cut face (brightness ${off.mid.toFixed(0)} -> ${on.mid.toFixed(0)}, ${(on.share * 100).toFixed(0)} % of it evenly filled)`);
  report(out.mid < on.mid - 50, `solid: and only the cut face: the rest of the box face stays clear (brightness ${out.mid.toFixed(0)})`);

  await b.ev('document.getElementById("sec-show").click()');
  await sleep(500);
  const noBox = await probe(inBeam);
  report(near(noBox.mid, off.mid, 15), `solid: with 👁 Box off the caps are gone (brightness ${noBox.mid.toFixed(0)}) and the cut stays`);
  await b.ev('document.getElementById("sec-show").click()');
  await sleep(500);
  await b.ev('document.getElementById("sec-solid").click()');
  await sleep(700);
  const offAgain = await probe(inBeam);
  report(near(offAgain.mid, off.mid, 15), `solid: switching Solid cut off empties the cut face again (brightness ${offAgain.mid.toFixed(0)})`);

  // In the perspective view the caps of several faces must not smear into each other: only the cut faces are filled.
  const brightPixels = () => b.ev(`(() => {
    const c = document.getElementById('gl'); const t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
    const x = t.getContext('2d', { willReadFrequently: true }); x.drawImage(c, 0, 0);
    const d = x.getImageData(0, 0, t.width, t.height).data; let bright = 0;
    for (let i = 0; i < d.length; i += 4) if ((d[i] + d[i + 1] + d[i + 2]) / 3 > ${Math.round(on.mid - 40)}) bright++;
    return { bright, total: d.length / 4 };
  })()`);
  await prep(b, { view: 'iso', box, solidCut: false });
  const isoOff = await brightPixels();
  await prep(b, { view: 'iso', box, solidCut: true });
  const isoOn = await brightPixels();
  const filled = isoOn.bright - isoOff.bright;
  report(filled > 200 && filled < isoOn.total * 0.2, `solid: in the Iso view the caps fill only the cut faces (${filled} more bright pixels of ${isoOn.total})`);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/perf/check_standalone.mjs --only section`
Expected: the earlier checks pass; `solid: Solid cut fills the beam's cut face` fails (brightness stays low: nothing is drawn yet), and `RESULT: FAIL`.

- [ ] **Step 3: Add the caps and marks to `src/standalone/sectionBox.js`**

Four edits.

Edit 1, imports. Replace
```
import { FACES, AXIS_COLORS, faceDragResult, testCutSize, boxFromBounds, pixelWorldSize } from '../viewer/sectionBoxMath.js';
```
with
```
import { stencilMats, capMaterial } from '../viewer/stencilMats.js';
import { FACES, AXIS_COLORS, capQuad, faceDragResult, testCutSize, boxFromBounds, pixelWorldSize } from '../viewer/sectionBoxMath.js';
```

Edit 2, signature. Replace
```
export function createSectionBox({ scene, canvas, viewport, field, bounds, getCamera, getOrbit, dirty }) {
```
with
```
export function createSectionBox({ scene, canvas, viewport, concreteGroup, concreteGeoms, field, bounds, getCamera, getOrbit, dirty }) {
```

Edit 3, the block, inserted before `syncPanel` (after the gizmo). Replace
```
  function syncPanel() {
```
with
```
  // ---- Solid cut: the cut faces of the concrete are filled (the app's stencil technique and render order). For each plane i and each
  // concrete mesh, back faces increment and front faces decrement the stencil where plane i clips the mesh (render orders 3i, 3i + 1);
  // then a cap quad on the box face draws where the stencil is not zero (3i + 2) and clears the stencil. Rebar is not capped. The marks
  // are children of the concrete group, so hiding the concrete hides them; the caps belong to the box, so they hide with 👁 Box. ----
  const capGroup = new THREE.Group();
  boxGroup.add(capGroup);
  const caps = [0, 1, 2, 3, 4, 5].map((i) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), capMaterial(i));
    mesh.renderOrder = 3 * i + 2;
    mesh.onAfterRender = (renderer) => renderer.clearStencil(); // without it the caps of one face accumulate into the next
    capGroup.add(mesh);
    return mesh;
  });
  const markGroups = concreteGeoms.map((geom) => {
    const g = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const back = new THREE.Mesh(geom, stencilMats[i].back);
      back.renderOrder = 3 * i;
      const front = new THREE.Mesh(geom, stencilMats[i].front);
      front.renderOrder = 3 * i + 1;
      g.add(back, front);
    }
    g.visible = false;
    concreteGroup.add(g);
    return g;
  });
  parts.push((live) => {
    capGroup.visible = live && state.solidCut;
    caps.forEach((mesh, i) => {
      const q = capQuad(i, state.size);
      mesh.position.set(q.pos[0], q.pos[1], q.pos[2]);
      mesh.rotation.set(q.rot[0], q.rot[1], q.rot[2]);
      mesh.scale.set(q.args[0], q.args[1], 1);
    });
    for (const g of markGroups) g.visible = state.enabled && state.solidCut;
  });

  function syncPanel() {
```

(Edit 4 is the viewer.)

- [ ] **Step 4: Wire the viewer**

Three edits to `src/standalone/viewer.js`.

Replace
```
  const concreteGroup = new THREE.Group();
```
with
```
  const concreteGroup = new THREE.Group();
  const concreteGeoms = []; // the same geometries carry the solid-cut stencil marks
```
Replace
```
    box.union(g.boundingBox);
    concreteGroup.add(new THREE.Mesh(g, ghost));
```
with
```
    box.union(g.boundingBox);
    concreteGeoms.push(g);
    concreteGroup.add(new THREE.Mesh(g, ghost));
```
Replace
```
  const section = createSectionBox({ scene, canvas, viewport, field: view, bounds: box, getCamera: () => cam, getOrbit: () => ctl, dirty });
```
with
```
  const section = createSectionBox({
    scene, canvas, viewport, concreteGroup, concreteGeoms, field: view, bounds: box, getCamera: () => cam, getOrbit: () => ctl, dirty,
  });
```

- [ ] **Step 5: Rebuild and run**

Run: `npm run build:viewer && node scripts/perf/check_standalone.mjs --only section`
Expected: every line `PASS`, `RESULT: PASS`.

If a `solid:` assertion fails, do not loosen it: use the systematic-debugging skill. Useful probes (all through `window.__viewer`): `section.state.solidCut`, `section.boxGroup.children` (six caps in `capGroup`), the `renderOrder` of caps and marks, `renderer.getContext().getContextAttributes().stencil` (must be `true`), and a screenshot of the Front and Iso views (`Page.captureScreenshot`) to see whether the face is empty (marks missing) or the whole box face is grey (the stencil is not cleared). The app's headless diagnostics `?captest=eq0|eq1|eq255` and `?oneplane=N` (in `SectionBox.jsx`) show how the same effects were isolated there.

Run also: `node scripts/perf/check_standalone.mjs --only viewer`, `npm test 2>&1 | tail -6`, `npx oxlint src scripts tests 2>&1 | grep -c ": warning "` (`29`).

- [ ] **Step 6: Commit**

```bash
git add src/standalone/sectionBox.js src/standalone/viewer.js scripts/perf/check_standalone.mjs
git commit -m "feat(viewer-export): Solid cut in the viewer: stencil caps on the cut faces of the concrete" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 10: The 1M-bar scale run and the evidence runs (production preview and dev server)

**Files:**
- Modify: `scripts/perf/check_standalone.mjs` (the `scale` section)
- Modify (only if a run fails): whatever the failure points at, through the systematic-debugging skill.

**Interfaces:**
- Consumes: every helper of Tasks 3–9; `scripts/perf/gen_project.mjs` (unchanged); the existing checks `check_field.mjs`, `check_views.mjs`, `check_select.mjs`.
- Produces: the measured numbers for the final report (file sizes, open times, export time, orbit rate, check counts).

- [ ] **Step 1: Add the `scale` section**

In `scripts/perf/check_standalone.mjs`, first add `const bigFile = arg('big', '');` right after the line `const projectFile = arg('project', '');`, then replace the line `const sections = { viewer, section, export: exportCheck, roundtrip };` with:

```js
// A million bars: the app exports the file (timed), the viewer opens it from file:// (timed) and orbits (frames drawn per second).
async function scale() {
  if (!bigFile) {
    if (only) { console.error('scale needs --big <project.json> (node scripts/perf/gen_project.mjs 25000 40 p1m 7)'); process.exit(2); }
    console.log('SKIP  scale (needs --big)');
    return;
  }
  const rowCount = JSON.parse(fs.readFileSync(bigFile, 'utf8')).bars.length;
  const exportedPath = path.join(outDir, 'standalone-scale.html');
  fs.rmSync(exportedPath, { force: true });
  let appTotals = null;

  // 1. In the app: open the big project, ⤓ Viewer, check the time and the size.
  const app = await launchBrowser();
  try {
    await openApp(app, bigFile, rowCount, 'autotest=standalone-scale');
    await waitFor(app, '!!(window.__barfield && window.__barfield.ready)', 240000);
    appTotals = await app.ev(`(() => { const e = document.querySelector('.bbstool strong'); return e ? e.textContent : null; })()`);
    const { dl, ms } = await exportFromApp(app, 'One million bars');
    report(!!dl && ms <= 3000, `scale: ⤓ Viewer on ${rowCount} rows took ${ms} ms to pack and download (budget 3000; this includes polling, so it is an upper bound)`);
    const bytes = dl ? Buffer.byteLength(dl.text) : 0;
    report(bytes > 0 && bytes <= 1800 * 1024, `scale: the file is ${(bytes / 1024).toFixed(0)} KB (budget 1800 KB)`);
    if (dl) fs.writeFileSync(exportedPath, dl.text);
    report(app.consoleErrors.length === 0, `scale: the app logged no errors${app.consoleErrors.length ? ': ' + app.consoleErrors[0] : ''}`);
  } finally {
    app.close();
  }
  if (!fs.existsSync(exportedPath)) return;

  // 2. In a fresh browser: open the file from file:// (budget 3 s), the same totals, and the orbit rate (median of three windows).
  const v = await launchBrowser();
  try {
    const ms = await openViewer(v, exportedPath, { autotest: 'nobuffer' });
    report(ms <= 3000, `scale: the viewer opened ${rowCount} rows from file:// in ${ms} ms (budget 3000)`);
    const totals = await v.ev('document.getElementById("stats").textContent');
    report(!!appTotals && appTotals.replace(/^BBS · /, '') === totals, `scale: the viewer's totals equal the app's ("${totals}")`);
    await settle(v);
    const rect = await rectOf(v);
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const rates = [];
    for (let w = 0; w < 3; w++) {
      await v.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy });
      await v.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 });
      const f0 = await v.ev('window.__viewer.frames');
      const t0 = Date.now();
      while (Date.now() - t0 < 2500) {
        const phase = ((Date.now() - t0) / 2500) * Math.PI * 4;
        await v.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + Math.sin(phase) * 250, y: cy + Math.cos(phase * 0.7) * 80, button: 'left', buttons: 1 });
        await sleep(6);
      }
      const f1 = await v.ev('window.__viewer.frames');
      const secs = (Date.now() - t0) / 1000;
      await v.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', buttons: 0, clickCount: 1 });
      rates.push((f1 - f0) / secs);
      await sleep(500);
    }
    rates.sort((x, y) => x - y);
    report(rates[1] >= 30, `scale: orbiting ${rowCount} rows draws ${rates.map((r) => r.toFixed(1)).join(' / ')} frames per second (median ${rates[1].toFixed(1)}, budget 30)`);
    report(v.consoleErrors.length === 0, `scale: the viewer logged no errors${v.consoleErrors.length ? ': ' + v.consoleErrors[0] : ''}`);
  } finally {
    v.close();
  }
}

const sections = { viewer, section, export: exportCheck, roundtrip, scale };
```

- [ ] **Step 2: Make the test projects**

```bash
node scripts/perf/gen_project.mjs 25000 40 p1m 7
```
Expected: `.../scripts/perf/out/p1m.json: rows=25000 physical bars=1002336 size=...`. (Skip if that file already exists with `physical bars=1002336`.)

- [ ] **Step 3: Build and serve the production preview (the fair baseline)**

```bash
npm run build
npx vite preview --port 5188 --strictPort --host 127.0.0.1
```
(run the second command with `run_in_background`; wait until `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5188/` prints `200`). `npm run build` must print the `build-viewer:` line first and finish with exit 0.

Check that the preview serves the template: `curl -s -o scripts/perf/out/served-template.html http://127.0.0.1:5188/viewer-template.html && cmp dist/viewer-template.html scripts/perf/out/served-template.html && echo identical` → `identical`.

- [ ] **Step 4: Run every check on the preview**

Run each and read the last line (`RESULT: PASS`) and any `FAIL` lines:

```bash
node scripts/perf/check_standalone.mjs --url http://127.0.0.1:5188
node scripts/perf/check_standalone.mjs --url http://127.0.0.1:5188 --only viewer --project inputs/saves/barbending-project-20261007-1814_ent3_with_group.json --max-kb 800
node scripts/perf/check_standalone.mjs --url http://127.0.0.1:5188 --only export --project inputs/saves/barbending-project-20261007-1814_ent3_with_group.json --max-kb 800
node scripts/perf/check_standalone.mjs --url http://127.0.0.1:5188 --only scale --big scripts/perf/out/p1m.json
node scripts/perf/check_field.mjs --url http://127.0.0.1:5188
node scripts/perf/check_views.mjs --url http://127.0.0.1:5188
node scripts/perf/check_select.mjs --url http://127.0.0.1:5188
```
Expected: every run `RESULT: PASS`; `check_field` 60 checks, `check_select` 45 checks (as before); the Ent3 file at most 800 KB (the prototype's was 627 KB); the 1M-bar file at most 1,800 KB, opened in at most 3,000 ms, orbit median at least 30; the export at most 3,000 ms. Benchmarks on this machine are noisy (shared GPU/CPU): if only the orbit rate or an open time misses, repeat the scale run twice more and judge by the median of the three runs; do not loosen a budget.

Keep the numbers (file sizes in KB, open ms, export ms, the three orbit rates, check counts) for the final report.

- [ ] **Step 5: Run the fixture checks on the dev server**

Make sure the dev server on 5189 is running (`npx vite --port 5189 --strictPort`, background; `curl` → `200`; the template is already in `public/`).

```bash
node scripts/perf/check_standalone.mjs --url http://localhost:5189
node scripts/perf/check_views.mjs --url http://localhost:5189 --only section
```
Expected: `RESULT: PASS` for both. (The dev server serves the template from `public/`, the preview from `dist/`; both paths are now covered.)

- [ ] **Step 6: Run the unit tests, lint and the production build once more**

```bash
npm test 2>&1 | tail -8
npx oxlint src scripts tests 2>&1 | grep -c ": warning "
npx oxlint src scripts tests 2>&1 | grep -c ": error "
```
Expected: all tests pass (136 existing plus the new ones: 10 pack, 10 section math, 3 export = 159), `29`, `0`.

- [ ] **Step 7: If Solid cut cannot be made reliable**

This applies only if `sectionSolid` still fails after a systematic investigation (the systematic-debugging skill: reproduce, compare with the app's rendering of the same cut, one hypothesis at a time; stop after three failed fixes and report rather than piling up hacks). The spec's fallback is to ship Solid cut switched off and say so:
1. In `src/standalone/sectionBox.js` set the initial state to `solidCut: false`.
2. In `src/standalone/template.html` remove `class="on"` from `#sec-solid` and set its title to `Fill the cut faces of the concrete members (not reliable yet in the viewer)`.
3. In `scripts/perf/check_standalone.mjs` make `sectionSolid` report the known limitation once (`SKIP  solid: ...` with the reason) instead of failing.
4. Tell the user plainly in the final report, and put the sentence in the CHANGELOG entry at the record step.
Do not claim the feature works in that case.

- [ ] **Step 8: Commit**

```bash
git add scripts/perf/check_standalone.mjs
git commit -m "test(perf): the standalone viewer's 1M-bar scale run" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
(plus any fix from Step 4–6, committed on its own with a message that names it.)

---

### Task 11: Documentation, cleanup and the hand-over

**Files:**
- Modify: `README.md` (CRLF in the working tree), `agent.md`, `overview.md`, `scripts/perf/README.md`
- Delete: `prototype-viewer/` (untracked, announced as throwaway in the spec)
- Not touched here: `CHANGELOG.md` (only when the user says "record, commit and push").

**Interfaces:**
- Consumes: the finished feature of Tasks 1–10 and its measured numbers.
- Produces: the documentation and a clean tree.

- [ ] **Step 1: README.md (keeping its CRLF line endings)**

`README.md` is CRLF in the working tree and LF in the index, so insert with a script that keeps the file's endings. Create `scripts/perf/out/insert_readme.mjs` (that folder is git-ignored) with the Write tool:

```js
// One-off: insert the viewer-export text into README.md, keeping the file's line endings (the working copy is CRLF).
import fs from 'node:fs';

const file = 'README.md';
const raw = fs.readFileSync(file, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
let text = raw.replace(/\r\n/g, '\n');
const insert = (anchor, block, where) => {
  const at = text.indexOf(anchor);
  if (at < 0 || text.indexOf(anchor, at + 1) >= 0) throw new Error('anchor not found exactly once: ' + JSON.stringify(anchor));
  text = where === 'before' ? text.slice(0, at) + block + text.slice(at) : text.slice(0, at + anchor.length) + block + text.slice(at + anchor.length);
};

insert('## Features\n',
  '> `npm run dev` and `npm run build` first run `npm run build:viewer`, which writes `public/viewer-template.html` (the page behind\n'
  + '> **⤓ Viewer**; git-ignored). After changing `src/standalone/` run it again: the dev server does not rebuild it.\n\n', 'before');
insert('\n## Typical workflows\n',
  '- **Share as one file** — **⤓ Viewer** writes the whole model as ONE `.html` file that opens in any recent browser with nothing\n'
  + '  installed (no app, no server, no internet): 3D bars and concrete, orbit / zoom / pan, the six true orthographic views, click a bar\n'
  + '  for its details, the sortable BBS table, a diameter legend, and a **section box** (push / pull faces, Move, Rotate, Fit box, Test\n'
  + '  cut, Solid cut). The file is also a save: **⤒ Project** and **⤒+ Insert** open it again in the app. The IFC model is not in it,\n'
  + '  and reference lines are kept in the file but not drawn.\n', 'before');
insert('   tags renumber, hosts follow (undoable).\n',
  '5. **Share a finished model:** ⤓ Viewer → type a title → send the `.html` file; whoever opens it sees the model and the schedule in\n'
  + '   their browser. Open it in the app again with ⤒ Project.\n', 'after');
insert('| Ghost too faint / too solid | Ghost ◧ / Solid ◼ toggle + opacity slider in the IFC rail |\n',
  '| ⤓ Viewer says the template is missing | `npm run build:viewer`, then reload (`npm run dev` / `npm run build` do it for you) |\n', 'after');
insert('- BBS math is straight/hook/bend-deduction lengths',
  '- The viewer `.html` is read-only: no IFC model, no measuring, no editing; the section box is not saved in the file.\n', 'before');
insert('  ifc/               WASM loader session, control panel, units\n',
  '  standalone/        single-file viewer export (⤓ Viewer): pack, viewer, section box, page template\n', 'after');

fs.writeFileSync(file, text.replace(/\n/g, eol));
console.log('README.md updated, line endings kept as', eol === '\r\n' ? 'CRLF' : 'LF');
```
Run: `node scripts/perf/out/insert_readme.mjs` — expected `README.md updated, line endings kept as CRLF`. Then `git diff --stat README.md` shows 13 added lines and nothing else (a whole-file change would mean the line endings were lost).

- [ ] **Step 2: agent.md**

Use the Edit tool: replace `## Dev servers & the stale-tab problem` with the following section followed by that heading again:

```
## Standalone viewer (`src/standalone/`, the `⤓ Viewer` export)

- `⤓ Viewer` writes ONE `.html` file: a generated template (`public/viewer-template.html`, git-ignored, built by `npm run build:viewer`,
  which `predev` and `prebuild` run) with the title and the gzipped, base64-encoded `_projectData()` filled in by `packViewerHtml`
  (`pack.js`). The same file is a project save: `⤒ Project` / `⤒+ Insert` read `.html` through `parseProjectFile` →
  `extractProjectFromHtml`. The viewer is vanilla JS on three.js (`viewer.js`, `sectionBox.js`), bundled by `scripts/build-viewer.mjs`
  (Vite library mode, IIFE) together with the app's own pure modules (`buildField`, `FieldView`, `pickField`, `cameraMath`,
  `sectionPlanes`, `stencilMats`, `csv.js`, ...), so geometry and numbers cannot drift from the app.
- Rules that keep it working: the template has exactly two tokens the app fills in (`@@BARBENDING_TITLE@@`, `@@BARBENDING_DATA@@`, once
  each) and two build-time tokens; the viewer script must not contain any of them, so never import `pack.js` into the viewer (it imports
  `codec.js` only). The build checks the tokens, the two script elements and the script size (800 KB). The dev server does not watch
  `src/standalone/`: after changing it run `npm run build:viewer` and reload. A dev server answers an unknown path with `index.html` and
  status 200, which is why `loadViewerTemplate` looks for the tokens, not the status.
- Test hooks (`window.__viewer`) and a readable canvas exist only with `?autotest` (`?autotest=nobuffer` for fps runs); a visitor's page has neither.
- Section box: the pure maths is `src/viewer/sectionBoxMath.js`, shared with the app's `SectionBox.jsx` (change it in one place and run
  `tests/standalone/sectionBoxMath.test.mjs` and `check_views.mjs --only section`). `FACES` (the grips) is in the order -X, +X, -Y, +Y,
  -Z, +Z; the clipping planes and `capQuad` are in the order +X, -X, +Y, -Y, +Z, -Z. The viewer keeps the app's technique: the shared
  `sectionPlanes` mutated in place, `FieldView.setClipping`, stencil marks and cap quads at render orders `3i`, `3i + 1`, `3i + 2`,
  `renderer.clearStencil()` after each cap, `stencil: true` on the renderer. Face grips keep a constant size on screen (`pixelWorldSize`)
  with a doubled hit area; a press on a grip is caught in the capture phase on the viewport so OrbitControls and the bar picker never see it.
- Browser check: `scripts/perf/check_standalone.mjs` (sections `viewer`, `section`, `export`, `roundtrip`, `scale`; the first two need only
  the built template, the others `--url`).

## Dev servers & the stale-tab problem
```

- [ ] **Step 3: overview.md**

Two edits with the Edit tool.

Replace the row
```
| `src/viewer/stencilMats.js` | Shared stencil mark + cap materials (created once) |
```
with
```
| `src/viewer/stencilMats.js` | Shared stencil mark + cap materials (created once) |
| `src/viewer/sectionBoxMath.js` | Pure section-box maths shared by `SectionBox.jsx` and the standalone viewer: the faces, cap quads, the face-drag result, the Test cut size, the default box from bounds, the world size of a pixel (constant-size grips) |
| `src/standalone/pack.js`, `codec.js` | The single-file viewer format: fill the template with the title and the gzipped base64 project (`packViewerHtml`), read it back (`extractProjectFromHtml`, `parseProjectFile`) |
| `src/standalone/exportViewer.js` | Fetches the generated viewer template for `⤓ Viewer` (and recognises a dev server's `index.html` fallback) |
| `src/standalone/viewer.js`, `sectionBox.js`, `template.html` | The viewer inside the exported file: vanilla JS on three.js reusing the app's pure modules, its section box (grips, move / rotate gizmo, solid-cut caps) and the page shell; `scripts/build-viewer.mjs` bundles them into `public/viewer-template.html` |
```
and replace
```
## Key conventions
```
with
```
**Viewer export:** `⤓ Viewer` → title prompt → `loadViewerTemplate` (fetch `viewer-template.html`) → `packViewerHtml(template,
_projectData(), { title })` (gzip + base64 into the template's data element) → download one `.html`. Opening it: the page's script
reads the data (`DecompressionStream`), rebuilds the rows with `enrichBar` and the field with `buildField` / `FieldView`, and renders on
demand; `⤒ Project` in the app reads the same data back with `extractProjectFromHtml`.

## Key conventions
```

- [ ] **Step 4: scripts/perf/README.md**

Two edits with the Edit tool.

Replace the line
```
`--enforce` checks `budgets.json` (reference machine: Intel UHD, 1600×900, DPR 1, no IFC).
```
with (the inner block is part of the file's text)
````
The standalone viewer (the single `.html` that `⤓ Viewer` writes) has its own check; `viewer` and `section` need only the built template,
the others the app at `--url`:

```bash
npm run build:viewer
node scripts/perf/check_standalone.mjs --url http://127.0.0.1:5189 --project inputs/saves/<your save>.json --max-kb 800
node scripts/perf/check_standalone.mjs --url http://127.0.0.1:5189 --only scale --big scripts/perf/out/p1m.json
```

`--enforce` checks `budgets.json` (reference machine: Intel UHD, 1600×900, DPR 1, no IFC).
````
and add a row at the end of the scripts table (after the `check_views.mjs` row):
```
| `check_standalone.mjs` | Functional checks of the single-file viewer: opens from `file://` within budget, totals equal the app's BBS header, picking, the table, the six orthographic views, dots, the legend; the section box (default box, Test cut agreeing with the planes to 1 px, face grips moving by the exact pointer distance, Move / Rotate gizmos, Solid cut caps, 👁 Box, the pick filter); the app's `⤓ Viewer` export and the `.html` round trip through `⤒ Project` / `⤒+ Insert`; and the 1M-bar scale run (`--big`) |
```

- [ ] **Step 5: Delete the prototype (look first)**

```bash
ls -la prototype-viewer prototype-viewer/out prototype-viewer/src
git status --short prototype-viewer | head -3
```
Expected: the throwaway files only (`src/`, `build.mjs`, `shots.mjs`, `README.txt`, `out/*.html`, `out/*.png`), all untracked. The same viewer is now produced by `⤓ Viewer`. Then:

```bash
rm -rf prototype-viewer
git status --short | head -20
```
Expected: no `prototype-viewer` line; the spec and plan files, `inputs/` and nothing else untracked.

- [ ] **Step 6: Final verification on the finished tree**

```bash
npm test 2>&1 | tail -8
npx oxlint src scripts tests 2>&1 | grep -c ": warning "
npm run build 2>&1 | tail -5
git log --oneline -12
git status --short
```
Expected: 159 tests pass; `29`; the build passes (with the `build-viewer:` line); the log shows this feature's commits on `feat/standalone-viewer` and `git status` lists only the docs edits of this task plus the untracked spec, plan and `inputs/` files. Also stop the servers you started (5189 and 5188) and no others, as described under Platform in the Global Constraints, and delete the throwaway files you made in `scripts/perf/out/` (that folder is git-ignored, so nothing there can be committed by mistake).

- [ ] **Step 7: Commit the docs**

```bash
git add README.md agent.md overview.md scripts/perf/README.md
git commit -m "docs(viewer-export): README, agent notes, overview and perf README for the single-file viewer" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Report to the user and wait**

Give the user a short report: what now exists (the `⤓ Viewer` button, the `.html`, the section box with Faces / Move / Rotate / Fit box / Test cut / Solid cut / 👁 Box), the measured numbers against the budgets (Task 10), what was not exercised (a real phone and real touch, browsers other than Edge, an IFC model in the app while exporting, Safari / Firefox), any fallback taken (Solid cut), and that nothing is pushed. Ask whether to **record, commit and push**; only then write the CHANGELOG entry (top of "Unreleased", the style of the entries above it, with the measured numbers and the "not exercised" list), commit it together with the spec and this plan, and push `feat/standalone-viewer`.

