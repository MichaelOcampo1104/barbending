// Pure ray picker (spec 7.1): ray -> chunk bounds -> pick blocks -> segments -> row id.
// Distances are scene metres. No three.js; works on the FieldData from buildField.

// Slab test: distance along the ray to where it enters the box (0 if it starts inside), or Infinity.
function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tmin = 0;
  let tmax = Infinity;
  if (Math.abs(dx) < 1e-12) {
    if (ox < x0 || ox > x1) return Infinity;
  } else {
    let t0 = (x0 - ox) / dx, t1 = (x1 - ox) / dx;
    if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
    if (t0 > tmin) tmin = t0;
    if (t1 < tmax) tmax = t1;
    if (tmin > tmax) return Infinity;
  }
  if (Math.abs(dy) < 1e-12) {
    if (oy < y0 || oy > y1) return Infinity;
  } else {
    let t0 = (y0 - oy) / dy, t1 = (y1 - oy) / dy;
    if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
    if (t0 > tmin) tmin = t0;
    if (t1 < tmax) tmax = t1;
    if (tmin > tmax) return Infinity;
  }
  if (Math.abs(dz) < 1e-12) {
    if (oz < z0 || oz > z1) return Infinity;
  } else {
    let t0 = (z0 - oz) / dz, t1 = (z1 - oz) / dz;
    if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
    if (t0 > tmin) tmin = t0;
    if (t1 < tmax) tmax = t1;
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

// ray = { origin: [x,y,z], dir: [x,y,z] } (unit direction).
// opts = { fovRad, viewportHeightPx, tolPx = 6, rowStates?: Uint8Array (1 hidden, 2 overlay: skipped),
//          rowRadiusM?: Float32Array, accept?: (point) => boolean,
//          worldPerPixel?: number (orthographic cameras: a constant world size per pixel, replaces fov) }
// Returns { row, distance (along the ray), point (closest point on the bar axis), seg } or null.
export function pickField(data, ray, opts = {}) {
  const {
    fovRad = Math.PI / 4, viewportHeightPx = 800, tolPx = 6, rowStates = null, rowRadiusM = null, accept = null,
    worldPerPixel = null,
  } = opts;
  const [ox, oy, oz] = ray.origin;
  const [dx, dy, dz] = ray.dir;
  const tanHalf = Math.tan(fovRad / 2);
  // world units per pixel at distance t (constant for an orthographic camera)
  const wpp = worldPerPixel ? () => worldPerPixel : (t) => (2 * Math.max(t, 0) * tanHalf) / viewportHeightPx;
  const { seg, rowOfVtx, blocks, chunks } = data;

  const cand = [];
  for (let c = 0; c < chunks.length; c++) {
    const ch = chunks[c];
    const far = Math.hypot(ch.center[0] - ox, ch.center[1] - oy, ch.center[2] - oz) + ch.radius;
    const pad = ch.maxRadiusM + tolPx * wpp(far);
    const t = rayBox(ox, oy, oz, dx, dy, dz,
      ch.min[0] - pad, ch.min[1] - pad, ch.min[2] - pad, ch.max[0] + pad, ch.max[1] + pad, ch.max[2] + pad);
    if (t < Infinity) cand.push({ t, c, pad });
  }
  cand.sort((a, b) => a.t - b.t);

  let best = null;
  let bestS = Infinity;
  for (const { t, c, pad } of cand) {
    if (t > bestS) break;
    const ch = chunks[c];
    for (let bi = ch.blockStart; bi < ch.blockStart + ch.blockCount; bi++) {
      const bo = bi * 6;
      const bt = rayBox(ox, oy, oz, dx, dy, dz,
        blocks.bounds[bo] - pad, blocks.bounds[bo + 1] - pad, blocks.bounds[bo + 2] - pad,
        blocks.bounds[bo + 3] + pad, blocks.bounds[bo + 4] + pad, blocks.bounds[bo + 5] + pad);
      if (bt > bestS) continue;
      const s0 = blocks.start[bi];
      const s1 = s0 + blocks.size[bi];
      for (let i = s0; i < s1; i++) {
        const row = rowOfVtx[2 * i];
        if (rowStates) {
          const st = rowStates[row];
          if (st === 1 || st === 2) continue;
        }
        const o6 = i * 6;
        const ax = seg[o6], ay = seg[o6 + 1], az = seg[o6 + 2];
        const vx = seg[o6 + 3] - ax, vy = seg[o6 + 4] - ay, vz = seg[o6 + 5] - az;
        const wx = ox - ax, wy = oy - ay, wz = oz - az;
        const b = dx * vx + dy * vy + dz * vz; // u.v
        const c2 = vx * vx + vy * vy + vz * vz; // v.v
        const d = dx * wx + dy * wy + dz * wz; // u.w
        const e = vx * wx + vy * wy + vz * wz; // v.w
        const den = c2 - b * b;
        let tt;
        if (c2 > 0 && den > 1e-12 * c2) tt = (e - b * d) / den;
        else tt = c2 > 0 ? e / c2 : 0;
        if (tt < 0) tt = 0; else if (tt > 1) tt = 1;
        let s = tt * b - d; // parameter along the ray (unit direction)
        if (s < 0) {
          s = 0;
          tt = c2 > 0 ? e / c2 : 0;
          if (tt < 0) tt = 0; else if (tt > 1) tt = 1;
        }
        if (s >= bestS) continue;
        const qx = ax + tt * vx, qy = ay + tt * vy, qz = az + tt * vz;
        const px = ox + s * dx - qx, py = oy + s * dy - qy, pz = oz + s * dz - qz;
        const rad = rowRadiusM ? rowRadiusM[row] : 0.008;
        const tol = Math.max(rad, tolPx * wpp(s));
        if (px * px + py * py + pz * pz > tol * tol) continue;
        if (accept && !accept([qx, qy, qz])) continue;
        bestS = s;
        best = { row, distance: s, point: [qx, qy, qz], seg: i };
      }
    }
  }
  return best;
}
