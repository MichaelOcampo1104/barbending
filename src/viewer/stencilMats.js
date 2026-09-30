import * as THREE from 'three';
import { planeSingles, planeOthers } from './sectionPlanes.js';

// Stencil-cap materials for solid-looking section cuts (three.js clipping-stencil
// pattern): per plane, back faces increment + front faces decrement the stencil
// where depthTest passes, then a cap quad fills pixels where stencil != 0.
function stencilMarkMaterial(side, planeIndex, increment) {
  const m = new THREE.MeshBasicMaterial();
  m.depthWrite = false;
  m.depthTest = true;
  m.colorWrite = false;
  m.stencilWrite = true;
  m.stencilFunc = THREE.AlwaysStencilFunc;
  m.stencilWriteMask = 1 << planeIndex;
  m.stencilFuncMask = 1 << planeIndex;
  m.stencilFail = THREE.KeepStencilOp;
  m.stencilZFail = THREE.KeepStencilOp;
  m.stencilZPass = increment ? THREE.IncrementWrapStencilOp : THREE.DecrementWrapStencilOp;
  m.side = side;
  m.clippingPlanes = planeSingles[planeIndex];
  return m;
}

// [planeIndex] -> { back, front }
export const stencilMats = planeSingles.map((_, i) => ({
  back: stencilMarkMaterial(THREE.BackSide, i, true),
  front: stencilMarkMaterial(THREE.FrontSide, i, false),
}));

export function capMaterial(planeIndex, color = '#cbd5e1') {
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.65,
    metalness: 0.05,
    side: THREE.DoubleSide,
    stencilWrite: true,
    stencilRef: 0,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilFuncMask: 1 << planeIndex,
    stencilWriteMask: 1 << planeIndex,
    stencilFail: THREE.ReplaceStencilOp,
    stencilZFail: THREE.ReplaceStencilOp,
    stencilZPass: THREE.ReplaceStencilOp,
    clippingPlanes: planeOthers[planeIndex],
  });
  return m;
}
