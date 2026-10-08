import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  FACES, AXIS_COLORS, MIN_THICK, capQuad, faceDragResult, testCutSize, boxFromBounds, pixelWorldSize,
} from '../../src/viewer/sectionBoxMath.js';
import { sectionPlanes, updateSectionPlanesBox } from '../../src/viewer/sectionPlanes.js';
import { rng } from '../barfield/helpers.mjs';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// The drag formula exactly as SectionBox.jsx had it before it moved into sectionBoxMath.js (three.js vectors).
function oldApplyDrag({ startCenter, startSize, axis, N, delta }) {
  const newSize = [...startSize];
  newSize[axis] = Math.max(0.05, startSize[axis] + delta);
  const applied = newSize[axis] - startSize[axis];
  const nc = new THREE.Vector3(...startCenter).addScaledVector(N, applied / 2);
  return { center: [nc.x, nc.y, nc.z], size: newSize };
}

test('faceDragResult is bit-for-bit the old applyDrag, for any axis, sign, rotation and delta', () => {
  const r = rng(7);
  for (let k = 0; k < 2000; k++) {
    const startCenter = [r() * 40 - 20, r() * 40 - 20, r() * 40 - 20];
    const startSize = [0.05 + r() * 10, 0.05 + r() * 10, 0.05 + r() * 10];
    const axis = Math.floor(r() * 3);
    const sign = r() < 0.5 ? -1 : 1;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 6.28, r() * 6.28, r() * 6.28));
    const N = new THREE.Vector3();
    N.setComponent(axis, sign).applyQuaternion(q);
    const delta = r() * 24 - 12; // large negatives reach the 50 mm clamp
    const want = oldApplyDrag({ startCenter, startSize, axis, N, delta });
    const got = faceDragResult({ startCenter, startSize, axis, normal: N.toArray(), delta });
    assert.deepEqual(got, want, `case ${k}`);
  }
});

test('dragging the +X face outwards widens the box and shifts the centre by half; the -X face stays', () => {
  const out = faceDragResult({ startCenter: [0, 0, 0], startSize: [2, 2, 2], axis: 0, normal: [1, 0, 0], delta: 0.5 });
  assert.deepEqual(out.size, [2.5, 2, 2]);
  assert.deepEqual(out.center, [0.25, 0, 0]);
  assert.ok(near(out.center[0] - out.size[0] / 2, -1));
  const minus = faceDragResult({ startCenter: [0, 0, 0], startSize: [2, 2, 2], axis: 0, normal: [-1, 0, 0], delta: 0.5 });
  assert.deepEqual(minus.size, [2.5, 2, 2]);
  assert.deepEqual(minus.center, [-0.25, 0, 0]);
  assert.ok(near(minus.center[0] + minus.size[0] / 2, 1));
});

test('a face cannot be dragged past 50 mm, and the opposite face still does not move', () => {
  const out = faceDragResult({ startCenter: [0, 0, 0], startSize: [2, 2, 2], axis: 0, normal: [1, 0, 0], delta: -5 });
  assert.equal(out.size[0], MIN_THICK);
  assert.ok(near(out.center[0] - out.size[0] / 2, -1));
});

test('a rotated box moves along its own face normal', () => {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2); // +X maps to -Z
  const N = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const out = faceDragResult({ startCenter: [1, 2, 3], startSize: [2, 2, 2], axis: 0, normal: N.toArray(), delta: 1 });
  assert.deepEqual(out.size, [3, 2, 2]);
  assert.ok(near(out.center[0], 1) && near(out.center[1], 2) && near(out.center[2], 2.5));
});

test('testCutSize is a third of each size, never below 50 mm', () => {
  const out = testCutSize([3, 0.6, 0.09]);
  assert.ok(near(out[0], 1) && near(out[1], 0.2) && out[2] === MIN_THICK, `got ${out}`);
});

test('boxFromBounds pads by max(0.2 m, 2 % of the largest extent) unless told otherwise', () => {
  const a = boxFromBounds([0, 0, 0], [10, 2, 4]);
  assert.deepEqual(a.center, [5, 1, 2]);
  assert.ok(a.size.every((v, i) => near(v, [10.4, 2.4, 4.4][i])));
  const small = boxFromBounds([0, 0, 0], [1, 1, 1]);
  assert.ok(small.size.every((v) => near(v, 1.4)), 'the 0.2 m floor');
  const big = boxFromBounds([0, 0, 0], [100, 10, 10]);
  assert.ok(near(big.size[0], 104) && near(big.size[1], 14), 'the 2 % rule');
  assert.deepEqual(boxFromBounds([0, 0, 0], [4, 2, 1], 0).size, [4, 2, 1]);
});

test('capQuad gives the six values SectionBox.jsx used', () => {
  const s = [2, 4, 6];
  const want = [
    { args: [6, 4], pos: [1, 0, 0], rot: [0, Math.PI / 2, 0] },
    { args: [6, 4], pos: [-1, 0, 0], rot: [0, -Math.PI / 2, 0] },
    { args: [2, 6], pos: [0, 2, 0], rot: [-Math.PI / 2, 0, 0] },
    { args: [2, 6], pos: [0, -2, 0], rot: [Math.PI / 2, 0, 0] },
    { args: [2, 4], pos: [0, 0, 3], rot: [0, 0, 0] },
    { args: [2, 4], pos: [0, 0, -3], rot: [0, Math.PI, 0] },
  ];
  want.forEach((w, i) => assert.deepEqual(capQuad(i, s), w, `plane ${i}`));
});

test('every cap quad lies on its own clipping plane (the index pairing with sectionPlanes)', () => {
  for (const quat of [[0, 0, 0, 1], new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 1.1, -0.7)).toArray()]) {
    const center = [1, 2, 3];
    const size = [2, 4, 6];
    updateSectionPlanesBox(center, size, quat);
    const q = new THREE.Quaternion().fromArray(quat);
    for (let i = 0; i < 6; i++) {
      const cq = capQuad(i, size);
      const world = new THREE.Vector3(...cq.pos).applyQuaternion(q).add(new THREE.Vector3(...center));
      assert.ok(near(sectionPlanes[i].distanceToPoint(world), 0, 1e-9), `cap ${i} is on plane ${i}`);
    }
  }
});

test('FACES and AXIS_COLORS describe the six faces and three axes', () => {
  assert.equal(FACES.length, 6);
  assert.deepEqual(FACES.map((f) => f.axis), [0, 0, 1, 1, 2, 2]);
  assert.deepEqual(FACES.map((f) => f.sign), [-1, 1, -1, 1, -1, 1]);
  assert.deepEqual(AXIS_COLORS, ['#ef4444', '#22c55e', '#3b82f6']);
});

test('pixelWorldSize: orthographic by zoom, perspective by depth and field of view', () => {
  assert.ok(near(pixelWorldSize({ ortho: true, zoom: 200 }), 0.005));
  const fov = Math.PI / 4;
  assert.ok(near(pixelWorldSize({ ortho: false, depth: 10, fovRad: fov, viewportHeightPx: 800 }), (2 * 10 * Math.tan(fov / 2)) / 800));
  assert.ok(pixelWorldSize({ ortho: false, depth: -5, fovRad: fov, viewportHeightPx: 800 }) > 0, 'behind the camera stays positive');
});