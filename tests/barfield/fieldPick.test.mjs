import test from 'node:test';
import assert from 'node:assert/strict';
import { buildField } from '../../src/viewer/barfield/buildField.js';
import { pickField } from '../../src/viewer/barfield/fieldPick.js';
import { straightRow, spreadRows, rng } from './helpers.mjs';

// Three 2 m bars along +X at height 1 m and scene z = 0, -0.5, -1.0 (app y = 0, 500, 1000).
const threeBars = () => [0, 500, 1000].map((y) => straightRow({ Pos_x: 0, Pos_y: y, Pos_z: 1000, 'Length of Bar': 2000 }));
const down = (x, z, y = 5) => ({ origin: [x, y, z], dir: [0, -1, 0] });
const opts = { fovRad: Math.PI / 4, viewportHeightPx: 800 }; // 6 px ~ 0.025 m at 4 m

test('a ray straight down onto a bar hits that row at the right distance and point', () => {
  const f = buildField(threeBars());
  const hit = pickField(f, down(1, -0.5), opts);
  assert.equal(hit.row, 1);
  assert.ok(Math.abs(hit.distance - 4) < 1e-6);
  assert.ok(Math.abs(hit.point[0] - 1) < 1e-5 && Math.abs(hit.point[1] - 1) < 1e-5 && Math.abs(hit.point[2] + 0.5) < 1e-5);
});

test('near misses inside the pixel tolerance hit, clear misses do not', () => {
  const f = buildField(threeBars());
  assert.equal(pickField(f, down(1, 0.02), opts).row, 0, '2 cm off the bar is within 6 px at 4 m');
  assert.equal(pickField(f, down(1, 0.04), opts), null, '4 cm off is outside');
  assert.equal(pickField(f, down(1, -0.25), opts), null, 'between two bars');
  assert.equal(pickField(f, down(5, 0), opts), null, 'beside the end of the bars');
});

test('the nearest hit along the ray wins', () => {
  const f = buildField([
    straightRow({ Pos_x: 0, Pos_y: 0, Pos_z: 1000, 'Length of Bar': 2000 }), // row 0 at height 1 m
    straightRow({ Pos_x: 0, Pos_y: 0, Pos_z: 2000, 'Length of Bar': 2000 }), // row 1 at height 2 m (nearer to a camera above)
  ]);
  assert.equal(pickField(f, down(1, 0), opts).row, 1);
});

test('hidden (1) and overlay (2) rows are skipped, tinted (3) rows are pickable', () => {
  const f = buildField(threeBars());
  assert.equal(pickField(f, down(1, 0), { ...opts, rowStates: Uint8Array.from([1, 0, 0]) }), null);
  assert.equal(pickField(f, down(1, 0), { ...opts, rowStates: Uint8Array.from([2, 0, 0]) }), null);
  assert.equal(pickField(f, down(1, 0), { ...opts, rowStates: Uint8Array.from([3, 0, 0]) }).row, 0);
  assert.equal(pickField(f, down(1, -0.5), { ...opts, rowStates: Uint8Array.from([1, 0, 0]) }).row, 1, 'other rows still pick');
});

test('accept() can reject hits, for example points outside the section box', () => {
  const f = buildField(threeBars());
  assert.equal(pickField(f, down(1, 0), { ...opts, accept: () => false }), null);
  assert.equal(pickField(f, down(1.5, 0), { ...opts, accept: (p) => p[0] < 1.2 }), null);
  assert.equal(pickField(f, down(0.5, 0), { ...opts, accept: (p) => p[0] < 1.2 }).row, 0);
});

test('a ray that starts past the bars does not pick them', () => {
  const f = buildField(threeBars());
  assert.equal(pickField(f, down(1, 0, 0.5), opts), null, 'camera below the bars looking down');
});

test('a thick bar is hit by its radius even where 6 px is smaller', () => {
  const f = buildField([straightRow({ Pos_x: 0, Pos_y: 0, Pos_z: 1000, 'Length of Bar': 2000, Dia: 32 })]);
  const rowRadiusM = Float32Array.from([0.016]);
  assert.equal(pickField(f, down(1, 0.012, 1.3), { ...opts, rowRadiusM }).row, 0, '12 mm off a 16 mm-radius bar, 0.3 m away');
});

test('picking is fast on a large field (150,000 segments)', () => {
  const f = buildField(spreadRows(3000, 50, 9));
  assert.equal(f.segCount, 150000);
  const r = rng(5);
  const cx = 50, cy = 10, cz = -25;
  let total = 0;
  let worst = 0;
  const N = 100;
  for (let k = 0; k < N; k++) {
    const origin = [cx + (r() - 0.5) * 200, cy + 60 + r() * 40, cz + (r() - 0.5) * 120];
    const target = [cx + (r() - 0.5) * 80, cy, cz + (r() - 0.5) * 40];
    const d = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]];
    const len = Math.hypot(...d);
    const t0 = performance.now();
    pickField(f, { origin, dir: [d[0] / len, d[1] / len, d[2] / len] }, opts);
    const dt = performance.now() - t0;
    total += dt;
    if (dt > worst) worst = dt;
  }
  assert.ok(total / N < 8, `average ${(total / N).toFixed(2)} ms per pick is too slow`);
  assert.ok(worst < 40, `worst ${worst.toFixed(1)} ms per pick is too slow`);
});
