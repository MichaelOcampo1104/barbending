// BBS calculations: lengths in mm, weight in kg.
// weight per metre = D^2 / 162.2 (D in mm)

export const unitWeight = (dia) => (dia * dia) / 162.2; // kg/m

export function polylineLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1, z1] = pts[i - 1];
    const [x2, y2, z2] = pts[i];
    L += Math.hypot(x2 - x1, y2 - y1, z2 - z1);
  }
  return L;
}

// Bend deduction: ~2*dia per 90° bend (configurable, simple BS8666-style)
export function bendDeduction(numBends90, dia, factor = 2) {
  return numBends90 * factor * dia;
}

export function barWeightKg(dia, lengthMm, qty = 1) {
  return unitWeight(dia) * (lengthMm / 1000) * qty;
}

// Bond condition per EC2 §8.2: bottom steel casts in good bond, top-zone
// steel in poor bond. Stored per bar as `bond_condition` ('good' | 'poor'
// | '' = auto). The global store.bond stays as the default/fallback for
// bars without an explicit or mark-inferrable value.
export function normalizeBond(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'good' || s === 'poor' ? s : '';
}

export function inferBondFromMark(mark) {
  const m = /^\s*([BT])\s*0*\d+\s*$/i.exec(String(mark ?? ''));
  if (!m) return '';
  return m[1].toUpperCase() === 'T' ? 'poor' : 'good';
}

const STIRRUP_TYPES = new Set(['c_link', 'clink', 'c_link_with_hook']);

// Effective bond for one bar: explicit value wins, else B/T mark inference
// (longitudinal bars only — links carry no lap bond), else fallback.
export function barBond(bar, fallback = 'poor') {
  const exp = normalizeBond(bar?.bond_condition ?? bar?.bond);
  if (exp) return exp;
  if (bar && STIRRUP_TYPES.has(String(bar.Rebar_Type || '').toLowerCase())) {
    return normalizeBond(fallback) || '';
  }
  return inferBondFromMark(bar?.Bar_mark) || normalizeBond(fallback) || '';
}

// Effective bond for a lap between anchor A and lapping bar B: poor wins
// (conservative) when the pair disagrees, else the shared value.
export function lapBondFor(aBar, bBar, fallback = 'poor') {
  const a = barBond(aBar, '');
  const b = barBond(bBar, '');
  if (a === 'poor' || b === 'poor') return 'poor';
  if (a === 'good' || b === 'good') return 'good';
  return normalizeBond(fallback) || 'poor';
}

// Lap lengths (mm) by bar diameter — EC2 §8.7 bond-anchorage basis for the
// project's concrete/steel grades, as specified by the user. Poor bond runs
// ≈1/0.7 of good (EC2 η1 = 0.7 for poor bond conditions).
const LAP_TABLE = {
  good: { 13: 580, 16: 760, 20: 990, 25: 1290, 32: 1650, 40: 2240, 50: 3170 },
  poor: { 13: 830, 16: 1080, 20: 1420, 25: 1840, 32: 2350, 40: 3200, 50: 4520 },
};

// Lap length for a diameter: piecewise-linear interpolation, linear
// extrapolation outside 13–50, rounded UP to 10 mm (conservative).
export function lapLengthMm(dia, bond) {
  const t = LAP_TABLE[bond] || LAP_TABLE.poor;
  const ds = Object.keys(t).map(Number).sort((a, b) => a - b);
  const d = Number(dia);
  if (!Number.isFinite(d) || d <= 0) return 0;
  let L;
  if (d <= ds[0]) {
    L = t[ds[0]] + ((t[ds[1]] - t[ds[0]]) * (d - ds[0])) / (ds[1] - ds[0]);
  } else if (d >= ds[ds.length - 1]) {
    const a = ds[ds.length - 2], b = ds[ds.length - 1];
    L = t[b] + ((t[b] - t[a]) * (d - b)) / (b - a);
  } else {
    const i = ds.findIndex((x) => x >= d);
    const a = ds[i - 1], b = ds[i];
    L = t[a] + ((t[b] - t[a]) * (d - a)) / (b - a);
  }
  return Math.max(0, Math.ceil(L / 10) * 10);
}
