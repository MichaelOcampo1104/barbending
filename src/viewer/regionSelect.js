// Region select (the Box and Lasso tools): which BBS rows have a bar that touches a shape drawn on the screen.
// Pure math, no three.js and no DOM, so the viewport, the Node tests and the benchmark all share it.
//
// A row is selected when any segment of any of its bars, projected through the camera, touches the shape: it
// lies inside it, crosses its outline, or passes within a couple of pixels of it. That is the bars' real lines,
// not their bounding boxes, so a box in the gap between the copies of a wide set selects nothing, and a bar that
// points straight at an orthographic camera (a dot) is selected by a shape around the dot.
import { genBarPoints, transformBarLocalPoint, distOffsets, distOffsetExtents } from '../bbs/shapes.js';

const S = 0.001; // app mm -> scene metres: x, z up, -y (the same mapping as buildField and RebarMesh)

// How near the outline a bar may pass and still count (a bar is a few pixels wide on screen).
export const TOUCH_TOL_PX = 2;
const MIN_LASSO_PX = 8; // the shortest path that counts as a lasso
const SIMPLIFY_PX = 1; // how far the simplified outline may stray from the drawn path

// ---------------------------------------------------------------------------------------------------------
// Regions: a closed polygon in canvas pixels (flat [x0, y0, x1, y1, ...]) and its bounding box.
// ---------------------------------------------------------------------------------------------------------
function regionOf(poly) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (let i = 0; i < poly.length; i += 2) {
    if (poly[i] < minx) minx = poly[i];
    if (poly[i] > maxx) maxx = poly[i];
    if (poly[i + 1] < miny) miny = poly[i + 1];
    if (poly[i + 1] > maxy) maxy = poly[i + 1];
  }
  return { poly, bbox: [minx, miny, maxx, maxy] };
}

export function boxRegion(x0, y0, x1, y1) {
  const a = Math.min(x0, x1), b = Math.min(y0, y1), c = Math.max(x0, x1), d = Math.max(y0, y1);
  return regionOf(Float64Array.of(a, b, c, b, c, d, a, d));
}

function pointSegDistSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

// Ramer-Douglas-Peucker on an open path (iterative): the vertices that keep it within `eps` of the original.
function simplify(pts, eps) {
  const n = pts.length;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const e2 = eps * eps;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = -1, wd = e2;
    for (let i = a + 1; i < b; i++) {
      const d = pointSegDistSq(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1]);
      if (d > wd) { wd = d; worst = i; }
    }
    if (worst >= 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// A free-form loop from the points the pointer passed through (canvas pixels, in drawing order). The loop
// closes back to its start. Null when it is too short to mean anything.
export function lassoRegion(points) {
  if (!points || points.length < 3) return null;
  const pts = [points[0]];
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const p = points[i], q = pts[pts.length - 1];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < 0.5) continue;
    length += d;
    pts.push(p);
  }
  if (pts.length < 3 || length < MIN_LASSO_PX) return null;
  const keep = simplify(pts, SIMPLIFY_PX);
  const poly = new Float64Array(keep.length * 2);
  keep.forEach((p, i) => { poly[2 * i] = p[0]; poly[2 * i + 1] = p[1]; });
  return regionOf(poly);
}

