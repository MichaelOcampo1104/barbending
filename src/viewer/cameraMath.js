// Pure camera maths for the preset views and the orthographic camera. No three.js, React or DOM, so it
// has Node tests (tests/views/). Scene axes: x = app X (length), y = up (app Z), z = towards the viewer
// in the Front view (= -app Y). Distances are metres, viewport sizes CSS pixels.

const ISO_RAW = [0.65, 0.55, 0.65];
const ISO_LEN = Math.hypot(...ISO_RAW);

// Unit vector from the orbit target TO the camera for every preset view.
export const VIEW_OFFSETS = Object.freeze({
  top: Object.freeze([0, 1, 0]),
  bottom: Object.freeze([0, -1, 0]),
  front: Object.freeze([0, 0, 1]),
  back: Object.freeze([0, 0, -1]),
  right: Object.freeze([1, 0, 0]),
  left: Object.freeze([-1, 0, 0]),
  iso: Object.freeze(ISO_RAW.map((v) => v / ISO_LEN)),
});

// Names shown in the view dropdown and the viewport pill ('free' = not looking along a preset).
export const VIEW_LABELS = Object.freeze({
  top: 'Top', bottom: 'Bottom', front: 'Front', back: 'Back', left: 'Left', right: 'Right', iso: 'Iso', free: 'Free',
});

// The six true views: drawn in orthographic projection. Iso is a perspective 3D view.
export const AXIS_VIEWS = Object.freeze(['top', 'bottom', 'front', 'back', 'left', 'right']);
export const isAxisView = (name) => AXIS_VIEWS.includes(name);

// Name of the preset a camera is looking along (forward = its look direction), or 'free'.
// Presets land within ~1e-6 rad; 0.003 rad (0.17 degrees) is the tolerance for "still that view".
export function viewFromForward(forward, tolRad = 0.003) {
  const len = Math.hypot(forward[0], forward[1], forward[2]);
  if (!(len > 1e-12)) return 'free';
  let best = 'free';
  let bestAngle = tolRad;
  for (const [name, off] of Object.entries(VIEW_OFFSETS)) {
    // The camera looks from the offset towards the target, so forward points the opposite way.
    const dot = -(forward[0] * off[0] + forward[1] * off[1] + forward[2] * off[2]) / len;
    const angle = Math.acos(Math.min(1, Math.max(-1, dot)));
    if (angle <= bestAngle) { best = name; bestAngle = angle; }
  }
  return best;
}

// ---- projection equivalence (what an orthographic zoom means in perspective, and back) ----
// The orthographic camera uses R3F's convention: its frustum is the canvas size in CSS pixels and
// `zoom` is pixels per metre, so the visible height is viewportHeightPx / zoom.

export function orthoZoomForPerspective({ fovDeg, distance, viewportHeightPx }) {
  return viewportHeightPx / (2 * distance * Math.tan((fovDeg * Math.PI) / 360));
}

export function perspectiveDistanceForOrtho({ fovDeg, zoom, viewportHeightPx }) {
  return viewportHeightPx / zoom / (2 * Math.tan((fovDeg * Math.PI) / 360));
}

// Visible height limits (m): the orthographic counterpart of the perspective camera-pivot guard.
export const MIN_VISIBLE_M = 0.002;
export const MAX_VISIBLE_M = 500;

export function clampOrthoZoom(zoom, viewportHeightPx, minVisible = MIN_VISIBLE_M, maxVisible = MAX_VISIBLE_M) {
  const lo = viewportHeightPx / maxVisible;
  const hi = viewportHeightPx / minVisible;
  if (!Number.isFinite(zoom)) return lo;
  return Math.min(hi, Math.max(lo, zoom));
}

// Zoom factor (> 1 zooms in) for one wheel step, matching DiveZoom's perspective dolly: a step < 0
// moves the camera 0.5 * |step| of its distance closer, a step > 0 moves it 0.55 * step further away.
export function zoomFactorForStep(step) {
  if (!step) return 1; // 0 or NaN
  if (step < 0) return 1 / Math.max(0.1, 1 + 0.5 * step);
  return 1 / (1 + 0.55 * step);
}

// Camera shift (metres along the camera's right and up axes) that keeps the world point under the
// cursor fixed while the zoom changes from `zoom` to `newZoom`. ndc is the cursor in -1..1.
export function zoomAboutCursorShift({ ndc, halfWidthPx, halfHeightPx, zoom, newZoom }) {
  const k = 1 - zoom / newZoom;
  return {
    right: ((ndc[0] * halfWidthPx) / zoom) * k + 0,
    up: ((ndc[1] * halfHeightPx) / zoom) * k + 0,
  };
}

// ---- fitting ----

// Half extents of an axis-aligned box (half sizes along x, y, z) along two unit screen axes.
export function boxHalfExtentsAlong(halfSizes, axisA, axisB) {
  let a = 0;
  let b = 0;
  for (let i = 0; i < 3; i++) {
    a += halfSizes[i] * Math.abs(axisA[i]);
    b += halfSizes[i] * Math.abs(axisB[i]);
  }
  return [a, b];
}

export function fitZoomForBox({ halfExtentX, halfExtentY, viewportWidthPx, viewportHeightPx, margin = 1.2 }) {
  const hx = Math.max(halfExtentX, 1e-6);
  const hy = Math.max(halfExtentY, 1e-6);
  return Math.min(viewportWidthPx / 2 / (hx * margin), viewportHeightPx / 2 / (hy * margin));
}

// What the bar renderer needs from the camera: a perspective camera sizes things by distance and fov,
// an orthographic one by a constant pixels-per-metre.
export function viewMetrics(cam, viewportHeightPx) {
  if (cam.isOrthographicCamera) return { fovRad: 0, viewportHeightPx, pxPerMeter: cam.zoom };
  return { fovRad: (cam.fov * Math.PI) / 180, viewportHeightPx, pxPerMeter: null };
}

// ---- shared camera constants ----
export const PERSP_FOV_DEG = 45;
// Camera-pivot range of the perspective camera (DiveZoom guard): no closer than 2 mm, no further than 400 m.
export const PERSP_MIN_DISTANCE = 0.002;
export const PERSP_MAX_DISTANCE = 400;
// The orthographic camera's depth range is symmetric around its plane (a negative near is allowed), so the
// model is never clipped wherever the camera sits; 4 km in 24 bits is still a quarter of a millimetre.
export const ORTHO_DEPTH = 2000;

// Unit direction a fraction t of the way from direction a to direction b along the great circle.
// Moving the camera this way (instead of along the chord) keeps it on the orbit sphere: a straight
// line between opposite views, such as Front to Back, would pass through the orbit target.
export function slerpDirection(a, b, t) {
  const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const A = unit(a);
  const B = unit(b);
  const dot = Math.min(1, Math.max(-1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]));
  if (dot > 1 - 1e-12) return A;
  let axis;
  let angle;
  if (dot < -1 + 1e-9) {
    // Opposite: swing sideways about any axis perpendicular to A (world up unless A is itself vertical).
    axis = unit(cross(A, Math.abs(A[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
    angle = Math.PI;
  } else {
    axis = unit(cross(A, B));
    angle = Math.acos(dot);
  }
  const th = angle * t;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const k = cross(axis, A); // axis is perpendicular to A, so Rodrigues' formula has no axis-parallel term
  return unit([A[0] * c + k[0] * s, A[1] * c + k[1] * s, A[2] * c + k[2] * s]);
}
