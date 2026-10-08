import test from 'node:test';
import assert from 'node:assert/strict';
import { buildField } from '../../src/viewer/barfield/buildField.js';
import { pickField } from '../../src/viewer/barfield/fieldPick.js';
import { straightRow } from './helpers.mjs';

// A bar pointing straight at an orthographic camera is a dot on the screen; clicking the dot must pick it.
// Three 3 m bars along app Y (scene -Z) starting at app y = 0: scene x = 0.5 / 1.5 / 2.5, height 1 m.
const alongY = () => [500, 1500, 2500].map((x) => straightRow({ Pos_x: x, Pos_y: 0, Pos_z: 1000, Pos_Rotation: 90, 'Length of Bar': 3000 }));
// Front view: the camera looks along -Z, so the ray runs exactly parallel to the bars.
const front = (x, y, z = 5) => ({ origin: [x, y, z], dir: [0, 0, -1] });
const ortho = { worldPerPixel: 0.004 }; // 250 px per metre: 6 px = 24 mm

test('an orthographic ray running exactly along a bar picks it, with the sideways offset as the distance', () => {
  const f = buildField(alongY());
  const hit = pickField(f, front(1.5, 1.0), ortho);
  assert.equal(hit.row, 1);
  assert.ok(Math.abs(hit.point[0] - 1.5) < 1e-5 && Math.abs(hit.point[1] - 1) < 1e-5, 'the point is on the bar axis');
  assert.equal(pickField(f, front(1.5 + 0.02, 1.0), ortho).row, 1, '20 mm to the side is inside 6 px');
  assert.equal(pickField(f, front(1.5 + 0.04, 1.0), ortho), null, '40 mm to the side is a miss');
  assert.equal(pickField(f, front(1.0, 1.0), ortho), null, 'between two bars');
});

test('the same holds from the back (the ray runs the other way) and when the camera sits inside the bar', () => {
  const f = buildField(alongY());
  assert.equal(pickField(f, { origin: [2.5, 1.0, -5], dir: [0, 0, 1] }, ortho).row, 2, 'back view');
  assert.equal(pickField(f, front(0.5, 1.0, -1.5), ortho).row, 0, 'camera plane in the middle of the bar');
});

test('a bar behind the camera plane is not picked, even though it is exactly in line', () => {
  const f = buildField(alongY());
  // The ray starts at z = -10, beyond the end of the bars (which span z = 0 .. -3), looking further along -Z.
  assert.equal(pickField(f, front(1.5, 1.0, -10), ortho), null);
});

test('the nearest of two end-on bars in the same line wins', () => {
  const f = buildField([
    straightRow({ Pos_x: 500, Pos_y: 0, Pos_z: 1000, Pos_Rotation: 90, 'Length of Bar': 1000 }), // z 0 .. -1 (near the front camera)
    straightRow({ Pos_x: 500, Pos_y: 2000, Pos_z: 1000, Pos_Rotation: 90, 'Length of Bar': 1000 }), // z -2 .. -3
  ]);
  assert.equal(pickField(f, front(0.5, 1.0), ortho).row, 0, 'from the front the first bar is nearer');
  assert.equal(pickField(f, { origin: [0.5, 1.0, -5], dir: [0, 0, 1] }, ortho).row, 1, 'from the back the other one is');
});
