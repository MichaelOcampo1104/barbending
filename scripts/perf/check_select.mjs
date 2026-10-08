// Browser checks for the Box and Lasso selection tools, in headless Edge (real GPU).
// usage: node scripts/perf/check_select.mjs --url <app base url> [--only toolbar|box|lasso|persp|perf] [--project file.json]
// toolbar: Box and Lasso buttons arm one tool at a time (highlight, hint bar), toggle off, Shift+B / Shift+L, Esc disarms
//          without touching the selection.
// box    : the exact rule (a box in the gap of a distribution set or in the empty corner of a diagonal bar selects
//          nothing, a box on a bar selects its row), one-shot, Ctrl adds, a click only disarms.
// lasso  : free-form loops follow their outline (a dot in the notch of a U is out), Ctrl adds, Esc mid-drag cancels,
//          a scribble only disarms, the outline is drawn while dragging.
// persp  : the same tools through the perspective camera.
// perf   : (needs --project, e.g. scripts/perf/out/p1m.json) selection time and responsiveness at a million bars.
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
const perfProject = arg('project', '');
if (!base) { console.error('usage: node scripts/perf/check_select.mjs --url <app base url> [--only toolbar|box|lasso|persp|perf] [--project file.json]'); process.exit(2); }

let failures = 0;
const report = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures += 1; };
const same = (a, c) => a.length === c.length && [...a].sort((x, y) => x - y).join() === [...c].sort((x, y) => x - y).join();

// The same scene as tests/select/regionSelect.test.mjs (app mm; the Front view shows x across and z up).
const ROWS = [
  { mark: 'H1', plane: 'XY', rot: 0, pos: [0, 0, 1000], len: 3000, dia: 16 }, // a line at 1.0 m
  { mark: 'H2', plane: 'XY', rot: 0, pos: [0, 0, 2000], len: 3000, dia: 16 }, // a line at 2.0 m
  { mark: 'SET', plane: 'XY', rot: 0, pos: [0, 0, 2400], len: 3000, dia: 16, qtyZ: 4, spacingZ: 250 }, // 2.4 / 2.65 / 2.9 / 3.15 m
  { mark: 'DIAG', plane: 'XZ', rot: 45, pos: [3500, 0, 0], len: 2000, dia: 16 }, // (3.5, 0) up to (4.91, 1.41)
  { mark: 'EA', plane: 'XY', rot: 90, pos: [6000, 0, 600], len: 3000, dia: 32 }, // along app Y: a dot in the Front view
  { mark: 'EB', plane: 'XY', rot: 90, pos: [6500, 0, 1500], len: 3000, dia: 32 },
  { mark: 'EC', plane: 'XY', rot: 90, pos: [7000, 0, 1500], len: 3000, dia: 32 },
];
const IDX = Object.fromEntries(ROWS.map((r, i) => [r.mark, i]));
function makeProject() {
  const bars = ROWS.map((d, k) => ({
    Rebar_tag: k + 1, Bar_mark: d.mark, Rebar_Type: 'straight', Plane: d.plane, Dia: d.dia, 'Length of Bar': d.len,
    Pos_x: d.pos[0], Pos_y: d.pos[1], Pos_z: d.pos[2], Pos_Rotation: d.rot, qty: 1, qty_x: 1, spacing_x: 150, qty_y: 1, spacing_y: 150,
    ...(d.qtyZ ? { qty_z: d.qtyZ, spacing_z: d.spacingZ } : {}),
    Group: 'select', bond_condition: 'poor', Visible: 1,
  }));
  return { v: 1, app: 'barbending', savedAt: Date.now(), bars, concretes: [], refLines: [], cover: 40, bond: 'poor', selectedBar: 0, selectedBars: [], };
}

const FIT = '(Array.from(document.querySelectorAll("button")).find((e) => e.title === "Fit entire model in view") || { click() {} }).click()';
const CAM = '(() => { const c = window.__camera; return { type: c.type, ortho: !!c.isOrthographicCamera, zoom: c.zoom }; })()';

