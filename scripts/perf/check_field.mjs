// Functional checks of the field renderer against the legacy renderer, in headless Edge.
// usage: node scripts/perf/check_field.mjs --url <app base url> [--only parity]
// parity : the same small project drawn by ?renderer=legacy and ?renderer=field, with and without
//          the section box (?autotest=section cuts it to the central third). The amber pixels must
//          occupy the same screen box (placement + clipping), and the field must draw something.
// tubes  : Detail = Tubes draws instanced tubes with the same extent as the legacy renderer.
// pick   : real clicks on the field renderer select / toggle / clear bars.
// edit   : edits and hiding go through the delta path and match the legacy renderer.
// bulk   : importing thousands of rows / bulk-editing hundreds creates no overlay-mesh flood.
// fallback: ?fieldfail=1 -> the classic renderer takes over with a badge.
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
const base = (arg('url') || '').replace(/\/$/, '');
const only = arg('only', '');
if (!base) { console.error('usage: node scripts/perf/check_field.mjs --url <app base url> [--only parity]'); process.exit(2); }

let failures = 0;
const report = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures += 1; };

// Bars that straddle the section box ?autotest=section creates (scene metres: x -1.33..1.33,
// y 1.33..2.67, z -1.33..1.33; app mm: x, y = -z, z = up). All Dia 16 so every bar is amber.
function makeCheckProject() {
  const bars = [];
  let tag = 1;
  const add = (row) => bars.push({
    Rebar_tag: tag, Bar_mark: `B${tag++}`, Dia: 16, Group: 'check', bond_condition: 'poor', Pos_Rotation: 0,
    qty: 1, Visible: 1, qty_x: 1, spacing_x: 150, qty_y: 1, spacing_y: 150, ...row,
  });
  for (let k = 0; k < 24; k++) add({ Rebar_Type: 'straight', Plane: 'XY', 'Length of Bar': 6000, Pos_x: -3000, Pos_y: -1100 + k * 100, Pos_z: 1500 + (k % 4) * 300 });
  for (let k = 0; k < 8; k++) add({ Rebar_Type: 'straight', Plane: 'XZ', Pos_Rotation: 90, 'Length of Bar': 4000, Pos_x: -1000 + k * 300, Pos_y: 0, Pos_z: 0 });
  add({ Rebar_Type: 'straight', Plane: 'XY', 'Length of Bar': 5000, Pos_x: -2500, Pos_y: -1000, Pos_z: 2000, qty_y: 20, spacing_y: 100 });
  add({ Rebar_Type: 'bent', Plane: 'XZ', 'Length of Bar': 3000, H: 800, bent_up_down: 'up', hook_start: 'no', Pos_x: -1500, Pos_y: 500, Pos_z: 1600 });
  return { v: 1, app: 'barbending', savedAt: Date.now(), bars, concretes: [], refLines: [], cover: 40, bond: 'poor', selectedBar: 0, selectedBars: [0] };
}

// Amber pixels (#f59e0b and its shaded variants) outside the orientation gizmo corner.
const PIXEL_STATS = `(() => {
  const c = document.querySelector('canvas'); const t = document.createElement('canvas');
  t.width = c.width; t.height = c.height;
  const x = t.getContext('2d', { willReadFrequently: true }); x.drawImage(c, 0, 0);
  const d = x.getImageData(0, 0, t.width, t.height).data;
  let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, sx = 0, sy = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const px = p % t.width, py = (p / t.width) | 0;
    if (px > t.width - 220 && py < 220) continue;
    if (r > 140 && g > 70 && g < 210 && b < 100 && r > g * 1.1) {
      n++; sx += px; sy += py;
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
  }
  return { n, x0, y0, x1, y1, cx: n ? sx / n : 0, cy: n ? sy / n : 0, w: t.width, h: t.height };
})()`;

