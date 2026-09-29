import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useStore } from '../store.js';

// Blender-style unlimited zoom: the near/far planes track the orbit distance
// every frame, so you can dive from site scale down to a single bar diameter
// without anything clipping. Also feeds FPS + camera distance to the status bar.
export default function AutoClipping() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  const setPerf = useStore((s) => s.setPerf);
  const frames = useRef(0);
  const last = useRef(performance.now());

  useFrame(() => {
    if (!controls) return;
    const d = Math.max(camera.position.distanceTo(controls.target), 1e-6);
    // Constant depth precision at every scale: dive from site to a single bar
    // without close surfaces clipping. Max near of 0.02m ensures close surfaces
    // never clip when inspecting rebar bends, and far of 5000m keeps site context.
    const near = Math.min(Math.max(d / 10000, 0.0001), 0.02);
    const far = Math.max(d * 150, 5000);
    if (Math.abs(camera.near - near) / (near || 1) > 0.1 || Math.abs(camera.far - far) / (far || 1) > 0.1) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
    frames.current += 1;
    const now = performance.now();
    if (now - last.current >= 500) {
      setPerf(Math.round((frames.current * 1000) / (now - last.current)), d);
      frames.current = 0;
      last.current = now;
    }
  });
  return null;
}
