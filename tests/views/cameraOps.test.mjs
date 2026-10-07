import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { switchProjection, setOrthoZoom } from '../../src/viewer/cameraOps.js';
import { ORTHO_DEPTH, PERSP_MIN_DISTANCE, PERSP_MAX_DISTANCE } from '../../src/viewer/cameraMath.js';

const W = 1600;
const H = 900;
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

function makeRig() {
  const persp = new THREE.PerspectiveCamera(45, W / H, 0.1, 1000);
  persp.position.set(6, 4, -6);
  persp.lookAt(0, 0, 0);
  persp.updateMatrixWorld(true);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -ORTHO_DEPTH, ORTHO_DEPTH);
  const ctlP = { target: new THREE.Vector3(0, 0, 0), enabled: true };
  const ctlO = { target: new THREE.Vector3(9, 9, 9), enabled: false };
  return { persp, ortho, ctlP, ctlO };
}

// A world point on the target plane (the plane through the orbit target facing the camera).
function onTargetPlane(cam, target, right, up) {
  cam.updateMatrixWorld(true);
  const r = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
  const u = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
  return target.clone().addScaledVector(r, right).addScaledVector(u, up);
}

const toOrtho = (rig) => switchProjection({
  next: 'ortho', fromCam: rig.persp, fromCtl: rig.ctlP, toCam: rig.ortho, toCtl: rig.ctlO, width: W, height: H, perspFovDeg: 45,
});
const toPersp = (rig) => switchProjection({
  next: 'persp', fromCam: rig.ortho, fromCtl: rig.ctlO, toCam: rig.persp, toCtl: rig.ctlP, width: W, height: H, perspFovDeg: 45,
});

test('perspective -> orthographic keeps the pose, the target and the frustum convention', () => {
  const rig = makeRig();
  const d = rig.persp.position.length();
  toOrtho(rig);
  assert.ok(rig.ortho.position.distanceTo(rig.persp.position) < 1e-12, 'same position');
  assert.ok(rig.ortho.quaternion.angleTo(rig.persp.quaternion) < 1e-12, 'same orientation');
  assert.ok(rig.ctlO.target.distanceTo(rig.ctlP.target) < 1e-12, 'target copied to the new controls');
  assert.equal(rig.ctlO.enabled, true);
  assert.equal(rig.ctlP.enabled, false);
  assert.ok(near(rig.ortho.left, -W / 2) && near(rig.ortho.right, W / 2) && near(rig.ortho.top, H / 2) && near(rig.ortho.bottom, -H / 2),
    'frustum = canvas size in CSS pixels, so zoom is pixels per metre');
  assert.equal(rig.ortho.near, -ORTHO_DEPTH);
  assert.equal(rig.ortho.far, ORTHO_DEPTH);
  assert.ok(near(rig.ortho.zoom, H / (2 * d * Math.tan(THREE.MathUtils.degToRad(22.5))), 1e-9), 'zoom frames the same region');
});

test('points on the target plane land on the same screen position before and after the switch', () => {
  const rig = makeRig();
  const target = rig.ctlP.target;
  const pts = [[0, 0], [2, 1], [-3, 0.5], [4, -2]].map(([r, u]) => onTargetPlane(rig.persp, target, r, u));
  const before = pts.map((p) => p.clone().project(rig.persp));
  toOrtho(rig);
  rig.ortho.updateMatrixWorld(true);
  const after = pts.map((p) => p.clone().project(rig.ortho));
  before.forEach((b, i) => {
    assert.ok(near(b.x, after[i].x, 1e-6) && near(b.y, after[i].y, 1e-6), `point ${i}: ${b.x},${b.y} vs ${after[i].x},${after[i].y}`);
  });
});

test('an orthographic camera is parallel: depth does not move a point on the screen', () => {
  const rig = makeRig();
  toOrtho(rig);
  rig.ortho.updateMatrixWorld(true);
  const fwd = new THREE.Vector3();
  rig.ortho.getWorldDirection(fwd);
  const p = onTargetPlane(rig.ortho, rig.ctlO.target, 1.5, 0.7);
  const a = p.clone().project(rig.ortho);
  const b = p.clone().addScaledVector(fwd, 7).project(rig.ortho);
  const c = p.clone().addScaledVector(fwd, -300).project(rig.ortho);
  assert.ok(near(a.x, b.x) && near(a.y, b.y) && near(a.x, c.x) && near(a.y, c.y), 'same x, y at any depth');
  // the perspective camera does move it (this is what the switch removes)
  const q = onTargetPlane(rig.persp, rig.ctlP.target, 1.5, 0.7);
  const pa = q.clone().project(rig.persp);
  const pb = q.clone().addScaledVector(fwd, 7).project(rig.persp);
  assert.ok(Math.abs(pa.x - pb.x) > 1e-3, 'perspective shifts with depth');
});

test('orthographic -> perspective restores the distance, and respects a zoom made in between', () => {
  const rig = makeRig();
  const d = rig.persp.position.length();
  toOrtho(rig);
  toPersp(rig);
  assert.ok(near(rig.persp.position.length(), d, 1e-9), 'same distance after a round trip');
  assert.equal(rig.persp.zoom, 1);
  assert.ok(near(rig.persp.aspect, W / H));
  assert.equal(rig.ctlP.enabled, true);
  assert.equal(rig.ctlO.enabled, false);

  // zoom the orthographic view 2x, then go back: the perspective camera is twice as close
  const rig2 = makeRig();
  toOrtho(rig2);
  setOrthoZoom(rig2.ortho, rig2.ortho.zoom * 2);
  toPersp(rig2);
  assert.ok(near(rig2.persp.position.length(), d / 2, 1e-9));
});

test('distances stay inside the perspective guard and never produce NaN', () => {
  const rig = makeRig();
  toOrtho(rig);
  setOrthoZoom(rig.ortho, 1e-6); // absurdly zoomed out
  toPersp(rig);
  assert.ok(near(rig.persp.position.distanceTo(rig.ctlP.target), PERSP_MAX_DISTANCE, 1e-6), 'clamped to the far guard');

  const rig2 = makeRig();
  toOrtho(rig2);
  setOrthoZoom(rig2.ortho, 1e12); // absurdly zoomed in
  toPersp(rig2);
  assert.ok(near(rig2.persp.position.distanceTo(rig2.ctlP.target), PERSP_MIN_DISTANCE, 1e-9), 'clamped to the near guard');

  // camera exactly on the target: a direction is invented instead of dividing by zero
  const rig3 = makeRig();
  rig3.persp.position.copy(rig3.ctlP.target);
  toOrtho(rig3);
  toPersp(rig3);
  for (const v of rig3.persp.position.toArray()) assert.ok(Number.isFinite(v));
});

test('setOrthoZoom updates the projection', () => {
  const rig = makeRig();
  toOrtho(rig);
  setOrthoZoom(rig.ortho, 50);
  assert.equal(rig.ortho.zoom, 50);
  // projection matrix element [0] = 2 / (width / zoom) = 2 * zoom / W
  assert.ok(near(rig.ortho.projectionMatrix.elements[0], (2 * 50) / W, 1e-12));
});
