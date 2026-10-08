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
import { sectionPlanes } from '../viewer/sectionPlanes.js';
import { gunzipBytes, fromBase64 } from './codec.js';
import { createSectionBox } from './sectionBox.js';

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
  const ghost = new THREE.MeshStandardMaterial({
    color: '#94a3b8', transparent: true, opacity: 0.25, roughness: 0.8, metalness: 0, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: sectionPlanes,
  });
  const edgeMat = new THREE.LineBasicMaterial({ color: '#475569', transparent: true, opacity: 0.85, clippingPlanes: sectionPlanes });
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
  const section = createSectionBox({ scene, canvas, viewport, field: view, bounds: box, getCamera: () => cam, getOrbit: () => ctl, dirty });

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
    section.setCamera(cam);
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
    section.update(cam, viewport.clientHeight || 800);
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
      accept: (p) => section.contains(p),
    });
    return hit ? hit.row : null;
  }
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button, onGizmo: section.gizmoBusy() }; });
  canvas.addEventListener('pointerup', (e) => {
    if (down && down.button === 0 && !down.onGizmo && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5 && performance.now() - down.t < 700) {
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
      select, goView, fitAll, switchTo, pick: pickAt, section,
    };
  }
}

main().catch((e) => { console.error(e); failScreen('Something went wrong opening the model: ' + (e && e.message ? e.message : e)); });