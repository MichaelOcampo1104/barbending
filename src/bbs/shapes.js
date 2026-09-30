// Shape generators — local coords in mm, origin at bar start.
// Each returns { points: [[x,y,z]...], bends90: n, lengthMm (gross), cutLengthMm }
// Compatible Rebar_Type values from FreeCAD rebar_detailing.py:
// straight, bent, crank, double_crank, c_link, c_link_with_hook
import { polylineLength, bendDeduction } from './calc.js';

export const REBAR_TYPES = [
  'straight',
  'bent',
  'crank',
  'double_crank',
  'c_link',
  'c_link_with_hook',
];

export const BENT_DEFAULTS = {
  10: { r: 20, H: 120, U: 85 },
  13: { r: 24, H: 125, U: 130 },
  16: { r: 32, H: 130, U: 130 },
  20: { r: 70, H: 190, U: 165 },
  25: { r: 87, H: 240, U: 260 },
  32: { r: 112, H: 305, U: 330 },
  40: { r: 140, H: 380, U: 400 },
  50: { r: 175, H: 475, U: 400 },
};

export function getBentDefaults(dia) {
  const d = Math.round(Number(dia) || 16);
  return BENT_DEFAULTS[d] || { r: d * 2, H: Math.max(100, d * 8), U: d * 10 };
}

export function genBarPoints(bar) {
  const d = Number(bar.Dia || 16);
  switch (bar.Rebar_Type) {
    case 'bent': {
      // L-shape: main leg L along local X, bent leg H along local Y (up/down)
      const L = Number(bar['Length of Bar'] || bar.length || 3000);
      const H = Number(bar.H || 800);
      const dir = String(bar.bent_up_down || 'up').toLowerCase() === 'down' ? -1 : 1;
      const pts = [[0, 0, 0], [L, 0, 0], [L, dir * H, 0]];
      return finish(pts, 1, d);
    }
    case 'crank': {
      // Single crank (offset step s in middle of long bar)
      const L = Number(bar.Long_length || 4000);
      const s = Number(bar.Crank_step || 300);
      const a = L * 0.4, b = L * 0.6;
      const pts = [[0, 0, 0], [a, 0, 0], [b, s, 0], [L, s, 0]];
      return finish(pts, 2, d);
    }
    case 'double_crank': {
      // Z / double crank: tail - mid - tail
      const start = Number(bar.DC_Lap_Start || 1000);
      const mid = Number(bar.DC_Lap_Mid || 2000);
      const tail = Number(bar.DC_Tail_Length || 1000);
      const s = Number(bar.Crank_step || 300);
      const pts = [[0, 0, 0], [start, 0, 0], [start + mid, s, 0], [start + mid + tail, s, 0]];
      return finish(pts, 2, d);
    }
    case 'c_link': {
      // FreeCAD Standard C-Link / U-Shape (place_c_link): Leg A (lenA) -> Spine (L) -> Leg B (lenB)
      const defs = getBentDefaults(d);
      const L = Number(bar.length || bar['Length of Bar'] || 1000);
      const lenA = Number(bar.c_length_a ?? defs.H);
      const lenB = Number(bar.c_length_b ?? defs.H);
      const pts = [[0, lenA, 0], [0, 0, 0], [L, 0, 0], [L, lenB, 0]];
      const totalLen = Math.round(lenA + L + lenB);
      return { points: pts, bends90: 2, lengthMm: totalLen, cutLengthMm: totalLen };
    }
    case 'c_link_with_hook': {
      // FreeCAD C-Link with Hook (place_c_link_with_hook):
      // Single Hook: Leg A (p1 -> p2) -> Spine (p2 -> p3_b) -> 180° Hook (p3_b -> p3_a -> p4)
      // Double Hook: Left Hook (p1 -> p2_a -> p2_b) -> Spine (p2_b -> p3_b) -> Right Hook (p3_b -> p3_a -> p4)
      const defs = getBentDefaults(d);
      const L = Number(bar.length || bar['Length of Bar'] || 1000);
      const lenA = Number(bar.c_length_a ?? defs.H);
      const defaultC = (d === 16 ? 130 : d === 13 ? 130 : (defs.U || 130));
      const hookC = Number(bar.c_length_b) || defaultC;
      const hookWidth = hookC - d;
      const isDouble = String(bar.double_hook || 'no').toLowerCase() === 'yes';

      const hookReturn = Math.round(10 * d);
      const hook6d = Math.round(6 * d);

      // Single hook: A = lenA, B = L, C = hookC, D = hookReturn -> A + B + C + D
      // Double hook: A = 6*d, B = L, C = hookC, D = hookReturn -> A*2 + B + C*2 + D*2
      const totalLen = Math.round(
        isDouble
          ? (hook6d * 2 + L + hookC * 2 + hookReturn * 2)
          : (lenA + L + hookC + hookReturn)
      );

      if (isDouble) {
        const p1 = [hookReturn, hookWidth, 0];
        const p2_a = [0, hookWidth, 0];
        const p2_b = [0, 0, 0];
        const p3_b = [L, 0, 0];
        const p3_a = [L, hookWidth, 0];
        const p4 = [Math.max(0, L - hookReturn), hookWidth, 0];
        const pts = [p1, p2_a, p2_b, p3_b, p3_a, p4];
        return { points: pts, bends90: 4, lengthMm: totalLen, cutLengthMm: totalLen };
      } else {
        const p1 = [0, lenA, 0];
        const p2 = [0, 0, 0];
        const p3_b = [L, 0, 0];
        const p3_a = [L, hookWidth, 0];
        const p4 = [Math.max(0, L - hookReturn), hookWidth, 0];
        const pts = [p1, p2, p3_b, p3_a, p4];
        return { points: pts, bends90: 3, lengthMm: totalLen, cutLengthMm: totalLen };
      }
    }
    case 'straight':
    default: {
      const L = Number(bar['Length of Bar'] || bar.length || 3000);
      const pts = [[0, 0, 0], [L, 0, 0]];
      return finish(pts, 0, d);
    }
  }
}

