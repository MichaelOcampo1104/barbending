import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VIEW_OFFSETS, AXIS_VIEWS, isAxisView, viewFromForward, orthoZoomForPerspective, perspectiveDistanceForOrtho,
  clampOrthoZoom, zoomFactorForStep, zoomAboutCursorShift, fitZoomForBox, boxHalfExtentsAlong, viewMetrics,
  MIN_VISIBLE_M, MAX_VISIBLE_M,
} from '../../src/viewer/cameraMath.js';

const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const neg = (v) => v.map((x) => -x);

test('preset offsets are unit vectors and the six axis views are exactly the axes', () => {
  for (const [name, v] of Object.entries(VIEW_OFFSETS)) {
    assert.ok(near(Math.hypot(...v), 1), `${name} is a unit vector`);
  }
  assert.deepEqual(VIEW_OFFSETS.top, [0, 1, 0]);
  assert.deepEqual(VIEW_OFFSETS.bottom, [0, -1, 0]);
  assert.deepEqual(VIEW_OFFSETS.front, [0, 0, 1]);
  assert.deepEqual(VIEW_OFFSETS.back, [0, 0, -1]);
  assert.deepEqual(VIEW_OFFSETS.right, [1, 0, 0]);
  assert.deepEqual(VIEW_OFFSETS.left, [-1, 0, 0]);
  assert.deepEqual([...AXIS_VIEWS].sort(), ['back', 'bottom', 'front', 'left', 'right', 'top']);
  assert.equal(isAxisView('front'), true);
  assert.equal(isAxisView('iso'), false);
  assert.equal(isAxisView('free'), false);
});

test('a camera looking exactly along an axis is named after that view', () => {
  for (const name of [...AXIS_VIEWS, 'iso']) {
    assert.equal(viewFromForward(neg(VIEW_OFFSETS[name])), name, name);
  }
});

test('view naming tolerates tiny skews and unnormalised vectors, but not real tilts', () => {
  assert.equal(viewFromForward([0, -1, 0.001]), 'top', '0.06 degrees off is still top');
  assert.equal(viewFromForward([0, 0, -50]), 'front', 'length does not matter');
  assert.equal(viewFromForward([0, -1, 0.02]), 'free', '1.1 degrees off is a free view');
  assert.equal(viewFromForward([-0.3, -0.5, -0.8]), 'free');
  assert.equal(viewFromForward([0, 0, 0]), 'free', 'degenerate input');
});

test('orthographic zoom and perspective distance describe the same framing', () => {
  const fovDeg = 45, viewportHeightPx = 900;
  // 10 m away at 45 degrees the view is 2 * 10 * tan(22.5 deg) = 8.284 m tall.
  const zoom = orthoZoomForPerspective({ fovDeg, distance: 10, viewportHeightPx });
  assert.ok(near(zoom, 900 / 8.284271247461902, 1e-6), `zoom ${zoom}`);
  assert.ok(near(perspectiveDistanceForOrtho({ fovDeg, zoom, viewportHeightPx }), 10, 1e-9), 'round trip');
  // zooming in 2x halves the equivalent distance
  assert.ok(near(perspectiveDistanceForOrtho({ fovDeg, zoom: zoom * 2, viewportHeightPx }), 5, 1e-9));
});

test('orthographic zoom is clamped to a sane visible range', () => {
  const H = 900;
  const lo = H / MAX_VISIBLE_M;
  const hi = H / MIN_VISIBLE_M;
  assert.equal(clampOrthoZoom(1e-9, H), lo);
  assert.equal(clampOrthoZoom(1e12, H), hi);
  assert.equal(clampOrthoZoom(100, H), 100);
  assert.equal(clampOrthoZoom(NaN, H), lo, 'non-finite zoom falls back to the widest view');
});

test('wheel steps zoom the same amount as the perspective dolly does', () => {
  // zoom in: distance r -> r * (1 + 0.5 * step) for step < 0, so the zoom factor is its inverse
  assert.ok(near(zoomFactorForStep(-0.1), 1 / 0.95, 1e-12));
  // zoom out: r -> r * (1 + 0.55 * step)
  assert.ok(near(zoomFactorForStep(0.1), 1 / 1.055, 1e-12));
  assert.equal(zoomFactorForStep(0), 1);
  assert.ok(zoomFactorForStep(-0.3) > zoomFactorForStep(-0.1) && zoomFactorForStep(-0.1) > 1);
  assert.ok(zoomFactorForStep(0.3) < zoomFactorForStep(0.1) && zoomFactorForStep(0.1) < 1);
  assert.ok(zoomFactorForStep(-50) <= 10, 'a runaway step cannot divide by zero');
});

