# Performance rig

Measures how the app behaves with large synthetic projects, in a separate headless Edge that
uses the real GPU (Windows only). Nothing here touches your own browser session.

## Quick start

```bash
# 1. serve a build (production is the fair baseline)
npm run build && npx vite preview --port 5188 --host 127.0.0.1 &

# 2. generate projects (written to scripts/perf/out/, git-ignored)
node scripts/perf/gen_project.mjs 250 40 p10k 7        # ~10k bars
node scripts/perf/gen_project.mjs 25000 40 p1m 7       # ~1M bars  (expect 1002336)
node scripts/perf/gen_project.mjs 7500 400 p3mfat 11  # ~3M bars in 7,500 rows (expect 3007138): the 3M benchmark
node scripts/perf/gen_project.mjs 75000 40 p3m 11      # ~3M bars in 75,000 rows (expect 3002391): with the BBS table windowed
                                                       # it opens in about a minute (the left panel's bar dropdowns then hold
                                                       # 150,000 options); with the left panel collapsed, in about a second

# 3. benchmark
node scripts/perf/cdp_bench.mjs --url "http://127.0.0.1:5188/?renderer=field" \
  --project scripts/perf/out/p1m.json --label field-1m --expect 1002336 --budget p1m --enforce
node scripts/perf/cdp_bench.mjs --url "http://127.0.0.1:5188/" \
  --project scripts/perf/out/p3mfat.json --label field-3m --expect 3007138 --budget p3m --enforce
```

The standalone viewer (the single `.html` that `⤓ Viewer` writes) has its own check; `viewer` and `section` need only the built template,
the others the app at `--url`:

```bash
npm run build:viewer
node scripts/perf/check_standalone.mjs --url http://127.0.0.1:5188 --project inputs/saves/<your save>.json --max-kb 800
node scripts/perf/check_standalone.mjs --url http://127.0.0.1:5188 --only scale --big scripts/perf/out/p1m.json
```

The bottom BBS panel (windowed table, find, Groups list, locate) has its own check: `fixture` builds a 400-row project and needs only the
app; `scale` adds 200 members and 500 ▦ groups to the 1M-bar project and times the table at that size:

```bash
node scripts/perf/check_bbs.mjs --url http://127.0.0.1:5188 --only fixture
node scripts/perf/check_bbs.mjs --url http://127.0.0.1:5188 --only scale --big scripts/perf/out/p1m.json
```

`--enforce` checks `budgets.json` (reference machine: Intel UHD, 1600×900, DPR 1, no IFC).
`--view front` (or top / bottom / back / left / right / iso) picks that preset from the dropdown before measuring, to benchmark the
orthographic camera (1M bars, Front: 52 fps idle, 40 orbit, 58 zoom, 60 close-up).
Without it the run only prints results. `PROFILE=1` adds a CPU profile (best against the dev server).

Reading the load numbers: `load.ms` is the wall-clock time until the page is responsive again, and
`load.blockedMs` is the main-thread time lost to long tasks. At 1M bars it used to be nearly all the BBS table
rendering every row (about 20 s); with the table windowed (only the rows on screen exist) it is about 12 s, and
nearly all of that is React inserting the 50,000 `<option>`s of the left panel's two bar dropdowns (with the
left panel collapsed the same project is ready in about half a second). `domNodes` is CDP's `Nodes` metric, which
also counts detached nodes that are still alive: compare it with `document.querySelectorAll('*').length`. `viewportMs` is the time from the page being responsive until
the bars are drawn (the budgeted number: the viewport only, as the spec defines it). `viewportWallMs` is
import-to-drawn wall-clock with the table included; it is reported, not budgeted. Both need the field
renderer (`?renderer=field`), which publishes `window.__barfield`.

The idle, orbit and close-up numbers are the median of three measurement windows (the individual windows
are listed in `runs`): on a machine shared with other GPU users one window can wobble by 5-10 fps.

## Scripts

| Script | Purpose |
|---|---|
| `gen_project.mjs` | Synthetic project JSON (mixed bar types, grids) |
| `cdp_bench.mjs` | Load time, memory, DOM size, draw calls, fps (idle / orbit / zoom / close-up), latencies |
| `check_field.mjs` | Functional checks of the field renderer against the legacy renderer (parity, picking, fallback) |
| `check_select.mjs` | Functional checks of the Box and Lasso selection tools: the toolbar and Shift+B / Shift+L, the exact rule (a shape in the gap of a distribution set or the empty corner of a diagonal bar selects nothing), one-shot, Ctrl adds, Esc, the outlines, perspective and orthographic (`--only toolbar\|box\|lasso\|persp`); `--only perf --project scripts/perf/out/p1m.json` times a selection at a million bars |
| `check_views.mjs` | Functional checks of the true views and the orthographic camera: exact axes from the dropdown and the gizmo, parallel projection, seamless Persp/Ortho switching, orbit / wheel / pan / keys / Fit All, picking, LOD, section box, end-on bars (dots), Fit IFC and a loaded IFC model (`--only views\|ortho\|gizmo\|nav\|field\|section\|dots\|ifc`); all sections take about 13 minutes, so run them one by one or in the background |
| `check_bbs.mjs` | Functional checks of the bottom BBS panel (`--only fixture\|scale`): first-run height, only the rows on screen in the page and every row exactly 28 px, scroll to the end, the pinned group header (and that it is not shown twice at the top), click / Ctrl / Shift selection and a click on a half-hidden row not moving the table, find (mark, ▦ group, member, Ø, several words, Esc, no empty frame when the list shrinks), Collapse all / Expand all, the table following a selection made elsewhere and `⌖ Selection`, the Groups list and jumping to a ▦ group or member, group editing (rename from the Groups list, a group header and the Set card, a refused name, add bars, a bar moving over from another group, remove bars, a group left with one bar, a face-sketch group asking first, the collapsed flag kept, undo of every step), Group by Element / ▦ Group / None, sort, Tools, maximize; `--only scale --big scripts/perf/out/p1m.json` times load, DOM size, row select, scroll to the end, a jump to the last of 500 ▦ groups, find, locate, and renaming a group / adding 30 bars / removing them (against a plain one-bar edit) at a million bars |
| `check_standalone.mjs` | Functional checks of the single-file viewer: opens from `file://` within budget, totals equal the app's BBS header, picking, the table, the six orthographic views, dots, the legend; the section box (default box, Test cut agreeing with the planes to 1 px, face grips moving by the exact pointer distance, Move / Rotate gizmos, Solid cut caps, 👁 Box, the pick filter); the app's `⤓ Viewer` export and the `.html` round trip through `⤒ Project` / `⤒+ Insert`; and the 1M-bar scale run (`--big`) |

Set `EDGE_PATH` if Edge is not at `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`.
