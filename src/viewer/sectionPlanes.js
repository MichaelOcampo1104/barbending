import * as THREE from 'three';

// World-space clipping planes shared by every clipped material (rebar, concrete,
// IFC ghost/highlight). Mutated in place so bound changes never recompile shaders.
// Disabled = giant box (no visible cut, no program switch).
export const sectionPlanes = [
  new THREE.Plane(new THREE.Vector3(1, 0, 0), 1e6),
  new THREE.Plane(new THREE.Vector3(-1, 0, 0), 1e6),
  new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e6),
  new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6),
  new THREE.Plane(new THREE.Vector3(0, 0, 1), 1e6),
  new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e6),
];

const HUGE = 1e6;

export function updateSectionPlanes(min, max) {
  if (!min || !max) {
    for (const p of sectionPlanes) p.constant = HUGE;
    return;
  }
  updateSectionPlanesBox(
    [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    [0, 0, 0, 1],
  );
}

// Rotated box: inward-facing planes derived from center/size/quaternion.
// +face i: normal -nOut through center + nOut·size/2; -face i: +nOut through center - nOut·size/2.
export function updateSectionPlanesBox(center, size, quat) {
  const q = new THREE.Quaternion(quat[0], quat[1], quat[2], quat[3]);
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const c = new THREE.Vector3(center[0], center[1], center[2]);
  axes.forEach((a, i) => {
    const nOut = new THREE.Vector3(a[0], a[1], a[2]).applyQuaternion(q);
    const pPlus = c.clone().addScaledVector(nOut, size[i] / 2);
    sectionPlanes[2 * i].normal.copy(nOut).negate();
    sectionPlanes[2 * i].constant = nOut.dot(pPlus);
    const pMinus = c.clone().addScaledVector(nOut, -size[i] / 2);
    sectionPlanes[2 * i + 1].normal.copy(nOut);
    sectionPlanes[2 * i + 1].constant = -nOut.dot(pMinus);
  });
}

// Stable single-plane / other-planes arrays (same Plane refs; assign once, no recompiles).
export const planeSingles = sectionPlanes.map((p) => [p]);
export const planeOthers = sectionPlanes.map((_, i) => sectionPlanes.filter((__, j) => j !== i));
export function normalizeSection(s) {
  if (!s) return s;
  let { center, size } = s;
  if ((!center || !size) && s.min && s.max) {
    center = [(s.min[0] + s.max[0]) / 2, (s.min[1] + s.max[1]) / 2, (s.min[2] + s.max[2]) / 2];
    size = [s.max[0] - s.min[0], s.max[1] - s.min[1], s.max[2] - s.min[2]];
  }
  return {
    enabled: !!s.enabled,
    mode: s.mode ?? 'faces',
    center, size,
    quat: s.quat ?? [0, 0, 0, 1],
    solidCut: s.solidCut ?? true,
  };
}
// Default box: IFC bounds + margin, else an 8×4×8 m cube. Scene units (metres).
// Tolerant of pre-size model metadata (bbox without .size) from older sessions.
export function defaultSectionBox(ifc) {
  if (ifc) {
    const u = ifc.unitToMeters;
    const c = ifc.bbox.center.map((v) => v * u);
    let sz = ifc.bbox.size?.map((v) => v * u);
    if (!sz) {
      const s = ((ifc.bbox.radius ?? 5) * u * 2) / Math.sqrt(3);
      sz = [s, s, s];
    }
    return { center: c, size: sz.map((v) => v + 0.5) };
  }
  return { center: [0, 2, 0], size: [8, 4, 8] };
}

// Param t along axis line (A0 + t·N, N unit) closest to pointer ray (Ro + s·Rd).
// Used for push/pull face dragging.
export function closestAxisParam(Ro, Rd, A0, N) {
  const w0 = new THREE.Vector3().subVectors(A0, Ro);
  const b = N.dot(Rd);
  const d = N.dot(w0);
  const e = Rd.dot(w0);
  const denom = 1 - b * b;
  if (Math.abs(denom) < 1e-6) return 0;
  return (b * e - d) / denom;
}