async function openProject(b, query, projectFile) {
  await b.send('Page.navigate', { url: `${base}/?${query}` });
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    await sleep(300);
    try { ready = await b.ev('!!document.querySelector("canvas") && !!window.__status', 5000); } catch { /* retry */ }
  }
  if (!ready) throw new Error('app did not start: ' + query);
  const root = await b.send('DOM.getDocument', { depth: 0 });
  const q = await b.send('DOM.querySelectorAll', { nodeId: root.root.nodeId, selector: 'input[type=file]' });
  await b.send('DOM.setFileInputFiles', { files: [projectFile], nodeId: q.nodeIds[0] });
  if (query.includes('renderer=field') && !query.includes('fieldfail')) {
    for (let i = 0; i < 200; i++) {
      await sleep(250);
      if (await b.ev('!!(window.__barfield && window.__barfield.ready)', 5000).catch(() => false)) break;
    }
  }
  await sleep(1500);
  await b.ev('(document.querySelector(\'button[title="Fit entire model in view"]\') || { click() {} }).click()');
  await sleep(3000);
}

async function parity() {
  const projectFile = path.join(outDir, 'check_clip.json');
  fs.writeFileSync(projectFile, JSON.stringify(makeCheckProject()));
  const b = await launchBrowser({ instrument: INSTR });
  try {
    for (const section of [false, true]) {
      const stats = {};
      for (const mode of ['legacy', 'field']) {
        const query = `renderer=${mode}&autotest=${section ? 'section' : 'parity'}`;
        b.consoleErrors.length = 0;
        await openProject(b, query, projectFile);
        stats[mode] = await b.ev(PIXEL_STATS);
        const shot = await b.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(outDir, `check-${mode}${section ? '-section' : ''}.png`), Buffer.from(shot.data, 'base64'));
        if (mode === 'field') {
          report(b.consoleErrors.length === 0, `field renderer logged no errors (${section ? 'section' : 'plain'})${b.consoleErrors.length ? ': ' + b.consoleErrors[0] : ''}`);
          // The scene census (AutotestDump) must show chunk line objects, and the one selected row
          // (the project file selects bar 0) must be drawn by the overlay RebarMesh, not the field.
          const dump = JSON.parse(await b.ev("document.getElementById('autotest-dump') ? document.getElementById('autotest-dump').textContent : '{}'"));
          report(!!dump.field && dump.field.lines > 0, `${section ? 'section' : 'plain'}: field chunk line objects exist (${dump.field ? dump.field.lines : 'no census'})`);
          report(dump.tube !== undefined && dump.tube !== 'none' && (dump.selectedBars || []).length === 1, `${section ? 'section' : 'plain'}: the selected row is drawn by the overlay mesh (selected=${(dump.selectedBars || []).length}, tube=${String(dump.tube).slice(0, 20)})`);
        }
      }
      const L = stats.legacy, F = stats.field, tol = 14;
      const label = section ? 'section box on' : 'no section box';
      console.log(`      ${label}: legacy n=${L.n} bbox=[${L.x0},${L.y0},${L.x1},${L.y1}]  field n=${F.n} bbox=[${F.x0},${F.y0},${F.x1},${F.y1}]`);
      report(L.n > 200, `${label}: legacy renderer drew the bars (${L.n} amber px)`);
      report(F.n > 0.03 * L.n, `${label}: field renderer drew the bars (${F.n} vs ${L.n} amber px)`);
      const same = Math.abs(L.x0 - F.x0) <= tol && Math.abs(L.x1 - F.x1) <= tol && Math.abs(L.y0 - F.y0) <= tol && Math.abs(L.y1 - F.y1) <= tol;
      report(same, `${label}: same screen extent within ${tol}px`);
      report(Math.hypot(L.cx - F.cx, L.cy - F.cy) <= 12, `${label}: same centre of mass within 12px (legacy ${L.cx.toFixed(0)},${L.cy.toFixed(0)} field ${F.cx.toFixed(0)},${F.cy.toFixed(0)})`);
    }
  } finally {
    b.close();
  }
}

