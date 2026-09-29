import { useEffect, useRef, useState, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store.js';
import { subsetBox } from '../ifc/session.js';

const S = 0.001;
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

// Collects candidate snapping nodes (vertices, bounding box corners, edge midpoints)
function getSnapCandidates(hit) {
  const candidates = [];
  const obj = hit.object;
  const geom = obj.geometry;
  const mat = obj.matrixWorld;

  // 1. Hit face vertices
  if (hit.face && geom && geom.attributes?.position) {
    const pos = geom.attributes.position;
    const a = hit.face.a;
    const b = hit.face.b;
    const c = hit.face.c;

    _v1.fromBufferAttribute(pos, a).applyMatrix4(mat);
    _v2.fromBufferAttribute(pos, b).applyMatrix4(mat);
    _v3.fromBufferAttribute(pos, c).applyMatrix4(mat);

    candidates.push({ pos: _v1.clone(), type: 'Vertex' });
    candidates.push({ pos: _v2.clone(), type: 'Vertex' });
    candidates.push({ pos: _v3.clone(), type: 'Vertex' });

    // Face edge midpoints
    candidates.push({ pos: _v1.clone().add(_v2).multiplyScalar(0.5), type: 'Edge Midpoint' });
    candidates.push({ pos: _v2.clone().add(_v3).multiplyScalar(0.5), type: 'Edge Midpoint' });
    candidates.push({ pos: _v3.clone().add(_v1).multiplyScalar(0.5), type: 'Edge Midpoint' });
  }

  // 2. Object bounding box corners
  try {
    const bb = obj.userData?.ifcKey ? subsetBox(obj) : new THREE.Box3().setFromObject(obj);
    if (!bb.isEmpty()) {
      const corners = [
        new THREE.Vector3(bb.min.x, bb.min.y, bb.min.z),
        new THREE.Vector3(bb.min.x, bb.min.y, bb.max.z),
        new THREE.Vector3(bb.min.x, bb.max.y, bb.min.z),
        new THREE.Vector3(bb.min.x, bb.max.y, bb.max.z),
        new THREE.Vector3(bb.max.x, bb.min.y, bb.min.z),
        new THREE.Vector3(bb.max.x, bb.min.y, bb.max.z),
        new THREE.Vector3(bb.max.x, bb.max.y, bb.min.z),
        new THREE.Vector3(bb.max.x, bb.max.y, bb.max.z),
      ];
      for (const pt of corners) {
        candidates.push({ pos: pt, type: 'Corner Node' });
      }
    }
  } catch { /* fallback */ }

  // 3. Fallback: exact surface hit point
  candidates.push({ pos: hit.point.clone(), type: 'Surface Point' });

  return candidates;
}

export default function TraceTool() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);

  const drawMode = useStore((s) => s.drawMode);
  const setDrawMode = useStore((s) => s.setDrawMode);
  const drawStart = useStore((s) => s.drawStart);
  const setDrawStart = useStore((s) => s.setDrawStart);
  const setSnapNode = useStore((s) => s.setSnapNode);
  const addConcrete = useStore((s) => s.addConcrete);
  const concretes = useStore((s) => s.concretes);

  const raycaster = useRef(new THREE.Raycaster());
  const mouse = useRef(new THREE.Vector2());
  const [liveSnap, setLiveSnap] = useState(null);

  // Keyboard Escape cancels drawing
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (drawStart) setDrawStart(null);
        else if (drawMode) setDrawMode(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawMode, drawStart, setDrawMode, setDrawStart]);

  // Pointer movement: perform fast node snapping
  useEffect(() => {
    const el = gl.domElement;

    const onPointerMove = (ev) => {
      const rect = el.getBoundingClientRect();
      mouse.current.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.current.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.current.setFromCamera(mouse.current, camera);

      // Collect pickable target roots (IFC group & concrete meshes)
      const roots = [];
      scene.traverse((o) => { if (o.userData?.pickRoot) roots.push(o); });

      const targets = [];
      for (const r of roots) {
        if (!r.visible) continue;
        if (r.userData.pickRoot === 'concrete' && r.isMesh) targets.push(r);
        else r.traverse((o) => { if (o.isMesh && o.visible && !o.userData?.stencil) targets.push(o); });
      }

      const hits = raycaster.current.intersectObjects(targets, false);
      if (!hits.length) {
        setLiveSnap(null);
        setSnapNode(null);
        return;
      }

      const hit = hits[0];
      const candidates = getSnapCandidates(hit);

      // Find closest snap candidate to hit point in 3D world space
      let best = null;
      let minD = Infinity;

      for (const c of candidates) {
        const d = hit.point.distanceTo(c.pos);
        if (d < minD) {
          minD = d;
          best = c;
        }
      }

      const snapPt = (best && minD < 0.6) ? best.pos : hit.point;
      const snapType = (best && minD < 0.6) ? best.type : 'Surface Point';

      // Convert world m to app mm: App X = +x*1000, App Y = -z*1000, App Z = +y*1000
      const appPos = {
        x: Math.round(snapPt.x * 1000),
        y: Math.round(-snapPt.z * 1000),
        z: Math.round(snapPt.y * 1000),
        worldPos: [snapPt.x, snapPt.y, snapPt.z],
        type: snapType,
        hitObject: hit.object,
      };

      setLiveSnap(appPos);
      setSnapNode(appPos);
    };

    el.addEventListener('pointermove', onPointerMove);
    return () => el.removeEventListener('pointermove', onPointerMove);
  }, [gl, camera, scene, setSnapNode]);

  // Handle pointer down (Click to place/trace)
  useEffect(() => {
    const el = gl.domElement;
    let downPos = null;

    const onDown = (ev) => {
      if (ev.button === 0) downPos = [ev.clientX, ev.clientY];
      else if (ev.button === 2) {
        // Right click cancels current step
        if (drawStart) {
          setDrawStart(null);
          ev.preventDefault();
        }
      }
    };

    const onUp = (ev) => {
      if (!downPos || ev.button !== 0) return;
      const dx = ev.clientX - downPos[0];
      const dy = ev.clientY - downPos[1];
      downPos = null;
      if (dx * dx + dy * dy > 25) return; // Ignore drags

      const currentSnap = liveSnap;
      if (!currentSnap || !drawMode) return;

      // MODE 1: 1-Click IFC Element Auto-Tracing
      if (drawMode === 'trace_ifc') {
        let targetMesh = currentSnap.hitObject;
        while (targetMesh && targetMesh !== scene && !targetMesh.userData?.ifcKey && targetMesh.parent) {
          if (targetMesh.userData?.pickRoot) break;
          targetMesh = targetMesh.parent;
        }
        if (!targetMesh) targetMesh = currentSnap.hitObject;
        if (!targetMesh) return;

        try {
          const ifcMeta = useStore.getState().ifc;
          const ifcKey = targetMesh.userData?.ifcKey || null;
          const elData = ifcMeta?.elements?.find((e) => e.key === ifcKey);

          const bb = subsetBox(targetMesh);
          if (bb.isEmpty() || !Number.isFinite(bb.min.x + bb.max.x)) return;

          const x = Math.round(bb.min.x * 1000);
          const y = Math.round(-bb.max.z * 1000);
          const z = Math.round(bb.min.y * 1000);
          const lx = Math.max(Math.round((bb.max.x - bb.min.x) * 1000), 50);
          const ly = Math.max(Math.round((bb.max.z - bb.min.z) * 1000), 50);
          const lz = Math.max(Math.round((bb.max.y - bb.min.y) * 1000), 50);

          const type = elData?.type || '';
          let prefix = elData?.typeLabel ? elData.typeLabel.replace(/s$/, '') : 'Concrete';
          if (/BEAM/i.test(type)) prefix = 'Beam';
          else if (/COLUMN/i.test(type)) prefix = 'Column';
          else if (/SLAB/i.test(type)) prefix = 'Slab';
          else if (/WALL/i.test(type)) prefix = 'Wall';
          else if (/FOOTING/i.test(type)) prefix = 'Footing';
          else {
            if (lz > lx && lz > ly) prefix = 'Column';
            else if (lx >= lz && lx >= ly && lz > 250) prefix = 'Beam';
            else if (lx > 1000 && ly > 1000 && lz <= 400) prefix = 'Slab';
          }

          const count = concretes.filter((c) => c.name.startsWith(prefix)).length + 1;
          const name = elData?.name || `${prefix} ${count}`;

          addConcrete({ name, lx, ly, lz, x, y, z });
          console.info(`[TraceTool] Auto-traced ${name}: ${lx}x${ly}x${lz} mm @ (${x}, ${y}, ${z})`);
        } catch (err) {
          console.error('[TraceTool] Auto-trace failed:', err);
        }
        return;
      }

      // MODE 2: 2-Point Snapped Drawing (Beam / Column / Slab / Box)
      if (!drawStart) {
        // Step 1: Set Start Point
        setDrawStart({
          x: currentSnap.x,
          y: currentSnap.y,
          z: currentSnap.z,
          worldPos: currentSnap.worldPos,
        });
        console.info(`[TraceTool] Point 1 set: (${currentSnap.x}, ${currentSnap.y}, ${currentSnap.z})`);
      } else {
        // Step 2: Complete element with Point 2
        const p1 = drawStart;
        const p2 = currentSnap;

        const x0 = Math.min(p1.x, p2.x);
        const y0 = Math.min(p1.y, p2.y);
        const z0 = Math.min(p1.z, p2.z);

        let lx = Math.abs(p2.x - p1.x);
        let ly = Math.abs(p2.y - p1.y);
        let lz = Math.abs(p2.z - p1.z);

        // Apply sensible defaults if user snapped on a flat 2D face
        if (drawMode === 'beam') {
          lx = Math.max(lx, 500);
          if (ly < 50) ly = 400;
          if (lz < 50) lz = 600;
        } else if (drawMode === 'column') {
          lz = Math.max(lz, 500);
          if (lx < 50) lx = 400;
          if (ly < 50) ly = 400;
        } else if (drawMode === 'slab') {
          lx = Math.max(lx, 500);
          ly = Math.max(ly, 500);
          if (lz < 50) lz = 200;
        } else {
          lx = Math.max(lx, 100);
          ly = Math.max(ly, 100);
          lz = Math.max(lz, 100);
        }

        const typeName = drawMode[0].toUpperCase() + drawMode.slice(1);
        const count = concretes.filter((c) => c.name.startsWith(typeName)).length + 1;
        const name = `${typeName} ${count}`;

        addConcrete({ name, lx, ly, lz, x: x0, y: y0, z: z0 });
        console.info(`[TraceTool] Created ${name}: ${lx}x${ly}x${lz} mm @ (${x0}, ${y0}, ${z0})`);

        setDrawStart(null); // Ready for next member
      }
    };

    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
    };
  }, [gl, drawMode, drawStart, liveSnap, concretes, addConcrete, setDrawStart]);

  // Compute live bounding preview geometry for 2-point drawing
  const previewBox = useMemo(() => {
    if (!drawMode || !drawStart || !liveSnap) return null;
    const p1 = drawStart;
    const p2 = liveSnap;

    const x0 = Math.min(p1.x, p2.x);
    const y0 = Math.min(p1.y, p2.y);
    const z0 = Math.min(p1.z, p2.z);

    let lx = Math.abs(p2.x - p1.x);
    let ly = Math.abs(p2.y - p1.y);
    let lz = Math.abs(p2.z - p1.z);

    if (drawMode === 'beam') {
      lx = Math.max(lx, 500);
      if (ly < 50) ly = 400;
      if (lz < 50) lz = 600;
    } else if (drawMode === 'column') {
      lz = Math.max(lz, 500);
      if (lx < 50) lx = 400;
      if (ly < 50) ly = 400;
    } else if (drawMode === 'slab') {
      lx = Math.max(lx, 500);
      ly = Math.max(ly, 500);
      if (lz < 50) lz = 200;
    } else {
      lx = Math.max(lx, 100);
      ly = Math.max(ly, 100);
      lz = Math.max(lz, 100);
    }

    const sx = lx * S;
    const sy = lz * S;
    const sz = ly * S;
    const cx = (x0 + lx / 2) * S;
    const cy = (z0 + lz / 2) * S;
    const cz = -((y0 + ly / 2) * S);

    return { cx, cy, cz, sx, sy, sz, lx, ly, lz };
  }, [drawMode, drawStart, liveSnap]);

  // Compute live hover box for 1-Click Auto-Trace mode
  const ifcHoverBox = useMemo(() => {
    if (drawMode !== 'trace_ifc' || !liveSnap?.hitObject) return null;
    const obj = liveSnap.hitObject;
    try {
      const bb = obj.userData?.ifcKey ? subsetBox(obj) : new THREE.Box3().setFromObject(obj);
      if (bb.isEmpty()) return null;
      const sx = bb.max.x - bb.min.x;
      const sy = bb.max.y - bb.min.y;
      const sz = bb.max.z - bb.min.z;
      const cx = (bb.min.x + bb.max.x) / 2;
      const cy = (bb.min.y + bb.max.y) / 2;
      const cz = (bb.min.z + bb.max.z) / 2;
      return { cx, cy, cz, sx, sy, sz };
    } catch {
      return null;
    }
  }, [drawMode, liveSnap]);

  return (
    <group>
      {/* 3D Snap Indicator Glyph */}
      {liveSnap && (
        <group position={liveSnap.worldPos}>
          {/* Glowing diamond/box */}
          <mesh renderOrder={9999}>
            <octahedronGeometry args={[0.04, 0]} />
            <meshBasicMaterial color="#38bdf8" wireframe depthTest={false} transparent opacity={0.9} />
          </mesh>
          <mesh renderOrder={9998}>
            <sphereGeometry args={[0.012, 8, 8]} />
            <meshBasicMaterial color="#f59e0b" depthTest={false} />
          </mesh>
        </group>
      )}

      {/* Start Point Marker */}
      {drawStart && (
        <group position={drawStart.worldPos}>
          <mesh renderOrder={9999}>
            <boxGeometry args={[0.06, 0.06, 0.06]} />
            <meshBasicMaterial color="#22c55e" wireframe depthTest={false} />
          </mesh>
          <mesh renderOrder={9998}>
            <sphereGeometry args={[0.015, 8, 8]} />
            <meshBasicMaterial color="#22c55e" depthTest={false} />
          </mesh>
        </group>
      )}

      {/* Live 2-Point Preview Box */}
      {previewBox && (
        <group position={[previewBox.cx, previewBox.cy, previewBox.cz]}>
          <mesh renderOrder={9990}>
            <boxGeometry args={[previewBox.sx, previewBox.sy, previewBox.sz]} />
            <meshStandardMaterial
              color="#0284c7"
              transparent
              opacity={0.35}
              roughness={0.5}
              depthTest={false}
            />
          </mesh>
          <lineSegments renderOrder={9991}>
            <edgesGeometry args={[new THREE.BoxGeometry(previewBox.sx, previewBox.sy, previewBox.sz)]} />
            <lineBasicMaterial color="#38bdf8" depthTest={false} linewidth={2} />
          </lineSegments>
        </group>
      )}

      {/* Live Hover Bounding Box for 1-Click Auto-Trace */}
      {ifcHoverBox && (
        <group position={[ifcHoverBox.cx, ifcHoverBox.cy, ifcHoverBox.cz]}>
          <mesh renderOrder={9990}>
            <boxGeometry args={[ifcHoverBox.sx, ifcHoverBox.sy, ifcHoverBox.sz]} />
            <meshStandardMaterial
              color="#f59e0b"
              transparent
              opacity={0.3}
              roughness={0.4}
              depthTest={false}
            />
          </mesh>
          <lineSegments renderOrder={9991}>
            <edgesGeometry args={[new THREE.BoxGeometry(ifcHoverBox.sx, ifcHoverBox.sy, ifcHoverBox.sz)]} />
            <lineBasicMaterial color="#fbbf24" depthTest={false} linewidth={2} />
          </lineSegments>
        </group>
      )}
    </group>
  );
}
