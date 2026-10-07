import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useStore } from '../store.js';
import { clampOrthoZoom, fitZoomForBox } from './cameraMath.js';
import { setOrthoZoom } from './cameraOps.js';

// Drives the default OrbitControls camera to the IFC bounding box.
// Tiny (no IFC parser import) so it can stay in the main bundle.
// Clip planes are owned by AutoClipping — this only moves target + position.
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
    if (camera.isOrthographicCamera) {
      // Distance frames nothing in orthographic: zoom so the bounding sphere fills the view.
      const H = camera.top - camera.bottom;
      setOrthoZoom(camera, clampOrthoZoom(fitZoomForBox({
        halfExtentX: fit.radius, halfExtentY: fit.radius, viewportWidthPx: camera.right - camera.left, viewportHeightPx: H, margin: 1.1,
      }), H));
    }
    controls.update();
  }, [fit, controls, camera]);
  return null;
}