// tubes : with Detail = Tubes every chunk draws as instanced tubes: the extent still matches the
//         legacy renderer (tubes have the same 8 mm minimum radius) and the census shows tube objects.
async function tubes() {
  const projectFile = path.join(outDir, 'check_clip.json');
  fs.writeFileSync(projectFile, JSON.stringify(makeCheckProject()));
  const b = await launchBrowser({ instrument: INSTR });
  try {
    await b.send('Page.navigate', { url: `${base}/?renderer=legacy&autotest=parity` });
    await sleep(1500);
    await openProject(b, 'renderer=legacy&autotest=parity', projectFile);
    const L = await b.ev(PIXEL_STATS);
    await b.ev("localStorage.setItem('barbending.barDetail', 'tubes')");
    b.consoleErrors.length = 0;
    await openProject(b, 'renderer=field&autotest=parity', projectFile);
    await sleep(1500);
    const F = await b.ev(PIXEL_STATS);
    const census = await b.ev("(() => { const el = document.getElementById('autotest-dump'); return el ? JSON.parse(el.textContent).field : null; })()");
    const shot = await b.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, 'check-field-tubes.png'), Buffer.from(shot.data, 'base64'));
    console.log(`      tubes: legacy n=${L.n} bbox=[${L.x0},${L.y0},${L.x1},${L.y1}]  field n=${F.n} bbox=[${F.x0},${F.y0},${F.x1},${F.y1}]  census=${JSON.stringify(census)}`);
    report(b.consoleErrors.length === 0, `tubes: no errors logged${b.consoleErrors.length ? ': ' + b.consoleErrors[0] : ''}`);
    report(!!census && census.tubes > 0 && census.visible > 0, 'tubes: tube objects were created and are drawn');
    report(F.n > 0.3 * L.n, `tubes: field drew comparable amber area (${F.n} vs ${L.n} px)`);
    const tol = 14;
    report(Math.abs(L.x0 - F.x0) <= tol && Math.abs(L.x1 - F.x1) <= tol && Math.abs(L.y0 - F.y0) <= tol && Math.abs(L.y1 - F.y1) <= tol, `tubes: same screen extent within ${tol}px`);
    await b.ev("localStorage.removeItem('barbending.barDetail')");
  } finally {
    b.close();
  }
}

// pick : real trusted clicks on the field renderer. Click one bar -> that bar is selected; Ctrl-click
//        another -> both; click empty space -> the selection clears; a double-click zooms to the bar;
//        with the Query tool on, a click fills the panel. Reads the selection from the ?autotest dump
//        (selectedBars), so it needs no store access.
const mulVec4 = (m, v) => [0, 1, 2, 3].map((row) => m[row] * v[0] + m[4 + row] * v[1] + m[8 + row] * v[2] + m[12 + row] * v[3]);
async function pick() {
  const bars = [0, 1, 2].map((k) => ({
    Rebar_tag: k + 1, Bar_mark: `B${k + 1}`, Rebar_Type: 'straight', Plane: 'XY', Dia: 16, 'Length of Bar': 3000,
    Pos_x: 0, Pos_y: k * 800, Pos_z: 1000 + k * 200, Pos_Rotation: 0, qty: 1, qty_x: 1, spacing_x: 150, qty_y: 1, spacing_y: 150,
    Group: 'pick', bond_condition: 'poor', Visible: 1,
  }));
  const projectFile = path.join(outDir, 'check_pick.json');
  fs.writeFileSync(projectFile, JSON.stringify({ v: 1, app: 'barbending', savedAt: Date.now(), bars, concretes: [], refLines: [], cover: 40, bond: 'poor', selectedBar: 0, selectedBars: [] }));
  const b = await launchBrowser({ instrument: INSTR });
  try {
    await openProject(b, 'renderer=field&autotest=pick', projectFile);
    const rect = await b.ev('(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()');
    // Mid-point of bar k on screen. Scene metres: x 1.5, y = height, z = -(app y). The camera is read
    // fresh every time because zoom-to-bar and Fit move it.
    const screen = async (k) => {
      const cam = await b.ev('({ view: Array.from(window.__camera.matrixWorldInverse.elements), proj: Array.from(window.__camera.projectionMatrix.elements) })');
      const p = [1.5, (1000 + k * 200) / 1000, -(k * 800) / 1000, 1];
      const c = mulVec4(cam.proj, mulVec4(cam.view, p));
      return { x: rect.x + (c[0] / c[3] * 0.5 + 0.5) * rect.w, y: rect.y + (-c[1] / c[3] * 0.5 + 0.5) * rect.h };
    };
    const press = async (pt, modifiers = 0, clickCount = 1) => {
      await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y });
      await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount, modifiers });
      await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount, modifiers });
    };
    const click = async (pt, modifiers = 0) => {
      await press(pt, modifiers);
      await sleep(1400); // the autotest dump refreshes once per second
    };
    const clickButton = (test) => b.ev(`(() => { const x = Array.from(document.querySelectorAll('button')).find((e) => ${test}); if (x) x.click(); return !!x; })()`);
    const selected = async () => (await b.ev("JSON.parse(document.getElementById('autotest-dump').textContent).selectedBars")) || [];
    const same = (a, c) => a.length === c.length && [...a].sort().join() === [...c].sort().join();
    await click(await screen(2));
    let s = await selected();
    report(same(s, [2]), `click on bar 3 selects it (selectedBars=${JSON.stringify(s)})`);
    await click(await screen(1));
    s = await selected();
    report(same(s, [1]), `click on bar 2 replaces the selection (selectedBars=${JSON.stringify(s)})`);
    await click(await screen(0), 2);
    s = await selected();
    report(same(s, [0, 1]), `Ctrl-click on bar 1 adds it (selectedBars=${JSON.stringify(s)})`);
    await click({ x: rect.x + rect.w * 0.08, y: rect.y + rect.h * 0.92 });
    s = await selected();
    report(s.length === 0, `click on empty space clears the selection (selectedBars=${JSON.stringify(s)})`);
    // Double-click: two quick clicks on bar 2 select it and zoom the camera to it.
    const camBefore = await b.ev('window.__camera.position.toArray()');
    const at2 = await screen(1);
    await press(at2); await sleep(120); await press(at2, 0, 2);
    await sleep(2500);
    const camAfter = await b.ev('window.__camera.position.toArray()');
    s = await selected();
    report(same(s, [1]), `double-click on bar 2 selects it (selectedBars=${JSON.stringify(s)})`);
    const moved = Math.hypot(...camAfter.map((v, i) => v - camBefore[i]));
    report(moved > 0.3, `double-click zooms the camera to the bar (moved ${moved.toFixed(2)} m)`);
    // Query tool: with it active, a click on a field bar must fill the panel with that bar.
    await clickButton("e.title.startsWith('Query')");
    await clickButton("e.title === 'Fit entire model in view'");
    await sleep(3000);
    await click(await screen(2));
    const bodyText = await b.ev('document.body.innerText');
    report(/Rebar B3/.test(bodyText) && /Bar index/.test(bodyText), 'Query tool names the clicked field bar (Rebar B3, with its rows)');
    report(b.consoleErrors.length === 0, `no errors logged${b.consoleErrors.length ? ': ' + b.consoleErrors[0] : ''}`);
  } finally {
    b.close();
  }
}

