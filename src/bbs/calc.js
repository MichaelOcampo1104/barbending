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
