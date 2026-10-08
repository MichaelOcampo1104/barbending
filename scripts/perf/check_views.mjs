// Browser checks for the preset views and the orthographic camera, in headless Edge (real GPU).
// usage: node scripts/perf/check_views.mjs --url <app base url> [--only <name>]
// views  : Top / Bottom / Front / Back / Left / Right from the real dropdown look exactly along their axis
//          in an orthographic camera, Iso is a perspective camera; the dropdown and the pill name the view.
// ortho  : the orthographic picture is parallel (depth does not move a point), and switching projection with
//          the pill keeps what you look at (points on the target plane stay put) in both directions.
// gizmo  : a click on each head of the axis gizmo gives the same exact view as the dropdown.
// nav    : orbiting keeps the projection (the view becomes "Free"); the wheel zooms about the cursor (the point
//          under the cursor stays put); right-drag pans like the perspective camera; +/- keys zoom; Fit All fits.
// field  : bars pick by click (the nearest one along the ray) and switch lines <-> tubes with the zoom.
// section: the section box clips in the orthographic view.
// dots   : a bar that points straight at the camera (Front / Back: along app Y, Left / Right: along X, Top / Bottom:
//          vertical) is a zero-length line in the far-zoom renderer; it must still show as a dot of its colour.
// ifc    : a loaded IFC model (public/sample-concrete.ifc): Fit IFC keeps the orthographic view and frames the
//          model, perspective Fit IFC is unchanged, and the model stays drawn after zooming out / in and in Top.
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
if (!base) { console.error('usage: node scripts/perf/check_views.mjs --url <app base url> [--only views|ortho|gizmo|nav|field|section|dots|ifc]'); process.exit(2); }

let failures = 0;
const report = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures += 1; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const fmt = (v) => `[${v.map((x) => x.toFixed(2)).join(', ')}]`;

// Six bars at different heights and depths inside two concrete members: easy to tell views apart.
// App mm -> scene m: x, z (up), -y. Bars 0-2 are near the camera of the Front view, bars 3-5 are 3 m behind.
function makeProject() {
  const member = (id, y) => ({ id, name: `Member ${id}`, lx: 3500, ly: 400, lz: 600, x: -500, y, z: 1200 });
  const bar = (k, y, hostId, z) => ({
    Rebar_tag: k + 1, Bar_mark: `V${k + 1}`, Rebar_Type: 'straight', Plane: 'XY', Dia: 16, 'Length of Bar': 3000, host: hostId,
    Pos_x: 0, Pos_y: y, Pos_z: z, Pos_Rotation: 0, qty: 1, qty_x: 1, spacing_x: 150, qty_y: 1, spacing_y: 150,
    Group: 'views', bond_condition: 'poor', Visible: 1,
  });
  const bars = [bar(0, 50, 'c1', 1300), bar(1, 150, 'c1', 1500), bar(2, 250, 'c1', 1700), bar(3, 3050, 'c2', 1300), bar(4, 3150, 'c2', 1500), bar(5, 3250, 'c2', 1700)];
  return { v: 1, app: 'barbending', savedAt: Date.now(), bars, concretes: [member('c1', 0), member('c2', 3000)], refLines: [], cover: 40, bond: 'poor', selectedBar: 0, selectedBars: [] };
}

const FIT = '(Array.from(document.querySelectorAll("button")).find((e) => e.title === "Fit entire model in view") || { click() {} }).click()';
const CAM = `(() => { const c = window.__camera; const V = c.position.constructor; const f = new V(); c.getWorldDirection(f);
  return { type: c.type, ortho: !!c.isOrthographicCamera, f: f.toArray(), zoom: c.zoom, pos: c.position.toArray() }; })()`;

// Waits until the camera has not moved (position, orientation, zoom) for 0.8 s.
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

async function openProject(b, query, project = makeProject()) {
  const file = path.join(outDir, 'check_views_project.json');
  fs.writeFileSync(file, JSON.stringify(project));
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
  await b.send('DOM.setFileInputFiles', { files: [file], nodeId: q.nodeIds[0] });
  for (let i = 0; i < 160; i++) {
    const n = await b.ev('window.__status().bars', 15000).catch(() => bars0);
    if (n !== bars0 && n > 0) break;
    await sleep(250);
  }
  for (let i = 0; i < 200; i++) {
    if (await b.ev('!!(window.__barfield && window.__barfield.ready && window.__barfield.rows === ${project.bars.length})', 5000).catch(() => false)) break;
    await sleep(250);
  }
  await sleep(800);
  await b.ev(FIT);
  await sleep(500);
  await settle(b);
  await b.ev('window.__store.getState().clearBarSelection(); document.activeElement && document.activeElement.blur()');
}