// edit : edit and hide bars through the real store and compare with the legacy renderer.
//        The edited bar must move (centre of mass shifts), both renderers must agree afterwards, hiding a
//        bar must remove its pixels, and a single edit must not trigger a full rebuild (delta path).
async function edit() {
  const mk = (k) => ({
    Rebar_tag: k + 1, Bar_mark: `B${k + 1}`, Rebar_Type: 'straight', Plane: 'XY', Dia: 16, 'Length of Bar': 3000,
    Pos_x: 0, Pos_y: k * 1200, Pos_z: 1500, Pos_Rotation: 0, qty: 1, qty_x: 1, spacing_x: 150, qty_y: 1, spacing_y: 150,
    Group: 'edit', bond_condition: 'poor', Visible: 1,
  });
  const projectFile = path.join(outDir, 'check_edit.json');
  fs.writeFileSync(projectFile, JSON.stringify({ v: 1, app: 'barbending', savedAt: Date.now(), bars: [0, 1, 2].map(mk), concretes: [], refLines: [], cover: 40, bond: 'poor', selectedBar: 0, selectedBars: [] }));
  const b = await launchBrowser({ instrument: INSTR });
  const res = {};
  try {
    for (const mode of ['legacy', 'field']) {
      b.consoleErrors.length = 0;
      await openProject(b, `renderer=${mode}&autotest=edit`, projectFile);
      await b.ev('window.__store.getState().clearBarSelection()');
      await sleep(800);
      const v0 = mode === 'field' ? await b.ev('window.__barfield.version') : 0;
      const before = await b.ev(PIXEL_STATS);
      await b.ev('window.__store.getState().updateBar(2, { Pos_y: 3200, Pos_x: 400 })');
      await sleep(1800); // 400 ms quiet period + delta flush + a few frames
      const moved = await b.ev(PIXEL_STATS);
      await b.ev('window.__store.getState().hideBars([0], true)');
      await sleep(1200);
      const hiddenStats = await b.ev(PIXEL_STATS);
      const v1 = mode === 'field' ? await b.ev('window.__barfield.version') : 0;
      res[mode] = { before, moved, hiddenStats, v0, v1, errors: b.consoleErrors.slice() };
      const shot = await b.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(outDir, `check-edit-${mode}.png`), Buffer.from(shot.data, 'base64'));
    }
  } finally {
    b.close();
  }
  const L = res.legacy, F = res.field;
  // Compare the extents only: they are set by the bars this check edits and hides (the moved bar sets the
  // right and bottom edges, the hidden bar the left and top ones) and move by 70-100 px between the steps.
  // The centre of mass is not compared: with three bars it depends on how many amber pixels each bar
  // contributes, and tubes shade while lines do not.
  const close = (a, c, tol = 14) => Math.abs(a.x0 - c.x0) <= tol && Math.abs(a.x1 - c.x1) <= tol && Math.abs(a.y0 - c.y0) <= tol && Math.abs(a.y1 - c.y1) <= tol;
  for (const k of ['before', 'moved', 'hiddenStats']) {
    const a = L[k], c = F[k];
    console.log(`      ${k}: legacy n=${a.n} bbox=[${a.x0},${a.y0},${a.x1},${a.y1}] c=(${a.cx.toFixed(0)},${a.cy.toFixed(0)})  field n=${c.n} bbox=[${c.x0},${c.y0},${c.x1},${c.y1}] c=(${c.cx.toFixed(0)},${c.cy.toFixed(0)})`);
  }
  report(F.errors.length === 0, `edit: no errors logged${F.errors.length ? ': ' + F.errors[0] : ''}`);
  report(Math.hypot(F.before.cx - F.moved.cx, F.before.cy - F.moved.cy) >= 5, 'edit: the edited bar moved on screen');
  report(close(L.before, F.before), 'edit: before the edit both renderers agree');
  report(close(L.moved, F.moved), 'edit: after moving a bar both renderers agree');
  report(F.hiddenStats.n < 0.9 * F.moved.n, `edit: hiding a bar removes its pixels (${F.moved.n} -> ${F.hiddenStats.n})`);
  report(close(L.hiddenStats, F.hiddenStats), 'edit: after hiding a bar both renderers agree');
  report(F.v1 === F.v0, `edit: a single edit used the delta chunk, not a full rebuild (field version ${F.v0} -> ${F.v1})`);
}

