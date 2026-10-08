// End-on bars (spec 6.1). A bar that points straight at an orthographic camera (a starter bar seen in the Front
// view, a vertical bar in the Top view) has no projected area, so nothing draws it. At far zoom it is a
// hardware line whose two endpoints land on one pixel: a zero-length line, which the GPU draws as nothing. The
// builder therefore tags every line vertex with the scene axis its segment runs along, the camera reports the
// axis it looks along, and the line shader opens a matching segment into a short dash so it shows as a dot.
// Near zoom the open tube prism has edge-on sides: the tube shader turns such a bar into a disc, and the
// classic overlay tube is capped (tubeCaps.js).
// No three.js: the builder runs in a Web Worker and in plain Node tests.

// Axis codes are scene axes (x, y up, z): 1 = X, 2 = Y, 3 = Z. In app terms a bar along app Y is scene Z
// (the Front / Back view direction) and a vertical bar is scene Y (the Top / Bottom view direction).
export const END_VERTEX = 4; // added to the code on the second vertex of a segment (which way to push it)

// sin of the largest skew that still counts as "along the axis" (0.06 degrees). Over a 30 m bar that is 30 mm,
// well under a pixel at the zoom where the bar is still drawn as a line.
export const AXIS_TOL = 1e-3;

// Which scene axis a segment runs along (0 = none).
export function segmentAxisCode(dx, dy, dz) {
  const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
  const len = Math.hypot(ax, ay, az);
  if (!(len > 1e-9)) return 0;
  const tol = len * AXIS_TOL;
  if (ay <= tol && az <= tol) return 1;
  if (ax <= tol && az <= tol) return 2;
  if (ax <= tol && ay <= tol) return 3;
  return 0;
}

// The two per-vertex flag values of a segment: [start, end].
export function vertexAxisFlags(code) {
  return code ? [code, code + END_VERTEX] : [0, 0];
}

// Which scene axis an orthographic camera looks exactly along (either way), from its look direction (0 = none).
export function cameraEndOnAxis(forward, tol = AXIS_TOL) {
  const len = Math.hypot(forward[0], forward[1], forward[2]);
  if (!(len > 1e-12)) return 0;
  const fx = Math.abs(forward[0]) / len, fy = Math.abs(forward[1]) / len, fz = Math.abs(forward[2]) / len;
  if (fy <= tol && fz <= tol) return 1;
  if (fx <= tol && fz <= tol) return 2;
  if (fx <= tol && fy <= tol) return 3;
  return 0;
}