function finish(pts, bends90, dia) {
  const gross = polylineLength(pts);
  const cut = Math.max(0, gross - bendDeduction(bends90, dia));
  return { points: pts, bends90, lengthMm: gross, cutLengthMm: Math.round(cut) };
}

// Default parameter sets per type (matches FreeCAD CSV columns loosely)
export function defaultBar(type, tag = 1) {
  const isStirrup = type === 'c_link' || type === 'c_link_with_hook';
  const base = {
    Rebar_tag: tag,
    Bar_mark: `B${tag}`,
    Rebar_Type: type,
    Dia: 16,
    Pos_x: 0, Pos_y: 0, Pos_z: 0,
    Group: isStirrup ? 'C_Links_Hook' : 'HRB3DB_bt',
    Pos_Rotation: 0,
    Plane: 'XZ',
    qty: 1,
  };
  switch (type) {
    case 'bent': return { ...base, 'Length of Bar': 3000, H: 800, bent_up_down: 'up' };
    case 'crank': return { ...base, Long_length: 4000, Crank_step: 300, 'Length of Lap': 500 };
    case 'double_crank': return { ...base, DC_Lap_Start: 1000, DC_Lap_Mid: 2000, DC_Tail_Length: 1000, Crank_step: 300 };
    case 'c_link': return { ...base, length: 1000, c_length_a: 130, c_length_b: 130, qty_x: 1, spacing_x: 150, qty_y: 1, spacing_y: 150 };
    case 'c_link_with_hook': return { ...base, length: 1000, c_length_a: 130, c_length_b: 130, double_hook: 'no', qty_x: 1, spacing_x: 150, qty_y: 5, spacing_y: 200 };
    default: return { ...base, 'Length of Bar': 3000, qty_x: 1, spacing_x: 150, qty_y: 1, spacing_y: 150 };
  }
}