test('zoom about the cursor keeps the point under the cursor fixed', () => {
  const halfW = 800, halfH = 450;
  for (const [nx, ny, zoom, newZoom] of [[0.6, -0.3, 100, 150], [-0.9, 0.8, 40, 25], [0, 0, 100, 300], [1, 1, 10, 11]]) {
    const s = zoomAboutCursorShift({ ndc: [nx, ny], halfWidthPx: halfW, halfHeightPx: halfH, zoom, newZoom });
    // centre C = 0. World point under the cursor before: P = (nx * halfW / zoom, ny * halfH / zoom).
    const px = (nx * halfW) / zoom, py = (ny * halfH) / zoom;
    // After the zoom and the camera shift, the same ndc must show the same point.
    assert.ok(near(s.right + (nx * halfW) / newZoom, px, 1e-9), `x for ${[nx, ny, zoom, newZoom]}`);
    assert.ok(near(s.up + (ny * halfH) / newZoom, py, 1e-9), `y for ${[nx, ny, zoom, newZoom]}`);
  }
  const centre = zoomAboutCursorShift({ ndc: [0, 0], halfWidthPx: halfW, halfHeightPx: halfH, zoom: 5, newZoom: 50 });
  assert.deepEqual(centre, { right: 0, up: 0 }, 'zooming at the centre does not move the camera');
});

test('fit zoom is limited by whichever side of the box is tighter', () => {
  // 1600 x 900 viewport, margin 1.2
  const wide = fitZoomForBox({ halfExtentX: 10, halfExtentY: 1, viewportWidthPx: 1600, viewportHeightPx: 900 });
  assert.ok(near(wide, 800 / (10 * 1.2)), 'a wide box is fitted by its width');
  const tall = fitZoomForBox({ halfExtentX: 1, halfExtentY: 10, viewportWidthPx: 1600, viewportHeightPx: 900 });
  assert.ok(near(tall, 450 / (10 * 1.2)), 'a tall box is fitted by its height');
  const flat = fitZoomForBox({ halfExtentX: 0, halfExtentY: 0, viewportWidthPx: 1600, viewportHeightPx: 900 });
  assert.ok(Number.isFinite(flat) && flat > 0, 'a degenerate box still gives a finite zoom');
});

test('half extents of a box along the screen axes', () => {
  const half = [3, 2, 1]; // box half sizes along x, y, z
  assert.deepEqual(boxHalfExtentsAlong(half, [1, 0, 0], [0, 1, 0]), [3, 2], 'front view');
  assert.deepEqual(boxHalfExtentsAlong(half, [0, 0, 1], [0, 1, 0]), [1, 2], 'side view');
  const r = Math.SQRT1_2;
  const [hx, hy] = boxHalfExtentsAlong(half, [r, 0, r], [0, 1, 0]);
  assert.ok(near(hx, (3 + 1) * r) && near(hy, 2), 'rotated 45 degrees about the vertical');
});

test('view metrics: perspective cameras report fov, orthographic ones report px per metre', () => {
  const persp = viewMetrics({ isOrthographicCamera: false, fov: 45, zoom: 1 }, 900);
  assert.ok(near(persp.fovRad, Math.PI / 4) && persp.viewportHeightPx === 900);
  assert.equal(persp.pxPerMeter, null);
  const ortho = viewMetrics({ isOrthographicCamera: true, zoom: 123 }, 900);
  assert.equal(ortho.pxPerMeter, 123);
  assert.equal(ortho.viewportHeightPx, 900);
});

test('direction slerp: endpoints, unit length, and the opposite-view case', async () => {
  const { slerpDirection } = await import('../../src/viewer/cameraMath.js');
  const unit = (v) => near(Math.hypot(...v), 1, 1e-9);
  const a = [0, 0, 1]; // front
  const b = [1, 0, 0]; // right
  assert.deepEqual(slerpDirection(a, b, 0).map((x) => +x.toFixed(12)), [0, 0, 1]);
  assert.deepEqual(slerpDirection(a, b, 1).map((x) => +x.toFixed(12)), [1, 0, 0]);
  const mid = slerpDirection(a, b, 0.5);
  assert.ok(unit(mid) && near(mid[0], Math.SQRT1_2, 1e-9) && near(mid[2], Math.SQRT1_2, 1e-9), 'halfway is 45 degrees');
  // front -> back: a straight line would pass through the target; the slerp stays on the sphere
  const back = [0, 0, -1];
  for (let i = 0; i <= 10; i++) {
    const v = slerpDirection(a, back, i / 10);
    assert.ok(unit(v), `unit at ${i / 10}`);
  }
  const half = slerpDirection(a, back, 0.5);
  assert.ok(near(half[2], 0, 1e-9) && near(Math.hypot(half[0], half[1]), 1, 1e-9), 'halfway between opposite views is sideways');
  // top -> bottom (opposite along the vertical) must also pick a sideways detour
  const t2b = slerpDirection([0, 1, 0], [0, -1, 0], 0.5);
  assert.ok(near(t2b[1], 0, 1e-9) && near(Math.hypot(t2b[0], t2b[2]), 1, 1e-9));
  // identical directions stay put
  assert.deepEqual(slerpDirection([0, 1, 0], [0, 1, 0], 0.3).map((x) => +x.toFixed(12)), [0, 1, 0]);
});
