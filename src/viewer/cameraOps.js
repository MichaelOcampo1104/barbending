// Imperative operations on the viewport cameras and orbit controls. They live outside the React
// components because they mutate three.js objects React does not own (which the component lint rules
// cannot tell apart from mutating props), and so Node tests can exercise the projection switch directly.
import { Vector3 } from 'three';
import {
  ORTHO_DEPTH, PERSP_MIN_DISTANCE, PERSP_MAX_DISTANCE, clampOrthoZoom, orthoZoomForPerspective,
  perspectiveDistanceForOrtho,
} from './cameraMath.js';

const _back = new Vector3();

// Orthographic zoom is pixels per metre (R3F's convention: the frustum is the canvas size in CSS pixels).
export function setOrthoZoom(camera, zoom) {
  camera.zoom = zoom;
  camera.updateProjectionMatrix();
}

// Hand the viewport from one camera + controls pair to the other without changing what you look at:
// same orbit target, same view direction, and the same visible region on the target plane (the
// dolly-zoom identity), so the picture only gains or loses its perspective. Does not touch R3F state
// and does not call controls.update(); the caller does both.
//  next: 'ortho' | 'persp' (the pair being switched TO), width / height: the canvas in CSS pixels.
export function switchProjection({ next, fromCam, fromCtl, toCam, toCtl, width, height, perspFovDeg }) {
  const target = fromCtl.target;
  toCam.position.copy(fromCam.position);
  toCam.quaternion.copy(fromCam.quaternion);
  toCam.up.copy(fromCam.up);
  if (next === 'ortho') {
    const d = Math.max(fromCam.position.distanceTo(target), 1e-3);
    const zoom = orthoZoomForPerspective({ fovDeg: perspFovDeg, distance: d, viewportHeightPx: height });
    toCam.left = -width / 2;
    toCam.right = width / 2;
    toCam.top = height / 2;
    toCam.bottom = -height / 2;
    toCam.near = -ORTHO_DEPTH;
    toCam.far = ORTHO_DEPTH;
    toCam.zoom = clampOrthoZoom(zoom, height);
  } else {
    const dist = perspectiveDistanceForOrtho({ fovDeg: perspFovDeg, zoom: fromCam.zoom, viewportHeightPx: height });
    _back.subVectors(fromCam.position, target);
    if (_back.lengthSq() < 1e-12) _back.set(0, 0, 1);
    _back.normalize();
    toCam.position.copy(target).addScaledVector(_back, Math.min(PERSP_MAX_DISTANCE, Math.max(PERSP_MIN_DISTANCE, dist)));
    toCam.zoom = 1;
    toCam.aspect = width / height;
  }
  toCam.updateProjectionMatrix();
  toCam.updateMatrixWorld(true);
  toCtl.target.copy(target);
  fromCtl.enabled = false;
  toCtl.enabled = true;
}

// Enable one controls object and disable the other (only one pair is ever active).
export function enableControls(on, off) {
  on.enabled = true;
  off.enabled = false;
}
