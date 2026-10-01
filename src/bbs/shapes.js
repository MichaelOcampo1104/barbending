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

// Generates a new rebar pre-fitted and snapped inside the active host concrete member.
export function defaultBarForHost(type, tag = 1, host = null, cover = 30) {
  const base = defaultBar(type, tag);
  if (!host) return base;

  const dia = Number(base.Dia || 16);
  const cv = Number(cover) || 30;
  const inset = cv + dia / 2;

  const isBeamX = host.lx >= host.ly && host.lx >= host.lz;
  const isColZ = host.lz > host.lx && host.lz > host.ly;
  const isSlabXY = host.lz < host.lx && host.lz < host.ly;
  const isStirrup = type === 'c_link' || type === 'c_link_with_hook';

  if (isStirrup) {
    if (isBeamX) {
      const lenA = Math.max(dia * 2, Math.round(host.ly - 2 * cv - dia));
      const lenB = Math.max(dia * 2, Math.round(host.lz - 2 * cv - dia));
      return {
        ...base,
        host: host.id,
        Plane: 'YZ',
        Pos_Rotation: 0,
        c_length_a: lenA,
        c_length_b: lenB,
        length: lenA,
        Pos_x: Math.round((host.x + cv + dia / 2) * 10) / 10,
        Pos_y: Math.round((host.y + inset) * 10) / 10,
        Pos_z: Math.round((host.z + inset) * 10) / 10,
        spacing_x: 150,
        qty_x: Math.max(1, Math.floor((host.lx - 2 * cv) / 150)),
        qty_y: 1,
      };
    } else if (isColZ) {
      const lenA = Math.max(dia * 2, Math.round(host.lx - 2 * cv - dia));
      const lenB = Math.max(dia * 2, Math.round(host.ly - 2 * cv - dia));
      return {
        ...base,
        host: host.id,
        Plane: 'XY',
        Pos_Rotation: 0,
        c_length_a: lenA,
        c_length_b: lenB,
        length: lenA,
        Pos_x: Math.round((host.x + inset) * 10) / 10,
        Pos_y: Math.round((host.y + inset) * 10) / 10,
        Pos_z: Math.round((host.z + cv + dia / 2) * 10) / 10,
        spacing_x: 0,
        qty_x: 1,
        spacing_y: 150,
        qty_y: Math.max(1, Math.floor((host.lz - 2 * cv) / 150)),
      };
    } else {
      const lenA = Math.max(dia * 2, Math.round(host.lx - 2 * cv - dia));
      const lenB = Math.max(dia * 2, Math.round(host.lz - 2 * cv - dia));
      return {
        ...base,
        host: host.id,
        Plane: 'XZ',
        Pos_Rotation: 0,
        c_length_a: lenA,
        c_length_b: lenB,
        length: lenA,
        Pos_x: Math.round((host.x + inset) * 10) / 10,
        Pos_y: Math.round((host.y + inset) * 10) / 10,
        Pos_z: Math.round((host.z + cv + dia / 2) * 10) / 10,
        spacing_x: 150,
        qty_x: Math.max(1, Math.floor((host.lx - 2 * cv) / 150)),
        qty_y: 1,
      };
    }
  }

  // Longitudinal bars: straight, bent, crank, double_crank
  if (isBeamX) {
    const mainLen = Math.max(300, Math.round(host.lx - 2 * cv));
    const hLen = Math.max(100, Math.round(host.lz - 2 * cv));
    const crankStep = Math.max(50, Math.round(host.lz - 2 * inset));
    return {
      ...base,
      host: host.id,
      Plane: 'XZ',
      Pos_Rotation: 0,
      Pos_x: Math.round((host.x + cv) * 10) / 10,
      Pos_y: Math.round((host.y + inset) * 10) / 10,
      Pos_z: Math.round((host.z + inset) * 10) / 10,
      'Length of Bar': mainLen,
      Long_length: mainLen,
      H: hLen,
      Crank_step: crankStep,
      'Length of Lap': Math.min(500, Math.round(mainLen * 0.2)),
      DC_Lap_Start: Math.round(mainLen * 0.25),
      DC_Lap_Mid: Math.round(mainLen * 0.5),
      DC_Tail_Length: Math.round(mainLen * 0.25),
      qty_x: 1,
      qty_y: 1,
    };
  } else if (isColZ) {
    const mainLen = Math.max(300, Math.round(host.lz - 2 * cv));
    const hLen = Math.max(100, Math.round(host.lx - 2 * cv));
    const crankStep = Math.max(50, Math.round(host.lx - 2 * inset));
    return {
      ...base,
      host: host.id,
      Plane: 'XZ',
      Pos_Rotation: 90,
      Pos_x: Math.round((host.x + inset) * 10) / 10,
      Pos_y: Math.round((host.y + inset) * 10) / 10,
      Pos_z: Math.round((host.z + cv) * 10) / 10,
      'Length of Bar': mainLen,
      Long_length: mainLen,
      H: hLen,
      Crank_step: crankStep,
      'Length of Lap': Math.min(500, Math.round(mainLen * 0.2)),
      DC_Lap_Start: Math.round(mainLen * 0.25),
      DC_Lap_Mid: Math.round(mainLen * 0.5),
      DC_Tail_Length: Math.round(mainLen * 0.25),
      qty_x: 1,
      qty_y: 1,
    };
  } else if (isSlabXY) {
    const mainLen = Math.max(300, Math.round(host.lx - 2 * cv));
    const crankStep = Math.max(50, Math.round(host.lz - 2 * inset));
    return {
      ...base,
      host: host.id,
      Plane: 'XY',
      Pos_Rotation: 0,
      Pos_x: Math.round((host.x + cv) * 10) / 10,
      Pos_y: Math.round((host.y + inset) * 10) / 10,
      Pos_z: Math.round((host.z + inset) * 10) / 10,
      'Length of Bar': mainLen,
      Long_length: mainLen,
      Crank_step: crankStep,
      'Length of Lap': Math.min(500, Math.round(mainLen * 0.2)),
      DC_Lap_Start: Math.round(mainLen * 0.25),
      DC_Lap_Mid: Math.round(mainLen * 0.5),
      DC_Tail_Length: Math.round(mainLen * 0.25),
      spacing_y: 200,
      qty_y: Math.max(1, Math.floor((host.ly - 2 * cv) / 200)),
    };
  } else {
    const mainLen = Math.max(300, Math.round(host.lx - 2 * cv));
    return {
      ...base,
      host: host.id,
      Plane: 'XZ',
      Pos_Rotation: 0,
      Pos_x: Math.round((host.x + cv) * 10) / 10,
      Pos_y: Math.round((host.y + inset) * 10) / 10,
      Pos_z: Math.round((host.z + inset) * 10) / 10,
      'Length of Bar': mainLen,
      Long_length: mainLen,
    };
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
export function applyTypeDefaults(bar, type, host = null, cover = 30) {
  const next = { ...bar, Rebar_Type: type };
  for (const f of ALL_DIM_FIELDS) delete next[f];
  const fresh = host ? defaultBarForHost(type, bar.Rebar_tag, host, cover) : defaultBar(type, bar.Rebar_tag);
  for (const f of DIM_FIELDS_BY_TYPE[type] || []) next[f] = fresh[f];
  if (host && (type === 'c_link' || type === 'c_link_with_hook')) {
    next.Plane = fresh.Plane;
    next.Pos_x = fresh.Pos_x;
    next.Pos_y = fresh.Pos_y;
    next.Pos_z = fresh.Pos_z;
    next.qty_x = fresh.qty_x;
    next.spacing_x = fresh.spacing_x;
    next.qty_y = fresh.qty_y;
    next.spacing_y = fresh.spacing_y;
  }
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

// Determines the associated concrete member ID ('c1', etc.) for a rebar.
// Matches by explicit ID, name, Member/Concrete_element column, group, or spatial bounding box containment.
export function resolveBarHost(bar, concretes = []) {
  if (!bar || !concretes || !concretes.length) return null;

  // 1. Direct match on bar.host by ID
  if (bar.host) {
    const direct = concretes.find((c) => c.id === bar.host);
    if (direct) return direct.id;
    // Match by name
    const byName = concretes.find((c) => c.name && c.name.toLowerCase() === String(bar.host).toLowerCase());
    if (byName) return byName.id;
    // Match by ID case-insensitive
    const byIdCase = concretes.find((c) => c.id && c.id.toLowerCase() === String(bar.host).toLowerCase());
    if (byIdCase) return byIdCase.id;
  }

  // 2. Match by Concrete_element or Member fields (from CSV or FreeCAD)
  const candidateName = bar.Concrete_element || bar.Concrete || bar.Member || bar.host_name;
  if (candidateName) {
    const str = String(candidateName).trim().toLowerCase();
    const matched = concretes.find((c) =>
      c.id?.toLowerCase() === str || c.name?.toLowerCase() === str
    );
    if (matched) return matched.id;
  }

  // 3. Match if bar.Group matches a concrete member name or ID
  if (bar.Group) {
    const grp = String(bar.Group).trim().toLowerCase();
    const byGrp = concretes.find((c) => c.id?.toLowerCase() === grp || c.name?.toLowerCase() === grp);
    if (byGrp) return byGrp.id;
  }

  // 4. Spatial bounding-box check: does the bar lie within / overlap a concrete element?
  try {
    const bb = barAppBox(bar);
    if ([bb.minX, bb.minY, bb.minZ, bb.maxX, bb.maxY, bb.maxZ].every(Number.isFinite)) {
      const midX = (bb.minX + bb.maxX) / 2;
      const midY = (bb.minY + bb.maxY) / 2;
      const midZ = (bb.minZ + bb.maxZ) / 2;

      // Check containment of bar centroid with a generous margin (e.g. 100mm tolerance for cover/hooks)
      for (const c of concretes) {
        const margin = 100;
        const cMinX = c.x - margin, cMaxX = c.x + c.lx + margin;
        const cMinY = c.y - margin, cMaxY = c.y + c.ly + margin;
        const cMinZ = c.z - margin, cMaxZ = c.z + c.lz + margin;

        if (midX >= cMinX && midX <= cMaxX &&
            midY >= cMinY && midY <= cMaxY &&
            midZ >= cMinZ && midZ <= cMaxZ) {
          return c.id;
        }
      }

      // Check standard bounding box intersection
      for (const c of concretes) {
        if (bb.minX <= (c.x + c.lx) && bb.maxX >= c.x &&
            bb.minY <= (c.y + c.ly) && bb.maxY >= c.y &&
            bb.minZ <= (c.z + c.lz) && bb.maxZ >= c.z) {
          return c.id;
        }
      }
    }
  } catch (_) {}

  // 5. If only 1 concrete element exists in the whole project, associate by default
  if (concretes.length === 1) {
    return concretes[0].id;
  }

  return null;
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
    if (c.meshData && c.meshData.positions?.length) {
      const pts = c.meshData.positions;
      for (let i = 0; i < pts.length; i += 3) {
        nodes.push([pts[i], pts[i + 1], pts[i + 2]]);
      }
      return;
    }
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
    // 12 edge midpoints (4 along each axis)
    for (const dy of [0, ly]) {
      for (const dz of [0, lz]) nodes.push([x0 + lx / 2, y0 + dy, z0 + dz]);
    }
    for (const dx of [0, lx]) {
      for (const dz of [0, lz]) nodes.push([x0 + dx, y0 + ly / 2, z0 + dz]);
    }
    for (const dx of [0, lx]) {
      for (const dy of [0, ly]) nodes.push([x0 + dx, y0 + dy, z0 + lz / 2]);
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

// Box edges of visible concrete members as app-mm [p1, p2] pairs (12 per
// member, or exact mesh triangle edges). Drives true edge snapping so the
// magnet grabs anywhere along an edge, not just at corners/midpoints.
export function concreteEdges(concretes) {
  const segs = [];
  (concretes || []).forEach((c) => {
    if (c.visible === false) return;
    if (c.meshData && c.meshData.positions?.length && c.meshData.indices?.length) {
      const pts = c.meshData.positions;
      const idx = c.meshData.indices;
      for (let i = 0; i < idx.length; i += 3) {
        const i0 = idx[i] * 3, i1 = idx[i + 1] * 3, i2 = idx[i + 2] * 3;
        segs.push([[pts[i0], pts[i0 + 1], pts[i0 + 2]], [pts[i1], pts[i1 + 1], pts[i1 + 2]]]);
        segs.push([[pts[i1], pts[i1 + 1], pts[i1 + 2]], [pts[i2], pts[i2 + 1], pts[i2 + 2]]]);
        segs.push([[pts[i2], pts[i2 + 1], pts[i2 + 2]], [pts[i0], pts[i0 + 1], pts[i0 + 2]]]);
      }
      return;
    }
    const x0 = Number(c.x) || 0, y0 = Number(c.y) || 0, z0 = Number(c.z) || 0;
    const lx = Number(c.lx) || 0, ly = Number(c.ly) || 0, lz = Number(c.lz) || 0;
    const X = [x0, x0 + lx], Y = [y0, y0 + ly], Z = [z0, z0 + lz];
    for (const y of Y) for (const z of Z) segs.push([[X[0], y, z], [X[1], y, z]]);
    for (const x of X) for (const z of Z) segs.push([[x, Y[0], z], [x, Y[1], z]]);
    for (const x of X) for (const y of Y) segs.push([[x, y, Z[0]], [x, y, Z[1]]]);
  });
  return segs;
}

// Centerline segments of visible bars (app-mm [p1, p2] pairs, every polyline
// leg of every rendered distribution copy). Same visibility rules as
// rebarSnapNodes; excludeIdx skips the bar being placed itself.
export function rebarSegments(bars, concretes, excludeIdx = -1) {
  const hiddenIds = new Set((concretes || []).filter((c) => c.visible === false).map((c) => c.id));
  const hiddenBoxes = (concretes || []).filter((c) => c.visible === false)
    .map((c) => ({ minX: c.x, minY: c.y, minZ: c.z, maxX: c.x + c.lx, maxY: c.y + c.ly, maxZ: c.z + c.lz }));
  const segs = [];
  (bars || []).forEach((b, bi) => {
    if (bi === excludeIdx || b.hidden) return;
    if (b.host && hiddenIds.has(b.host)) return;
    if (hiddenBoxes.length && barOverlapsBoxes(b, hiddenBoxes)) return;
    const g = genBarPoints(b);
    const px = Number(b.Pos_x) || 0, py = Number(b.Pos_y) || 0, pz = Number(b.Pos_z) || 0;
    const transformed = g.points.map((pt) => transformBarLocalPoint(b, pt));
    for (const [ox, oy, oz] of distOffsets(b).slice(0, MAX_RENDER_COPIES)) {
      const world = transformed.map(([tx, ty, tz]) => [px + ox + tx, py + oy + ty, pz + oz + tz]);
      for (let i = 1; i < world.length; i++) segs.push([world[i - 1], world[i]]);
    }
  });
  return segs;
}

// Reference-line segments of visible lines attached to visible concrete.
export function refLineSegments(refLines = [], concretes = []) {
  const hiddenConcreteIds = new Set((concretes || []).filter((c) => c.visible === false).map((c) => c.id));
  const segs = [];
  for (const l of refLines || []) {
    if (l.visible === false) continue;
    if (l.host && hiddenConcreteIds.has(l.host)) continue;
    if (l.p1 && l.p2) segs.push([l.p1, l.p2]);
  }
  return segs;
}

// Centerline, endpoint, and midpoint snap nodes of visible reference lines attached to visible concrete
export function refLineSnapNodes(refLines = [], concretes = []) {
  const hiddenConcreteIds = new Set((concretes || []).filter((c) => c.visible === false).map((c) => c.id));
  const nodes = [];
  for (const l of refLines || []) {
    if (l.visible === false) continue;
    if (l.host && hiddenConcreteIds.has(l.host)) continue;
    if (l.p1) nodes.push(l.p1);
    if (l.p2) nodes.push(l.p2);
    if (l.p1 && l.p2) {
      nodes.push([
        (l.p1[0] + l.p2[0]) / 2,
        (l.p1[1] + l.p2[1]) / 2,
        (l.p1[2] + l.p2[2]) / 2,
      ]);
    }
  }
  return nodes;
}

// All snap nodes (rebar + concrete + reference lines)
export function allSnapNodes(bars, concretes, refLines = [], excludeIdx = -1, includeConcrete = true) {
  const rNodes = rebarSnapNodes(bars, concretes, excludeIdx);
  const refNodes = refLineSnapNodes(refLines, concretes);
  if (!includeConcrete) return [...rNodes, ...refNodes];
  const cNodes = concreteSnapNodes(concretes);
  return [...rNodes, ...cNodes, ...refNodes];
}

// All snap segments ([p1, p2] app-mm pairs) matching allSnapNodes coverage.
export function allSnapSegments(bars, concretes, refLines = [], excludeIdx = -1, includeConcrete = true) {
  const segs = [...rebarSegments(bars, concretes, excludeIdx), ...refLineSegments(refLines, concretes)];
  if (includeConcrete) segs.push(...concreteEdges(concretes));
  return segs;
}

// Categorized snap primitives for osnap-style options (Endpoint / Midpoint /
// Center toggles + Nearest / Perpendicular edge modes). All points/segments
// are app-mm; visibility rules mirror the individual builders above.
//   ends: bar vertices, concrete corners, ref-line endpoints
//   mids: bar-leg midpoints, concrete edge midpoints, ref-line midpoints
//   centers: concrete face centers
//   segments: concrete edges, bar legs, ref lines (Nearest + Perpendicular)
export function snapPrimitives(bars, concretes, refLines = [], excludeIdx = -1, includeConcrete = true) {
  const ends = [], mids = [], centers = [];
  const hiddenIds = new Set((concretes || []).filter((c) => c.visible === false).map((c) => c.id));
  const hiddenBoxes = (concretes || []).filter((c) => c.visible === false)
    .map((c) => ({ minX: c.x, minY: c.y, minZ: c.z, maxX: c.x + c.lx, maxY: c.y + c.ly, maxZ: c.z + c.lz }));
  (bars || []).forEach((b, bi) => {
    if (bi === excludeIdx || b.hidden) return;
    if (b.host && hiddenIds.has(b.host)) return;
    if (hiddenBoxes.length && barOverlapsBoxes(b, hiddenBoxes)) return;
    const g = genBarPoints(b);
    const px = Number(b.Pos_x) || 0, py = Number(b.Pos_y) || 0, pz = Number(b.Pos_z) || 0;
    const transformed = g.points.map((pt) => transformBarLocalPoint(b, pt));
    for (const [ox, oy, oz] of distOffsets(b).slice(0, MAX_RENDER_COPIES)) {
      const world = transformed.map(([tx, ty, tz]) => [px + ox + tx, py + oy + ty, pz + oz + tz]);
      for (const w of world) ends.push(w);
      for (let i = 1; i < world.length; i++) {
        mids.push([
          (world[i - 1][0] + world[i][0]) / 2,
          (world[i - 1][1] + world[i][1]) / 2,
          (world[i - 1][2] + world[i][2]) / 2,
        ]);
      }
    }
  });
  if (includeConcrete) {
    (concretes || []).forEach((c) => {
      if (c.visible === false) return;
      const x0 = Number(c.x) || 0, y0 = Number(c.y) || 0, z0 = Number(c.z) || 0;
      const lx = Number(c.lx) || 0, ly = Number(c.ly) || 0, lz = Number(c.lz) || 0;
      for (const dx of [0, lx]) for (const dy of [0, ly]) for (const dz of [0, lz]) ends.push([x0 + dx, y0 + dy, z0 + dz]);
      for (const dy of [0, ly]) for (const dz of [0, lz]) mids.push([x0 + lx / 2, y0 + dy, z0 + dz]);
      for (const dx of [0, lx]) for (const dz of [0, lz]) mids.push([x0 + dx, y0 + ly / 2, z0 + dz]);
      for (const dx of [0, lx]) for (const dy of [0, ly]) mids.push([x0 + dx, y0 + dy, z0 + lz / 2]);
      centers.push(
        [x0 + lx / 2, y0 + ly / 2, z0], [x0 + lx / 2, y0 + ly / 2, z0 + lz],
        [x0, y0 + ly / 2, z0 + lz / 2], [x0 + lx, y0 + ly / 2, z0 + lz / 2],
        [x0 + lx / 2, y0, z0 + lz / 2], [x0 + lx / 2, y0 + ly, z0 + lz / 2],
      );
    });
  }
  const hiddenConcreteIds = new Set((concretes || []).filter((c) => c.visible === false).map((c) => c.id));
  for (const l of refLines || []) {
    if (l.visible === false) continue;
    if (l.host && hiddenConcreteIds.has(l.host)) continue;
    if (l.p1) ends.push(l.p1);
    if (l.p2) ends.push(l.p2);
    if (l.p1 && l.p2) mids.push([(l.p1[0] + l.p2[0]) / 2, (l.p1[1] + l.p2[1]) / 2, (l.p1[2] + l.p2[2]) / 2]);
  }
  return { ends, mids, centers, segments: allSnapSegments(bars, concretes, refLines, excludeIdx, includeConcrete) };
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

// Distance calculation from a 3D point (app-mm) to a rebar's centerline/geometry
export function distToBar(pt, bar) {
  if (!bar || !pt) return Infinity;
  const px = Number(bar.Pos_x) || 0;
  const py = Number(bar.Pos_y) || 0;
  const pz = Number(bar.Pos_z) || 0;
  const g = genBarPoints(bar);
  const transformed = g.points.map((p) => transformBarLocalPoint(bar, p));
  let minD = Infinity;

  const offsets = distOffsets(bar).slice(0, 100);
  for (const [ox, oy, oz] of offsets) {
    for (let i = 0; i < transformed.length; i++) {
      const v1 = [px + ox + transformed[i][0], py + oy + transformed[i][1], pz + oz + transformed[i][2]];
      const d = Math.hypot(pt[0] - v1[0], pt[1] - v1[1], pt[2] - v1[2]);
      if (d < minD) minD = d;

      if (i > 0) {
        const v0 = [px + ox + transformed[i - 1][0], py + oy + transformed[i - 1][1], pz + oz + transformed[i - 1][2]];
        const segD = distToSegment3D(pt, v0, v1);
        if (segD < minD) minD = segD;
      }
    }
  }
  return minD;
}

function distToSegment3D(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const ab2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  if (ab2 === 0) return Math.hypot(ap[0], ap[1], ap[2]);
  let t = (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / ab2;
  t = Math.max(0, Math.min(1, t));
  const proj = [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]];
  return Math.hypot(p[0] - proj[0], p[1] - proj[1], p[2] - proj[2]);
}
