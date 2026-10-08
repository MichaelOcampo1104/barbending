import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { Html, TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../store.js';
import { sectionPlanes, updateSectionPlanes, updateSectionPlanesBox, closestAxisParam, normalizeSection } from './sectionPlanes.js';
import { stencilMats, capMaterial } from './stencilMats.js';
import { FACES, AXIS_COLORS, capQuad, faceDragResult } from './sectionBoxMath.js';

const noHitRaycast = () => null;

// One cap material per plane (created once; shared Plane refs, no recompiles).
const capMats = [0, 1, 2, 3, 4, 5].map((i) => capMaterial(i));

// Headless stencil census (?captest=eq0|eq1|eq255): force all caps to
// EqualStencilFunc over the FULL byte to map stencil values (0 vs 1 vs 255
// distinguishes no-marks vs back-only vs front-only). Proves single-sided marks.
if (typeof window !== 'undefined') {
  const ct = new URLSearchParams(window.location.search).get('captest');
  if (ct === 'eq0' || ct === 'eq1' || ct === 'eq255') {
    const ref = ct === 'eq1' ? 1 : ct === 'eq255' ? 255 : 0;
    // full-byte census: neutralise per-plane write masks on marks too
    stencilMats.forEach((m) => {
      m.back.stencilWriteMask = 0xff;
      m.front.stencilWriteMask = 0xff;
    });
    capMats.forEach((m) => {
      m.stencilFunc = THREE.EqualStencilFunc;
      m.stencilFuncMask = 0xff;
      m.stencilRef = ref;
    });
  }
}

const noopRaycast = () => null;
// Imperative (not the onAfterRender prop — R3F may not forward it to the object,
// and without a per-face stencil clear the caps accumulate into full grey faces).
const clearStencilAfter = (renderer) => renderer.clearStencil();
function attachClearStencil(mesh) {
  if (mesh) { mesh.onAfterRender = clearStencilAfter; }
}

// Revit-style section box. Modes: faces (push/pull), translate (move gizmo),
// rotate (rotate gizmo). Clipping uses shared sectionPlanes mutated in place,
// so bound/rotation changes never recompile shaders.
export default function SectionBox() {
  const raw = useStore((s) => s.section);
  const section = normalizeSection(raw);
  const setSection = useStore((s) => s.setSection);
  const controls = useThree((s) => s.controls);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const drag = useRef(null);
  const boxRef = useRef(null);
  const raycaster = useRef(null);
  if (!raycaster.current) raycaster.current = new THREE.Raycaster();

  // Safety: never leave orbit disabled (alt-tab mid-drag, lost pointerup).
  // Stale move listeners are harmless: they early-return on null drag.current,
  // and the once:true up/cancel listeners self-remove.
  // (Above all early returns: hooks must run unconditionally every render.)
  useEffect(() => {
    const rescue = () => {
      drag.current = null;
      if (controls) controls.enabled = true;
      document.body.style.cursor = '';
    };
    window.addEventListener('blur', rescue);
    return () => window.removeEventListener('blur', rescue);
  }, [controls]);

  if (section?.enabled && section.center && section.size) {
    updateSectionPlanesBox(section.center, section.size, section.quat);
  } else if (!section?.enabled) {
    updateSectionPlanes(null, null);
  }
  // Headless isolation (?oneplane=N): park every plane but N giant so a single
  // plane's marks/fill can be judged alone.
  if (typeof window !== 'undefined' && section?.enabled) {
    const op = new URLSearchParams(window.location.search).get('oneplane');
    if (op !== null && op !== '') {
      const keep = Number(op);
      sectionPlanes.forEach((p, i) => { if (i !== keep) p.constant = 1e6; });
    }
  }

  if (!section?.enabled || !section.center || !section.size) return null;
  const { center, size, quat, mode, solidCut } = section;
  const showBox = section.showBox ?? true;
  const q = new THREE.Quaternion(quat[0], quat[1], quat[2], quat[3]);

  const syncFromGizmo = () => {
    const o = boxRef.current;
    if (!o) return;
    setSection({
      center: [o.position.x, o.position.y, o.position.z],
      quat: [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w],
    });
  };

  // Drag uses native window listeners (not R3F pointer capture): pointerdown on a
  // face cube starts the drag, window pointermove drives it, window pointerup ends it.
  const rayFromClient = (clientX, clientY) => {
    const rect = gl.domElement.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.current.setFromCamera(new THREE.Vector2(nx, ny), camera);
    return raycaster.current.ray;
  };
  const applyDrag = (ray) => {
    const d = drag.current;
    if (!d) return;
    const delta = closestAxisParam(ray.origin, ray.direction, d.A0, d.N) - d.t0;
    const next = faceDragResult({ startCenter: d.startCenter, startSize: d.startSize, axis: d.axis, normal: d.N.toArray(), delta });
    setSection({ center: next.center, size: next.size });
  };
  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    window.removeEventListener('pointermove', onWinMove);
    if (controls) controls.enabled = true;
    document.body.style.cursor = '';
  };
  const onWinMove = (ev) => {
    if (!drag.current) return;
    ev.preventDefault();
    applyDrag(rayFromClient(ev.clientX, ev.clientY));
  };
  const onDown = (axis, sign) => (e) => {
    e.stopPropagation();
    if (controls) controls.enabled = false;
    document.body.style.cursor = 'grabbing';
    const N = new THREE.Vector3();
    N.setComponent(axis, sign).applyQuaternion(q);
    const A0 = new THREE.Vector3(...center).addScaledVector(N, size[axis] / 2);
    const ray = rayFromClient(e.nativeEvent.clientX, e.nativeEvent.clientY);
    drag.current = {
      N, A0,
      t0: closestAxisParam(ray.origin, ray.direction, A0, N),
      startCenter: [...center],
      startSize: [...size],
      axis,
    };
    window.addEventListener('pointermove', onWinMove);
    window.addEventListener('pointerup', endDrag, { once: true });
    window.addEventListener('pointercancel', endDrag, { once: true });
  };

  // Hidden-box mode: planes above stay live, but no visuals, handles, gizmo or
  // label mount — zero picking interference while the cut remains active.
  if (!showBox) return null;

  return (
    <>
      <group ref={boxRef} position={center} quaternion={q}>
        <mesh>
          <boxGeometry args={size} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.05} depthWrite={false} />
        </mesh>
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(...size)]} />
          <lineBasicMaterial color="#38bdf8" />
        </lineSegments>
        {mode === 'faces' && FACES.map((f) => {
          const p = [0, 0, 0];
          p[f.axis] = f.sign * (size[f.axis] / 2 + 0.7);
          const lp = [0, 0, 0];
          lp[f.axis] = f.sign * (size[f.axis] / 2 + 0.35);
          const lineArgs = [0.035, 0.035, 0.035];
          lineArgs[f.axis] = 0.7;
          return (
            // leader line from face + 0.6 m invisible hit area + core drawn
            // on top (depthTest off, gizmo style) so caps never hide it
            <group key={`${f.axis}${f.sign > 0 ? 'p' : 'm'}`} position={[0, 0, 0]}>
              <mesh position={lp} raycast={noHitRaycast}>
                <boxGeometry args={lineArgs} />
                <meshBasicMaterial color={AXIS_COLORS[f.axis]} transparent opacity={0.75} depthWrite={false} />
              </mesh>
              <mesh position={p}
                onPointerDown={onDown(f.axis, f.sign)}
                onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'grab'; }}
                onPointerOut={() => { if (!drag.current) document.body.style.cursor = ''; }}
              >
                <boxGeometry args={[0.6, 0.6, 0.6]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
                <mesh renderOrder={999}>
                  <boxGeometry args={[0.3, 0.3, 0.3]} />
                  <meshBasicMaterial color={AXIS_COLORS[f.axis]} transparent opacity={0.95} depthTest={false} depthWrite={false} />
                </mesh>
              </mesh>
            </group>
          );
        })}
        {/* solid-cut caps: filled where the stencil mark says solid (per plane) */}
        {solidCut && [0, 1, 2, 3, 4, 5].map((i) => {
          const cq = capQuad(i, size);
          return (
            <mesh key={`cap${i}`} position={cq.pos} rotation={cq.rot}
              material={capMats[i]} renderOrder={3 * i + 2} raycast={noopRaycast}
              ref={attachClearStencil}
            >
              <planeGeometry args={cq.args} />
            </mesh>
          );
        })}
        <Html position={[size[0] / 2 + 0.3, size[1] / 2 + 0.3, size[2] / 2 + 0.3]} center wrapperClass="secWrap">
          <div className="secLabel">
            {`${Math.round(size[0] * 1000).toLocaleString('en-US')} × ${Math.round(size[1] * 1000).toLocaleString('en-US')} × ${Math.round(size[2] * 1000).toLocaleString('en-US')} mm`}
          </div>
        </Html>
      </group>
      {mode !== 'faces' && (
        <TransformControls object={boxRef} mode={mode} size={0.85} onObjectChange={syncFromGizmo} />
      )}
    </>
  );
}