// Dimension fields per type (form + CSV). Common fields (mark, dia,
// position, distribution, group, plane) are preserved on type switch.
export const DIM_FIELDS_BY_TYPE = {
  straight: ['Length of Bar'],
  bent: ['Length of Bar', 'H', 'bent_up_down'],
  crank: ['Long_length', 'Crank_step', 'Length of Lap'],
  double_crank: ['DC_Lap_Start', 'DC_Lap_Mid', 'DC_Tail_Length', 'Crank_step'],
  c_link: ['length', 'c_length_a', 'c_length_b'],
  c_link_with_hook: ['length', 'c_length_a', 'c_length_b', 'double_hook'],
};

const ALL_DIM_FIELDS = [...new Set(Object.values(DIM_FIELDS_BY_TYPE).flat())];

// Switch a bar to a new shape type: keep identity/position/distribution,
// drop the old shape's dimensions, fill the new shape's defaults.
export function applyTypeDefaults(bar, type) {
  const next = { ...bar, Rebar_Type: type };
  for (const f of ALL_DIM_FIELDS) delete next[f];
  const fresh = defaultBar(type, bar.Rebar_tag);
  for (const f of DIM_FIELDS_BY_TYPE[type] || []) next[f] = fresh[f];
  return next;
}

// Transforms a local bar coordinate [x, y, z] to rotated orientation based on Plane (XY, XZ, YZ),
// in-plane Pos_Rotation, and plan_rotation (around global vertical Z).
export function transformBarLocalPoint(bar, [x, y, z]) {
  const planeRaw = String(bar?.Plane ?? 'XZ').toUpperCase().trim();
  const plane = (planeRaw === '0' || planeRaw === 'XY' || planeRaw === 'TOP' || planeRaw === 'BOTTOM' || planeRaw === 'HORIZONTAL' || planeRaw === 'SLAB')
    ? 'XY'
    : (planeRaw === '2' || planeRaw === 'YZ' || planeRaw === 'SIDE' || planeRaw === 'CROSS')
      ? 'YZ'
      : 'XZ';

  const posRot = Number(bar?.Pos_Rotation) || 0;
  const planRot = Number(bar?.plan_rotation) || 0;

  const theta = (posRot * Math.PI) / 180;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  // In-plane 2D rotation of the local profile
  const x0 = x * cosT - y * sinT;
  const y0 = x * sinT + y * cosT;
  const z0 = z;

  let x1 = 0, y1 = 0, z1 = 0;

  if (plane === 'XY') {
    // Horizontal (Slab / Column cross-section): local X -> App X, local Y -> App Y, local Z -> App Z
    x1 = x0;
    y1 = y0;
    z1 = z0;
  } else if (plane === 'YZ') {
    // Vertical YZ (Beam cross-section): local X -> App Y, local Y -> App Z (up), local Z -> App X
    x1 = z0;
    y1 = x0;
    z1 = y0;
  } else {
    // Vertical XZ (Beam elevation X): local X -> App X, local Y -> App Z (up), local Z -> App Y
    x1 = x0;
    y1 = z0;
    z1 = y0;
  }

  // Plan rotation (twist around global vertical Z-axis)
  if (planRot !== 0) {
    const phi = (planRot * Math.PI) / 180;
    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);
    const rx = x1 * cosP - y1 * sinP;
    const ry = x1 * sinP + y1 * cosP;
    x1 = rx;
    y1 = ry;
  }

  return [x1, y1, z1];
}

