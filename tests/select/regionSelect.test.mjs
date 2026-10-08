import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  TOUCH_TOL_PX, boxRegion, lassoRegion, pointInPolygon, segmentTouchesRegion, clipSegmentToDepth, rowAppBox,
  selectBarsInRegion,
} from '../../src/viewer/regionSelect.js';
import { barAppBox, distOffsets, distOffsetExtents } from '../../src/bbs/shapes.js';
import { straightRow, spreadRows, rng } from '../barfield/helpers.mjs';

const W = 800;
const H = 600;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---- cameras: the matrices the viewport has, and a way to know where a scene point lands on screen ----
function makeView(camera) {
  camera.updateMatrixWorld(true);
  const m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const px = (x, y, z) => {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return [(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H];
  };
  return { viewProj: Array.from(m.elements), width: W, height: H, px };
}
// R3F's orthographic convention: the frustum is the canvas in CSS px and zoom is pixels per metre.
function orthoFront(target = [3, 1.5, 0], zoom = 80) {
  const cam = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, -2000, 2000);
  cam.zoom = zoom;
  cam.updateProjectionMatrix();
  cam.position.set(target[0], target[1], target[2] + 50); // looks along -Z, like the Front view
  cam.lookAt(target[0], target[1], target[2]);
  return makeView(cam);
}
function perspective() {
  const cam = new THREE.PerspectiveCamera(45, W / H, 0.1, 1000);
  cam.position.set(0, 1.5, 10);
  cam.lookAt(0, 1.5, 0);
  return makeView(cam);
}
const boxAround = (v, x0, up0, x1, up1) => {
  const [a, b] = v.px(x0, up0, 0);
  const [c, d] = v.px(x1, up1, 0);
  return boxRegion(a, b, c, d);
};
const pick = (bars, region, v, extra = {}) => selectBarsInRegion({ bars, region, viewProj: v.viewProj, width: v.width, height: v.height, ...extra });

// ---- the shapes themselves ----
test('point in polygon: even-odd, concave shapes, bow ties', () => {
  const square = Float64Array.of(0, 0, 10, 0, 10, 10, 0, 10);
  assert.equal(pointInPolygon(square, 5, 5), true);
  assert.equal(pointInPolygon(square, 15, 5), false);
  assert.equal(pointInPolygon(square, 5, -1), false);
  const ell = Float64Array.of(0, 0, 100, 0, 100, 40, 40, 40, 40, 100, 0, 100); // an L
  assert.equal(pointInPolygon(ell, 80, 20), true, 'the horizontal arm');
  assert.equal(pointInPolygon(ell, 20, 80), true, 'the vertical arm');
  assert.equal(pointInPolygon(ell, 80, 80), false, 'the notch is outside although it is inside the bounding box');
  const bow = Float64Array.of(0, 0, 10, 10, 10, 0, 0, 10); // crosses itself at (5, 5): a left and a right triangle
  assert.equal(pointInPolygon(bow, 1, 5), true, 'the left lobe');
  assert.equal(pointInPolygon(bow, 9, 5), true, 'the right lobe');
  assert.equal(pointInPolygon(bow, 5, 1), false, 'the wedge below the crossing is outside');
  assert.equal(pointInPolygon(bow, 5, 9), false, 'and so is the wedge above it');
});

test('a box region is normalised whichever corner you start from', () => {
  const a = boxRegion(200, 150, 100, 50);
  assert.deepEqual(a.bbox, [100, 50, 200, 150]);
  assert.equal(pointInPolygon(a.poly, 150, 100), true);
});

