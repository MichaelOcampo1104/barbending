// Functional checks of the field renderer against the legacy renderer, in headless Edge.
// usage: node scripts/perf/check_field.mjs --url <app base url> [--only parity]
// parity : the same small project drawn by ?renderer=legacy and ?renderer=field, with and without
//          the section box (?autotest=section cuts it to the central third). The amber pixels must
//          occupy the same screen box (placement + clipping), and the field must draw something.
// tubes  : Detail = Tubes draws instanced tubes with the same extent as the legacy renderer.
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
  if (query.includes('renderer=field')) {
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

try {
  if (!only || only === 'parity') await parity();
  if (!only || only === 'tubes') await tubes();
} catch (e) {
  console.error('ERROR', e.message);
  failures += 1;
}
console.log(failures ? `RESULT: FAIL (${failures})` : 'RESULT: PASS');
process.exit(failures ? 1 : 0);
