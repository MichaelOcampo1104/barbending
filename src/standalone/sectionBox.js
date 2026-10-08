// The standalone viewer's section box: the app's Revit-style box rebuilt on plain three.js (spec section 6). The state
// { enabled, mode, center, size, quat, solidCut, showBox } is in scene metres and lives for the session only. The clipping planes are
// the app's shared sectionPlanes, updated in place; the materials do the cutting (the bar field's clipped programs, the concrete
// meshes). This module owns the box, its panel and, in later parts, the face grips, the move / rotate gizmo and the solid-cut caps.
import * as THREE from 'three';
import { sectionPlanes, updateSectionPlanes, updateSectionPlanesBox, isWorldPointInSectionBox } from '../viewer/sectionPlanes.js';
import { testCutSize, boxFromBounds } from '../viewer/sectionBoxMath.js';

const BOX_COLOR = '#38bdf8';
const mm = (m) => Math.round(m * 1000).toLocaleString('en-US');
const $ = (id) => document.getElementById(id);

export function createSectionBox({ scene, field, bounds, dirty }) {
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

  apply();
  return api;
}