test('a segment touches a region when it is inside, crosses it, or passes within the tolerance', () => {
  const r = boxRegion(100, 100, 200, 200);
  assert.equal(segmentTouchesRegion(r, 120, 120, 180, 150), true, 'inside');
  assert.equal(segmentTouchesRegion(r, 50, 150, 250, 150), true, 'passes straight through, both ends outside');
  assert.equal(segmentTouchesRegion(r, 210, 100, 300, 100), false, 'outside');
  assert.equal(segmentTouchesRegion(r, 0, 0, 90, 90), false, 'a diagonal that stops short of the corner');
  assert.equal(segmentTouchesRegion(r, 50, 98.5, 250, 98.5), true, '1.5 px above the top edge is within the tolerance');
  assert.equal(segmentTouchesRegion(r, 50, 96, 250, 96), false, '4 px above is not');
  assert.equal(segmentTouchesRegion(r, 150, 150, 150, 150), true, 'a point (an end-on bar) inside');
  assert.equal(segmentTouchesRegion(r, 230, 150, 230, 150), false, 'a point outside');
  assert.equal(segmentTouchesRegion(r, 50, 96, 250, 96, 5), true, 'the tolerance is a parameter');
  assert.ok(TOUCH_TOL_PX >= 1 && TOUCH_TOL_PX <= 4);
});

test('a lasso follows its outline, not its bounding box', () => {
  const lasso = lassoRegion([[0, 0], [100, 0], [100, 40], [40, 40], [40, 100], [0, 100]]);
  assert.ok(lasso);
  assert.equal(segmentTouchesRegion(lasso, 20, 80, 20, 80, 0), true);
  assert.equal(segmentTouchesRegion(lasso, 80, 80, 80, 80, 0), false, 'a point in the notch');
  assert.equal(segmentTouchesRegion(lasso, 60, 60, 120, 60, 0), false, 'a line that runs through the notch only');
  assert.equal(segmentTouchesRegion(lasso, 20, 120, 20, 60, 0), true, 'a line that runs into the vertical arm');
});

test('lassos are simplified without changing their shape, and degenerate ones are refused', () => {
  // A circle drawn with 400 points collapses to a few dozen vertices.
  const pts = [];
  for (let i = 0; i < 400; i++) pts.push([200 + 100 * Math.cos((i / 400) * 2 * Math.PI), 200 + 100 * Math.sin((i / 400) * 2 * Math.PI)]);
  const circle = lassoRegion(pts);
  assert.ok(circle.poly.length / 2 < 100, `${circle.poly.length / 2} vertices`);
  assert.equal(pointInPolygon(circle.poly, 200, 200), true);
  assert.equal(pointInPolygon(circle.poly, 200 + 99, 200), true);
  assert.equal(pointInPolygon(circle.poly, 200 + 104, 200), false);
  assert.equal(lassoRegion([[10, 10], [11, 11]]), null, 'two points');
  assert.equal(lassoRegion([[10, 10], [10, 10], [10, 11], [11, 11]]), null, 'a path shorter than a few pixels');
  assert.equal(lassoRegion([]), null);
});

test('clipping to the depth range: both in, one behind the camera, both behind, beyond the far plane', () => {
  assert.deepEqual(clipSegmentToDepth([0, 0, 0, 1], [0, 0, 0.5, 1]), [0, 1]);
  const beyond = clipSegmentToDepth([0, 0, 0, 1], [0, 0, 3, 1]); // z reaches w = 1 a third of the way
  assert.ok(near(beyond[0], 0) && near(beyond[1], 1 / 3));
  assert.equal(clipSegmentToDepth([0, 0, -3, 1], [0, 0, -2, 1]), null, 'both in front of the near plane');
  const behind = clipSegmentToDepth([0, 0, 0, 1], [0, 0, 0, -1]); // w turns negative: behind the camera
  assert.ok(behind && behind[1] < 1 && behind[1] > 0, 'the part in front is kept');
  assert.equal(clipSegmentToDepth([0, 0, 0, -1], [0, 0, 0, -2]), null, 'both behind');
});

