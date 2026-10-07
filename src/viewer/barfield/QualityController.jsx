import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { createQualityController } from './quality.js';
import { qualityState } from './qualityState.js';

// Replaces drei's AdaptiveDpr for the field renderer: watches frame times while the camera moves and
// steps the pixel ratio and the tube triangle budget (spec 8.1). "Interacting" = the camera moved
// within the last 250 ms, whatever moved it (orbit, wheel zoom, keys, fit / view animations). An
// orthographic camera zooms without moving, so its zoom counts as movement too.
export default function QualityController() {
  const camera = useThree((s) => s.camera);
  const setDpr = useThree((s) => s.setDpr);
  const ctl = useMemo(() => createQualityController(), []);
  const prev = useRef({ pos: new THREE.Vector3(), quat: new THREE.Quaternion(), zoom: 1, movedAt: -Infinity, init: false });
  useFrame((_, delta) => {
    const now = performance.now();
    const p = prev.current;
    if (!p.init) { p.pos.copy(camera.position); p.quat.copy(camera.quaternion); p.zoom = camera.zoom; p.init = true; }
    const moved = p.pos.distanceToSquared(camera.position) > 1e-10 || p.quat.angleTo(camera.quaternion) > 1e-5
      || Math.abs(camera.zoom - p.zoom) > 1e-6 * p.zoom;
    if (moved) { p.movedAt = now; p.pos.copy(camera.position); p.quat.copy(camera.quaternion); p.zoom = camera.zoom; }
    const r = ctl.update(Math.min(delta * 1000, 250), now - p.movedAt < 250, now);
    if (r.changed) {
      qualityState.budgetTris = r.budgetTris;
      qualityState.level = r.level;
      const dpr = Math.max(1, Math.min(r.dpr, window.devicePixelRatio || 1));
      qualityState.dpr = dpr;
      setDpr(dpr);
    }
  });
  return null;
}