// The "view" dropdown, driven like a user would: choose an option, React's onChange fires.
const SELECT = "Array.from(document.querySelectorAll('select')).find((x) => Array.from(x.options).some((o) => o.value === 'front'))";
const chooseView = (b, value) => b.ev(`(() => { const s = ${SELECT}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
const dropdownText = (b) => b.ev(`(() => { const s = ${SELECT}; return s.options[s.selectedIndex].text; })()`);
const pillText = (b) => b.ev("(document.querySelector('.viewbadge') || { textContent: '' }).textContent");
const clickPill = (b) => b.ev("document.querySelector('.viewbadge').click()");
const viewName = (b) => b.ev('window.__store.getState().viewName');

// World point -> canvas pixels (and NDC depth), using the live camera.
const toScreen = (b, [x, y, z]) => b.ev(`(() => { const c = window.__camera; const V = c.position.constructor; const cv = document.querySelector('canvas');
  const p = new V(${x}, ${y}, ${z}).project(c); return [(p.x * 0.5 + 0.5) * cv.clientWidth, (-p.y * 0.5 + 0.5) * cv.clientHeight, p.z]; })()`);
// Points on the plane through the orbit target facing the camera.
const targetPlanePoints = (b) => b.ev(`(() => { const c = window.__camera; const t = window.__controls.target; const V = c.position.constructor;
  c.updateMatrixWorld(true);
  const r = new V().setFromMatrixColumn(c.matrixWorld, 0); const u = new V().setFromMatrixColumn(c.matrixWorld, 1);
  return [[0, 0], [1.2, 0.5], [-1.5, 0.9], [2.0, -1.1]].map(([a, d]) => t.clone().addScaledVector(r, a).addScaledVector(u, d).toArray()); })()`);
const rectOf = (b) => b.ev('(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()');
const tubesDrawn = (b) => b.ev("(() => { let n = 0; window.__scene.traverse((o) => { if (o.userData && o.userData.barField === 'tubes' && o.visible) n += 1; }); return n; })()");

// Trusted mouse input.
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
const click = async (b, pt, modifiers = 0) => {
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt[0], y: pt[1] });
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt[0], y: pt[1], button: 'left', clickCount: 1, modifiers });
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt[0], y: pt[1], button: 'left', clickCount: 1, modifiers });
};
const wheel = (b, pt, deltaY) => b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: pt[0], y: pt[1], deltaX: 0, deltaY });
const key = async (b, k, code) => {
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code });
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code });
};

const FORWARD = { top: [0, -1, 0], bottom: [0, 1, 0], front: [0, 0, -1], back: [0, 0, 1], right: [-1, 0, 0], left: [1, 0, 0] };
const dot = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

async function views() {
  const b = await launchBrowser({ instrument: INSTR });
  try {
    await openProject(b, 'autotest=views');
    const start = await b.ev(CAM);
    report(!start.ortho && start.type === 'PerspectiveCamera', `views: the app starts with the perspective camera (${start.type})`);
    report((await pillText(b)).includes('Perspective'), `views: the pill says Perspective ("${await pillText(b)}")`);
    for (const name of ['top', 'bottom', 'front', 'back', 'left', 'right']) {
      await chooseView(b, name);
      await settle(b);
      const c = await b.ev(CAM);
      const aligned = dot(c.f, FORWARD[name]);
      report(c.ortho && c.type === 'OrthographicCamera', `views: ${cap(name)} uses the orthographic camera (${c.type})`);
      report(aligned > 1 - 1e-9, `views: ${cap(name)} looks exactly along its axis (angle ${(Math.acos(Math.min(1, aligned)) * 1e6).toFixed(2)} microrad)`);
      report((await dropdownText(b)) === cap(name), `views: the dropdown reads "${cap(name)}" (it reads "${await dropdownText(b)}")`);
      const pill = await pillText(b);
      report(pill.includes(cap(name)) && pill.includes('Orthographic'), `views: the pill reads "${pill}"`);
    }
    await chooseView(b, 'iso');
    await settle(b);
    const iso = await b.ev(CAM);
    report(!iso.ortho && iso.type === 'PerspectiveCamera', `views: Iso is a perspective camera (${iso.type})`);
    report((await dropdownText(b)) === 'Iso' && (await pillText(b)).includes('Iso'), `views: Iso is named in the dropdown and the pill ("${await dropdownText(b)}", "${await pillText(b)}")`);
    report(b.consoleErrors.length === 0, `views: no errors logged${b.consoleErrors.length ? ': ' + b.consoleErrors[0] : ''}`);
  } finally {
    b.close();
  }
}

async function ortho() {
  const b = await launchBrowser({ instrument: INSTR });
  try {
    await openProject(b, 'autotest=ortho');
    // Parallel: two points that differ only in depth (along the view axis of the Front view) coincide ...
    await chooseView(b, 'front');
    await settle(b);
    const a = await toScreen(b, [3.0, 1.8, -1]);
    const c = await toScreen(b, [3.0, 1.8, -2.5]);
    report(near(a[0], c[0], 0.01) && near(a[1], c[1], 0.01), `ortho: depth does not move a point in the Front view (${fmt(a)} vs ${fmt(c)})`);
    // ... and in perspective they do not.
    await clickPill(b);
    await sleep(700);
    const p1 = await toScreen(b, [3.0, 1.8, -1]);
    const p2 = await toScreen(b, [3.0, 1.8, -2.5]);
    const apart = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
    report(!(await b.ev(CAM)).ortho && apart > 5, `ortho: in perspective the same two points are ${apart.toFixed(0)} px apart`);

    // Switching keeps what you look at: points on the target plane stay where they are, both ways.
    await chooseView(b, 'iso');
    await settle(b);
    const pts = await targetPlanePoints(b);
    const shots = [];
    for (const p of pts) shots.push(await toScreen(b, p));
    await clickPill(b);
    await sleep(700);
    const orthoCam = await b.ev(CAM);
    const afterO = [];
    for (const p of pts) afterO.push(await toScreen(b, p));
    const dO = Math.max(...shots.map((s, i) => Math.hypot(s[0] - afterO[i][0], s[1] - afterO[i][1])));
    report(orthoCam.ortho && dO < 0.1, `ortho: perspective -> orthographic keeps the target plane in place (max move ${dO.toFixed(3)} px)`);
    await clickPill(b);
    await sleep(700);
    const afterP = [];
    for (const p of pts) afterP.push(await toScreen(b, p));
    const dP = Math.max(...shots.map((s, i) => Math.hypot(s[0] - afterP[i][0], s[1] - afterP[i][1])));
    report(!(await b.ev(CAM)).ortho && dP < 0.1, `ortho: and back to perspective keeps it too (max move ${dP.toFixed(3)} px)`);
    // The pill toggles without changing the view direction.
    const dirBefore = (await b.ev(CAM)).f;
    await clickPill(b);
    await sleep(500);
    const dirAfter = (await b.ev(CAM)).f;
    report(dot(dirBefore, dirAfter) > 1 - 1e-9, 'ortho: the pill does not change the view direction');
    report((await pillText(b)).includes('Orthographic'), `ortho: the pill reads "${await pillText(b)}"`);
    // The dropdown's Perspective / Orthographic entries do the same.
    await chooseView(b, 'persp');
    await sleep(500);
    report(!(await b.ev(CAM)).ortho, 'ortho: the dropdown entry "Perspective" switches to perspective');
    await chooseView(b, 'ortho');
    await sleep(500);
    report((await b.ev(CAM)).ortho, 'ortho: the dropdown entry "Orthographic" switches to orthographic');
    report(b.consoleErrors.length === 0, `ortho: no errors logged${b.consoleErrors.length ? ': ' + b.consoleErrors[0] : ''}`);
  } finally {
    b.close();
  }
}

// Head of the axis gizmo on the canvas: the corner widget is 70 px from the top-right, heads sit 40 px out.
const gizmoHead = (b, axis) => b.ev(`(() => { const c = window.__camera; const V = c.position.constructor; const cv = document.querySelector('canvas');
  const r = cv.getBoundingClientRect(); const q = c.quaternion.clone().invert(); const v = new V(${axis[0]}, ${axis[1]}, ${axis[2]}).applyQuaternion(q);
  return [r.left + cv.clientWidth - 70 + v.x * 40, r.top + 70 - v.y * 40]; })()`);

async function gizmo() {
  const b = await launchBrowser({ instrument: INSTR });
  try {
    await openProject(b, 'autotest=gizmo');
    const heads = [[[1, 0, 0], 'right'], [[0, 1, 0], 'top'], [[0, 0, 1], 'front'], [[-1, 0, 0], 'left'], [[0, -1, 0], 'bottom'], [[0, 0, -1], 'back']];
    for (const [axis, name] of heads) {
      await chooseView(b, 'iso');
      await settle(b);
      const pt = await gizmoHead(b, axis);
      await click(b, pt);
      await settle(b);
      const c = await b.ev(CAM);
      const aligned = dot(c.f, FORWARD[name]);
      const got = await viewName(b);
      report(got === name && c.ortho && aligned > 1 - 1e-9, `gizmo: the ${fmt(axis)} head gives the exact orthographic ${cap(name)} view (view "${got}", ${c.type}, ${(Math.acos(Math.min(1, aligned)) * 1e6).toFixed(2)} microrad)`);
    }
    report(b.consoleErrors.length === 0, `gizmo: no errors logged${b.consoleErrors.length ? ': ' + b.consoleErrors[0] : ''}`);
  } finally {
    b.close();
  }
}

async function nav() {
  const b = await launchBrowser({ instrument: INSTR });
  try {
    await openProject(b, 'autotest=nav');
    const R = await rectOf(b);
    const centre = [R.x + R.w / 2, R.y + R.h / 2 + 30];
    // Orbiting keeps the orthographic projection and the view becomes "Free".
    await chooseView(b, 'front');
    await settle(b);
    await drag(b, centre, [centre[0] + 160, centre[1] - 60], 'middle');
    await settle(b);
    const orbited = await b.ev(CAM);
    report(orbited.ortho && (await viewName(b)) === 'free', `nav: orbiting keeps the orthographic camera and the view becomes "${await viewName(b)}"`);
    report((await pillText(b)).includes('Free') && (await pillText(b)).includes('Orthographic'), `nav: the pill reads "${await pillText(b)}"`);

    // Wheel zoom about the cursor in the Front view: the point under the cursor stays put.
    await chooseView(b, 'front');
    await settle(b);
    const P = [1.0, 1.5, -0.15]; // on bar 1 (near), a third of the way along
    const s0 = await toScreen(b, P);
    const at = [R.x + s0[0], R.y + s0[1]];
    const z0 = (await b.ev(CAM)).zoom;
    await wheel(b, at, -120);
    await settle(b);
    const z1 = (await b.ev(CAM)).zoom;
    const s1 = await toScreen(b, P);
    report(z1 > z0 * 1.1, `nav: a wheel notch zooms in (${z0.toFixed(1)} -> ${z1.toFixed(1)} px/m)`);
    report(Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) < 1.5, `nav: the point under the cursor stays put (moved ${Math.hypot(s1[0] - s0[0], s1[1] - s0[1]).toFixed(2)} px)`);
    await wheel(b, at, 120);
    await settle(b);
    const z2 = (await b.ev(CAM)).zoom;
    const s2 = await toScreen(b, P);
    report(z2 < z1 && Math.hypot(s2[0] - s0[0], s2[1] - s0[1]) < 1.5, `nav: and zooming out comes back (${z1.toFixed(1)} -> ${z2.toFixed(1)} px/m, point moved ${Math.hypot(s2[0] - s0[0], s2[1] - s0[1]).toFixed(2)} px)`);
    // A fling in each direction stays finite and inside the zoom limits.
    for (let i = 0; i < 60; i++) { await wheel(b, at, -200); await sleep(10); }
    await settle(b);
    const zin = (await b.ev(CAM)).zoom;
    for (let i = 0; i < 90; i++) { await wheel(b, at, 200); await sleep(10); }
    await settle(b);
    const zout = (await b.ev(CAM)).zoom;
    report(Number.isFinite(zin) && Number.isFinite(zout) && zin > zout && zout >= R.h / 500 - 1e-6 && zin <= R.h / 0.002 + 1e-6,
      `nav: wheel flings stay finite and inside the limits (zoomed in ${zin.toFixed(0)}, out ${zout.toFixed(2)} px/m)`);

    // Keys: + / - zoom by 1.2x, Home fits.
    await b.ev(FIT);
    await settle(b);
    await b.ev('document.activeElement && document.activeElement.blur()');
    const k0 = (await b.ev(CAM)).zoom;
    await key(b, '=', 'Equal');
    await sleep(300);
    const k1 = (await b.ev(CAM)).zoom;
    await key(b, '-', 'Minus');
    await sleep(300);
    const k2 = (await b.ev(CAM)).zoom;
    report(near(k1 / k0, 1.2, 0.01) && near(k2 / k1, 1 / 1.2, 0.01), `nav: the + and - keys zoom by 1.2x (${(k1 / k0).toFixed(3)}, ${(k2 / k1).toFixed(3)})`);

    // Fit All in the orthographic Front view: the whole model is inside the canvas and fills most of it.
    await drag(b, centre, [centre[0] + 220, centre[1] + 90], 'right'); // pan it away
    await wheel(b, centre, -240);
    await settle(b);
    await b.ev(FIT);
    await settle(b);
    const corners = [];
    for (const x of [-0.5, 3.0]) for (const y of [1.2, 1.8]) for (const z of [-3.4, 0]) corners.push(await toScreen(b, [x, y, z]));
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    const inside = Math.min(...xs) >= 0 && Math.max(...xs) <= R.w && Math.min(...ys) >= 0 && Math.max(...ys) <= R.h;
    const fill = Math.max((Math.max(...xs) - Math.min(...xs)) / R.w, (Math.max(...ys) - Math.min(...ys)) / R.h);
    report(inside && fill > 0.5, `nav: Fit All frames the whole model (inside the canvas: ${inside}, fills ${(fill * 100).toFixed(0)}% of it)`);

    // Panning: the same drag moves a point on the target plane the same distance in perspective and orthographic.
    await chooseView(b, 'iso');
    await settle(b);
    const planeP = (await targetPlanePoints(b))[1];
    const shiftOf = async (from, to) => {
      const before = await toScreen(b, planeP);
      await drag(b, from, to, 'right');
      await sleep(900);
      const after = await toScreen(b, planeP);
      return [after[0] - before[0], after[1] - before[1]];
    };
    const sPersp = await shiftOf(centre, [centre[0] + 100, centre[1]]);
    await shiftOf([centre[0] + 100, centre[1]], centre); // drag it back
    await settle(b);
    await clickPill(b);
    await sleep(700);
    const sOrtho = await shiftOf(centre, [centre[0] + 100, centre[1]]);
    report(Math.abs(sPersp[0]) > 20 && Math.hypot(sPersp[0] - sOrtho[0], sPersp[1] - sOrtho[1]) < 3,
      `nav: right-drag pans orthographic like perspective (perspective moved ${fmt(sPersp)} px, orthographic ${fmt(sOrtho)} px)`);
    report(b.consoleErrors.length === 0, `nav: no errors logged${b.consoleErrors.length ? ': ' + b.consoleErrors[0] : ''}`);
  } finally {
    b.close();
  }
}

async function field() {
  const b = await launchBrowser({ instrument: INSTR });
  try {
    await openProject(b, 'autotest=field');
    const R = await rectOf(b);
    await chooseView(b, 'front');
    await settle(b);
    const selected = async () => JSON.parse(await b.ev('JSON.stringify(window.__store.getState().selectedBars)'));
    const mid = async (k) => { const s = await toScreen(b, [1.5, [1.3, 1.5, 1.7][k % 3], -(k < 3 ? 0.15 : 3.15)]); return [R.x + s[0], R.y + s[1]]; };
    // Bars 0 and 3 (and 1 / 4, 2 / 5) overlap on screen; the one nearer the camera (0, 1, 2) wins.
    for (const k of [0, 1, 2]) {
      await click(b, await mid(k));
      await sleep(500);
      const sel = await selected();
      report(sel.length === 1 && sel[0] === k, `field: a click on the overlapping bars picks the nearer one, bar ${k} (selectedBars=${JSON.stringify(sel)})`);
    }
    await click(b, [R.x + R.w * 0.1, R.y + R.h * 0.85]);
    await sleep(500);
    report((await selected()).length === 0, 'field: a click on empty space clears the selection');

    // Lines <-> tubes follow the zoom (2 * radius * zoom >= 3 px turns a chunk into tubes). The Front view
    // fits the whole model at ~93 px/m, where a 16 mm bar is 1.5 px wide: lines. Zoom in until the bars are
    // 5 px wide: tubes.
    const centre = [R.x + R.w / 2, R.y + R.h / 2];
    const zFit = (await b.ev(CAM)).zoom;
    await sleep(500);
    const tubesFit = await tubesDrawn(b);
    report(zFit * 0.016 < 2 && tubesFit === 0, `field: fitted at ${zFit.toFixed(0)} px/m (bars ${(zFit * 0.016).toFixed(1)} px wide) the bars are drawn as lines (${tubesFit} tube objects)`);
    let z = zFit;
    for (let i = 0; i < 40 && z * 0.016 < 5; i++) { await wheel(b, centre, -200); await sleep(60); z = (await b.ev(CAM)).zoom; }
    await settle(b);
    await sleep(600);
    z = (await b.ev(CAM)).zoom;
    const tubesNear = await tubesDrawn(b);
    report(z * 0.016 >= 3 && tubesNear > 0, `field: zoomed in to ${z.toFixed(0)} px/m (bars ${(z * 0.016).toFixed(1)} px wide) the bars are drawn as tubes (${tubesNear} tube objects)`);
    for (let i = 0; i < 40; i++) { await wheel(b, centre, 200); await sleep(10); }
    await settle(b);
    await sleep(600);
    const zFar = (await b.ev(CAM)).zoom;
    const tubesFar = await tubesDrawn(b);
    report(zFar * 0.016 < 2 && tubesFar === 0, `field: zoomed out to ${zFar.toFixed(1)} px/m (bars ${(zFar * 0.016).toFixed(2)} px wide) no tubes are drawn (${tubesFar})`);
    for (let i = 0; i < 60; i++) { await wheel(b, centre, -200); await sleep(10); }
    await settle(b);
    await sleep(600);
    const tubesBack = await tubesDrawn(b);
    report(tubesBack > 0, `field: zoomed back in the tubes return (${tubesBack})`);
    report(b.consoleErrors.length === 0, `field: no errors logged${b.consoleErrors.length ? ': ' + b.consoleErrors[0] : ''}`);
  } finally {
    b.close();
  }
}

// Amber pixels of the canvas (the bars): count and extent, outside the orientation gizmo corner. The green
// channel must be above 105: the section box's red face handles (228, 74, 69) are not bars.
const PIXELS = `(() => {
  const c = document.querySelector('canvas'); const t = document.createElement('canvas');
  t.width = c.width; t.height = c.height;
  const x = t.getContext('2d', { willReadFrequently: true }); x.drawImage(c, 0, 0);
  const d = x.getImageData(0, 0, t.width, t.height).data;
  let n = 0, x0 = 1e9, x1 = -1;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const px = p % t.width, py = (p / t.width) | 0;
    if (px > t.width - 220 && py < 220) continue;
    if (r > 140 && g > 105 && g < 210 && b < 100 && r > g * 1.1) { n++; if (px < x0) x0 = px; if (px > x1) x1 = px; }
  }
  return { n, x0, x1 };
})()`;

async function section() {
  const b = await launchBrowser({ instrument: INSTR });
  try {
    await openProject(b, 'autotest=section-ortho');
    await chooseView(b, 'front');
    await settle(b);
    await sleep(600);
    const zoom = (await b.ev(CAM)).zoom;
    const dpr = await b.ev('document.querySelector("canvas").width / document.querySelector("canvas").clientWidth');
    const off0 = await b.ev(PIXELS);
    // The solid-cut cap (on by default) is an opaque face over the cut member and hides the bars inside it,
    // in either projection: switch it off to see the bars themselves.
    await b.ev('(() => { const s = window.__store.getState(); if (!s.section) s.toggleSection(); s.thirdSection(); s.setSection({ solidCut: false }); })()');
    await sleep(1500);
    const on = await b.ev(PIXELS);
    // The bars run from x = 0 to 3 m: the box keeps them up to its right face.
    const sec = await b.ev('window.__store.getState().section');
    const keptM = Math.min(3, sec.center[0] + sec.size[0] / 2) - Math.max(0, sec.center[0] - sec.size[0] / 2);
    const expectPx = keptM * zoom * dpr;
    await b.ev('window.__store.getState().toggleSection()');
    await sleep(1500);
    const off1 = await b.ev(PIXELS);
    const w = (s) => s.x1 - s.x0;
    console.log(`      section (orthographic Front): bars ${w(off0)} px wide -> section on ${w(on)} (expected ${expectPx.toFixed(0)}) -> off ${w(off1)}`);
    report(off0.n > 200, `section: the bars are drawn (${off0.n} amber px)`);
    report(on.n > 100 && near(w(on), expectPx, 12),
      `section: the box cuts the bars at its face in the orthographic view (${w(off0)} -> ${w(on)} px wide, expected ${expectPx.toFixed(0)}, ${on.n} amber px)`);
    report(Math.abs(w(off1) - w(off0)) <= 14, `section: switching it off restores them (${w(off1)} px wide)`);
    report(b.consoleErrors.length === 0, `section: no errors logged${b.consoleErrors.length ? ': ' + b.consoleErrors[0] : ''}`);
  } finally {
    b.close();
  }
}

// Straight bars along each axis, far apart, so that in each of the six views the end-on bars are isolated dots.
// Along app Y: plane XY, rotation 90. Along app X: plane XY, rotation 0. Vertical: plane XZ, rotation 90.
const DOT_BARS = [
  { mark: 'Y1', dia: 32, plane: 'XY', rot: 90, pos: [500, 0, 1000], len: 3000 },
  { mark: 'Y2', dia: 32, plane: 'XY', rot: 90, pos: [1500, 0, 1500], len: 3000 },
  { mark: 'Y3', dia: 32, plane: 'XY', rot: 90, pos: [2500, 0, 2000], len: 3000 },
  { mark: 'X1', dia: 25, plane: 'XY', rot: 0, pos: [0, 4000, 3000], len: 3000 },
  { mark: 'X2', dia: 25, plane: 'XY', rot: 0, pos: [0, 5000, 3500], len: 3000 },
  { mark: 'Z1', dia: 20, plane: 'XZ', rot: 90, pos: [6000, 0, 0], len: 2000 },
  { mark: 'Z2', dia: 20, plane: 'XZ', rot: 90, pos: [7000, 1000, 0], len: 2000 },
];
const DOT_COLOR = { 32: [59, 130, 246], 25: [168, 85, 247], 20: [239, 68, 68] }; // the palette's blue, purple and red
// Which bars are end-on in which view, and the scene axis code the line shader is told about (1 = X, 2 = Y, 3 = Z).
const DOT_VIEWS = {
  front: { marks: ['Y1', 'Y2', 'Y3'], axis: 3 }, back: { marks: ['Y1', 'Y2', 'Y3'], axis: 3 },
  left: { marks: ['X1', 'X2'], axis: 1 }, right: { marks: ['X1', 'X2'], axis: 1 },
  top: { marks: ['Z1', 'Z2'], axis: 2 }, bottom: { marks: ['Z1', 'Z2'], axis: 2 },
};

function makeDotsProject() {
  const bars = DOT_BARS.map((d, k) => ({
    Rebar_tag: k + 1, Bar_mark: d.mark, Rebar_Type: 'straight', Plane: d.plane, Dia: d.dia, 'Length of Bar': d.len,
    Pos_x: d.pos[0], Pos_y: d.pos[1], Pos_z: d.pos[2], Pos_Rotation: d.rot, qty: 1, qty_x: 1, spacing_x: 150, qty_y: 1, spacing_y: 150,
    Group: 'dots', bond_condition: 'poor', Visible: 1,
  }));
  return { v: 1, app: 'barbending', savedAt: Date.now(), bars, concretes: [], refLines: [], cover: 40, bond: 'poor', selectedBar: 0, selectedBars: [] };
}

// Pixels near (cx, cy) (canvas CSS px) that differ from the local background in the direction of `color`:
// anti-aliasing blends a thin dash with the background, so this looks at hue and strength, not an exact colour.
const dotProbe = (cx, cy, color) => `(() => {
  const c = document.querySelector('canvas'); const k = c.width / c.clientWidth;
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
const endOnUniform = (b) => b.ev(`(() => { let v = null; window.__scene.traverse((o) => { if (v === null && o.userData && o.userData.barField === 'lines') v = o.material.uniforms.uEndOnAxis.value; }); return v; })()`);

async function dots() {
  const b = await launchBrowser({ instrument: INSTR });
  try {
    await openProject(b, 'autotest=dots', makeDotsProject());
    const byMark = Object.fromEntries(DOT_BARS.map((d) => [d.mark, d]));
    const startOf = (d) => [d.pos[0] / 1000, d.pos[2] / 1000, -d.pos[1] / 1000]; // app mm -> scene m (x, z up, -y)
    const probeAll = async (marks) => {
      const seen = [];
      for (const m of marks) {
        const d = byMark[m];
        const [sx, sy] = await toScreen(b, startOf(d));
        const r = await b.ev(dotProbe(sx, sy, DOT_COLOR[d.dia]));
        seen.push(`${m} ${r.n > 0 ? 'dot' : 'MISSING'}`);
      }
      return seen;
    };
    const keepShot = async (name) => {
      // A picture of a failure, next to the other rig output.
      const shot = await b.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(outDir, name), Buffer.from(shot.data, 'base64'));
    };
    for (const [view, { marks, axis }] of Object.entries(DOT_VIEWS)) {
      await chooseView(b, view);
      await settle(b);
      await b.ev(FIT);
      await sleep(500);
      await settle(b);
      await sleep(400);
      // Close: the bars are drawn as tubes, and an open tube seen end-on has no area.
      const cam = await b.ev(CAM);
      const tubesNear = await tubesDrawn(b);
      const near = await probeAll(marks);
      report(cam.ortho && tubesNear > 0 && near.every((t) => t.endsWith('dot')),
        `dots: in the ${view} view end-on bars show as dots when drawn as tubes (${near.join(', ')}; ${cam.zoom.toFixed(0)} px/m, ${tubesNear} tube objects)`);
      if (!near.every((t) => t.endsWith('dot'))) await keepShot(`check-dots-${view}-tubes.png`);
      // Far: the bars are lines, and a line seen end-on has no length.
      const R = await rectOf(b);
      for (let i = 0; i < 10; i++) { await wheel(b, [R.x + R.w / 2, R.y + R.h / 2], 200); await sleep(40); }
      await settle(b);
      await sleep(700);
      const camFar = await b.ev(CAM);
      const tubesFar = await tubesDrawn(b);
      const far = await probeAll(marks);
      report(tubesFar === 0 && far.every((t) => t.endsWith('dot')),
        `dots: and when drawn as lines (${far.join(', ')}; ${camFar.zoom.toFixed(0)} px/m, ${tubesFar} tube objects)`);
      if (!far.every((t) => t.endsWith('dot'))) await keepShot(`check-dots-${view}-lines.png`);
      const u = await endOnUniform(b);
      report(u === axis, `dots: the line shader is told the camera looks along axis ${axis} (uEndOnAxis ${u})`);
    }

    // Selecting an end-on bar: a click on its dot picks it, and the selected bar (drawn by the classic mesh,
    // whose tube is capped) is still there.
    await chooseView(b, 'front');
    await settle(b);
    await b.ev(FIT);
    await sleep(500);
    await settle(b);
    await sleep(400);
    const R2 = await rectOf(b);
    const y2 = byMark.Y2;
    const [px, py] = await toScreen(b, startOf(y2));
    await b.ev('window.__store.getState().clearBarSelection(); document.activeElement && document.activeElement.blur()');
    await click(b, [R2.x + px, R2.y + py]);
    await sleep(900);
    const sel = JSON.parse(await b.ev('JSON.stringify(window.__store.getState().selectedBars)'));
    report(sel.length === 1 && sel[0] === DOT_BARS.indexOf(y2), `dots: a click on the dot of Y2 selects that bar (selectedBars ${JSON.stringify(sel)})`);
    await sleep(500);
    const shown = await b.ev(dotProbe(px, py, DOT_COLOR[y2.dia]));
    report(shown.n > 0, `dots: the selected end-on bar is still drawn (${shown.n} bar-coloured px at its dot)`);
    if (shown.n === 0) await keepShot('check-dots-selected.png');
    // The dash is only for the exact axis views: Iso, perspective and a slightly orbited orthographic view draw plain lines.
    await chooseView(b, 'iso');
    await settle(b);
    report((await endOnUniform(b)) === 0, `dots: Iso (perspective) draws plain lines (uEndOnAxis ${await endOnUniform(b)})`);
    await chooseView(b, 'front');
    await settle(b);
    await clickPill(b); // front, perspective
    await settle(b);
    report((await endOnUniform(b)) === 0 && !(await b.ev(CAM)).ortho, `dots: a perspective Front draws plain lines (uEndOnAxis ${await endOnUniform(b)})`);
    await clickPill(b); // back to orthographic
    await settle(b);
    const R = await rectOf(b);
    const c = [R.x + R.w / 2, R.y + R.h / 2];
    await drag(b, c, [c[0] + 12, c[1]], 'middle'); // a few degrees of orbit
    await sleep(600);
    await settle(b);
    const free = await b.ev(CAM);
    report(free.ortho && (await viewName(b)) === 'free' && (await endOnUniform(b)) === 0,
      `dots: an orbited orthographic view draws plain lines (view "${await viewName(b)}", uEndOnAxis ${await endOnUniform(b)})`);
    report(b.consoleErrors.length === 0, `dots: no errors logged${b.consoleErrors.length ? ': ' + b.consoleErrors[0] : ''}`);
  } finally {
    b.close();
  }
}

// Canvas snapshot and "how many pixels differ from it" (needs preserveDrawingBuffer, on under ?autotest).
const SNAP = `(() => { const c = document.querySelector('canvas'); const t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
  const x = t.getContext('2d', { willReadFrequently: true }); x.drawImage(c, 0, 0); window.__snap = x.getImageData(0, 0, t.width, t.height).data; return true; })()`;
const DIFF = `(() => { const c = document.querySelector('canvas'); const t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
  const x = t.getContext('2d', { willReadFrequently: true }); x.drawImage(c, 0, 0); const d = x.getImageData(0, 0, t.width, t.height).data; const a = window.__snap;
  const k = c.width / c.clientWidth; let n = 0, sx = 0, sy = 0;
  const changed = (i) => Math.abs(d[i] - a[i]) + Math.abs(d[i + 1] - a[i + 1]) + Math.abs(d[i + 2] - a[i + 2]) > 60;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) { if (changed(i)) { n++; sx += p % t.width; sy += (p / t.width) | 0; } }
  if (!n) return { n: 0, x: 0, y: 0 };
  const mx = sx / n, my = sy / n; let best = 1e18, bx = 0, by = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) { if (!changed(i)) continue; const px = p % t.width, py = (p / t.width) | 0; const dd = (px - mx) ** 2 + (py - my) ** 2; if (dd < best) { best = dd; bx = px; by = py; } }
  return { n, x: bx / k, y: by / k }; })()`;
const FIT_IFC = '(Array.from(document.querySelectorAll("button")).find((e) => e.textContent.trim() === "Fit IFC") || { click() {} }).click()';

async function ifc() {
  const b = await launchBrowser({ instrument: INSTR });
  try {
    await openProject(b, 'autotest=ifc-ortho');
    // The IFC loader lives in the Concrete tab; use its own file input, the same path as a user upload.
    await b.ev("(Array.from(document.querySelectorAll('.tabs button')).find((e) => e.textContent.trim() === 'Concrete') || { click() {} }).click()");
    await sleep(600);
    const sample = path.join(here, '..', '..', 'public', 'sample-concrete.ifc');
    const idx = await b.ev("Array.from(document.querySelectorAll('input[type=file]')).findIndex((i) => /ifc/i.test(i.accept))");
    if (idx < 0) { report(false, 'ifc: the IFC file input was not found'); return; }
    const root = await b.send('DOM.getDocument', { depth: 0 });
    const q = await b.send('DOM.querySelectorAll', { nodeId: root.root.nodeId, selector: 'input[type=file]' });
    await b.send('DOM.setFileInputFiles', { files: [sample], nodeId: q.nodeIds[idx] });
    let loaded = false;
    for (let i = 0; i < 120 && !loaded; i++) { await sleep(500); loaded = await b.ev('!!window.__store.getState().ifc', 15000).catch(() => false); }
    report(loaded, 'ifc: the sample IFC loads through the IFC panel');
    if (!loaded) return;
    await sleep(1500);
    await b.ev(FIT_IFC);
    await sleep(600);
    await settle(b);

    // Perspective: Fit IFC frames from the fixed oblique offset, as before.
    const cam0 = await b.ev(CAM);
    const fit = await b.ev('JSON.parse(JSON.stringify(window.__store.getState().ifcFit))');
    const tgt = await b.ev('window.__controls.target.toArray()');
    const off = cam0.pos.map((v, i) => v - tgt[i]);
    const len = Math.hypot(...off);
    const want = [0.8, 0.6, -0.9];
    const wl = Math.hypot(...want);
    report(!cam0.ortho && off.every((v, i) => near(v / len, want[i] / wl, 0.01)),
      `ifc: Fit IFC in perspective still frames from the oblique offset (${cam0.type}, direction ${fmt(off.map((v) => v / len))})`);

    // Orthographic Front: Fit IFC keeps the view and frames the model.
    await chooseView(b, 'front');
    await settle(b);
    await b.ev(FIT_IFC);
    await sleep(600);
    await settle(b);
    const cam1 = await b.ev(CAM);
    const name1 = await viewName(b);
    report(cam1.ortho && name1 === 'front', `ifc: Fit IFC in the orthographic Front keeps the view (view "${name1}", ${cam1.type})`);
    const R = await rectOf(b);
    const c = await toScreen(b, fit.center);
    const expectR = Math.min(R.w, R.h) / 2 / 1.1;
    report(near(c[0], R.w / 2, 2) && near(c[1], R.h / 2, 2), `ifc: the model is centred (centre at ${c[0].toFixed(0)}, ${c[1].toFixed(0)} of ${R.w.toFixed(0)} x ${R.h.toFixed(0)})`);
    report(near(fit.radius * cam1.zoom, expectR, 3), `ifc: the bounding sphere fills the view (${(fit.radius * cam1.zoom).toFixed(0)} px radius, expected ${expectR.toFixed(0)})`);

    // The model is really drawn: pixels change when it is switched off (opacity 0).
    const drawn = async () => {
      await b.ev('window.__store.getState().setIfcOpacity(1)');
      await sleep(900);
      await b.ev(SNAP);
      await b.ev('window.__store.getState().setIfcOpacity(0)');
      await sleep(900);
      const r = await b.ev(DIFF);
      await b.ev('window.__store.getState().setIfcOpacity(1)');
      await sleep(300);
      return r;
    };
    const centre = [R.x + R.w / 2, R.y + R.h / 2];
    const dFit = await drawn();
    report(dFit.n > 400, `ifc: the model is drawn in the orthographic Front (${dFit.n} px change when it is hidden)`);
    for (let i = 0; i < 6; i++) { await wheel(b, centre, 200); await sleep(60); }
    await settle(b);
    const dOut = await drawn();
    report(dOut.n > 100, `ifc: and after zooming out (${(fit.radius * (await b.ev(CAM)).zoom).toFixed(0)} px radius, ${dOut.n} px change)`);
    // Zoom in about a point that is on the model (zoom-to-cursor keeps it under the cursor).
    const onModel = [R.x + dOut.x, R.y + dOut.y];
    for (let i = 0; i < 20; i++) { await wheel(b, onModel, -200); await sleep(60); }
    await settle(b);
    const dIn = await drawn();
    report(dIn.n > 400, `ifc: and after zooming in on it (${(fit.radius * (await b.ev(CAM)).zoom).toFixed(0)} px radius, ${dIn.n} px change)`);

    // Top view.
    await chooseView(b, 'top');
    await settle(b);
    await b.ev(FIT_IFC);
    await sleep(600);
    await settle(b);
    const cam2 = await b.ev(CAM);
    const dTop = await drawn();
    report(cam2.ortho && (await viewName(b)) === 'top' && dTop.n > 400, `ifc: the model is drawn in the orthographic Top (view "${await viewName(b)}", ${dTop.n} px change)`);
    report(b.consoleErrors.length === 0, `ifc: no errors logged${b.consoleErrors.length ? ': ' + b.consoleErrors[0] : ''}`);
  } finally {
    b.close();
  }
}

const sections = { views, ortho, gizmo, nav, field, section, dots, ifc };
try {
  for (const [name, fn] of Object.entries(sections)) {
    if (!only || only === name) await fn();
  }
} catch (e) {
  console.error('ERROR', e.message);
  failures += 1;
}
console.log(failures ? `RESULT: FAIL (${failures})` : 'RESULT: PASS');
process.exit(failures ? 1 : 0);
