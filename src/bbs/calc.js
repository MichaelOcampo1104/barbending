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
