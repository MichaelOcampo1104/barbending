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
    report(/^[\d,]+ of [\d,]+ rows$/.test(count), `viewer: filtering by "${mark}" narrows the table (${count})`);
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