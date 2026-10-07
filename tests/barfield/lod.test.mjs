import test from 'node:test';
import assert from 'node:assert/strict';
import { apparentPx, chooseTubeChunks, TRIS_PER_SEGMENT, ON_PX, OFF_PX } from '../../src/viewer/barfield/lod.js';

const fov = (45 * Math.PI) / 180;
const chunk = (cx, count = 1000, maxRadiusM = 0.008) => ({ center: [cx, 0, 0], radius: 1, count, maxRadiusM });
const base = { fovRad: fov, viewportHeightPx: 800, budgetTris: 5e6, cameraPos: [0, 0, 0] };

test('constants match the spec', () => {
  assert.equal(TRIS_PER_SEGMENT, 12);
  assert.equal(ON_PX, 3);
  assert.equal(OFF_PX, 2);
});

test('apparent width: 15.45 px for an 8 mm bar at 1 m, shrinking with distance, growing with radius', () => {
  assert.ok(Math.abs(apparentPx(0.008, 1, fov, 800) - 15.45) < 0.05);
  assert.ok(apparentPx(0.008, 1, fov, 800) > apparentPx(0.008, 10, fov, 800));
  assert.ok(Math.abs(apparentPx(0.016, 5, fov, 800) - 2 * apparentPx(0.008, 5, fov, 800)) < 1e-9);
});

test('a chunk whose bars are at least 3 px wide draws as tubes, thinner stays lines', () => {
  // px = 15.45 / d for an 8 mm bar: d = 4 -> 3.9 px (tube), d = 6 -> 2.6 px (line)
  const set = chooseTubeChunks({ ...base, chunks: [chunk(4), chunk(6)] });
  assert.deepEqual([...set], [0]);
});

test('hysteresis: a chunk already drawn as tubes stays until it drops below 2 px', () => {
  const chunks = [chunk(6)]; // 2.6 px: between the thresholds
  assert.equal(chooseTubeChunks({ ...base, chunks }).size, 0, 'not promoted from lines');
  assert.equal(chooseTubeChunks({ ...base, chunks, prevTubes: new Set([0]) }).size, 1, 'kept once promoted');
  assert.equal(chooseTubeChunks({ ...base, chunks: [chunk(9)], prevTubes: new Set([0]) }).size, 0, '1.7 px drops back to lines');
});

test('closest chunks are promoted first and the triangle budget is respected', () => {
  const chunks = [chunk(3), chunk(1), chunk(2)]; // 1000 segments each = 12,000 triangles
  const set = chooseTubeChunks({ ...base, chunks, budgetTris: 25000 });
  assert.deepEqual([...set].sort(), [1, 2], 'the two closest fit, the farthest does not');
});

test('the closest chunk is always promoted even when it alone exceeds the budget', () => {
  const set = chooseTubeChunks({ ...base, chunks: [chunk(1, 100000)], budgetTris: 1000 });
  assert.deepEqual([...set], [0]);
});

test('detail overrides: lines never draws tubes, tubes always does (ignoring budget and distance)', () => {
  const chunks = [chunk(1), chunk(500), chunk(900)];
  assert.equal(chooseTubeChunks({ ...base, chunks, detail: 'lines' }).size, 0);
  assert.equal(chooseTubeChunks({ ...base, chunks, detail: 'tubes', budgetTris: 1 }).size, 3);
});

test('isVisible filters chunks outside the view before the budget is spent', () => {
  const chunks = [chunk(1), chunk(2), chunk(3)];
  const set = chooseTubeChunks({ ...base, chunks, budgetTris: 25000, isVisible: (i) => i !== 0 });
  assert.deepEqual([...set].sort(), [1, 2]);
});

test('an empty chunk list gives an empty set', () => {
  assert.equal(chooseTubeChunks({ ...base, chunks: [] }).size, 0);
});