// bulk : a bulk edit of hundreds of rows goes through the delta chunk (no rebuild) and shows on screen, and
//        adding thousands of rows creates no overlay flood (the classic renderer draws one mesh per bar copy).
//        The mesh count is read from the live scene ~150 ms after the store update, while the field is still
//        stale: that is the window where a flood would exist. (The edited-rows overlay limit is unit-tested
//        in overlayRows.test.mjs: that overlay only lives for 400 ms, too short to sample reliably here.)
async function bulk() {
  const N = 8000;
  const row = (k) => ({
    Rebar_tag: k + 1, Bar_mark: `B${k + 1}`, Rebar_Type: 'straight', Plane: 'XY', Dia: 16, 'Length of Bar': 2000,
    Pos_x: (k % 100) * 120, Pos_y: Math.floor(k / 100) * 120, Pos_z: 1000, Pos_Rotation: 0, qty: 1, qty_x: 1, spacing_x: 150, qty_y: 1, spacing_y: 150,
    Group: 'bulk', bond_condition: 'poor', Visible: 1,
  });
  const projectFile = path.join(outDir, 'check_bulk.json');
  fs.writeFileSync(projectFile, JSON.stringify({ v: 1, app: 'barbending', savedAt: Date.now(), bars: Array.from({ length: N }, (_, k) => row(k)), concretes: [], refLines: [], cover: 40, bond: 'poor', selectedBar: 0, selectedBars: [] }));
  const b = await launchBrowser({ instrument: INSTR });
  const meshes = () => b.ev("(() => { let n = 0; window.__scene.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.type === 'TubeGeometry') n += 1; }); return n; })()");
  try {
    await openProject(b, 'renderer=field&autotest=bulk', projectFile);
    await sleep(1500);
    const rows = await b.ev('window.__barfield.rows');
    report(rows === N, `bulk: the field holds all ${N} rows after the import (rows=${rows})`);
    // 400 rows moved in one store update: more than the overlay limit, within the delta capacity.
    const v0 = await b.ev('window.__barfield.version');
    const before = await b.ev(PIXEL_STATS);
    await b.ev("(() => { const s = window.__store; const bars = s.getState().bars.map((r, i) => (i < 400 ? { ...r, Pos_x: r.Pos_x + 3000 } : r)); s.setState({ bars }); })()");
    await sleep(1550);
    const after = await b.ev(PIXEL_STATS);
    const v1 = await b.ev('window.__barfield.version');
    report(v1 === v0, `bulk: the bulk edit used the delta chunk, not a rebuild (field version ${v0} -> ${v1})`);
    report(Math.abs(after.x0 - before.x0) + Math.abs(after.x1 - before.x1) > 20, `bulk: the edited rows moved on screen (left/right edge ${before.x0}/${before.x1} -> ${after.x0}/${after.x1})`);
    // 1,000 rows added in one store update: the field is stale until the rebuild lands, with no overlay flood.
    await b.ev("(() => { const s = window.__store; const extra = Array.from({ length: 1000 }, (_, k) => ({ ...s.getState().bars[k], Pos_z: 1600, Rebar_tag: 90000 + k, Bar_mark: 'X' + k })); s.setState({ bars: [...s.getState().bars, ...extra] }); })()");
    await sleep(150);
    const addMeshes = await meshes();
    report(addMeshes <= 300, `bulk: adding 1000 rows created no overlay flood (${addMeshes} classic bar meshes after 150 ms)`);
    let rebuilt = false;
    for (let i = 0; i < 80 && !rebuilt; i++) { await sleep(250); rebuilt = (await b.ev('window.__barfield.rows')) === N + 1000; }
    report(rebuilt, `bulk: the rebuild picked up the ${N + 1000} rows`);
    report(b.consoleErrors.length === 0, `bulk: no errors logged${b.consoleErrors.length ? ': ' + b.consoleErrors[0] : ''}`);
  } finally {
    b.close();
  }
}