// ---- which rows a region selects (an orthographic Front view: x right, scene up = app Z, depth = app Y) ----
const rows = {
  H1: straightRow({ Bar_mark: 'H1', Pos_x: 0, Pos_y: 0, Pos_z: 1000, 'Length of Bar': 3000 }), // horizontal line at 1.0 m
  H2: straightRow({ Bar_mark: 'H2', Pos_x: 0, Pos_y: 0, Pos_z: 2000, 'Length of Bar': 3000 }), // horizontal line at 2.0 m
  SET: straightRow({ Bar_mark: 'SET', Pos_x: 0, Pos_y: 0, Pos_z: 2400, 'Length of Bar': 3000, qty_z: 4, spacing_z: 250 }), // 2.4 / 2.65 / 2.9 / 3.15 m
  DIAG: straightRow({ Bar_mark: 'DIAG', Plane: 'XZ', Pos_Rotation: 45, Pos_x: 3500, Pos_y: 0, Pos_z: 0, 'Length of Bar': 2000 }), // (3.5, 0) up to (4.91, 1.41)
  EA: straightRow({ Bar_mark: 'EA', Pos_Rotation: 90, Pos_x: 6000, Pos_y: 0, Pos_z: 600, 'Length of Bar': 3000 }), // along app Y: a dot
  EB: straightRow({ Bar_mark: 'EB', Pos_Rotation: 90, Pos_x: 6500, Pos_y: 0, Pos_z: 1500, 'Length of Bar': 3000 }),
  EC: straightRow({ Bar_mark: 'EC', Pos_Rotation: 90, Pos_x: 7000, Pos_y: 0, Pos_z: 1500, 'Length of Bar': 3000 }),
};
const bars = Object.values(rows);
const IDX = Object.fromEntries(Object.keys(rows).map((k, i) => [k, i]));

test('a box over one bar selects that row and nothing else', () => {
  const v = orthoFront();
  assert.deepEqual(pick(bars, boxAround(v, 1.4, 0.9, 1.6, 1.1), v), [IDX.H1]);
  assert.deepEqual(pick(bars, boxAround(v, 1.0, 0.9, 2.0, 2.1), v), [IDX.H1, IDX.H2], 'a taller box takes both lines');
});

test('exact rule: a box in the gap between the copies of a set selects nothing, a box on one copy selects the set', () => {
  const v = orthoFront();
  // The set spans 2.4 .. 3.15 m, so its bounding box covers the gap; its bars do not.
  assert.deepEqual(pick(bars, boxAround(v, 1.0, 2.5, 2.0, 2.58), v), []);
  assert.deepEqual(pick(bars, boxAround(v, 1.0, 2.88, 2.0, 2.92), v), [IDX.SET]);
  assert.deepEqual(pick(bars, boxAround(v, 1.0, 3.12, 2.0, 3.18), v), [IDX.SET], 'the last copy counts too');
});

test('exact rule: a box in the empty corner of a diagonal bar selects nothing, one across it selects it', () => {
  const v = orthoFront();
  assert.deepEqual(pick(bars, boxAround(v, 4.5, 0.05, 4.8, 0.35), v), []);
  assert.deepEqual(pick(bars, boxAround(v, 4.1, 0.6, 4.3, 0.8), v), [IDX.DIAG]);
});

test('bars pointing at the camera are dots: a region around the point selects them, one beside it does not', () => {
  const v = orthoFront();
  const [ex, ey] = v.px(6.0, 0.6, 0);
  assert.deepEqual(pick(bars, boxRegion(ex - 10, ey - 10, ex + 10, ey + 10), v), [IDX.EA]);
  assert.deepEqual(pick(bars, boxRegion(ex + 30, ey - 10, ex + 50, ey + 10), v), []);
  assert.deepEqual(pick(bars, boxRegion(ex + 1.5, ey - 10, ex + 20, ey + 10), v), [IDX.EA], 'its edge 1.5 px from the dot still counts');
  assert.deepEqual(pick(bars, boxRegion(ex + 5, ey - 10, ex + 20, ey + 10), v), [], 'but 5 px away does not');
});

