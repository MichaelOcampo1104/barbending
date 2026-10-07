import { useEffect } from 'react';
import { Vector3 } from 'three';
import { useThree } from '@react-three/fiber';
import { useStore } from '../store.js';
import { clampOrthoZoom, fitZoomForBox } from './cameraMath.js';
import { setOrthoZoom } from './cameraOps.js';

const _dir = new Vector3();

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
    const d = Math.max(fit.radius * 1.4, 1);
    if (camera.isOrthographicCamera) {
      // Orthographic: keep the view direction (a true Front stays a true Front) and only recentre and zoom
      // so the bounding sphere fills the view; the distance frames nothing in a parallel projection.
      _dir.subVectors(camera.position, controls.target);
      if (_dir.lengthSq() < 1e-12) _dir.set(0.8, 0.6, -0.9);
      _dir.normalize();
      controls.target.set(cx, cy, cz);
      camera.position.set(cx, cy, cz).addScaledVector(_dir, d);
      const H = camera.top - camera.bottom;
      setOrthoZoom(camera, clampOrthoZoom(fitZoomForBox({
        halfExtentX: fit.radius, halfExtentY: fit.radius, viewportWidthPx: camera.right - camera.left, viewportHeightPx: H, margin: 1.1,
      }), H));
    } else {
      controls.target.set(cx, cy, cz);
      camera.position.set(cx + d * 0.8, cy + d * 0.6, cz - d * 0.9);
    }
    controls.update();
  }, [fit, controls, camera]);
  return null;
}