// fallback : ?fieldfail=1 makes the field build fail on purpose: the classic renderer must take over
//            (same picture as the legacy renderer) and the badge must say so.
async function fallback() {
  const projectFile = path.join(outDir, 'check_clip.json');
  fs.writeFileSync(projectFile, JSON.stringify(makeCheckProject()));
  const b = await launchBrowser({ instrument: INSTR });
  try {
    await openProject(b, 'renderer=legacy&autotest=parity', projectFile);
    const L = await b.ev(PIXEL_STATS);
    b.consoleErrors.length = 0;
    await openProject(b, 'renderer=field&fieldfail=1&autotest=parity', projectFile);
    await sleep(1500);
    const F = await b.ev(PIXEL_STATS);
    const badge = await b.ev("document.body.innerText.includes('Bar renderer unavailable')");
    console.log(`      fallback: legacy n=${L.n} c=(${L.cx.toFixed(0)},${L.cy.toFixed(0)})  fieldfail n=${F.n} c=(${F.cx.toFixed(0)},${F.cy.toFixed(0)})`);
    report(badge, 'fallback: the badge says the classic view is showing');
    report(b.consoleErrors.some((e) => e.includes('build failed')), 'fallback: the failure was logged');
    report(F.n > 0.7 * L.n && F.n < 1.4 * L.n, `fallback: the classic renderer drew the bars (${F.n} vs ${L.n} amber px)`);
    report(Math.hypot(L.cx - F.cx, L.cy - F.cy) <= 8, 'fallback: same picture as the legacy renderer');
  } finally {
    b.close();
  }
}

try {
  if (!only || only === 'parity') await parity();
  if (!only || only === 'tubes') await tubes();
  if (!only || only === 'pick') await pick();
  if (!only || only === 'edit') await edit();
  if (!only || only === 'bulk') await bulk();
  if (!only || only === 'fallback') await fallback();
} catch (e) {
  console.error('ERROR', e.message);
  failures += 1;
}
console.log(failures ? `RESULT: FAIL (${failures})` : 'RESULT: PASS');
process.exit(failures ? 1 : 0);