// Waits until the camera has not moved for 0.8 s.
async function settle(b, maxMs = 20000) {
  const t0 = Date.now();
  let prev = null;
  let since = Date.now();
  while (Date.now() - t0 < maxMs) {
    const p = await b.ev('window.__camera ? window.__camera.position.toArray().concat(window.__camera.quaternion.toArray(), [window.__camera.zoom]).join(",") : "none"', 15000).catch(() => 'err');
    if (p === prev) { if (Date.now() - since >= 800) return; } else { prev = p; since = Date.now(); }
    await sleep(200);
  }
}

async function openProject(b, query, project, rows) {
  const file = path.join(outDir, 'check_select_project.json');
  if (typeof project === 'string') {
    // a project file on disk (the performance section)
  } else {
    fs.writeFileSync(file, JSON.stringify(project));
  }
  await b.send('Page.navigate', { url: `${base}/?${query}` });
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    await sleep(300);
    try { ready = await b.ev('!!document.querySelector("canvas") && !!window.__status && !!window.__store && !!window.__camera && !!window.__controls', 5000); } catch { /* retry */ }
  }
  if (!ready) throw new Error('app did not start: ' + query);
  const bars0 = await b.ev('window.__status().bars');
  const root = await b.send('DOM.getDocument', { depth: 0 });
  const q = await b.send('DOM.querySelectorAll', { nodeId: root.root.nodeId, selector: 'input[type=file]' });
  await b.send('DOM.setFileInputFiles', { files: [typeof project === 'string' ? project : file], nodeId: q.nodeIds[0] });
  for (let i = 0; i < 480; i++) {
    const n = await b.ev('window.__status().bars', 15000).catch(() => bars0);
    if (n !== bars0 && n > 0) break;
    await sleep(250);
  }
  for (let i = 0; i < 480; i++) {
    if (await b.ev(`!!(window.__barfield && window.__barfield.ready && window.__barfield.rows === ${rows})`, 5000).catch(() => false)) break;
    await sleep(250);
  }
  await sleep(800);
  await b.ev(FIT);
  await sleep(500);
  await settle(b);
}

