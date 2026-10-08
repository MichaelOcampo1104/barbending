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
import { isDeepStrictEqual } from 'node:util';
import { packViewerHtml, extractProjectFromHtml } from '../../src/standalone/pack.js';
import { boxFromBounds, testCutSize } from '../../src/viewer/sectionBoxMath.js';
import { gzipBytes, toBase64 } from '../../src/standalone/codec.js';

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
const bigFile = arg('big', '');
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
  while (Date.now() - t0 < 60000) { // bounded in time: a frozen page must fail the run, not hold it up for an hour
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
  await b.send('DOM.setFileInputFiles', { files: [path.resolve(filePath)], nodeId: q.nodeIds[which] }); // the browser needs an absolute path
}

// Opens the app and imports a project file; waits until the store holds all its rows.
async function openApp(b, projectPath, rowCount, query = 'autotest=standalone') {
  await b.send('Page.navigate', { url: `${base}/?${query}` });
  if (!(await waitFor(b, '!!document.querySelector("canvas") && !!window.__store', 45000))) throw new Error('the app did not start at ' + base);
  await importFile(b, projectPath, 0);
  // Generous, and growing with the rows: the BBS table renders every row, so 25,000 rows keep the page busy for a minute or more.
  if (!(await waitFor(b, `window.__store.getState().bars.length === ${rowCount}`, Math.max(120000, rowCount * 24)))) throw new Error('the app did not take the project');
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

const near = (a, b, tol) => Math.abs(a - b) <= tol;
// The canvas rectangle in page pixels (for trusted mouse input).
const rectOf = (b) => b.ev(`(() => { const r = document.getElementById('gl').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);

// ---- the section box (viewer) ----
// Amber pixels of the canvas (the Ø16 bar): count and horizontal extent, in canvas pixels. Amber by hue, not by brightness: at this zoom
// the bar is a one-pixel line, and when its centre falls between two pixel rows each of them is only partly covered and dim.
const AMBER = `(() => {
  const c = document.getElementById('gl'); const t = document.createElement('canvas');
  t.width = c.width; t.height = c.height;
  const x = t.getContext('2d', { willReadFrequently: true }); x.drawImage(c, 0, 0);
  const d = x.getImageData(0, 0, t.width, t.height).data;
  let n = 0, x0 = 1e9, x1 = -1;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r > 60 && r > g * 1.08 && g > b * 1.2 && r - b > 25) { n++; const px = p % t.width; if (px < x0) x0 = px; if (px > x1) x1 = px; }
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
  // The bar is cut at the box faces, to a pixel. The box's own outline is drawn over the last pixel at each plane, so the box is hidden
  // (👁 Box: it keeps cutting) for this measure; the first and last pixel the bar can have are the ones whose centres lie inside the planes.
  const lo = Math.max(0, s2.center[0] - s2.size[0] / 2);
  const hi = Math.min(3, s2.center[0] + s2.size[0] / 2);
  const e0 = await sx(lo);
  const e1 = await sx(hi);
  await b.ev('document.getElementById("sec-show").click()');
  await sleep(600);
  const hid = await b.ev('({ visible: window.__viewer.section.boxGroup.visible, show: window.__viewer.section.state.showBox })');
  const cut = await b.ev(AMBER);
  const first = Math.ceil(e0 - 0.5);
  const last = Math.floor(e1 - 0.5);
  report(cut.n > 100 && near(cut.x0, first, 1) && near(cut.x1, last, 1), `section: the cut agrees with the planes to 1 px (bar ${cut.x0}..${cut.x1}, planes ${e0.toFixed(1)}..${e1.toFixed(1)}, so pixels ${first}..${last})`);
  report(!hid.visible && !hid.show, 'section: 👁 Box hides the box, and the cut above is still there');
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

async function section() {
  const { file } = await writeViewer(makeProject(), 'viewer-section', 'Section check');
  const b = await launchBrowser();
  try {
    await openViewer(b, file);
    await sectionCore(b);
    await sectionFaces(b);
    await sectionGizmo(b);
    await sectionSolid(b);
    report(b.consoleErrors.length === 0, `section: no errors logged${b.consoleErrors.length ? ': ' + b.consoleErrors[0] : ''}`);
  } finally {
    b.close();
  }
}

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