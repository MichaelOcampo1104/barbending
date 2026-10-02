import { useEffect, useRef, useState, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { Line, Html } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../store.js';
import { subsetBox, extractMeshGeometry } from '../ifc/session.js';
import { fmtLen, snapMagnet } from './Scene.jsx';
import { snapPrimitives } from '../bbs/shapes.js';
import { isWorldPointInSectionBox } from './sectionPlanes.js';

const S = 0.001;
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

function resolveConcreteHostId(snapPos, hitObject, concretes) {
  if (hitObject?.userData?.concreteId) return hitObject.userData.concreteId;
  for (const c of concretes || []) {
    const margin = 80;
    if (snapPos.x >= c.x - margin && snapPos.x <= c.x + c.lx + margin &&
        snapPos.y >= c.y - margin && snapPos.y <= c.y + c.ly + margin &&
        snapPos.z >= c.z - margin && snapPos.z <= c.z + c.lz + margin) {
      return c.id;
    }
  }
  return concretes?.[0]?.id || null;
}

// BBox cache: subsetBox() walks the whole element index — far too slow on
// every pointermove for real-size models. Geometry is effectively static, so
// cache per mesh and recompute only when the geometry object or world matrix
// changes (covers dim edits + IFC placement offsets/rotations).
const boxCache = new WeakMap();
function cachedWorldBox(obj) {
  if (!obj) return new THREE.Box3();
  const entry = boxCache.get(obj);
  const el = obj.matrixWorld?.elements;
  if (entry && entry.g === obj.geometry && el && entry.m.every((v, i) => v === el[i])) {
    return entry.box;
  }
  let box;
  try {
    box = (obj.userData?.ifcKey || obj.geometry?.index || obj.parent?.userData?.pickRoot === 'ifc')
      ? subsetBox(obj)
      : new THREE.Box3().setFromObject(obj);
  } catch {
    box = new THREE.Box3();
  }
  boxCache.set(obj, { box, g: obj.geometry, m: el ? [...el] : [] });
  return box;
}

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

  // 2. Object bounding box corners (cached: subsetBox walks the full index)
  const bb = cachedWorldBox(obj);
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

  const addRefLine = useStore((s) => s.addRefLine);
  const selectedConcrete = useStore((s) => s.selectedConcrete);

  const raycaster = useRef(new THREE.Raycaster());
  const mouse = useRef(new THREE.Vector2());
  const [liveSnap, setLiveSnap] = useState(null);

  // Keyboard Escape cancels drawing
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (drawStart) { setDrawStart(null); e.preventDefault(); }
        else if (drawMode) { setDrawMode(null); e.preventDefault(); }
        else {
          const st = useStore.getState();
          // Consumed — App's Esc cascade must not clear the selection too.
          if (st.lapArmed) { st.setLapArmed(false); e.preventDefault(); }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawMode, drawStart, setDrawMode, setDrawStart]);

  // Pointer movement: fast node snapping
  const liveSnapRef = useRef(null);
  useEffect(() => {
    const el = gl.domElement;
    let raf = 0;
    let lastEv = null;

    const clearSnap = () => {
      if (liveSnapRef.current !== null) {
        liveSnapRef.current = null;
        setLiveSnap(null);
        setSnapNode(null);
      }
    };

    const doMove = () => {
      raf = 0;
      const ev = lastEv;
      if (!ev) return;
      const st = useStore.getState();
      if (!st.drawMode) { clearSnap(); return; }
      const rect = el.getBoundingClientRect();

      // Osnap magnet first (ref_line / beam / column / slab): same Endpoint /
      // Midpoint / Center / Nearest / Perpendicular options as pick + measure,
      // so ref-line endpoints can land on bar ends, edge midpoints, or the
      // perpendicular foot from the first point. trace_ifc skips this — its
      // placement derives from the picked IFC element's bounding box, not the
      // cursor point. Magnet hits carry no mesh, so the host resolves
      // spatially (80 mm margin) at click time.
      if (st.drawMode !== 'trace_ifc' && st.snapEnabled !== false) {
        const ds = st.drawStart;
        let magnet = snapMagnet(ev, camera, rect,
          snapPrimitives(st.bars, st.concretes, st.refLines, -1, true),
          st.snapOpts,
          ds ? [ds.x, ds.y, ds.z] : null);
        // Section cut hides geometry visually but raycast/magnet math still
        // sees it — drop magnet points clipped away by the active box.
        if (magnet && !isWorldPointInSectionBox(
          { x: magnet.p[0] * S, y: magnet.p[2] * S, z: -magnet.p[1] * S }, st.section)) {
          magnet = null;
        }
        if (magnet) {
          const kindLabel = { end: 'Endpoint', mid: 'Midpoint', center: 'Center', nearest: 'Nearest', perp: 'Perpendicular' }[magnet.kind] || 'Snap';
          const appPos = {
            x: Math.round(magnet.p[0]),
            y: Math.round(magnet.p[1]),
            z: Math.round(magnet.p[2]),
            worldPos: [magnet.p[0] * S, magnet.p[2] * S, -magnet.p[1] * S],
            type: kindLabel,
            hitObject: null,
          };
          liveSnapRef.current = appPos;
          setLiveSnap(appPos);
          setSnapNode(appPos);
          return;
        }
      }

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
      // Raycast ignores clipping planes: with an active section box the first
      // hit may be a clipped-away element "through" the cut — take the first
      // hit that survives the box instead.
      const hit = hits.find((h) => isWorldPointInSectionBox(h.point, st.section)) || null;
      if (!hit) {
        clearSnap();
        return;
      }

      // Raycast fallback honors the snap options too: mesh vertices/corners
      // need Endpoint, face edge midpoints need Midpoint. (The raw surface
      // hit stays the unsnapped fallback regardless.)
      const snapOpts = st.snapOpts || { end: true, mid: true };
      const candidates = getSnapCandidates(hit).filter((c) =>
        c.type === 'Surface Point' ? true
        : c.type === 'Edge Midpoint' ? snapOpts.mid !== false
        : snapOpts.end !== false);

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

      liveSnapRef.current = appPos;
      setLiveSnap(appPos);
      setSnapNode(appPos);
    };

    const onPointerMove = (ev) => {
      lastEv = ev;
      if (!raf) raf = requestAnimationFrame(doMove);
    };

    el.addEventListener('pointermove', onPointerMove);
    return () => {
      el.removeEventListener('pointermove', onPointerMove);
      if (raf) cancelAnimationFrame(raf);
    };
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

      if (!drawMode) return;
      if (useStore.getState().measure?.active) return; // measuring owns clicks

      // Fallback: resolve snap or direct hit at click coordinates if liveSnap is null
      let currentSnap = liveSnapRef.current;
      if (!currentSnap) {
        const rect = el.getBoundingClientRect();
        const nx = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
        const ny = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.current.setFromCamera(new THREE.Vector2(nx, ny), camera);
        const roots = [];
        scene.traverse((o) => { if (o.userData?.pickRoot) roots.push(o); });
        const targets = [];
        for (const r of roots) {
          if (!r.visible) continue;
          if (r.userData.pickRoot === 'concrete' && r.isMesh) targets.push(r);
          else r.traverse((o) => { if (o.isMesh && o.visible && !o.userData?.stencil) targets.push(o); });
        }
        const hits = raycaster.current.intersectObjects(targets, false);
        // Same section-box filtering as hover: skip clipped-away hits.
        const hit = hits.find((h) => isWorldPointInSectionBox(h.point, useStore.getState().section)) || null;
        if (hit) {
          currentSnap = {
            x: Math.round(hit.point.x * 1000),
            y: Math.round(-hit.point.z * 1000),
            z: Math.round(hit.point.y * 1000),
            worldPos: [hit.point.x, hit.point.y, hit.point.z],
            type: 'Surface Point',
            hitObject: hit.object,
          };
        }
      }
      if (!currentSnap) return;

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

          const bb = targetMesh.userData?.ifcKey ? subsetBox(targetMesh) : cachedWorldBox(targetMesh);
          if (bb.isEmpty() || !Number.isFinite(bb.min.x + bb.max.x)) return;
          const x = Math.round(bb.min.x * 1000);
          const y = Math.round(-bb.max.z * 1000);
          const z = Math.round(bb.min.y * 1000);
          const lx = Math.max(Math.round((bb.max.x - bb.min.x) * 1000), 50);
          const ly = Math.max(Math.round((bb.max.z - bb.min.z) * 1000), 50);
          const lz = Math.max(Math.round((bb.max.y - bb.min.y) * 1000), 50);

          const type = elData?.type || '';
          let prefix = elData?.typeLabel ? elData.typeLabel.replace(/s\b/i, '').replace(/\(.*\)/, '').trim() : 'Concrete';
          if (/BEAM/i.test(type)) prefix = 'Beam';
          else if (/COLUMN/i.test(type)) prefix = 'Column';
          else if (/SLAB/i.test(type)) prefix = 'Slab';
          else if (/WALL/i.test(type)) prefix = 'Wall';
          else if (/FOOTING|PILE/i.test(type)) prefix = 'Footing';
          else {
            if (lz > lx && lz > ly) prefix = 'Column';
            else if (lx >= lz && lx >= ly && lz > 250) prefix = 'Beam';
            else if (lx > 1000 && ly > 1000 && lz <= 400) prefix = 'Slab';
          }

          const existingConcretes = useStore.getState().concretes || [];
          const count = existingConcretes.filter((c) => c.name.startsWith(prefix)).length + 1;
          const name = elData?.name || `${prefix} ${count}`;
          // The pick walk can stop at a wrapper group (e.g. the concrete
          // pickRoot group) — descend to the geometry-bearing mesh for the
          // exact profile. Stencil/ghost children share the same geometry.
          const geomMesh = targetMesh?.isMesh && targetMesh?.geometry ? targetMesh : (() => {
            let found = null;
            targetMesh?.traverse?.((o) => { if (!found && o.isMesh && o.geometry) found = o; });
            return found;
          })();
          const meshData = extractMeshGeometry(geomMesh);

          addConcrete({ name, lx, ly, lz, x, y, z, meshData });
          console.info(`[TraceTool] Auto-traced ${name} (exact geometry preserved: ${!!meshData}): ${lx}x${ly}x${lz} mm @ (${x}, ${y}, ${z})`);
        } catch (err) {
          console.error('[TraceTool] Auto-trace failed: ' + (err?.stack || err?.message || String(err)));
        }
        return;
      }

      // MODE 2: Draw Reference Line attached to Concrete Elements
      if (drawMode === 'ref_line') {
        const hostId = resolveConcreteHostId(currentSnap, currentSnap.hitObject, concretes) || selectedConcrete || (concretes[0]?.id);
        if (!drawStart) {
          setDrawStart({
            x: currentSnap.x,
            y: currentSnap.y,
            z: currentSnap.z,
            worldPos: currentSnap.worldPos,
            hostId,
          });
        } else {
          const p1 = [drawStart.x, drawStart.y, drawStart.z];
          const p2 = [currentSnap.x, currentSnap.y, currentSnap.z];
          const targetHost = drawStart.hostId || hostId;
          const len = Math.round(Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]));
          addRefLine({
            host: targetHost,
            p1,
            p2,
            name: `Ref ${len}mm`,
            color: '#f59e0b',
          });
          console.info(`[TraceTool] Added RefLine ${len}mm parented to host ${targetHost}`);
          setDrawStart(null);
        }
        return;
      }

      // MODE 3: 2-Point Snapped Drawing (Beam / Column / Slab / Box)
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
  }, [gl, scene, drawMode, drawStart, concretes, selectedConcrete, addConcrete, addRefLine, setDrawStart]);

  // Compute live bounding preview geometry for 2-point drawing
  const previewBox = useMemo(() => {
    if (!drawMode || drawMode === 'ref_line' || !drawStart || !liveSnap) return null;
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
    const bb = cachedWorldBox(obj);
    if (bb.isEmpty()) return null;
    const sx = bb.max.x - bb.min.x;
    const sy = bb.max.y - bb.min.y;
    const sz = bb.max.z - bb.min.z;
    const cx = (bb.min.x + bb.max.x) / 2;
    const cy = (bb.min.y + bb.max.y) / 2;
    const cz = (bb.min.z + bb.max.z) / 2;
    return { cx, cy, cz, sx, sy, sz };
  }, [drawMode, liveSnap]);

  // Live ref_line preview
  const refLinePreview = useMemo(() => {
    if (drawMode !== 'ref_line' || !drawStart || !liveSnap) return null;
    const p1 = drawStart;
    const p2 = liveSnap;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dz = p2.z - p1.z;
    const len = Math.round(Math.hypot(dx, dy, dz));
    const mid = [
      (p1.worldPos[0] + p2.worldPos[0]) / 2,
      (p1.worldPos[1] + p2.worldPos[1]) / 2,
      (p1.worldPos[2] + p2.worldPos[2]) / 2,
    ];
    return { p1World: p1.worldPos, p2World: p2.worldPos, mid, len };
  }, [drawMode, drawStart, liveSnap]);

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

      {/* Live Ref Line Preview */}
      {refLinePreview && (
        <group>
          <Line
            points={[refLinePreview.p1World, refLinePreview.p2World]}
            color="#f59e0b"
            lineWidth={3}
            dashed
            dashScale={18}
            depthTest={false}
            transparent
            opacity={0.95}
          />
          <Html position={refLinePreview.mid} center zIndexRange={[50, 0]}>
            <div className="refline-badge preview">📏 {fmtLen(refLinePreview.len)}</div>
          </Html>
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
