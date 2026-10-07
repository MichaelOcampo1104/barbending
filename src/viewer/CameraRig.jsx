import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useStore } from '../store.js';
import { PERSP_FOV_DEG, viewFromForward } from './cameraMath.js';
import { enableControls, switchProjection } from './cameraOps.js';

// Owns the viewport's two cameras (perspective + orthographic) and their orbit controls. Only one pair
// is active: `state.camera` / `state.controls` always point at it, so every other component keeps
// using useThree() unchanged. Two real cameras, one OrbitControls each, because OrbitControls checks
// the camera's class (instanceof) and a camera that only flips flags would lose panning and zoom.
//
// Switching keeps what you are looking at: the same orbit target, the same view direction and the same
// visible region at the target plane (the dolly-zoom identity), so the picture only loses its
// perspective. The store's `projection` ('persp' | 'ortho') drives it; the six true views request ortho.
export default function CameraRig({ cameras, perspControls, orthoControls }) {
  const projection = useStore((s) => s.projection);
  const set = useThree((s) => s.set);
  const get = useThree((s) => s.get);
  const active = useRef('persp');
  const fwd = useRef(new THREE.Vector3());

  // Start with the perspective camera and its controls (the ortho controls stay disabled).
  useEffect(() => {
    const p = perspControls.current;
    const o = orthoControls.current;
    if (!p || !o) return;
    enableControls(p, o);
    active.current = 'persp';
    set({ camera: cameras.persp, controls: p });
  }, [cameras, perspControls, orthoControls, set]);

  // Projection switch.
  useEffect(() => {
    const next = projection === 'ortho' ? 'ortho' : 'persp';
    if (active.current === next) return;
    const { size, camera: fromCam, controls: fromCtl } = get();
    const toCam = next === 'ortho' ? cameras.ortho : cameras.persp;
    const toCtl = (next === 'ortho' ? orthoControls : perspControls).current;
    if (!fromCam || !fromCtl || !toCtl || fromCam === toCam) return;
    switchProjection({
      next, fromCam, fromCtl, toCam, toCtl, width: size.width, height: size.height, perspFovDeg: PERSP_FOV_DEG,
    });
    set({ camera: toCam, controls: toCtl });
    toCtl.update(); // orients the new camera at the target
    active.current = next;
  }, [projection, cameras, perspControls, orthoControls, get, set]);

  // Which preset the camera is looking along, for the view label (only publishes changes).
  useFrame(() => {
    const cam = get().camera;
    if (!cam) return;
    cam.getWorldDirection(fwd.current);
    const v = fwd.current;
    useStore.getState().setViewName(viewFromForward([v.x, v.y, v.z]));
  });

  return null;
}
