// Headless-Edge (GPU on) benchmark of the barbending app against a synthetic project.
// usage: node scripts/perf/cdp_bench.mjs --url <app url> [--project <file>] [--label x] [--dpr 1]
//        [--expect <physical bars>] [--budget <key in budgets.json>] [--enforce] [--detail auto|lines|tubes]
// Loads the project through the real "⤒ Project" file input, then measures load, memory, DOM size,
// draw calls, fps idle / orbit / zoom / close-up, and select / edit / undo latency.
// PROFILE=1 adds a CPU profile of the idle phase (use against the dev server for readable names).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, sleep } from './lib/cdp.mjs';
import { INSTR } from './lib/instrument.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });
const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
};
const url = arg('url');
if (!url) {
  console.error('usage: node scripts/perf/cdp_bench.mjs --url <app url> [--project file.json] [--label x] [--dpr 1] [--expect <bars>] [--budget p1m] [--enforce]');
  process.exit(2);
}
const projPath = arg('project', '-');
const label = arg('label', 'run');
const dpr = Number(arg('dpr', '1'));
const expected = Number(arg('expect', '0'));
const budgetKey = arg('budget', '');
const detail = arg('detail', ''); // bar detail preference to run with (field renderer)
const enforce = process.argv.includes('--enforce');

const R = { label, url, dpr, detail: detail || 'default' };
const tBench = Date.now();
// Progress goes to stderr so a stalled run is visible; the RESULT line on stdout is unchanged.
const phase = (name) => console.error(`[bench +${((Date.now() - tBench) / 1000).toFixed(1)}s] ${name}`);
const timeout = setTimeout(() => { R.status = 'GLOBAL-TIMEOUT'; finish(1); }, 12 * 60 * 1000);
let b = null;
let finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  if (b) { R.consoleErrors = b.consoleErrors.slice(0, 10); b.close(); }
  console.log('RESULT ' + JSON.stringify(R));
  fs.appendFileSync(path.join(outDir, 'results.jsonl'), JSON.stringify(R) + '\n');
  setTimeout(() => process.exit(code), 1500);
}

function checkBudget() {
  const all = JSON.parse(fs.readFileSync(path.join(here, 'budgets.json'), 'utf8'));
  const bud = all[budgetKey];
  if (!bud) { console.error(`no budget "${budgetKey}" in budgets.json`); return false; }
  const rows = [
    ['idle fps', R.idle && R.idle.fps, bud.minIdleFps, (v, lim) => v >= lim],
    ['orbit fps', R.orbit && R.orbit.fps, bud.minOrbitFps, (v, lim) => v >= lim],
    ['close-up fps', R.closeup && R.closeup.fps, bud.minCloseupFps, (v, lim) => v >= lim],
    ['viewport ready ms', R.viewportMs, bud.maxViewportMs, (v, lim) => v != null && v <= lim],
    ['heap MB after edit', R.afterEdit && R.afterEdit.jsHeapMB, bud.maxHeapMB, (v, lim) => v <= lim],
    ['longest field block ms', R.field && R.field.maxBlockMs, bud.maxFieldBlockMs, (v, lim) => v != null && v <= lim],
  ];
  let ok = true;
  for (const [name, value, limit, pass] of rows) {
    if (limit === undefined) continue;
    const good = value !== undefined && value !== null && pass(value, limit);
    if (!good) ok = false;
    console.log(`${good ? 'PASS' : 'FAIL'}  ${name}: ${value} (budget ${limit})`);
  }
  return ok;
}