// App-frame bounding box of a bar (mm), including Pos, Plane, Pos_Rotation, plan_rotation
// and every distribution copy. Pure math, no three.
export function barAppBox(bar) {
  const g = genBarPoints(bar);
  let lx0 = Infinity, ly0 = Infinity, lz0 = Infinity;
  let lx1 = -Infinity, ly1 = -Infinity, lz1 = -Infinity;
  for (const pt of g.points) {
    const [rx, ry, rz] = transformBarLocalPoint(bar, pt);
    if (rx < lx0) lx0 = rx; if (rx > lx1) lx1 = rx;
    if (ry < ly0) ly0 = ry; if (ry > ly1) ly1 = ry;
    if (rz < lz0) lz0 = rz; if (rz > lz1) lz1 = rz;
  }
  let ox0 = 0, oy0 = 0, oz0 = 0, ox1 = 0, oy1 = 0, oz1 = 0;
  let first = true;
  for (const [ox, oy, oz] of distOffsets(bar)) {
    if (first || ox < ox0) ox0 = ox; if (first || ox > ox1) ox1 = ox;
    if (first || oy < oy0) oy0 = oy; if (first || oy > oy1) oy1 = oy;
    if (first || oz < oz0) oz0 = oz; if (first || oz > oz1) oz1 = oz;
    first = false;
  }
  const px = Number(bar.Pos_x) || 0, py = Number(bar.Pos_y) || 0, pz = Number(bar.Pos_z) || 0;
  return {
    minX: px + ox0 + lx0, minY: py + oy0 + ly0, minZ: pz + oz0 + lz0,
    maxX: px + ox1 + lx1, maxY: py + oy1 + ly1, maxZ: pz + oz1 + lz1,
  };
}

// True when the bar's bounding box overlaps any box in the list (each
// {minX..maxZ}). NaN anywhere → false (garbage never hides).
export function barOverlapsBoxes(bar, boxes) {
  const b = barAppBox(bar);
  if (![b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ].every(Number.isFinite)) return false;
  return (boxes || []).some((h) =>
    b.minX <= h.maxX && b.maxX >= h.minX &&
    b.minY <= h.maxY && b.maxY >= h.minY &&
    b.minZ <= h.maxZ && b.maxZ >= h.minZ,
  );
}

// Main straight run length (mm) of a longitudinal bar (straight, bent, crank, double_crank)
export function barMainLength(bar) {
  switch (bar?.Rebar_Type) {
    case 'bent':
    case 'straight':
    default:
      return Number(bar?.['Length of Bar'] || bar?.length || 3000);
    case 'crank':
      return Number(bar?.Long_length || 4000);
    case 'double_crank':
      return Number(bar?.DC_Lap_Start || 1000) + Number(bar?.DC_Lap_Mid || 2000) + Number(bar?.DC_Tail_Length || 1000);
  }
}

// Splice endpoints along the main axis of a bar in app-mm (Pos + Plane + Rotation)
export function barSpliceEnds(bar) {
  const L = barMainLength(bar);
  const px = Number(bar.Pos_x) || 0, py = Number(bar.Pos_y) || 0, pz = Number(bar.Pos_z) || 0;
  const s0 = transformBarLocalPoint(bar, [0, 0, 0]);
  const e0 = transformBarLocalPoint(bar, [L, 0, 0]);
  return [
    [px + s0[0], py + s0[1], pz + s0[2]],
    [px + e0[0], py + e0[1], pz + e0[2]],
  ];
}

// Base [start, end] of a bar in app-mm (Pos + Plane + Rotation)
export function barBaseEnds(bar) {
  const g = genBarPoints(bar);
  const px = Number(bar.Pos_x) || 0, py = Number(bar.Pos_y) || 0, pz = Number(bar.Pos_z) || 0;
  const p0 = transformBarLocalPoint(bar, g.points[0]);
  const p1 = transformBarLocalPoint(bar, g.points[g.points.length - 1]);
  return [
    [px + p0[0], py + p0[1], pz + p0[2]],
    [px + p1[0], py + p1[1], pz + p1[2]],
  ];
}

// Centerline snap nodes of visible bars (app-mm [x, y, z]): every polyline
// vertex of every rendered distribution copy. Drives pick/measure "snap on
// the rebar". Hidden bars (flag, host-hidden link, or inside a hidden
// member) never attract snaps; excludeIdx skips the bar being placed itself.
export function rebarSnapNodes(bars, concretes, excludeIdx = -1) {
  const hiddenIds = new Set((concretes || []).filter((c) => c.visible === false).map((c) => c.id));
  const hiddenBoxes = (concretes || []).filter((c) => c.visible === false)
    .map((c) => ({ minX: c.x, minY: c.y, minZ: c.z, maxX: c.x + c.lx, maxY: c.y + c.ly, maxZ: c.z + c.lz }));
  const nodes = [];
  (bars || []).forEach((b, bi) => {
    if (bi === excludeIdx || b.hidden) return;
    if (b.host && hiddenIds.has(b.host)) return;
    if (hiddenBoxes.length && barOverlapsBoxes(b, hiddenBoxes)) return;
    const g = genBarPoints(b);
    const px = Number(b.Pos_x) || 0, py = Number(b.Pos_y) || 0, pz = Number(b.Pos_z) || 0;
    const transformed = g.points.map((pt) => transformBarLocalPoint(b, pt));
    for (const [ox, oy, oz] of distOffsets(b).slice(0, MAX_RENDER_COPIES)) {
      for (const [tx, ty, tz] of transformed) {
        nodes.push([px + ox + tx, py + oy + ty, pz + oz + tz]);
      }
    }
  });
  return nodes;
}

