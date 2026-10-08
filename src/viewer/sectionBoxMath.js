// Pure section-box maths shared by the app's SectionBox.jsx and the standalone viewer's section box. Arrays in, arrays out:
// no three.js and no DOM, so plain Node tests can load it.

// The six faces in box-local axes, in the order the grips use: -X, +X, -Y, +Y, -Z, +Z. This is NOT the clipping-plane order of
// sectionPlanes.js, which capQuad(i) follows: +X, -X, +Y, -Y, +Z, -Z (planes 2k is the + face of axis k, 2k + 1 the - face).
export const FACES = [
  { axis: 0, sign: -1 }, { axis: 0, sign: 1 },
  { axis: 1, sign: -1 }, { axis: 1, sign: 1 },
  { axis: 2, sign: -1 }, { axis: 2, sign: 1 },
];
export const AXIS_COLORS = ['#ef4444', '#22c55e', '#3b82f6'];
export const MIN_THICK = 0.05; // 50 mm

// Cap quad transforms per plane, in box-local coords (box centred at origin).
export function capQuad(i, size) {
  const [sx, sy, sz] = size;
  switch (i) {
    case 0: return { args: [sz, sy], pos: [sx / 2, 0, 0], rot: [0, Math.PI / 2, 0] };
    case 1: return { args: [sz, sy], pos: [-sx / 2, 0, 0], rot: [0, -Math.PI / 2, 0] };
    case 2: return { args: [sx, sz], pos: [0, sy / 2, 0], rot: [-Math.PI / 2, 0, 0] };
    case 3: return { args: [sx, sz], pos: [0, -sy / 2, 0], rot: [Math.PI / 2, 0, 0] };
    case 4: return { args: [sx, sy], pos: [0, 0, sz / 2], rot: [0, 0, 0] };
    default: return { args: [sx, sy], pos: [0, 0, -sz / 2], rot: [0, Math.PI, 0] };
  }
}

// Push / pull one face: `delta` is how far the pointer moved along the face's outward unit `normal` (world space, metres). The size
// along `axis` follows it but never drops below MIN_THICK; the centre moves by half the applied change, so the opposite face stays.
// The arithmetic is the order the app has always used (x + n * (applied / 2)), so results are identical to the last bit.
export function faceDragResult({ startCenter, startSize, axis, normal, delta }) {
  const size = [...startSize];
  size[axis] = Math.max(MIN_THICK, startSize[axis] + delta);
  const half = (size[axis] - startSize[axis]) / 2;
  return {
    center: [startCenter[0] + normal[0] * half, startCenter[1] + normal[1] * half, startCenter[2] + normal[2] * half],
    size,
  };
}

// "Test cut": a third of each size around the same centre (never below MIN_THICK) so the cut is visible at once.
export function testCutSize(size) {
  return size.map((v) => Math.max(MIN_THICK, v / 3));
}

// The default box around model bounds (scene metres): padded by max(0.2 m, 2 % of the largest extent) unless `pad` is given.
export function boxFromBounds(min, max, pad) {
  const ext = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const p = pad ?? Math.max(0.2, 0.02 * Math.max(ext[0], ext[1], ext[2]));
  return {
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    size: [ext[0] + 2 * p, ext[1] + 2 * p, ext[2] + 2 * p],
  };
}

// World metres covered by one screen pixel at a point: an orthographic camera by its zoom (pixels per metre), a perspective one by
// the point's depth along the view axis, the vertical field of view and the viewport height. Keeps the viewer's grips a constant size.
export function pixelWorldSize({ ortho, zoom = 1, depth = 1, fovRad = Math.PI / 4, viewportHeightPx = 800 }) {
  if (ortho) return 1 / Math.max(zoom, 1e-9);
  return (2 * Math.max(depth, 1e-4) * Math.tan(fovRad / 2)) / Math.max(viewportHeightPx, 1);
}