try {
  b = await launchBrowser({ dpr, instrument: INSTR });
  const { send, ev } = b;
  const waitReady = async () => {
    for (let i = 0; i < 100; i++) {
      await sleep(300);
      try { if (await ev('!window.__old && !!document.querySelector("canvas") && !!window.__status', 5000)) return true; } catch { /* retry */ }
    }
    return false;
  };
  await send('Page.navigate', { url });
  let ready = await waitReady();
  if (ready && detail) {
    // Bar detail is a persisted preference: store it, then load the app again so the store reads it.
    await ev(`window.__old = true; localStorage.setItem('barbending.barDetail', ${JSON.stringify(detail)})`);
    await send('Page.navigate', { url });
    ready = await waitReady();
  }
  if (!ready) { R.status = 'APP-NOT-READY'; finish(1); }
  R.gpu = await ev('window.__gpuInfo()');
  phase('app ready');
  await sleep(1500);
  const metric = async () => {
    const o = {};
    for (const x of (await send('Performance.getMetrics')).metrics) o[x.name] = x.value;
    return { jsHeapMB: Math.round(o.JSHeapUsedSize / 1048576), domNodes: o.Nodes, layoutCount: o.LayoutCount, scriptSec: +o.ScriptDuration.toFixed(2) };
  };
  R.baseline = { ...(await metric()) };
  phase('measuring baseline');
  await ev('window.__startRec()'); await sleep(2000); R.baseline.idle = await ev('window.__stopRec()');

  if (projPath !== '-') {
    const root = await send('DOM.getDocument', { depth: 0 });
    const q = await send('DOM.querySelectorAll', { nodeId: root.root.nodeId, selector: 'input[type=file]' });
    const lt0 = await ev('window.__lt.length');
    const v0 = await ev('(window.__barfield && window.__barfield.version) || 0');
    const bars0 = (await ev('window.__status()')).bars; // read before the import starts
    phase('importing project');
    const tStart = Date.now();
    await send('DOM.setFileInputFiles', { files: [path.resolve(projPath)], nodeId: q.nodeIds[0] });
    // Poll; each evaluate only answers once the main thread is free again.
    const fieldReadyExpr = '!!(window.__barfield && window.__barfield.ready && window.__barfield.version > ' + v0 + ')';
    // The default project already has bars, so "the project is in" means the expected count, or any
    // count different from what the page showed before the import.
    const projectIn = (s) => s.bars > 0 && (expected ? s.bars === expected : s.bars !== bars0);
    let quick = 0, last = null, loaded = false, tFree = null, readyAt = null;
    while (Date.now() - tStart < 10 * 60 * 1000 && !b.isCrashed()) {
      const p0 = Date.now();
      try { last = await ev('window.__status()', 90000); } catch (e) { R.loadError = e.message; break; }
      const rt = Date.now() - p0;
      // First answer with the project's bars in the store: the BBS table's synchronous render (spec
      // section 2: not part of the viewport budget) has finished by then, so the page is free again.
      if (tFree === null && projectIn(last)) tFree = Date.now();
      if (readyAt === null && await ev(fieldReadyExpr, 90000).catch(() => false)) readyAt = Date.now();
      if (projectIn(last)) {
        quick = rt < 200 ? quick + 1 : 0;
        if (quick >= 3) { loaded = true; break; }
      }
      await sleep(80);
    }
    R.load = { ms: Date.now() - tStart, loaded, barsShown: last && last.bars };
    phase(`page responsive again after ${R.load.ms} ms (loaded=${loaded})`);
    if (!loaded) { R.status = b.isCrashed() ? 'CRASHED' : (R.loadError ? 'HUNG' : 'LOAD-INCOMPLETE'); finish(1); }
    // The field is drawn a little after the page is responsive again (build + install): keep waiting.
    if (readyAt === null && await ev('!!window.__barfield').catch(() => false)) {
      for (let i = 0; i < 600 && readyAt === null; i++) {
        if (await ev(fieldReadyExpr, 90000).catch(() => false)) readyAt = Date.now();
        else await sleep(100);
      }
    }
    // viewportMs: from the page being responsive until the bars are drawn (budgeted).
    // viewportWallMs: from the import until the bars are drawn, BBS table included (reported only).
    R.viewportMs = readyAt !== null && tFree !== null ? Math.max(0, readyAt - tFree) : null;
    R.viewportWallMs = readyAt !== null ? readyAt - tStart : null;
    phase(`bars drawn: viewportMs=${R.viewportMs} wall=${R.viewportWallMs}`);
    const lts = await ev(`window.__lt.slice(${lt0}).map(x => x[1])`);
    R.load.longTasks = lts.length;
    R.load.blockedMs = Math.round(lts.reduce((s, v) => s + v, 0));
    R.load.worstTaskMs = Math.round(Math.max(0, ...lts));
    R.afterLoad = await metric();
  }

  // Frame the whole model (worst case: everything in the frustum).
  await ev('(document.querySelector(\'button[title="Fit entire model in view"]\') || { click() {} }).click()');
  await sleep(2500);
  const prof = !!process.env.PROFILE;
  if (prof) { await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 500 }); await send('Profiler.start'); }
  phase('idle (whole model framed)');
  await ev('window.__startRec()'); await sleep(prof ? 6000 : 3000); R.idle = await ev('window.__stopRec()');
  phase(`idle ${R.idle.fps} fps`);
  if (prof) {
    const { profile } = await send('Profiler.stop', {}, 120000);
    const self = new Map();
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    let total = 0;
    profile.samples.forEach((id, i) => { const dt = (profile.timeDeltas[i] || 0) / 1000; total += dt; self.set(id, (self.get(id) || 0) + dt); });
    const bucket = (n) => {
      const u = n.callFrame.url || '', f = n.callFrame.functionName || '';
      if (f === '(idle)') return 'idle'; if (f === '(garbage collector)') return 'GC'; if (f === '(program)') return 'native/driver';
      if (/three/.test(u) && !/fiber|drei|stdlib|web-ifc/.test(u)) return 'three.js';
      if (/react-dom|scheduler/.test(u)) return 'react-dom'; if (/fiber/.test(u)) return 'r3f'; if (/drei/.test(u)) return 'drei';
      if (/\/src\//.test(u)) return 'app (/src)'; if (!u) return 'native/other';
      return 'other:' + u.split('/').slice(-1)[0].slice(0, 24);
    };
    const buckets = {};
    const fns = new Map();
    for (const [id, ms] of self) {
      const n = byId.get(id);
      const bk = bucket(n);
      buckets[bk] = (buckets[bk] || 0) + ms;
      const key = (n.callFrame.functionName || '(anon)') + ' @' + (n.callFrame.url || '').split('/').slice(-1)[0].slice(0, 28);
      fns.set(key, (fns.get(key) || 0) + ms);
    }
    R.profile = {
      totalMs: Math.round(total),
      buckets: Object.fromEntries(Object.entries(buckets).sort((x, y) => y[1] - x[1]).map(([k, v]) => [k, Math.round(v)])),
      top: [...fns].sort((x, y) => y[1] - x[1]).slice(0, 14).map(([k, v]) => [k, Math.round(v)]),
    };
  }

  const [cx, cy] = await ev('(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()');
  // Orbit: a real trusted middle-button drag in a circle.
  phase('orbit');
  await ev('window.__startRec()');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'middle', buttons: 4, clickCount: 1 });
  const tO = Date.now();
  let th = 0;
  while (Date.now() - tO < 4000) {
    th += 0.12;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + 140 * Math.cos(th), y: cy + 70 * Math.sin(th), button: 'middle', buttons: 4 });
    await sleep(8);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'middle', buttons: 0, clickCount: 1 });
  R.orbit = await ev('window.__stopRec()');
  phase(`orbit ${R.orbit.fps} fps`);
  await sleep(600);
  // Zoom: wheel in then out.
  phase('zoom');
  await ev('window.__startRec()');
  for (let i = 0; i < 25; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -100 }); await sleep(30); }
  for (let i = 0; i < 25; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: 100 }); await sleep(30); }
  R.zoom = await ev('window.__stopRec()');
  phase(`zoom ${R.zoom.fps} fps`);
  await sleep(500);
  // Close-up: dive into the model along the cursor ray, then measure the steady state there.
  phase('close-up');
  for (let i = 0; i < 60; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -100 }); await sleep(30); }
  await sleep(1500);
  await ev('window.__startRec()'); await sleep(3000); R.closeup = await ev('window.__stopRec()');
  phase(`close-up ${R.closeup.fps} fps`);

  // Interaction latencies (click -> two frames later).
  phase('latencies');
  R.latency = {};
  const lat = async (key, expr) => { try { R.latency[key] = await ev(expr, 90000); } catch (e) { R.latency[key] = 'ERR ' + e.message.slice(0, 40); } };
  await lat('selectRow_ms', 'window.__lat(() => { const tr = document.querySelectorAll("table tbody tr")[1]; if (tr) tr.click(); })');
  await lat('editDuplicate_ms', 'window.__lat(() => { const x = document.querySelector(\'button[title^="Copy"]\'); if (x) x.click(); })');
  await lat('undo_ms', 'window.__lat(() => { const x = document.querySelector(\'button[title^="Undo"]\'); if (x && !x.disabled) x.click(); })');
  R.afterEdit = await metric();
  phase('done');
  R.field = await ev('window.__barfield ? JSON.parse(JSON.stringify(window.__barfield)) : null');
  R.status = 'OK';
} catch (e) {
  R.status = b && b.isCrashed() ? 'CRASHED' : 'ERROR ' + String(e.message).slice(0, 160);
}
let code = R.status === 'OK' ? 0 : 1;
if (enforce && R.status === 'OK') code = checkBudget() ? 0 : 1;
finish(code);
