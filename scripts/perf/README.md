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
node scripts/perf/gen_project.mjs 75000 40 p3m 11      # ~3M bars  (expect 3002391)

# 3. benchmark
node scripts/perf/cdp_bench.mjs --url "http://127.0.0.1:5188/?renderer=field" \
  --project scripts/perf/out/p1m.json --label field-1m --expect 1002336 --budget p1m --enforce
```

`--enforce` checks `budgets.json` (reference machine: Intel UHD, 1600×900, DPR 1, no IFC).
Without it the run only prints results. `PROFILE=1` adds a CPU profile (best against the dev server).

## Scripts

| Script | Purpose |
|---|---|
| `gen_project.mjs` | Synthetic project JSON (mixed bar types, grids) |
| `cdp_bench.mjs` | Load time, memory, DOM size, draw calls, fps (idle / orbit / zoom / close-up), latencies |
| `check_field.mjs` | Functional checks of the field renderer against the legacy renderer (parity, picking, fallback) |

Set `EDGE_PATH` if Edge is not at `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`.