// Even-odd rule, so a loop that crosses itself leaves its overlap out of the shape.
export function pointInPolygon(poly, x, y) {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[2 * i], yi = poly[2 * i + 1], xj = poly[2 * j], yj = poly[2 * j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function orient(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

// Proper crossings only; segments that touch or overlap are caught by the distance test with its tolerance.
function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const o1 = orient(ax, ay, bx, by, cx, cy), o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay), o4 = orient(cx, cy, dx, dy, bx, by);
  return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
}

// Does the segment (x0,y0)-(x1,y1) touch the region? Inside it, across its outline, or within `tol` pixels of it.
export function segmentTouchesRegion(region, x0, y0, x1, y1, tol = TOUCH_TOL_PX) {
  const [rx0, ry0, rx1, ry1] = region.bbox;
  const sx0 = Math.min(x0, x1) - tol, sx1 = Math.max(x0, x1) + tol;
  const sy0 = Math.min(y0, y1) - tol, sy1 = Math.max(y0, y1) + tol;
  if (sx1 < rx0 || sx0 > rx1 || sy1 < ry0 || sy0 > ry1) return false;
  const poly = region.poly;
  if (pointInPolygon(poly, x0, y0) || pointInPolygon(poly, x1, y1)) return true;
  const n = poly.length / 2;
  const tol2 = tol * tol + 1e-9;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = poly[2 * j], ay = poly[2 * j + 1], cx = poly[2 * i], cy = poly[2 * i + 1];
    if (Math.max(ax, cx) < sx0 || Math.min(ax, cx) > sx1 || Math.max(ay, cy) < sy0 || Math.min(ay, cy) > sy1) continue;
    if (segmentsCross(x0, y0, x1, y1, ax, ay, cx, cy)) return true;
    // Not crossing: the closest approach is at one of the four endpoints.
    if (pointSegDistSq(x0, y0, ax, ay, cx, cy) <= tol2 || pointSegDistSq(x1, y1, ax, ay, cx, cy) <= tol2
      || pointSegDistSq(ax, ay, x0, y0, x1, y1) <= tol2 || pointSegDistSq(cx, cy, x0, y0, x1, y1) <= tol2) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------------
// Through the camera
// ---------------------------------------------------------------------------------------------------------
const _t = new Float64Array(2);

// The part of a segment that is inside the camera's depth range (-w <= z <= w in clip coordinates, which also
// keeps w > 0, so nothing behind a perspective camera). Writes the parameter range into _t.
function depthClip(aw, az, bw, bz) {
  let t0 = 0, t1 = 1;
  let f0 = aw + az, f1 = bw + bz; // near plane
  if (f0 < 0 && f1 < 0) return false;
  if (f0 < 0) { const t = f0 / (f0 - f1); if (t > t0) t0 = t; } else if (f1 < 0) { const t = f0 / (f0 - f1); if (t < t1) t1 = t; }
  f0 = aw - az; f1 = bw - bz; // far plane
  if (f0 < 0 && f1 < 0) return false;
  if (f0 < 0) { const t = f0 / (f0 - f1); if (t > t0) t0 = t; } else if (f1 < 0) { const t = f0 / (f0 - f1); if (t < t1) t1 = t; }
  if (t0 > t1) return false;
  _t[0] = t0;
  _t[1] = t1;
  return true;
}

// For tests: the kept parameter range [t0, t1] of a segment between two clip-space points [x, y, z, w], or null.
export function clipSegmentToDepth(c0, c1) {
  return depthClip(c0[3], c0[2], c1[3], c1[2]) ? [_t[0], _t[1]] : null;
}

// A scene-space segment (metres) through the view-projection matrix (column-major, like three's Matrix4) onto
// the canvas (pixels), clipped to the depth range, tested against the region.
function segmentHit(ctx, ax, ay, az, bx, by, bz) {
  const m = ctx.m;
  const aX = m[0] * ax + m[4] * ay + m[8] * az + m[12], aY = m[1] * ax + m[5] * ay + m[9] * az + m[13];
  const aZ = m[2] * ax + m[6] * ay + m[10] * az + m[14], aW = m[3] * ax + m[7] * ay + m[11] * az + m[15];
  const bX = m[0] * bx + m[4] * by + m[8] * bz + m[12], bY = m[1] * bx + m[5] * by + m[9] * bz + m[13];
  const bZ = m[2] * bx + m[6] * by + m[10] * bz + m[14], bW = m[3] * bx + m[7] * by + m[11] * bz + m[15];
  if (!depthClip(aW, aZ, bW, bZ)) return false;
  const t0 = _t[0], t1 = _t[1];
  const cX = aX + t0 * (bX - aX), cY = aY + t0 * (bY - aY), cW = aW + t0 * (bW - aW);
  const dX = aX + t1 * (bX - aX), dY = aY + t1 * (bY - aY), dW = aW + t1 * (bW - aW);
  if (!(cW > 1e-12) || !(dW > 1e-12)) return false;
  return segmentTouchesRegion(
    ctx.region,
    (cX / cW * 0.5 + 0.5) * ctx.w, (-cY / cW * 0.5 + 0.5) * ctx.h,
    (dX / dW * 0.5 + 0.5) * ctx.w, (-dY / dW * 0.5 + 0.5) * ctx.h,
    ctx.tol,
  );
}

// ---------------------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------------------
// Per row object: its base polyline (app mm, rotated into place, before Pos and the distribution offsets) and
// its app-frame box. Rows are replaced, not edited, by the store, so the object identity is the cache key.
const geometryCache = new WeakMap();

function geometryOf(bar) {
  let g = geometryCache.get(bar);
  if (g !== undefined) return g;
  g = null;
  try {
    const pts = genBarPoints(bar).points.map((p) => transformBarLocalPoint(bar, p));
    if (pts.length >= 2 && pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]))) {
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (const p of pts) {
        if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
        if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
        if (p[2] < z0) z0 = p[2]; if (p[2] > z1) z1 = p[2];
      }
      const px = Number(bar.Pos_x) || 0, py = Number(bar.Pos_y) || 0, pz = Number(bar.Pos_z) || 0;
      const e = distOffsetExtents(bar);
      const box = [px + e.minX + x0, py + e.minY + y0, pz + e.minZ + z0, px + e.maxX + x1, py + e.maxY + y1, pz + e.maxZ + z1];
      if (box.every(Number.isFinite)) g = { pts, box, px, py, pz };
    }
  } catch { g = null; }
  geometryCache.set(bar, g);
  return g;
}

