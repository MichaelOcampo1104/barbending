import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useStore } from '../store.js';

// Drives the default OrbitControls camera to the IFC bounding box.
// Tiny (no IFC parser import) so it can stay in the main bundle.
export default function FitIfc() {
  const fit = useStore((s) => s.ifcFit);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  useEffect(() => {
    if (!fit || !controls) return;
    const [cx, cy, cz] = fit.center;
    controls.target.set(cx, cy, cz);
    const d = Math.max(fit.radius * 1.4, 1);
    camera.position.set(cx + d * 0.8, cy + d * 0.6, cz - d * 0.9);
    camera.near = Math.max(d / 1000, 0.01);
    camera.far = Math.max(d * 100, 100);
    camera.updateProjectionMatrix();
    controls.update();
  }, [fit, controls, camera]);
  return null;
}
