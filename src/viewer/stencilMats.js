import * as THREE from 'three';
import { planeSingles, planeOthers } from './sectionPlanes.js';

// Stencil-cap materials for solid-looking section cuts (three.js clipping-stencil
// pattern): per plane, back faces increment + front faces decrement the stencil
// (colour/depth writes off), then a cap quad fills pixels where stencil != 0.
// Robustness: each plane owns one stencil bit (write/test masks), so caps never
// depend on inter-plane clear timing; the per-face clearStencil in SectionBox
// is only belt-and-braces. All arrays reference the shared live Plane objects;
// materials are created once and shared by every clipped object.
function stencilMarkMaterial(side, planeIndex, increment) {
  const m = new THREE.MeshBasicMaterial();
  m.depthWrite = false;
  m.depthTest = false;
  m.colorWrite = false;
  m.stencilWrite = true;
  m.stencilFunc = THREE.AlwaysStencilFunc;
  m.stencilWriteMask = 1 << planeIndex;
  const op = increment ? THREE.IncrementWrapStencilOp : THREE.DecrementWrapStencilOp;
  m.stencilFail = op;
  m.stencilZFail = op;
  m.stencilZPass = op;
  m.side = side;
  m.clippingPlanes = planeSingles[planeIndex];
  return m;
}

// [planeIndex] -> { back, front }
export const stencilMats = planeSingles.map((_, i) => ({
  back: stencilMarkMaterial(THREE.BackSide, i, true),
  front: stencilMarkMaterial(THREE.FrontSide, i, false),
}));

export function capMaterial(planeIndex, color = '#d6d3d1') {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, emissive: color, emissiveIntensity: 0.35 });
  m.stencilWrite = true;
  m.stencilRef = 0;
  m.stencilFunc = THREE.NotEqualStencilFunc;
  m.stencilFuncMask = 1 << planeIndex;
  m.stencilWriteMask = 1 << planeIndex; // cap's own Replace-write touches only its bit
  m.stencilFail = THREE.ReplaceStencilOp;
  m.stencilZFail = THREE.ReplaceStencilOp;
  m.stencilZPass = THREE.ReplaceStencilOp;
  m.clippingPlanes = planeOthers[planeIndex];
  return m;
}