// App-frame box of a row (mm) as [minX, minY, minZ, maxX, maxY, maxZ], the same box as barAppBox but without
// building the distribution grid; null for a row with no drawable geometry.
export function rowAppBox(bar) {
  const g = geometryOf(bar);
  return g ? g.box : null;
}

// Can the row reach the region at all? Its box projected to the screen must overlap the region's. When a corner
// is outside the depth range there is no safe screen box, so say yes and let the exact test decide.
function boxMayTouch(box, ctx) {
  const m = ctx.m;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    const ax = (i & 1 ? box[3] : box[0]) * S;
    const ay = (i & 4 ? box[5] : box[2]) * S;
    const az = -(i & 2 ? box[4] : box[1]) * S;
    const cX = m[0] * ax + m[4] * ay + m[8] * az + m[12], cY = m[1] * ax + m[5] * ay + m[9] * az + m[13];
    const cZ = m[2] * ax + m[6] * ay + m[10] * az + m[14], cW = m[3] * ax + m[7] * ay + m[11] * az + m[15];
    if (!(cW > 1e-12) || cW + cZ < 0 || cW - cZ < 0) return true;
    const sx = (cX / cW * 0.5 + 0.5) * ctx.w, sy = (-cY / cW * 0.5 + 0.5) * ctx.h;
    if (sx < x0) x0 = sx; if (sx > x1) x1 = sx;
    if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
  }
  const r = ctx.region.bbox, tol = ctx.tol;
  return !(x1 < r[0] - tol || x0 > r[2] + tol || y1 < r[1] - tol || y0 > r[3] + tol);
}

function rowTouches(bar, g, ctx) {
  const { pts, px, py, pz } = g;
  const offs = distOffsets(bar);
  for (let k = 0; k < offs.length; k++) {
    const o = offs[k];
    const bx = px + o[0], by = py + o[1], bz = pz + o[2];
    for (let j = 1; j < pts.length; j++) {
      const a = pts[j - 1], c = pts[j];
      if (segmentHit(ctx, (bx + a[0]) * S, (bz + a[2]) * S, -(by + a[1]) * S, (bx + c[0]) * S, (bz + c[2]) * S, -(by + c[1]) * S)) return true;
    }
  }
  return false;
}

const overlapsAny = (box, hidden) => hidden.some((h) =>
  box[0] <= h.maxX && box[3] >= h.minX && box[1] <= h.maxY && box[4] >= h.minY && box[2] <= h.maxZ && box[5] >= h.minZ);

// The indices (ascending) of the rows with a bar that touches `region`.
//  bars: the store's rows; concretes: its members (hidden ones hide their bars, as in the viewport);
//  region: boxRegion / lassoRegion in canvas pixels; viewProj: the camera's projection * view matrix as 16 numbers
//  (column-major); width / height: the canvas in the same pixels as the region.
export function selectBarsInRegion({ bars, concretes = [], region, viewProj, width, height, tolPx = TOUCH_TOL_PX }) {
  const out = [];
  if (!region || !bars || !bars.length || !viewProj) return out;
  const hiddenHosts = new Set();
  const hiddenBoxes = [];
  for (const c of concretes || []) {
    if (c && c.visible === false) {
      hiddenHosts.add(c.id);
      hiddenBoxes.push({ minX: c.x, minY: c.y, minZ: c.z, maxX: c.x + c.lx, maxY: c.y + c.ly, maxZ: c.z + c.lz });
    }
  }
  const ctx = { m: viewProj, w: width, h: height, region, tol: tolPx };
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (!b || b.hidden) continue;
    if (b.host && hiddenHosts.has(b.host)) continue;
    const g = geometryOf(b);
    if (!g) continue;
    if (hiddenBoxes.length && overlapsAny(g.box, hiddenBoxes)) continue;
    if (!boxMayTouch(g.box, ctx)) continue;
    if (rowTouches(b, g, ctx)) out.push(i);
  }
  return out;
}