const SELECT = "Array.from(document.querySelectorAll('select')).find((x) => Array.from(x.options).some((o) => o.value === 'front'))";
const chooseView = (b, value) => b.ev(`(() => { const s = ${SELECT}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
const rectOf = (b) => b.ev('(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()');
// A scene point (x across, up, z) -> page pixels, through the live camera.
async function page(b, x, up, z = 0) {
  const R = await rectOf(b);
  const s = await b.ev(`(() => { const c = window.__camera; const V = c.position.constructor; const cv = document.querySelector('canvas');
    const p = new V(${x}, ${up}, ${z}).project(c); return [(p.x * 0.5 + 0.5) * cv.clientWidth, (-p.y * 0.5 + 0.5) * cv.clientHeight]; })()`);
  return [R.x + s[0], R.y + s[1]];
}

// ---- state ----
const tool = (b) => b.ev('window.__store.getState().selectTool');
const selected = async (b) => JSON.parse(await b.ev('JSON.stringify(window.__store.getState().selectedBars)'));
const lastSelect = async (b) => JSON.parse(await b.ev('JSON.stringify(window.__lastSelect || null)'));
const hint = (b) => b.ev("(document.querySelector('.overlay') || { textContent: '' }).textContent");
const reset = (b, keep = []) => b.ev(`(() => { const s = window.__store.getState(); s.setSelectTool(null); if (${JSON.stringify(keep)}.length) s.setSelectedBars(${JSON.stringify(keep)}); else s.clearBarSelection(); window.__lastSelect = null; document.activeElement && document.activeElement.blur(); })()`);
const buttonClass = (b, startsWith) => b.ev(`(() => { const x = Array.from(document.querySelectorAll('button')).find((e) => e.textContent.trim().startsWith(${JSON.stringify(startsWith)})); return x ? x.className : null; })()`);
const clickButton = (b, startsWith) => b.ev(`(() => { const x = Array.from(document.querySelectorAll('button')).find((e) => e.textContent.trim().startsWith(${JSON.stringify(startsWith)})); if (x) x.click(); return !!x; })()`);
const BOX_BTN = '⊞ Box [';
const LASSO_BTN = '➰ Lasso [';

// ---- trusted input ----
const mouse = (b, type, x, y, extra = {}) => b.send('Input.dispatchMouseEvent', { type, x, y, ...extra });
const CTRL = 2;
const SHIFT = 8;
async function key(b, k, code, modifiers = 0) {
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, modifiers });
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers });
}
// Press at the first point, move through the others (in steps of at most 6 px), and release at the last unless told not to.
async function dragPath(b, pts, { ctrl = false, release = true, stopAt = null } = {}) {
  const mod = ctrl ? CTRL : 0;
  await mouse(b, 'mouseMoved', pts[0][0], pts[0][1], { modifiers: mod });
  await mouse(b, 'mousePressed', pts[0][0], pts[0][1], { button: 'left', buttons: 1, clickCount: 1, modifiers: mod });
  let n = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 6));
    for (let s = 1; s <= steps; s++) {
      await mouse(b, 'mouseMoved', x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps, { button: 'left', buttons: 1, modifiers: mod });
      n += 1;
      if (stopAt !== null && n >= stopAt) return;
    }
    await sleep(8);
  }
  if (release) {
    const [lx, ly] = pts[pts.length - 1];
    await mouse(b, 'mouseReleased', lx, ly, { button: 'left', buttons: 0, clickCount: 1, modifiers: mod });
  }
}
const release = (b, [x, y], ctrl = false) => mouse(b, 'mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: 1, modifiers: ctrl ? CTRL : 0 });

// A rectangle between two scene points of the Front view, as page pixels.
const frontBox = async (b, x0, up0, x1, up1) => [await page(b, x0, up0), await page(b, x1, up1)];

async function front(b, name) {
  await chooseView(b, 'front');
  await settle(b);
  await b.ev(FIT);
  await sleep(500);
  await settle(b);
  // Fit All leaves the top of the scene under the toolbar rows that overlay the canvas, and a drag that starts on a
  // toolbar button never reaches the canvas: zoom out a little so the whole scene is clear of them.
  const R = await rectOf(b);
  for (let i = 0; i < 3; i++) { await mouse(b, 'mouseWheel', R.x + R.w / 2, R.y + R.h / 2, { deltaX: 0, deltaY: 200 }); await sleep(60); }
  await settle(b);
  const cam = await b.ev(CAM);
  report(cam.ortho, `${name}: the Front view is orthographic (${cam.zoom.toFixed(0)} px/m)`);
}

async function toolbar() {
  const b = await launchBrowser({ instrument: INSTR });
  try {
    await openProject(b, 'autotest=select', makeProject(), ROWS.length);
    await reset(b);
    report((await buttonClass(b, BOX_BTN)) !== null && (await buttonClass(b, LASSO_BTN)) !== null, 'toolbar: the Box and Lasso buttons are there');
    report((await tool(b)) === null, 'toolbar: no tool is armed to begin with');

    await clickButton(b, BOX_BTN);
    await sleep(200);
    report((await tool(b)) === 'box' && /\bon\b/.test(await buttonClass(b, BOX_BTN)) && !/\bon\b/.test(await buttonClass(b, LASSO_BTN)),
      'toolbar: the Box button arms box select and is highlighted alone');
    report(/BOX SELECT armed/.test(await hint(b)), 'toolbar: the hint bar says the box is armed');
    await clickButton(b, LASSO_BTN);
    await sleep(200);
    report((await tool(b)) === 'lasso' && /\bon\b/.test(await buttonClass(b, LASSO_BTN)) && !/\bon\b/.test(await buttonClass(b, BOX_BTN)),
      'toolbar: the Lasso button switches to the lasso');
    report(/LASSO SELECT armed/.test(await hint(b)), 'toolbar: the hint bar says the lasso is armed');
    await clickButton(b, LASSO_BTN);
    await sleep(200);
    report((await tool(b)) === null && !/\bon\b/.test(await buttonClass(b, LASSO_BTN)), 'toolbar: the armed button again turns the tool off');

    // Hotkeys (the focus is on the page, not in a field).
    await reset(b);
    await key(b, 'B', 'KeyB', SHIFT);
    await sleep(150);
    report((await tool(b)) === 'box', 'toolbar: Shift+B arms the box');
    await key(b, 'L', 'KeyL', SHIFT);
    await sleep(150);
    report((await tool(b)) === 'lasso', 'toolbar: Shift+L switches to the lasso');
    await key(b, 'L', 'KeyL', SHIFT);
    await sleep(150);
    report((await tool(b)) === null, 'toolbar: Shift+L again turns it off');

    // Esc disarms and leaves the selection alone.
    await reset(b, [IDX.H1, IDX.H2]);
    await key(b, 'L', 'KeyL', SHIFT);
    await sleep(150);
    await key(b, 'Escape', 'Escape');
    await sleep(200);
    report((await tool(b)) === null && same(await selected(b), [IDX.H1, IDX.H2]), `toolbar: Esc disarms without clearing the selection (selected ${JSON.stringify(await selected(b))})`);
    report(b.consoleErrors.length === 0, `toolbar: no errors logged${b.consoleErrors.length ? ': ' + b.consoleErrors[0] : ''}`);
  } finally {
    b.close();
  }
}

async function box() {
  const b = await launchBrowser({ instrument: INSTR });
  try {
    await openProject(b, 'autotest=select', makeProject(), ROWS.length);
    await front(b, 'box');
    const run = async (label, corners, want, opts = {}) => {
      if (!opts.keep) await reset(b); else await reset(b, opts.keep);
      await clickButton(b, BOX_BTN);
      await sleep(150);
      await dragPath(b, corners, { ctrl: !!opts.ctrl });
      await sleep(350);
      const got = await selected(b);
      report(same(got, want) && (await tool(b)) === null, `box: ${label} (selected ${JSON.stringify(got)}, expected ${JSON.stringify(want)}, tool ${await tool(b)})`);
      return lastSelect(b);
    };
    const one = await run('a box over the line H1 selects it', await frontBox(b, 1.4, 0.9, 1.6, 1.1), [IDX.H1]);
    report(one && one.tool === 'box' && one.ms < 100, `box: the selection took ${one ? one.ms.toFixed(1) : '?'} ms`);
    await run('a box over both lines H1 and H2 selects both', await frontBox(b, 1.0, 0.9, 2.0, 2.1), [IDX.H1, IDX.H2]);
    // The set's bounding box covers the gap between its copies; its bars do not.
    await run('a box in the gap between the copies of a set selects nothing', await frontBox(b, 1.0, 2.5, 2.0, 2.58), []);
    await run('a box on one copy of the set selects the set', await frontBox(b, 1.0, 2.88, 2.0, 2.92), [IDX.SET]);
    // The diagonal bar's bounding box covers its empty corners.
    await run('a box in the empty corner of a diagonal bar selects nothing', await frontBox(b, 4.5, 0.05, 4.8, 0.35), []);
    await run('a box across the diagonal bar selects it', await frontBox(b, 4.1, 0.6, 4.3, 0.8), [IDX.DIAG]);
    await run('a box around an end-on bar (a dot) selects it', await frontBox(b, 5.9, 0.5, 6.1, 0.7), [IDX.EA]);
    await run('Ctrl adds the boxed row to the current selection', await frontBox(b, 1.0, 1.9, 2.0, 2.1), [IDX.H1, IDX.H2], { ctrl: true, keep: [IDX.H1] });
    // A click, not a drag: the tool only disarms.
    await reset(b, [IDX.H2]);
    await clickButton(b, BOX_BTN);
    await sleep(150);
    const [cx, cy] = await page(b, 1.5, 0.5);
    await mouse(b, 'mouseMoved', cx, cy);
    await mouse(b, 'mousePressed', cx, cy, { button: 'left', buttons: 1, clickCount: 1 });
    await release(b, [cx, cy]);
    await sleep(300);
    report((await tool(b)) === null && same(await selected(b), [IDX.H2]), `box: a click without a drag only disarms (selected ${JSON.stringify(await selected(b))})`);
    // The outline is drawn while dragging.
    await reset(b);
    await clickButton(b, BOX_BTN);
    await sleep(150);
    const [p0, p1] = await frontBox(b, 1.0, 0.9, 2.0, 2.1);
    await dragPath(b, [p0, p1], { release: false });
    const drawn = await b.ev("Array.from(document.querySelectorAll('div')).some((d) => d.style.display === 'block' && /dashed/.test(d.style.cssText))");
    await release(b, p1);
    await sleep(300);
    report(drawn === true, 'box: the dashed rectangle is drawn while dragging');
    report(b.consoleErrors.length === 0, `box: no errors logged${b.consoleErrors.length ? ': ' + b.consoleErrors[0] : ''}`);
  } finally {
    b.close();
  }
}

// A closed loop through scene points of the Front view, as page pixels.
const frontLoop = async (b, world) => { const out = []; for (const [x, up] of world) out.push(await page(b, x, up)); return out; };
const circle = ([cx, cy], r, n = 24) => Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)]);

async function lasso() {
  const b = await launchBrowser({ instrument: INSTR });
  try {
    await openProject(b, 'autotest=select', makeProject(), ROWS.length);
    await front(b, 'lasso');
    const run = async (label, pts, want, opts = {}) => {
      await reset(b, opts.keep || []);
      await clickButton(b, LASSO_BTN);
      await sleep(150);
      await dragPath(b, pts, { ctrl: !!opts.ctrl });
      await sleep(350);
      const got = await selected(b);
      report(same(got, want) && (await tool(b)) === null, `lasso: ${label} (selected ${JSON.stringify(got)}, expected ${JSON.stringify(want)}, tool ${await tool(b)})`);
      return lastSelect(b);
    };
    // A triangle around the left ends of H1 and H2 (and nothing else).
    const tri = await frontLoop(b, [[0.1, 0.85], [0.1, 2.15], [1.2, 1.5], [0.1, 0.85]]);
    const r1 = await run('a loop around the left ends of H1 and H2 selects those two rows', tri, [IDX.H1, IDX.H2]);
    report(r1 && r1.tool === 'lasso' && r1.ms < 100, `lasso: the selection took ${r1 ? r1.ms.toFixed(1) : '?'} ms`);
    // A circle around a dot.
    const ea = await page(b, 6.0, 0.6);
    await run('a circle around the dot of EA selects it', circle(ea, 14), [IDX.EA]);
    // A U with a notch: EA (6.0, 0.6) in the body and EC (7.0, 1.5) in an arm are in, EB (6.5, 1.5) in the notch is out.
    const u = await frontLoop(b, [[5.8, 0.2], [7.2, 0.2], [7.2, 1.8], [6.7, 1.8], [6.7, 1.0], [6.3, 1.0], [6.3, 1.8], [5.8, 1.8], [5.8, 0.2]]);
    await run('a U-shaped loop leaves out the dot in its notch', u, [IDX.EA, IDX.EC]);
    await run('a loop over empty space selects nothing (and clears the selection)', circle(await page(b, 5.2, 2.6), 20), [], { keep: [IDX.H1] });
    await run('Ctrl adds the looped row to the current selection', circle(ea, 14), [IDX.H1, IDX.EA], { ctrl: true, keep: [IDX.H1] });
    // Exact on a set: a loop in the gap between copies selects nothing, a loop on one copy selects the set.
    await run('a loop in the gap between the copies of a set selects nothing', await frontLoop(b, [[1.0, 2.5], [2.0, 2.5], [2.0, 2.58], [1.0, 2.58], [1.0, 2.5]]), []);
    await run('a loop on one copy of the set selects the set', await frontLoop(b, [[1.0, 2.88], [2.0, 2.88], [2.0, 2.92], [1.0, 2.92], [1.0, 2.88]]), [IDX.SET]);

    // Esc in the middle of a drag cancels it: nothing is selected, the tool is off, the camera is not stuck.
    await reset(b, [IDX.H2]);
    await clickButton(b, LASSO_BTN);
    await sleep(150);
    await dragPath(b, circle(ea, 30), { release: false, stopAt: 8 });
    await key(b, 'Escape', 'Escape');
    await sleep(150);
    await release(b, ea);
    await sleep(300);
    report((await tool(b)) === null && same(await selected(b), [IDX.H2]), `lasso: Esc in the middle of a drag cancels it (selected ${JSON.stringify(await selected(b))})`);
    // A scribble too short to be a loop only disarms.
    await reset(b, [IDX.H2]);
    await clickButton(b, LASSO_BTN);
    await sleep(150);
    await dragPath(b, [[ea[0], ea[1]], [ea[0] + 3, ea[1] + 2], [ea[0] + 1, ea[1] + 4]]);
    await sleep(300);
    report((await tool(b)) === null && same(await selected(b), [IDX.H2]), `lasso: a scribble of a few pixels only disarms (selected ${JSON.stringify(await selected(b))})`);
    // The outline is an SVG polygon that grows while dragging.
    await reset(b);
    await clickButton(b, LASSO_BTN);
    await sleep(150);
    await dragPath(b, circle(ea, 40), { release: false, stopAt: 20 });
    const pointsDrawn = await b.ev("(() => { const p = document.querySelector('svg polygon'); return p ? p.getAttribute('points').split(' ').length : 0; })()");
    await release(b, ea);
    await sleep(300);
    report(pointsDrawn >= 8, `lasso: the outline is drawn while dragging (${pointsDrawn} points)`);
    report(!(await b.ev("!!document.querySelector('svg polygon')")), 'lasso: and it is removed when the tool disarms');
    report(b.consoleErrors.length === 0, `lasso: no errors logged${b.consoleErrors.length ? ': ' + b.consoleErrors[0] : ''}`);
  } finally {
    b.close();
  }
}

async function persp() {
  const b = await launchBrowser({ instrument: INSTR });
  try {
    await openProject(b, 'autotest=select', makeProject(), ROWS.length);
    await chooseView(b, 'iso');
    await settle(b);
    await b.ev(FIT);
    await sleep(500);
    await settle(b);
    const cam = await b.ev(CAM);
    report(!cam.ortho, `persp: the Iso view is a perspective camera (${cam.type})`);
    const mid = await page(b, 1.5, 1.0, 0); // the middle of H1
    const run = async (label, shape, pts, want) => {
      await reset(b);
      await clickButton(b, shape === 'box' ? BOX_BTN : LASSO_BTN);
      await sleep(150);
      await dragPath(b, pts);
      await sleep(350);
      const got = await selected(b);
      report(same(got, want), `persp: ${label} (selected ${JSON.stringify(got)}, expected ${JSON.stringify(want)})`);
    };
    await run('a box around the middle of H1 selects it', 'box', [[mid[0] - 14, mid[1] - 14], [mid[0] + 14, mid[1] + 14]], [IDX.H1]);
    await run('a lasso around the middle of H1 selects it', 'lasso', circle(mid, 14), [IDX.H1]);
    const R = await rectOf(b);
    const corner = [R.x + 50, R.y + R.h - 70];
    await run('a lasso in an empty corner selects nothing', 'lasso', circle(corner, 20), []);
    await run('a box in an empty corner selects nothing', 'box', [[corner[0] - 20, corner[1] - 20], [corner[0] + 20, corner[1] + 20]], []);
    report(b.consoleErrors.length === 0, `persp: no errors logged${b.consoleErrors.length ? ': ' + b.consoleErrors[0] : ''}`);
  } finally {
    b.close();
  }
}

// A million bars: how long the selection takes and whether the page stays responsive afterwards.
async function perf() {
  if (!perfProject || !fs.existsSync(perfProject)) { console.log('perf: pass --project <file.json> (e.g. scripts/perf/out/p1m.json) to run this section'); return; }
  const proj = JSON.parse(fs.readFileSync(perfProject, 'utf8'));
  const b = await launchBrowser({ instrument: INSTR });
  try {
    await openProject(b, 'autotest=select', path.resolve(perfProject), proj.bars.length);
    const bars = await b.ev('window.__status().bars');
    console.log(`      ${proj.bars.length} rows, ${bars} bars loaded`);
    const R = await rectOf(b);
    const frame = () => b.ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now()))))', 60000);
    const time = async (label, shape, pts) => {
      await reset(b);
      await clickButton(b, shape === 'box' ? BOX_BTN : LASSO_BTN);
      await sleep(200);
      const t0 = Date.now();
      await dragPath(b, pts);
      await frame();
      const wall = Date.now() - t0;
      await sleep(500);
      const last = await lastSelect(b);
      const n = (await selected(b)).length;
      // Is the page still responsive: two animation frames after the selection landed.
      const t2 = Date.now();
      await frame();
      const responsive = Date.now() - t2;
      console.log(`      ${label}: ${n} rows selected, handler ${last ? last.ms.toFixed(0) : '?'} ms, drag + selection ${wall} ms, next frame ${responsive} ms`);
      return { n, ms: last ? last.ms : Infinity, responsive };
    };
    const c = [R.x + R.w / 2, R.y + R.h / 2];
    const small = await time('small lasso', 'lasso', circle(c, 25));
    const whole = await time('whole-view box', 'box', [[R.x + 5, R.y + 125], [R.x + R.w - 5, R.y + R.h - 5]]);
    const big = await time('big lasso', 'lasso', circle(c, Math.min(R.w, R.h) * 0.35, 40));
    // Reference: the same selections set straight in the store, without any shape tool. The stall after a big
    // selection is the selection-dependent UI (the BBS table renders every row), not the geometry above.
    for (const count of [small.n, whole.n]) {
      await reset(b);
      await sleep(1500);
      const t0 = Date.now();
      await b.ev(`(() => { window.__store.getState().setSelectedBars(Array.from({ length: ${count} }, (_, i) => i)); })()`);
      await frame();
      console.log(`      reference: ${count} rows set in the store (no tool): the page is back after ${Date.now() - t0} ms`);
    }
    report(small.ms < 1500, `perf: a small lasso takes ${small.ms.toFixed(0)} ms at ${proj.bars.length} rows`);
    report(whole.ms < 3000, `perf: a whole-view box takes ${whole.ms.toFixed(0)} ms (${whole.n} rows)`);
    report(big.ms < 3000, `perf: a big lasso takes ${big.ms.toFixed(0)} ms (${big.n} rows)`);
    report(b.consoleErrors.length === 0, `perf: no errors logged${b.consoleErrors.length ? ': ' + b.consoleErrors[0] : ''}`);
  } finally {
    b.close();
  }
}

const sections = { toolbar, box, lasso, persp, perf };
try {
  for (const [name, fn] of Object.entries(sections)) {
    if (only ? only === name : name !== 'perf') await fn();
  }
} catch (e) {
  console.error('ERROR', e.message);
  failures += 1;
}
console.log(failures ? `RESULT: FAIL (${failures})` : 'RESULT: PASS');
process.exit(failures ? 1 : 0);
