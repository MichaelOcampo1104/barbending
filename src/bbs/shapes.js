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

export function genBarPoints(bar) {
  const d = Number(bar.Dia || 16);
  switch (bar.Rebar_Type) {
    case 'bent': {
      // L-shape: main leg L along X, bent leg H up (+Z) or down (−Z)
      const L = Number(bar['Length of Bar'] || bar.length || 3000);
      const H = Number(bar.H || 800);
      const dir = String(bar.bent_up_down || 'up').toLowerCase() === 'down' ? -1 : 1;
      const pts = [[0, 0, 0], [L, 0, 0], [L, 0, dir * H]];
      return finish(pts, 1, d);
    }
    case 'crank': {
      // Single crank (offset step s in middle of long bar)
      const L = Number(bar.Long_length || 4000);
      const s = Number(bar.Crank_step || 300);
      const a = L * 0.4, b = L * 0.6;
      const pts = [[0, 0, 0], [a, 0, 0], [b, 0, s], [L, 0, s]];
      return finish(pts, 2, d);
    }
    case 'double_crank': {
      // Z / double crank: tail - mid - tail
      const start = Number(bar.DC_Lap_Start || 1000);
      const mid = Number(bar.DC_Lap_Mid || 2000);
      const tail = Number(bar.DC_Tail_Length || 1000);
      const s = Number(bar.Crank_step || 300);
      const pts = [[0, 0, 0], [start, 0, 0], [start + mid, 0, s], [start + mid + tail, 0, s]];
      return finish(pts, 2, d);
    }
    case 'c_link': {
      // Closed rectangular stirrup a x b in XY plane
      const a = Number(bar.c_length_a || 600);
      const b = Number(bar.c_length_b || 400);
      const pts = [[0, 0, 0], [a, 0, 0], [a, b, 0], [0, b, 0], [0, 0, 0]];
      return finish(pts, 4, d);
    }
    case 'c_link_with_hook': {
      // Stirrup with 135°-ish hooks (modelled as short extensions)
      const a = Number(bar.c_length_a || 600);
      const b = Number(bar.c_length_b || 400);
      const hook = Number(bar.double_hook || 10) * d;
      const pts = [[hook, hook, 0], [a, 0, 0], [a, b, 0], [0, b, 0], [0, 0, 0], [hook, hook, 0]];
      return finish(pts, 5, d);
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
  const base = {
    Rebar_tag: tag,
    Bar_mark: `B${tag}`,
    Rebar_Type: type,
    Dia: 16,
    Pos_x: 0, Pos_y: 0, Pos_z: 0,
    Group: 'HRB3DB_bt',
    Pos_Rotation: 0,
    Plane: 0,
    qty: 1,
  };
  switch (type) {
    case 'bent': return { ...base, 'Length of Bar': 3000, H: 800, bent_up_down: 'up' };
    case 'crank': return { ...base, Long_length: 4000, Crank_step: 300, 'Length of Lap': 500 };
    case 'double_crank': return { ...base, DC_Lap_Start: 1000, DC_Lap_Mid: 2000, DC_Tail_Length: 1000, Crank_step: 300 };
    case 'c_link': return { ...base, c_length_a: 600, c_length_b: 400, length: 2000, qty_x: 1, spacing_x: 150, qty_y: 1, spacing_y: 150 };
    case 'c_link_with_hook': return { ...base, c_length_a: 600, c_length_b: 400, length: 2000, double_hook: 10, qty_x: 1, spacing_x: 150 };
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
  c_link: ['c_length_a', 'c_length_b', 'length'],
  c_link_with_hook: ['c_length_a', 'c_length_b', 'length', 'double_hook'],
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