test('a concave lasso leaves out a dot in its notch although the notch is inside its bounding box', () => {
  const v = orthoFront();
  // A U: a body below 1.0 m with two arms above it and a notch (6.3 .. 6.7 m wide, 1.0 .. 1.8 m high) between them.
  const world = [[5.8, 0.2], [7.2, 0.2], [7.2, 1.8], [6.7, 1.8], [6.7, 1.0], [6.3, 1.0], [6.3, 1.8], [5.8, 1.8]];
  const lasso = lassoRegion(world.map(([x, up]) => v.px(x, up, 0)));
  assert.deepEqual(pick(bars, lasso, v), [IDX.EA, IDX.EC], 'EA in the body, EC in the right arm, EB (6.5, 1.5) in the notch is out');
});

test('hidden bars, bars of hidden members and bars inside hidden members are not selected', () => {
  const v = orthoFront();
  const all = boxRegion(0, 0, W, H);
  const base = pick(bars, all, v);
  assert.deepEqual(base, bars.map((_, i) => i), 'the whole view takes every row');
  const hiddenBar = bars.map((b, i) => (i === IDX.H2 ? { ...b, hidden: true } : b));
  assert.ok(!pick(hiddenBar, all, v).includes(IDX.H2));
  const member = { id: 'c1', visible: false, x: 0, y: -500, z: 800, lx: 3500, ly: 1000, lz: 400 }; // around H1 (z = 1000)
  const hosted = bars.map((b, i) => (i === IDX.DIAG ? { ...b, host: 'c1' } : b));
  const picked = pick(hosted, all, v, { concretes: [member] });
  assert.ok(!picked.includes(IDX.H1), 'H1 lies inside the hidden member');
  assert.ok(!picked.includes(IDX.DIAG), 'DIAG belongs to the hidden member');
  assert.ok(picked.includes(IDX.H2) && picked.includes(IDX.SET), 'the others stay');
  const shown = pick(hosted, all, v, { concretes: [{ ...member, visible: true }] });
  assert.deepEqual(shown, base, 'a visible member hides nothing');
});

test('perspective: bars behind the camera are never selected, a bar crossing the near plane is selected by the part in front', () => {
  const v = perspective();
  const front = straightRow({ Pos_x: 500, Pos_y: 0, Pos_z: 1500, Pos_Rotation: 90, 'Length of Bar': 3000 }); // z 0 .. -3: in front
  const behind = straightRow({ Pos_x: 500, Pos_y: -20000, Pos_z: 1500, Pos_Rotation: 90, 'Length of Bar': 3000 }); // z 20 .. 17: behind the camera at z = 10
  const crossing = straightRow({ Pos_x: -500, Pos_y: -12000, Pos_z: 1500, Pos_Rotation: 90, 'Length of Bar': 5000 }); // z 12 .. 7
  const list = [front, behind, crossing];
  const around = ([x, y], r = 8) => boxRegion(x - r, y - r, x + r, y + r);
  assert.deepEqual(pick(list, around(v.px(0.5, 1.5, 0)), v), [0], 'the near end of the bar in front');
  // Where a naive projection puts the far end of the bar behind the camera: mirrored through the screen centre.
  assert.deepEqual(pick(list, around(v.px(0.5, 1.5, 17)), v), [], 'nothing is drawn there');
  assert.deepEqual(pick(list, around(v.px(-0.5, 1.5, 7)), v), [2], 'the end of the crossing bar that is in front of the camera');
  assert.deepEqual(pick(list, around(v.px(-0.5, 1.5, 12)), v), [], 'the end behind the camera is not a place on screen');
});