// Bounding box corners, edge midpoints, and face centers of visible concrete members
export function concreteSnapNodes(concretes) {
  const nodes = [];
  (concretes || []).forEach((c) => {
    if (c.visible === false) return;
    const x0 = Number(c.x) || 0, y0 = Number(c.y) || 0, z0 = Number(c.z) || 0;
    const lx = Number(c.lx) || 0, ly = Number(c.ly) || 0, lz = Number(c.lz) || 0;
    // 8 bounding corners
    for (const dx of [0, lx]) {
      for (const dy of [0, ly]) {
        for (const dz of [0, lz]) {
          nodes.push([x0 + dx, y0 + dy, z0 + dz]);
        }
      }
    }
    // 6 face centers
    nodes.push([x0 + lx / 2, y0 + ly / 2, z0]);
    nodes.push([x0 + lx / 2, y0 + ly / 2, z0 + lz]);
    nodes.push([x0, y0 + ly / 2, z0 + lz / 2]);
    nodes.push([x0 + lx, y0 + ly / 2, z0 + lz / 2]);
    nodes.push([x0 + lx / 2, y0, z0 + lz / 2]);
    nodes.push([x0 + lx / 2, y0 + ly, z0 + lz / 2]);
  });
  return nodes;
}

// All snap nodes (rebar + concrete)
export function allSnapNodes(bars, concretes, excludeIdx = -1, includeConcrete = true) {
  const rNodes = rebarSnapNodes(bars, concretes, excludeIdx);
  if (!includeConcrete) return rNodes;
  const cNodes = concreteSnapNodes(concretes);
  return [...rNodes, ...cNodes];
}

// Distribution grid — mirrors FreeCAD parametric_utils.py place_c_link_*:
// copies at (Pos_x + ix*spacing_x + offset_x, Pos_y + iy*spacing_y + offset_y,
//            Pos_z + offset_z). Applies to ALL bar types in the browser so
// straight/bent/crank runs distribute like the Reinforcement workbench.
// Total placed bars = qty (sets) × qty_x × qty_y.
export const MAX_RENDER_COPIES = 200;

const num = (v, fb) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' && v !== null && v !== undefined ? n : fb;
};

export function distCount(bar) {
  const sets = Math.max(1, Math.floor(num(bar.qty, 1)));
  const nx = Math.max(1, Math.floor(num(bar.qty_x, 1)));
  const ny = Math.max(1, Math.floor(num(bar.qty_y, 1)));
  return sets * nx * ny;
}

// World-space offsets (mm) for each copy, before Pos_Rotation.
export function distOffsets(bar) {
  const sets = Math.max(1, Math.floor(num(bar.qty, 1)));
  const nx = Math.max(1, Math.floor(num(bar.qty_x, 1)));
  const ny = Math.max(1, Math.floor(num(bar.qty_y, 1)));
  const sx = num(bar.spacing_x, 0);
  const sy = num(bar.spacing_y, 0);
  const ox = num(bar.offset_x, 0);
  const oy = num(bar.offset_y, 0);
  const oz = num(bar.offset_z, 0);
  const out = [];
  for (let s = 0; s < sets; s++)
    for (let ix = 0; ix < nx; ix++)
      for (let iy = 0; iy < ny; iy++)
        out.push([ox + ix * sx, oy + iy * sy, oz]);
  return out;
}
