// The standalone viewer's section box: the app's Revit-style box rebuilt on plain three.js (spec section 6). The state
// { enabled, mode, center, size, quat, solidCut, showBox } is in scene metres and lives for the session only. The clipping planes are
// the app's shared sectionPlanes, updated in place; the materials do the cutting (the bar field's clipped programs, the concrete
// meshes). This module owns the box, its panel and, in later parts, the face grips, the move / rotate gizmo and the solid-cut caps.
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import {
  sectionPlanes, updateSectionPlanes, updateSectionPlanesBox, closestAxisParam, isWorldPointInSectionBox,
} from '../viewer/sectionPlanes.js';
import { stencilMats, capMaterial } from '../viewer/stencilMats.js';
import { FACES, AXIS_COLORS, capQuad, faceDragResult, testCutSize, boxFromBounds, pixelWorldSize } from '../viewer/sectionBoxMath.js';

const BOX_COLOR = '#38bdf8';
const mm = (m) => Math.round(m * 1000).toLocaleString('en-US');
const $ = (id) => document.getElementById(id);

export function createSectionBox({ scene, canvas, viewport, concreteGroup, concreteGeoms, field, bounds, getCamera, getOrbit, dirty }) {
  const state = { enabled: false, mode: 'faces', center: [0, 0, 0], size: [1, 1, 1], quat: [0, 0, 0, 1], solidCut: true, showBox: true };
  let boxReady = false; // false until the first box has been made from the model bounds
  const parts = []; // what the other parts of the box (grips, gizmo, caps) do when the state changes: (live) => void

  // ---- the box: a translucent volume with edges, in a group that carries its position and rotation ----
  const boxGroup = new THREE.Group();
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const volume = new THREE.Mesh(unit, new THREE.MeshBasicMaterial({ color: BOX_COLOR, transparent: true, opacity: 0.05, depthWrite: false }));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(unit), new THREE.LineBasicMaterial({ color: BOX_COLOR }));
  boxGroup.add(volume, edges);
  scene.add(boxGroup);

  // ---- face grips (Faces mode): constant size on screen, a pick area twice the visible size, an axis-coloured leader ----
  const GRIP_PX = 14; // the visible grip cube, in screen pixels
  const HIT_PX = 28; // its pick area
  const LEADER_PX = 36; // from the face to the grip centre
  const gripGroup = new THREE.Group();
  boxGroup.add(gripGroup);
  const grips = FACES.map((f) => {
    const dir = new THREE.Vector3();
    dir.setComponent(f.axis, f.sign);
    const color = AXIS_COLORS[f.axis];
    const root = new THREE.Group(); // at the face centre, scaled so that one unit is one screen pixel (see update())
    const leaderDims = [2.5, 2.5, 2.5];
    leaderDims[f.axis] = LEADER_PX;
    const leader = new THREE.Mesh(new THREE.BoxGeometry(...leaderDims), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthWrite: false }));
    leader.position.copy(dir).multiplyScalar(LEADER_PX / 2);
    // drawn on top (depthTest off, gizmo style) so a cap or the concrete never hides it
    const core = new THREE.Mesh(new THREE.BoxGeometry(GRIP_PX, GRIP_PX, GRIP_PX), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false }));
    core.position.copy(dir).multiplyScalar(LEADER_PX);
    core.renderOrder = 999;
    const hit = new THREE.Mesh(new THREE.BoxGeometry(HIT_PX, HIT_PX, HIT_PX)); // never drawn, only ray-tested (a Raycaster ignores `visible`)
    hit.position.copy(core.position);
    hit.visible = false;
    root.add(leader, core, hit);
    gripGroup.add(root);
    return { root, core, hit };
  });
  parts.push((live) => {
    gripGroup.visible = live && state.mode === 'faces';
    grips.forEach((g, k) => {
      g.root.position.set(0, 0, 0);
      g.root.position.setComponent(FACES[k].axis, (FACES[k].sign * state.size[FACES[k].axis]) / 2);
    });
  });

  // Per rendered frame: scale every grip so it covers the same number of pixels whatever the zoom or the distance.
  const toGrip = new THREE.Vector3();
  const viewDir = new THREE.Vector3();
  function update(cam, viewportHeightPx) {
    if (!gripGroup.visible) return;
    const ortho = !!cam.isOrthographicCamera;
    cam.getWorldDirection(viewDir);
    boxGroup.updateMatrixWorld(true);
    for (const g of grips) {
      const depth = toGrip.setFromMatrixPosition(g.root.matrixWorld).sub(cam.position).dot(viewDir);
      g.root.scale.setScalar(pixelWorldSize({ ortho, zoom: cam.zoom, depth, fovRad: ortho ? 0 : (cam.fov * Math.PI) / 180, viewportHeightPx }));
    }
  }

  // Dragging a grip. A press on a grip is caught on the viewport in the capture phase, so the orbit controls and the bar picker never see it;
  // the pointer is captured, the orbit is switched off, and the size follows the pointer along the face normal (the app's maths, shared).
  const caster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const aim = (e) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    caster.setFromCamera(ndc, getCamera());
    return caster.ray;
  };
  function gripAt(e) {
    if (!gripGroup.visible) return -1;
    aim(e);
    boxGroup.updateMatrixWorld(true);
    const hits = caster.intersectObjects(grips.map((g) => g.hit), false);
    return hits.length ? grips.findIndex((g) => g.hit === hits[0].object) : -1;
  }
  let drag = null;
  function onDragMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const ray = aim(e);
    const delta = closestAxisParam(ray.origin, ray.direction, drag.A0, drag.N) - drag.t0;
    const next = faceDragResult({ startCenter: drag.startCenter, startSize: drag.startSize, axis: drag.axis, normal: drag.N.toArray(), delta });
    state.center = next.center;
    state.size = next.size;
    apply();
  }
  function stopDrag() {
    if (!drag) return;
    const { id } = drag;
    drag = null;
    canvas.removeEventListener('pointermove', onDragMove);
    canvas.removeEventListener('pointerup', stopDrag);
    canvas.removeEventListener('pointercancel', stopDrag);
    try { canvas.releasePointerCapture(id); } catch { /* it was never captured */ }
    const orbit = getOrbit();
    if (orbit) orbit.enabled = true;
    canvas.style.cursor = '';
  }
  viewport.addEventListener('pointerdown', (e) => {
    if (e.target !== canvas || e.button !== 0 || drag) return;
    const k = gripAt(e);
    if (k < 0) return;
    e.stopPropagation();
    e.preventDefault();
    const f = FACES[k];
    const N = new THREE.Vector3();
    N.setComponent(f.axis, f.sign).applyQuaternion(new THREE.Quaternion().fromArray(state.quat));
    const A0 = new THREE.Vector3().fromArray(state.center).addScaledVector(N, state.size[f.axis] / 2);
    const ray = aim(e);
    drag = { id: e.pointerId, axis: f.axis, N, A0, t0: closestAxisParam(ray.origin, ray.direction, A0, N), startCenter: [...state.center], startSize: [...state.size] };
    const orbit = getOrbit();
    if (orbit) orbit.enabled = false;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer cannot be captured: its events still reach the canvas */ }
    canvas.style.cursor = 'grabbing';
    canvas.addEventListener('pointermove', onDragMove);
    canvas.addEventListener('pointerup', stopDrag);
    canvas.addEventListener('pointercancel', stopDrag);
  }, true);
  window.addEventListener('blur', stopDrag); // never leave the orbit off (alt-tab in the middle of a drag)
  canvas.addEventListener('pointermove', (e) => {
    if (!drag && e.pointerType !== 'touch') canvas.style.cursor = gripAt(e) >= 0 ? 'grab' : '';
  });

  // ---- Move and Rotate: three's TransformControls on the box group (the app uses the same gizmo through drei) ----
  const gizmo = new TransformControls(getCamera(), canvas);
  gizmo.size = 0.85; // as in the app
  gizmo.enabled = false;
  scene.add(gizmo.getHelper());
  gizmo.addEventListener('change', dirty);
  gizmo.addEventListener('dragging-changed', (e) => { const orbit = getOrbit(); if (orbit) orbit.enabled = !e.value; });
  gizmo.addEventListener('objectChange', () => { // the gizmo moved or turned the group: the state, the planes and the panel follow
    state.center = boxGroup.position.toArray();
    state.quat = boxGroup.quaternion.toArray();
    apply();
  });
  parts.push((live) => {
    const on = live && state.mode !== 'faces';
    gizmo.enabled = on;
    if (on) {
      gizmo.setMode(state.mode);
      if (gizmo.object !== boxGroup) gizmo.attach(boxGroup);
    } else if (gizmo.object) {
      gizmo.detach();
    }
  });

  // ---- Solid cut: the cut faces of the concrete are filled (the app's stencil technique and render order). For each plane i and each
  // concrete mesh, back faces increment and front faces decrement the stencil where plane i clips the mesh (render orders 3i, 3i + 1);
  // then a cap quad on the box face draws where the stencil is not zero (3i + 2) and clears the stencil. Rebar is not capped. The marks
  // are children of the concrete group, so hiding the concrete hides them; the caps belong to the box, so they hide with 👁 Box. ----
  const capGroup = new THREE.Group();
  boxGroup.add(capGroup);
  const caps = [0, 1, 2, 3, 4, 5].map((i) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), capMaterial(i));
    mesh.renderOrder = 3 * i + 2;
    mesh.onAfterRender = (renderer) => renderer.clearStencil(); // without it the caps of one face accumulate into the next
    capGroup.add(mesh);
    return mesh;
  });
  const markGroups = concreteGeoms.map((geom) => {
    const g = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const back = new THREE.Mesh(geom, stencilMats[i].back);
      back.renderOrder = 3 * i;
      const front = new THREE.Mesh(geom, stencilMats[i].front);
      front.renderOrder = 3 * i + 1;
      g.add(back, front);
    }
    g.visible = false;
    concreteGroup.add(g);
    return g;
  });
  parts.push((live) => {
    capGroup.visible = live && state.solidCut;
    caps.forEach((mesh, i) => {
      const q = capQuad(i, state.size);
      mesh.position.set(q.pos[0], q.pos[1], q.pos[2]);
      mesh.rotation.set(q.rot[0], q.rot[1], q.rot[2]);
      mesh.scale.set(q.args[0], q.args[1], 1);
    });
    for (const g of markGroups) g.visible = state.enabled && state.solidCut;
  });

  function syncPanel() {
    $('sec-panel').hidden = !state.enabled;
    $('section').classList.toggle('on', state.enabled);
    for (const btn of $('sec-mode').children) btn.classList.toggle('on', btn.dataset.mode === state.mode);
    $('sec-solid').classList.toggle('on', state.solidCut);
    $('sec-show').classList.toggle('on', state.showBox);
    $('sec-size').textContent = `${mm(state.size[0])} × ${mm(state.size[1])} × ${mm(state.size[2])} mm`;
  }

  // Everything that depends on the state: the planes, the bar programs, the box, the parts, the panel.
  function apply() {
    if (state.enabled) updateSectionPlanesBox(state.center, state.size, state.quat);
    else updateSectionPlanes(null, null);
    field.setClipping(state.enabled);
    boxGroup.position.fromArray(state.center);
    boxGroup.quaternion.fromArray(state.quat);
    volume.scale.fromArray(state.size);
    edges.scale.fromArray(state.size);
    const live = state.enabled && state.showBox; // a hidden box keeps cutting but shows nothing and offers no handles
    boxGroup.visible = live;
    for (const part of parts) part(live);
    syncPanel();
    dirty();
  }

  function ensureBox() {
    if (boxReady) return;
    const b = boxFromBounds(bounds.min.toArray(), bounds.max.toArray());
    state.center = b.center;
    state.size = b.size;
    state.quat = [0, 0, 0, 1];
    boxReady = true;
  }

  const api = {
    state,
    planes: sectionPlanes,
    boxGroup,
    // A partial state change (the panel's buttons and the test hooks); the first time Section is on it gets the default box.
    set(patch) {
      if (patch.enabled) ensureBox();
      Object.assign(state, patch);
      if (patch.center || patch.size) boxReady = true;
      apply();
    },
    toggle() { api.set({ enabled: !state.enabled }); },
    fitBox() { boxReady = false; api.set({ enabled: true }); },
    testCut() { ensureBox(); api.set({ enabled: true, size: testCutSize(state.size) }); },
    // True when a scene point (metres) survives the cut: the picker ignores hits outside the box.
    contains: (p) => !state.enabled || isWorldPointInSectionBox(p, state),
  };

  $('section').addEventListener('click', () => api.toggle());
  $('sec-mode').addEventListener('click', (e) => { const m = e.target.dataset && e.target.dataset.mode; if (m) api.set({ mode: m }); });
  $('sec-fit').addEventListener('click', () => api.fitBox());
  $('sec-test').addEventListener('click', () => api.testCut());
  $('sec-solid').addEventListener('click', () => api.set({ solidCut: !state.solidCut }));
  $('sec-show').addEventListener('click', () => api.set({ showBox: !state.showBox }));

  api.gripGroup = gripGroup;
  api.grips = grips;
  api.gripWorld = (k) => { boxGroup.updateMatrixWorld(true); return grips[k].core.getWorldPosition(new THREE.Vector3()).toArray(); };
  api.update = update;
  api.gizmo = gizmo;
  api.gizmoBusy = () => gizmo.enabled && (gizmo.axis !== null || gizmo.dragging);
  api.setCamera = (cam) => { if (gizmo.camera !== cam) gizmo.camera = cam; };

  apply();
  return api;
}