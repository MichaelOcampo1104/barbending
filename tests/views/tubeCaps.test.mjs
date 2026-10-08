import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { capTubeGeometry } from '../../src/viewer/tubeCaps.js';

const RADIAL = 8;
const straight = (from, to, tubular = 8, radius = 0.016) => {
  const curve = new THREE.LineCurve3(new THREE.Vector3(...from), new THREE.Vector3(...to));
  return { curve, tube: new THREE.TubeGeometry(curve, tubular, radius, RADIAL, false), tubular, radius };
};

// Geometric normals of the triangles in index range [from, to) of a geometry.
function normalsOf(geo, from, to) {
  const p = geo.attributes.position, idx = geo.index.array, out = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = from; i < to; i += 3) {
    a.fromBufferAttribute(p, idx[i]); b.fromBufferAttribute(p, idx[i + 1]); c.fromBufferAttribute(p, idx[i + 2]);
    out.push(b.clone().sub(a).cross(c.clone().sub(a)).normalize());
  }
  return out;
}

test('capping adds a fan of triangles at each end, and nothing else changes', () => {
  const { curve, tube, tubular } = straight([0, 0, 0], [0, 0, -3]);
  const sideIndices = tube.index.count;
  const sideVertices = tube.attributes.position.count;
  const capped = capTubeGeometry(tube, curve, tubular, RADIAL);
  assert.equal(capped.index.count, sideIndices + 2 * RADIAL * 3, 'two fans of one triangle per radial segment');
  assert.equal(capped.attributes.position.count, sideVertices + 2 * (1 + RADIAL + 1), 'a centre and a ring copy per cap');
  assert.equal(capped.attributes.normal.count, capped.attributes.position.count);
  assert.equal(capped.attributes.uv.count, capped.attributes.position.count);
  for (const v of capped.attributes.position.array) assert.ok(Number.isFinite(v));
  // The side triangles are untouched.
  assert.deepEqual([...capped.index.array.slice(0, sideIndices)], [...tube.index.array]);
});

test('the start cap faces back along the bar and the end cap faces forward (outward-facing triangles)', () => {
  const { curve, tube, tubular } = straight([0, 0, 0], [0, 0, -3]);
  const side = tube.index.count;
  const capped = capTubeGeometry(tube, curve, tubular, RADIAL);
  const half = RADIAL * 3;
  const startNormals = normalsOf(capped, side, side + half);
  const endNormals = normalsOf(capped, side + half, side + 2 * half);
  // The bar runs along -Z, so "back along the bar" at the start is +Z and "forward" at the end is -Z.
  for (const n of startNormals) assert.ok(n.z > 0.999, `start cap normal ${n.toArray()}`);
  for (const n of endNormals) assert.ok(n.z < -0.999, `end cap normal ${n.toArray()}`);
});

test('cap vertices sit on the end planes within the tube radius, with axial shading normals', () => {
  const { curve, tube, tubular, radius } = straight([0, 0, 0], [0, 0, -3], 8, 0.02);
  const sideVertices = tube.attributes.position.count;
  const capped = capTubeGeometry(tube, curve, tubular, RADIAL);
  const p = capped.attributes.position, n = capped.attributes.normal;
  for (let i = sideVertices; i < p.count; i++) {
    const z = p.getZ(i);
    assert.ok(Math.abs(z) < 1e-9 || Math.abs(z + 3) < 1e-9, `vertex ${i} is on an end plane (z=${z})`);
    assert.ok(Math.hypot(p.getX(i), p.getY(i)) <= radius + 1e-9, `vertex ${i} is inside the radius`);
    assert.ok(Math.abs(Math.abs(n.getZ(i)) - 1) < 1e-9, 'shading normal is along the axis');
  }
});

test('a bent bar is capped along its own end tangents, whatever the direction', () => {
  const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(1, 0.5, 0)];
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.0);
  const tubular = 36;
  const tube = new THREE.TubeGeometry(curve, tubular, 0.01, RADIAL, false);
  const side = tube.index.count;
  const capped = capTubeGeometry(tube, curve, tubular, RADIAL);
  const half = RADIAL * 3;
  const t0 = curve.getTangentAt(0), t1 = curve.getTangentAt(1);
  for (const n of normalsOf(capped, side, side + half)) assert.ok(n.dot(t0) < -0.99, `start ${n.toArray()} vs tangent ${t0.toArray()}`);
  for (const n of normalsOf(capped, side + half, side + 2 * half)) assert.ok(n.dot(t1) > 0.99, `end ${n.toArray()} vs tangent ${t1.toArray()}`);
});

test('a vertical bar and a bar along X are capped correctly too', () => {
  for (const [from, to] of [[[0, 0, 0], [0, 3, 0]], [[0, 0, 0], [3, 0, 0]], [[1, 2, 3], [1, 2, 3.0 + 4]]]) {
    const { curve, tube, tubular } = straight(from, to);
    const side = tube.index.count;
    const capped = capTubeGeometry(tube, curve, tubular, RADIAL);
    const dir = new THREE.Vector3(...to).sub(new THREE.Vector3(...from)).normalize();
    for (const n of normalsOf(capped, side, side + RADIAL * 3)) assert.ok(n.dot(dir) < -0.999);
    for (const n of normalsOf(capped, side + RADIAL * 3, side + 2 * RADIAL * 3)) assert.ok(n.dot(dir) > 0.999);
  }
});