test('the extents of a distribution grid are computed without building it, and the row box matches barAppBox', () => {
  const r = rng(7);
  const planes = ['XY', 'XZ', 'YZ'];
  for (let i = 0; i < 300; i++) {
    const row = straightRow({
      Plane: planes[i % 3], Pos_Rotation: [0, 30, 90, 270][i % 4], plan_rotation: [0, 0, 45][i % 3],
      qty: 1 + Math.floor(r() * 3), qty_x: 1 + Math.floor(r() * 4), qty_y: 1 + Math.floor(r() * 4), qty_z: 1 + Math.floor(r() * 3),
      spacing_x: Math.round((r() - 0.5) * 400), spacing_y: Math.round((r() - 0.5) * 400), spacing_z: Math.round((r() - 0.5) * 400),
      offset_x: Math.round((r() - 0.5) * 300), offset_y: Math.round((r() - 0.5) * 300), offset_z: Math.round((r() - 0.5) * 300),
    });
    const offs = distOffsets(row);
    const want = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
    for (const [x, y, z] of offs) {
      want.minX = Math.min(want.minX, x); want.maxX = Math.max(want.maxX, x);
      want.minY = Math.min(want.minY, y); want.maxY = Math.max(want.maxY, y);
      want.minZ = Math.min(want.minZ, z); want.maxZ = Math.max(want.maxZ, z);
    }
    assert.deepEqual(distOffsetExtents(row), want, `row ${i}`);
    const a = barAppBox(row);
    const b = rowAppBox(row);
    assert.ok(near(b[0], a.minX) && near(b[1], a.minY) && near(b[2], a.minZ) && near(b[3], a.maxX) && near(b[4], a.maxY) && near(b[5], a.maxZ), `row ${i}`);
  }
});

test('results are sorted and unique, empty input and a missing region are fine', () => {
  const v = orthoFront();
  assert.deepEqual(pick([], boxRegion(0, 0, W, H), v), []);
  assert.deepEqual(pick(bars, null, v), []);
  const r = pick(bars, boxRegion(0, 0, W, H), v);
  assert.deepEqual(r, [...new Set(r)].sort((a, b) => a - b));
});

test('a row replaced in the store is measured again, not served from the old geometry', () => {
  const v = orthoFront();
  const list = [rows.H1];
  const region = boxAround(v, 1.4, 0.9, 1.6, 1.1);
  assert.deepEqual(pick(list, region, v), [0]);
  const moved = [{ ...rows.H1, Pos_z: 3000 }]; // a new row object, 2 m higher
  assert.deepEqual(pick(moved, region, v), []);
  assert.deepEqual(pick(moved, boxAround(v, 1.4, 2.9, 1.6, 3.1), v), [0]);
});

test('performance: 25,000 rows x 40 copies', () => {
  const big = spreadRows(25000, 40);
  const cam = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, -2000, 2000);
  cam.zoom = 8; // 100 m across 800 px
  cam.updateProjectionMatrix();
  cam.position.set(50, 100, -25);
  cam.up.set(0, 0, -1);
  cam.lookAt(50, 0, -25); // a Top view of the 100 x 50 m footprint
  const v = makeView(cam);
  const time = (region) => { const t0 = performance.now(); const n = pick(big, region, v).length; return { n, ms: performance.now() - t0 }; };
  const smallCold = time(boxRegion(390, 290, 410, 310));
  const smallWarm = time(boxRegion(390, 290, 410, 310));
  const whole = time(boxRegion(0, 0, W, H));
  const lasso = time(lassoRegion([[100, 100], [700, 120], [650, 500], [120, 480], [100, 100]]));
  console.log(`      select, 25,000 rows: small box ${smallCold.ms.toFixed(0)} ms cold / ${smallWarm.ms.toFixed(0)} ms warm (${smallWarm.n} rows), whole view ${whole.ms.toFixed(0)} ms (${whole.n} rows), big lasso ${lasso.ms.toFixed(0)} ms (${lasso.n} rows)`);
  assert.equal(smallCold.n, smallWarm.n);
  assert.ok(whole.n > 20000, `${whole.n} rows in the whole view`);
  assert.ok(smallCold.ms < 4000 && smallWarm.ms < 1500 && whole.ms < 4000 && lasso.ms < 4000, 'generous bounds: this runs on a busy machine');
});
