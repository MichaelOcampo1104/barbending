import { useEffect, useLayoutEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, AdaptiveDpr, Line, Html, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../store.js';
import { genBarPoints, transformBarLocalPoint, distOffsets, barOverlapsBoxes, rebarSnapNodes, rebarSegments, concreteSnapNodes, concreteEdges, refLineSegments, allSnapNodes, allSnapSegments, barBaseEnds, barSpliceEnds, MAX_RENDER_COPIES, barAppBox } from '../bbs/shapes.js';
import FitIfc from './FitIfc.jsx';
import AutoClipping from './AutoClipping.jsx';
import SectionBox from './SectionBox.jsx';
import TraceTool from './TraceTool.jsx';
import { sectionPlanes } from './sectionPlanes.js';
import { stencilMats } from './stencilMats.js';

const noopStencilRaycast = () => null;
const SNAP_PX = 14; // screen-space aperture for rebar-node snapping

// Nearest visible rebar centerline node (app-mm [x,y,z]) within SNAP_PX of
// the cursor, or null. nodes = rebarSnapNodes(...) app-mm points. Nodes
// behind the camera are skipped (projection flips there).
function snapToRebar(ev, camera, rect, nodes) {
  if (!nodes?.length) return null;
  const v = new THREE.Vector3();
  const cam = new THREE.Vector3();
  const cx = ev.clientX - rect.left, cy = ev.clientY - rect.top;
  let best = null, bestD = SNAP_PX;
  for (const [x, y, z] of nodes) {
    v.set(x * S, z * S, -y * S);
    cam.copy(v).applyMatrix4(camera.matrixWorldInverse);
    if (cam.z > -1e-6) continue;
    v.project(camera);
    const d = Math.hypot((v.x * 0.5 + 0.5) * rect.width - cx, (-v.y * 0.5 + 0.5) * rect.height - cy);
    if (d < bestD) { bestD = d; best = [x, y, z]; }
  }
  return best;
}

// Nearest point on any snap segment (app-mm [p1,p2] pairs: concrete box
// edges, rebar legs, ref lines) within SNAP_PX of the cursor, or null.
// Screen-space point-to-segment so the magnet grabs anywhere along an edge,
// not just at its endpoints. Segments with an endpoint behind the camera are
// skipped (projection flips there).
function snapToEdges(ev, camera, rect, segments) {
  if (!segments?.length) return null;
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const ca = new THREE.Vector3();
  const cb = new THREE.Vector3();
  const cx = ev.clientX - rect.left, cy = ev.clientY - rect.top;
  let best = null, bestD = SNAP_PX;
  for (const seg of segments) {
    const [ax, ay, az] = seg[0];
    const [bx, by, bz] = seg[1];
    va.set(ax * S, az * S, -ay * S);
    vb.set(bx * S, bz * S, -by * S);
    ca.copy(va).applyMatrix4(camera.matrixWorldInverse);
    cb.copy(vb).applyMatrix4(camera.matrixWorldInverse);
    if (ca.z > -1e-6 || cb.z > -1e-6) continue;
    va.project(camera);
    vb.project(camera);
    const sax = (va.x * 0.5 + 0.5) * rect.width, say = (-va.y * 0.5 + 0.5) * rect.height;
    const sbx = (vb.x * 0.5 + 0.5) * rect.width, sby = (-vb.y * 0.5 + 0.5) * rect.height;
    const dx = sbx - sax, dy = sby - say;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((cx - sax) * dx + (cy - say) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(cx - (sax + t * dx), cy - (say + t * dy));
    if (d < bestD) {
      bestD = d;
      best = [ax + t * (bx - ax), ay + t * (by - ay), az + t * (bz - az)];
    }
  }
  return best;
}

// Combined magnet: exact nodes win (corners, bar ends, face centers), then
// edges (anywhere along a concrete edge / rebar leg / ref line).
function snapNodesAndEdges(ev, camera, rect, nodes, segments) {
  return snapToRebar(ev, camera, rect, nodes) || snapToEdges(ev, camera, rect, segments);
}

// Display length: "742 mm" or "12,400 mm (12.40 m)". Shared with the overlay.
export function fmtLen(mm) {
  const mms = `${Math.round(mm).toLocaleString('en-US')} mm`;
  return Math.abs(mm) < 1000 ? mms : `${mms} (${(mm / 1000).toFixed(2)} m)`;
}

// Visible pickable meshes under the pick roots (IFC group, concrete boxes,
// rebar tubes): skips hidden subtrees + stencil ghosts. Shared by PickHandler,
// MeasureHandler and TraceTool-style hover.
export function collectPickTargets(scene) {
  const roots = [];
  scene.traverse((o) => { if (o.userData?.pickRoot) roots.push(o); });
  const isShown = (o) => {
    let p = o;
    while (p && p !== scene) { if (!p.visible) return false; p = p.parent; }
    return true;
  };
  const targets = [];
  for (const r of roots) {
    if (!isShown(r)) continue;
    if (r.userData.pickRoot === 'concrete') { if (r.isMesh) targets.push(r); continue; }
    r.traverse((o) => {
      if (!o.isMesh || !isShown(o) || o.userData?.stencil) return;
      targets.push(o);
    });
  }
  return targets;
}

// Blender-style direct picking: DOM pointer tracking + manual raycast against
// pickable roots only (IFC group, concrete boxes, rebar tubes). Skips hidden
// subtrees and stencil ghosts, so big models stay interactive. Independent of
// R3F event bubbling; tolerates small pointer drift.
// Blender-style unlimited fluid zoom:
//  - Wheel / trackpad pinch accumulates smooth momentum with exponential decay (fluid 60/120fps glide).
//  - Zooms directly along the cursor ray into the 3D scene (zoom-to-cursor).
//  - Walks both camera and pivot target forward when diving deep, so distance r never collapses
//    to 0, eliminating the classic OrbitControls "brick wall" / Zeno slowdown.
//  - Zoom-out smoothly expands compressed pivot radii, making escape from micro scale immediate.
function DiveZoom() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  const zoomVel = useRef(0);
  const cursorNDC = useRef(new THREE.Vector2(0, 0));
  const dir = useRef(new THREE.Vector3());

  useEffect(() => {
    const el = gl.domElement;
    const onWheel = (ev) => {
      if (ev.target !== el) return;
      ev.preventDefault();
      const ctl = controls;
      if (!ctl || ctl.enabled === false) return;

      const rect = el.getBoundingClientRect();
      cursorNDC.current.set(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );

      let delta = ev.deltaY;
      if (ev.deltaMode === 1) delta *= 16;
      else if (ev.deltaMode === 2) delta *= 100;

      // Trackpad pinch-zoom multiplier
      if (ev.ctrlKey) delta *= 2.5;

      // Cap extreme delta spikes to keep motion continuous
      const clamped = Math.max(-250, Math.min(250, delta));
      zoomVel.current += clamped * 0.0022;
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [gl, controls]);

  useFrame((_, deltaSec) => {
    const ctl = controls;
    if (!ctl || Math.abs(zoomVel.current) < 1e-5) {
      zoomVel.current = 0;
      return;
    }

    const decay = Math.exp(-20 * Math.min(deltaSec, 0.1));
    const step = zoomVel.current * (1 - decay);
    zoomVel.current *= decay;

    dir.current.set(cursorNDC.current.x, cursorNDC.current.y, 1)
      .unproject(camera)
      .sub(camera.position)
      .normalize();

    const d = dir.current;
    const r = Math.max(camera.position.distanceTo(ctl.target), 0.005);

    if (step < 0) {
      // Zoom in towards cursor
      const speed = Math.max(r * 0.5, 0.02);
      const move = -step * speed;
      camera.position.addScaledVector(d, move);

      // Unlimited dive: if camera approaches pivot, glide pivot forward along ray
      const newR = camera.position.distanceTo(ctl.target);
      const toTgt = new THREE.Vector3().subVectors(ctl.target, camera.position);
      const forwardDot = toTgt.dot(d);

      if (forwardDot < 0.1 || newR < Math.max(r * 0.4, 0.05)) {
        ctl.target.addScaledVector(d, move);
      }
    } else {
      // Zoom out away from cursor
      const speed = Math.max(r * 0.55, 0.04);
      const move = step * speed;
      camera.position.addScaledVector(d, -move);

      // Re-inflate target if we backed out from a sub-mm micro inspection
      const newR = camera.position.distanceTo(ctl.target);
      if (newR < 0.1) {
        ctl.target.copy(camera.position).addScaledVector(d, 0.4);
      }
    }

    ctl.update();

    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('autotest')) {
      console.info(`[dive] r=${r.toFixed(3)} vel=${zoomVel.current.toFixed(3)} cam=[${camera.position.toArray().map((v) => +v.toFixed(3)).join(',')}] tgt=[${ctl.target.toArray().map((v) => +v.toFixed(3)).join(',')}]`);
    }
  });

  return null;
}

function PickHandler() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const raycaster = useRef(null);
  if (!raycaster.current) raycaster.current = new THREE.Raycaster();
  useEffect(() => {
    const el = gl.domElement;
    let down = null;
    const autotest = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('autotest');
    const onDown = (ev) => {
      down = [ev.clientX, ev.clientY];
      if (autotest) console.info('[pick] down @' + ev.clientX + ',' + ev.clientY);
    };
    const onUp = (ev) => {
      if (!down) return;
      const dx = ev.clientX - down[0];
      const dy = ev.clientY - down[1];
      down = null;
      if (dx * dx + dy * dy > 25) return; // drag, not a click
      const st = useStore.getState();
      if (st.drawMode || st.measure?.active) return; // Drawing / tracing / measuring own their clicks
      const t0 = performance.now();
      const rect = el.getBoundingClientRect();
      const nx = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.current.setFromCamera(new THREE.Vector2(nx, ny), camera);
      const targets = collectPickTargets(scene);
      const hits = raycaster.current.intersectObjects(targets, false);
      const ms = performance.now() - t0;
      // Always-on one-liner (remote diagnosis: slow raycast vs clean miss).
      console.info(`[pick] targets=${targets.length} hits=${hits.length} raycast=${ms < 10 ? ms.toFixed(1) : Math.round(ms)}ms pick=${st.ifcPick}`);
      if (!hits.length) return;
      const h = hits[0];
      let root = h.object;
      while (root && root !== scene && !root.userData?.pickRoot) root = root.parent;
      if (st.ifcPick) {
        // Snap on the rebar first: a visible bar node or anywhere along a
        // bar leg near the cursor wins over the surface point (exact
        // centreline point, no cover offset).
        const snap = st.snapEnabled !== false
          ? snapNodesAndEdges(ev, camera, rect,
              rebarSnapNodes(st.bars, st.concretes, st.selectedBar),
              rebarSegments(st.bars, st.concretes, st.selectedBar))
          : null;
        if (snap) {
          const pos = {
            Pos_x: Math.round(snap[0] * 10) / 10,
            Pos_y: Math.round(snap[1] * 10) / 10,
            Pos_z: Math.round(snap[2] * 10) / 10,
          };
          st.updateBar(st.selectedBar, pos);
          st.setLastPick({ ...pos, snapped: 'rebar', at: Date.now() });
          console.info('[pick] placed ' + JSON.stringify(pos) + ' (snapped rebar)');
          return;
        }
        // Snap-to-cover: push the placed point inside the clicked concrete/IFC
        // face along the inward face normal by cover + Dia/2 (bar centreline).
        // Rebar-on-rebar picks keep the exact hit point (no meaningful face).
        let wp = h.point.clone();
        const faceN = h.face?.normal;
        if (faceN && root && (root.userData.pickRoot === 'ifc' || root.userData.pickRoot === 'concrete')) {
          const inward = faceN.clone().transformDirection(h.object.matrixWorld).negate();
          const bar = st.bars[st.selectedBar];
          const offM = ((Number(st.cover) || 0) + (Number(bar?.Dia) || 0) / 2) / 1000;
          wp.addScaledVector(inward, offM);
        }
        let pos;
        if (root && root.userData.pickRoot === 'ifc') {
          const u = st.ifc?.unitToMeters || 1;
          const lp = root.worldToLocal(wp);
          pos = { Pos_x: Math.round(lp.x * u * 1000), Pos_y: Math.round(-lp.z * u * 1000), Pos_z: Math.round(lp.y * u * 1000) };
        } else {
          // app frame (mm): x right, y plan, z up; scene is metres, Y-up
          pos = { Pos_x: Math.round(wp.x * 1000), Pos_y: Math.round(-wp.z * 1000), Pos_z: Math.round(wp.y * 1000) };
        }
        st.updateBar(st.selectedBar, pos);
        st.setLastPick({ ...pos, at: Date.now() });
        console.info('[pick] placed ' + JSON.stringify(pos));
      } else {
        const key = h.object.userData?.ifcKey || null;
        if (key) st.setIfcSelected(key === st.ifcSelected ? null : key);
      }
    };
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
    };
  }, [gl, camera, scene]);
  return null;
}

// Measure tool: LMB drops surface points (exact hit, no cover offset),
// RMB-click removes the last point, Esc exits. Ephemeral — never saved.
function MeasureHandler() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const raycaster = useRef(null);
  if (!raycaster.current) raycaster.current = new THREE.Raycaster();
  useEffect(() => {
    const el = gl.domElement;
    let down = null;
    const onDown = (ev) => {
      if (ev.button === 0 || ev.button === 2) down = [ev.clientX, ev.clientY, ev.button];
    };
    const onUp = (ev) => {
      if (!down) return;
      const dx = ev.clientX - down[0];
      const dy = ev.clientY - down[1];
      const btn = down[2];
      down = null;
      if (dx * dx + dy * dy > 25) return; // drag (orbit/pan), not a click
      const st = useStore.getState();
      if (!st.measure?.active) return;
      if (ev.button === 2) { st.popMeasurePoint(); return; } // right-click: drop last
      if (ev.button !== 0 || btn !== 0) return;
      const rect = el.getBoundingClientRect();
      raycaster.current.setFromCamera(new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      ), camera);
      const hits = raycaster.current.intersectObjects(collectPickTargets(scene), false);
      if (!hits.length) return;
      // Snap on rebar, concrete, or reference line nodes first, then anywhere
      // along their edges (concrete box edges, rebar legs, ref lines)
      const snapped = st.snapEnabled !== false
        ? snapNodesAndEdges(ev, camera, rect,
            allSnapNodes(st.bars, st.concretes, st.refLines),
            allSnapSegments(st.bars, st.concretes, st.refLines))
        : null;
      if (snapped) {
        st.pushMeasurePoint(snapped.map((v) => Math.round(v * 10) / 10));
        return;
      }
      const h = hits[0];
      let root = h.object;
      while (root && root !== scene && !root.userData?.pickRoot) root = root.parent;
      // app frame (mm), exact surface point
      const wp = h.point;
      let p;
      if (root && root.userData.pickRoot === 'ifc') {
        const u = st.ifc?.unitToMeters || 1;
        const lp = root.worldToLocal(wp.clone());
        p = [lp.x * u * 1000, -lp.z * u * 1000, lp.y * u * 1000];
      } else {
        p = [wp.x * 1000, -wp.z * 1000, wp.y * 1000];
      }
      st.pushMeasurePoint(p.map((v) => Math.round(v * 10) / 10));
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && useStore.getState().measure?.active) {
        useStore.getState().setMeasureActive(false);
      }
    };
    const noMenu = (e) => e.preventDefault(); // static right-click is "remove last", not a menu
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    el.addEventListener('contextmenu', noMenu);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      el.removeEventListener('contextmenu', noMenu);
    };
  }, [gl, camera, scene]);
  return null;
}

// Snap magnet preview: while pick-to-place or measure is armed (and snap is
// enabled), hovering near a visible bar, concrete, or reference line node or
// edge shows exactly where a click would snap. Local state only — no store
// churn per mousemove.
function SnapPreview() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    const el = gl.domElement;
    const onMove = (ev) => {
      const st = useStore.getState();
      const inPick = st.ifcPick;
      const inMeasure = !!st.measure?.active;
      if (st.snapEnabled === false || (!inPick && !inMeasure)) {
        setHover((h) => (h ? null : h));
        return;
      }
      const rect = el.getBoundingClientRect();
      let nodes, segments;
      if (inMeasure) {
        nodes = allSnapNodes(st.bars, st.concretes, st.refLines);
        segments = allSnapSegments(st.bars, st.concretes, st.refLines);
      } else {
        nodes = rebarSnapNodes(st.bars, st.concretes, inPick ? st.selectedBar : -1);
        segments = rebarSegments(st.bars, st.concretes, inPick ? st.selectedBar : -1);
      }
      const sn = snapNodesAndEdges(ev, camera, rect, nodes, segments);
      setHover((h) => {
        const key = sn ? sn.join(',') : '';
        return (h?.join(',') ?? '') === key ? h : sn;
      });
    };
    el.addEventListener('pointermove', onMove);
    return () => el.removeEventListener('pointermove', onMove);
  }, [gl, camera]);
  useEffect(() => {
    // clear the magnet when its mode disengages
    const off = useStore.subscribe((s) => {
      if ((!s.ifcPick && !s.measure?.active) || s.snapEnabled === false) setHover((h) => (h ? null : h));
    });
    return off;
  }, []);
  if (!hover) return null;
  const [x, y, z] = hover;
  const pos = [x * S, z * S, -y * S];
  return (
    <group position={pos}>
      <mesh renderOrder={9999}>
        <octahedronGeometry args={[0.05, 0]} />
        <meshBasicMaterial color="#ec4899" wireframe depthTest={false} transparent opacity={0.95} />
      </mesh>
      <mesh renderOrder={10000}>
        <sphereGeometry args={[0.014, 10, 10]} />
        <meshBasicMaterial color="#ffffff" depthTest={false} />
      </mesh>
    </group>
  );
}

function MeasureView() {
  const points = useStore((s) => s.measure.points);
  if (!points.length) return null;
  const pts = points.map(([x, y, z]) => [x * S, z * S, -y * S]);
  const segs = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = new THREE.Vector3(...pts[i - 1]);
    const b = new THREE.Vector3(...pts[i]);
    const len = a.distanceTo(b) * 1000;
    total += len;

    const p1 = points[i - 1];
    const p2 = points[i];
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const dz = p2[2] - p1[2];

    const p1Scene = [p1[0] * S, p1[2] * S, -p1[1] * S];
    const p1xScene = [p2[0] * S, p1[2] * S, -p1[1] * S];
    const p1xyScene = [p2[0] * S, p1[2] * S, -p2[1] * S];
    const p2Scene = [p2[0] * S, p2[2] * S, -p2[1] * S];

    const midX = [(p1[0] + p2[0]) / 2 * S, p1[2] * S, -p1[1] * S];
    const midY = [p2[0] * S, p1[2] * S, -(p1[1] + p2[1]) / 2 * S];
    const midZ = [p2[0] * S, (p1[2] + p2[2]) / 2 * S, -p2[1] * S];

    segs.push({
      mid: [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2],
      len,
      dx, dy, dz,
      p1Scene, p1xScene, p1xyScene, p2Scene,
      midX, midY, midZ,
      showDeltas: (Math.abs(dx) > 1 || Math.abs(dy) > 1 || Math.abs(dz) > 1) && (pts.length === 2 || i === 1),
    });
  }
  return (
    <group>
      {pts.length > 1 && (
        <Line points={pts} color="#22d3ee" lineWidth={2.5} transparent opacity={0.95} depthTest={false} />
      )}
      {segs.map((sg, i) => sg.showDeltas && (
        <group key={`deltas-${i}`}>
          {Math.abs(sg.dx) > 1 && (
            <>
              <Line points={[sg.p1Scene, sg.p1xScene]} color="#ef4444" lineWidth={1.5} dashed dashScale={12} depthTest={false} transparent opacity={0.8} />
              <Html position={sg.midX} center zIndexRange={[30, 0]}>
                <div className="measure-label dx">ΔX: {fmtLen(Math.abs(sg.dx))}</div>
              </Html>
            </>
          )}
          {Math.abs(sg.dy) > 1 && (
            <>
              <Line points={[sg.p1xScene, sg.p1xyScene]} color="#22c55e" lineWidth={1.5} dashed dashScale={12} depthTest={false} transparent opacity={0.8} />
              <Html position={sg.midY} center zIndexRange={[30, 0]}>
                <div className="measure-label dy">ΔY: {fmtLen(Math.abs(sg.dy))}</div>
              </Html>
            </>
          )}
          {Math.abs(sg.dz) > 1 && (
            <>
              <Line points={[sg.p1xyScene, sg.p2Scene]} color="#3b82f6" lineWidth={1.5} dashed dashScale={12} depthTest={false} transparent opacity={0.8} />
              <Html position={sg.midZ} center zIndexRange={[30, 0]}>
                <div className="measure-label dz">ΔZ: {fmtLen(Math.abs(sg.dz))}</div>
              </Html>
            </>
          )}
        </group>
      ))}
      {pts.map((p, i) => (
        <mesh key={i} position={p} renderOrder={9999}>
          <sphereGeometry args={[0.02, 10, 10]} />
          <meshBasicMaterial color={i === 0 ? '#22c55e' : '#f59e0b'} depthTest={false} transparent opacity={0.95} />
        </mesh>
      ))}
      {segs.map((sg, i) => (
        <Html key={`m${i}`} position={sg.mid} center zIndexRange={[30, 0]}>
          <div className="measure-label vector">Vector: {fmtLen(sg.len)}</div>
        </Html>
      ))}
      {pts.length > 2 && (
        <Html position={pts[pts.length - 1]} center zIndexRange={[30, 0]}>
          <div className="measure-label total">Σ {fmtLen(total)}</div>
        </Html>
      )}
    </group>
  );
}

// Headless hook (?autotest=section): drives the section + rewrites live renderer/
// material/section state into #autotest-dump every second (settled-state truth,
// not mount-timing artefacts).
function AutotestDump() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  // Expose scene/camera + a manual pick probe for headless debugging.
  useLayoutEffect(() => {
    window.__scene = scene;
    window.__camera = camera;
    window.__probePick = (nx, ny) => {
      try {
        const rc = new THREE.Raycaster();
        rc.setFromCamera(new THREE.Vector2(nx, ny), camera);
        const hits = rc.intersectObjects(scene.children, true).slice(0, 6);
        return JSON.stringify(hits.map((h) => {
          const chain = [];
          let p = h.object;
          while (p) { if (p.__r3f?.eventCount) chain.push(p.type); p = p.parent; }
          return {
            d: +h.distance.toFixed(2),
            type: `${h.object.type}/${h.object.geometry?.type || '-'}`,
            ifcKey: h.object.userData?.ifcKey || null,
            handlers: chain,
            pt: h.point.toArray().map((v) => +v.toFixed(2)),
          };
        }));
      } catch (e) { return 'ERR:' + e.message; }
    };
  }, [scene, camera]);
  useLayoutEffect(() => {
    const st = useStore.getState();
    if (!st.section) st.toggleSection();
    st.thirdSection();
    // ?showmarks=1 : make stencil mark passes visible (red=back/inc, blue=front/dec)
    if (new URLSearchParams(window.location.search).get('showmarks') === '1') {
      import('./stencilMats.js').then(({ stencilMats }) => {
        stencilMats.forEach((m, i) => {
          m.back.colorWrite = true;
          m.back.color.set(i % 2 ? '#ff0000' : '#ff5555');
          m.back.opacity = 0.5;
          m.back.transparent = true;
          m.front.colorWrite = true;
          m.front.color.set(i % 2 ? '#0000ff' : '#5555ff');
          m.front.opacity = 0.5;
          m.front.transparent = true;
        });
      });
    }
  }, []);
  useEffect(() => {
    const el = document.createElement('div');
    el.id = 'autotest-dump';
    document.body.appendChild(el);
    const iv = setInterval(() => {
      const sec = useStore.getState().section;
      let sample = 'none';
      let meshes = 0;
      let tubeInfo = 'none';
      scene.traverse((o) => {
        if (!o.isMesh || !o.material || !o.material.isMeshStandardMaterial) return;
        meshes += 1;
        if (sample !== 'none') return;
        const cp = o.material.clippingPlanes;
        sample = cp
          ? `n=${cp.length} n0=[${cp[0].normal.toArray().map((v) => v.toFixed(2)).join(',')}] c0=${cp[0].constant.toFixed(2)}`
          : 'null';
      });
      // Rebar tube census: exists? sane verts? visible chain? world bounds?
      scene.traverse((o) => {
        if (tubeInfo !== 'none' || !o.isMesh || o.geometry?.type !== 'TubeGeometry') return;
        const pos = o.geometry.attributes.position;
        let nan = 0;
        for (let i = 0; i < Math.min(pos.count, 200); i++) {
          if (!Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))) nan += 1;
        }
        o.updateWorldMatrix(true, false);
        const bb = new THREE.Box3().setFromObject(o);
        let visChain = true;
        let p = o;
        while (p) { if (!p.visible) { visChain = false; break; } p = p.parent; }
        const mp = gl.properties.get(o.material);
        tubeInfo = `verts=${pos.count} nan=${nan} vis=${o.visible}/${visChain} `
          + `bb=[${bb.min.toArray().map((v) => v.toFixed(2)).join(',')}]-[${bb.max.toArray().map((v) => v.toFixed(2)).join(',')}] `
          + `clip=${o.material.clippingPlanes === sectionPlanes}/${mp.numClippingPlanes}`;
      });
      // Pixel verdict: 5 sample points along the default bar OUTSIDE the box
      // (bar x∈[0,3] at y=z=0; thirded box x∈[-1.33,1.33]) must read background.
      let verdict = 'n/a';
      try {
        const ctx = gl.getContext();
        const w = gl.domElement.width;
        const h = gl.domElement.height;
        const px = new Uint8Array(4);
        const v3 = new THREE.Vector3();
        let bg = 0;
        const tested = [];
        for (const x of [1.6, 2.0, 2.4, 2.7, 2.95]) {
          v3.set(x, 0, 0).project(camera);
          if (v3.z > 1) { tested.push('behind'); continue; }
          const sx = Math.round((v3.x * 0.5 + 0.5) * w);
          const sy = Math.round((-v3.y * 0.5 + 0.5) * h);
          ctx.readPixels(sx, sy, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
          tested.push([px[0], px[1], px[2]].join(','));
          if (Math.abs(px[0] - 15) < 28 && Math.abs(px[1] - 23) < 28 && Math.abs(px[2] - 42) < 32) bg += 1;
        }
        verdict = `${bg}/5 background [${tested.join(' ')}]`;
      } catch (err) { verdict = `pixel read failed: ${err.message}`; }
      el.textContent = JSON.stringify({
        t: Date.now(),
        localClipping: gl.localClippingEnabled,
        planes: sectionPlanes.map((p) => +p.constant.toFixed(2)),
        section: sec,
        ifc: !!useStore.getState().ifc,
        meshesStandard: meshes,
        sampleMat: sample,
        tube: tubeInfo,
        pick: useStore.getState().ifcPick,
        lastPick: useStore.getState().lastPick,
        barPos: (() => {
          const s = useStore.getState();
          const b = s.bars[s.selectedBar];
          return b ? [b.Pos_x, b.Pos_y, b.Pos_z] : null;
        })(),
      });
    }, 1000);
    return () => { clearInterval(iv); el.remove(); };
  }, [gl, scene]);
  return null;
}

// web-ifc (~6 MB) loads only after the first IFC file is opened.
const IfcModel = lazy(() => import('./IfcModel.jsx'));

// preserveDrawingBuffer (screenshot/pixel reads) only pays off under ?autotest;
// production gets the faster swap path. powerPreference nudges hybrid laptops
// onto the discrete GPU.
const AUTOTEST = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('autotest');

// Scene units: 1 unit = 1 mm, scaled down by 0.001 inside group for viewing.
const S = 0.001;

const DIA_COLORS = { 10: '#22c55e', 12: '#84cc16', 16: '#f59e0b', 20: '#ef4444', 25: '#a855f7', 32: '#3b82f6', 40: '#e11d48' };
const colorFor = (dia) => DIA_COLORS[dia] || '#f59e0b';

function RebarMesh({ bar, selected, onClick, onDoubleClick }) {
  const tube = useMemo(() => {
    const g = genBarPoints(bar);
    // App coords in mm: [ax, ay, az] via transformBarLocalPoint(bar, pt)
    // Scene coords in m: ThreeX = ax * S, ThreeY = az * S (up), ThreeZ = -ay * S (depth)
    const v3 = g.points.map((pt) => {
      const [ax, ay, az] = transformBarLocalPoint(bar, pt);
      return new THREE.Vector3(ax * S, az * S, -ay * S);
    });
    let curve;
    if (v3.length === 2) curve = new THREE.LineCurve3(v3[0], v3[1]);
    else curve = new THREE.CatmullRomCurve3(v3, false, 'catmullrom', 0.0);
    // sharp corners: use low-tension catmull ~ polyline; radius = dia/2 in m
    const diaM = (Number(bar.Dia) || 16) / 1000;
    const geo = new THREE.TubeGeometry(curve, Math.max(8, v3.length * 12), Math.max(0.008, diaM / 2), 8, false);
    return geo;
  // NOTE: depends on the whole bar object — a manual field list went stale
  // before (bent_up_down flip was swallowed by the cache). Tube rebuilds are
  // cheap at BBS scale and distribution copies share one geometry.
  }, [bar]);

  // Distribution grid (FreeCAD-style: world X/Y offsets + optional Z).
  // Same convention as parametric_utils place_c_link_*: copies at
  // Pos + (ix*spacing_x, iy*spacing_y, 0), tagged _ix_iy.
  const copies = useMemo(() => distOffsets(bar).slice(0, MAX_RENDER_COPIES), [
    bar.qty, bar.qty_x, bar.spacing_x, bar.qty_y, bar.spacing_y,
    bar.offset_x, bar.offset_y, bar.offset_z,
  ]);
  const hiddenCount = Math.max(0, distOffsets(bar).length - copies.length);

  const bx = (Number(bar.Pos_x) || 0) * S;
  const bz = (Number(bar.Pos_z) || 0) * S;
  const by = -(Number(bar.Pos_y) || 0) * S;

  return (
    <group userData-pickRoot="rebar"
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
    >
      {copies.map(([ox, oy, oz], i) => (
        <group key={i} position={[bx + ox * S, bz + oz * S, by - oy * S]}>
          {/* Selected bar draws on top (no depth test): snap-to-cover parks it
              inside opaque solids, and the white highlight alone can't show
              through. Unselected bars keep depth so the model reads normally.
              Clipping planes still apply, so section cuts stay correct. */}
          <mesh geometry={tube} renderOrder={selected ? 999 : 0}>
            <meshStandardMaterial color={colorFor(Number(bar.Dia))} roughness={0.4} metalness={0.4} emissive={selected ? '#ffffff' : '#000000'} emissiveIntensity={selected ? 0.35 : 0} clippingPlanes={sectionPlanes} depthTest={selected ? false : true} />
          </mesh>
        </group>
      ))}
      {hiddenCount > 0 && (
        <mesh position={[bx, bz + 0.3, by]}>
          <sphereGeometry args={[0.09, 12, 12]} />
          <meshStandardMaterial color="#f43f5e" emissive="#f43f5e" emissiveIntensity={0.6} />
        </mesh>
      )}
    </group>
  );
}

function ConcreteMesh({ c }) {
  // Scene mapping (shared with rebar + pick): scene = (appX, appZ, −appY) × S.
  // Box spans app [x,x+lx] × [y,y+ly] × [z,z+lz] (mm); ly = plan depth, lz = height.
  const sx = c.lx * S, sy = c.lz * S, sz = c.ly * S;
  const cx = (c.x + c.lx / 2) * S, cy = (c.z + c.lz / 2) * S, cz = -((c.y + c.ly / 2) * S);
  const geom = useMemo(() => new THREE.BoxGeometry(sx, sy, sz), [sx, sy, sz]);
  const capsOn = useStore((s) => !!(s.section?.enabled && (s.section?.solidCut ?? true)));
  const isWireframe = useStore((s) => s.shading === 'wireframe');
  const xray = useStore((s) => s.shading === 'xray');
  const opacity = isWireframe ? 0.08 : xray ? 0.1 : 0.22;
  const noMarks = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('nomarks') === '1';
  const requestFit = useStore((s) => s.requestFit);
  return (
    <mesh userData-pickRoot="concrete" userData-concreteId={c.id} position={[cx, cy, cz]} geometry={geom} onDoubleClick={(e) => {
      e.stopPropagation();
      requestFit('concrete', c.id);
    }}>
      <meshStandardMaterial color="#9ca3af" transparent opacity={opacity} roughness={0.9} depthWrite={false} clippingPlanes={sectionPlanes} />
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(sx, sy, sz)]} />
        <lineBasicMaterial color={isWireframe ? "#38bdf8" : "#6b7280"} />
      </lineSegments>
      {capsOn && !noMarks && [0, 1, 2, 3, 4, 5].map((i) => (
        <group key={i}>
          <mesh geometry={geom} material={stencilMats[i].back} renderOrder={3 * i} raycast={noopStencilRaycast} />
          <mesh geometry={geom} material={stencilMats[i].front} renderOrder={3 * i + 1} raycast={noopStencilRaycast} />
        </group>
      ))}
    </mesh>
  );
}

// Reference lines parented to concrete elements:
// Automatically hidden if the parent concrete element is toggled off or hidden.
function RefLinesGroup() {
  const refLines = useStore((s) => s.refLines);
  const concretes = useStore((s) => s.concretes);
  const showConcrete = useStore((s) => s.showConcrete);
  const selectedRefLine = useStore((s) => s.selectedRefLine);
  const selectRefLine = useStore((s) => s.selectRefLine);
  const removeRefLine = useStore((s) => s.removeRefLine);
  const updateRefLine = useStore((s) => s.updateRefLine);
  const selectConcrete = useStore((s) => s.selectConcrete);

  // Keyboard shortcut: Press Delete or Backspace to delete selected reference line
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const st = useStore.getState();
        if (st.selectedRefLine) {
          e.preventDefault();
          st.removeRefLine(st.selectedRefLine);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!showConcrete || !refLines?.length) return null;

  const hiddenHostIds = new Set((concretes || []).filter((c) => c.visible === false).map((c) => c.id));
  const concMap = new Map((concretes || []).map((c) => [c.id, c]));

  return (
    <group>
      {refLines.map((line) => {
        if (line.visible === false) return null;
        if (line.host && hiddenHostIds.has(line.host)) return null;
        const hostConc = line.host ? concMap.get(line.host) : null;
        if (line.host && !hostConc) return null;

        const isSelected = line.id === selectedRefLine;

        const p1 = line.p1 || [0, 0, 0];
        const p2 = line.p2 || [0, 0, 0];
        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        const dz = p2[2] - p1[2];
        const len = Math.round(Math.hypot(dx, dy, dz));

        const p1Scene = [p1[0] * S, p1[2] * S, -p1[1] * S];
        const p2Scene = [p2[0] * S, p2[2] * S, -p2[1] * S];
        const midScene = [
          (p1Scene[0] + p2Scene[0]) / 2,
          (p1Scene[1] + p2Scene[1]) / 2,
          (p1Scene[2] + p2Scene[2]) / 2,
        ];

        const baseColor = line.color || '#f59e0b';
        const renderColor = isSelected ? '#38bdf8' : baseColor;

        return (
          <group
            key={line.id}
            onClick={(e) => {
              e.stopPropagation();
              selectRefLine(line.id);
              if (line.host) selectConcrete(line.host);
            }}
          >
            <Line
              points={[p1Scene, p2Scene]}
              color={renderColor}
              lineWidth={isSelected ? 4 : 2.5}
              dashed={!isSelected && line.dashed !== false}
              dashScale={16}
              depthTest={false}
              transparent
              opacity={isSelected ? 1 : 0.9}
            />
            {/* Endpoints */}
            <mesh position={p1Scene} renderOrder={9995}>
              <sphereGeometry args={[isSelected ? 0.026 : 0.018, 10, 10]} />
              <meshBasicMaterial color={renderColor} depthTest={false} />
            </mesh>
            <mesh position={p2Scene} renderOrder={9995}>
              <sphereGeometry args={[isSelected ? 0.026 : 0.018, 10, 10]} />
              <meshBasicMaterial color={renderColor} depthTest={false} />
            </mesh>
            {/* Dimension / Name Interactive Badge */}
            <Html position={midScene} center zIndexRange={[35, 0]}>
              <div
                className={`refline-badge ${isSelected ? 'selected' : ''}`}
                title={`Attached to: ${hostConc?.name || 'Concrete'} · Click to select · Press Delete to remove`}
                onClick={(e) => {
                  e.stopPropagation();
                  selectRefLine(line.id);
                  if (line.host) selectConcrete(line.host);
                }}
              >
                <span className="refline-icon">📏</span>
                <span className="refline-text">{line.name ? `${line.name} (${fmtLen(len)})` : fmtLen(len)}</span>
                {isSelected && (
                  <span className="refline-badge-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="refline-badge-btn"
                      title="Hide line"
                      onClick={() => updateRefLine(line.id, { visible: false })}
                    >
                      👁
                    </button>
                    <button
                      className="refline-badge-btn del"
                      title="Delete reference line (Hotkey: Delete)"
                      onClick={() => removeRefLine(line.id)}
                    >
                      ✕
                    </button>
                  </span>
                )}
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

// Preset views (Blender-style, app frame):
// App X = Length (Red), App Y = Width/Depth (Green), App Z = Height/Vertical UP (Blue).
// Scene coords: ThreeX = AppX, ThreeY = AppZ (UP), ThreeZ = -AppY (Depth).
function ViewPreset() {
  const viewReq = useStore((s) => s.viewReq);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  const animRef = useRef(null);
  const lastN = useRef(0);

  useEffect(() => {
    if (!viewReq || !controls || viewReq.n === lastN.current) return;
    lastN.current = viewReq.n;
    const t = controls.target;
    const d = Math.max(camera.position.distanceTo(t), 1);
    const e = Math.max(d * 0.002, 0.001); // epsilon avoids gimbal lock
    const off = {
      top: [0, d, e],
      bottom: [0, -d, e],
      front: [0, e, d],
      back: [0, e, -d],
      right: [d, e, 0],
      left: [-d, e, 0],
      iso: [d * 0.65, d * 0.55, d * 0.65],
    }[viewReq.dir] || [d * 0.65, d * 0.55, d * 0.65];

    animRef.current = {
      from: camera.position.clone(),
      to: new THREE.Vector3(t.x + off[0], t.y + off[1], t.z + off[2]),
      t: 0,
    };
  }, [viewReq, controls, camera]);

  useFrame((_, deltaSec) => {
    if (!animRef.current || !controls) return;
    const a = animRef.current;
    a.t = Math.min(1, a.t + deltaSec * 6.0); // smooth ~180ms ease
    const ease = 1 - Math.pow(1 - a.t, 3);
    camera.position.lerpVectors(a.from, a.to, ease);
    controls.update();
    if (a.t >= 1) animRef.current = null;
  });

  return null;
}

// Focus / Fit model or selected rebar/beam bounds on request or hotkey
function FitModelHandler() {
  const fitReq = useStore((s) => s.fitReq);
  const concretes = useStore((s) => s.concretes);
  const bars = useStore((s) => s.bars);
  const selectedBar = useStore((s) => s.selectedBar);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  const requestFit = useStore((s) => s.requestFit);
  const animRef = useRef(null);
  const lastN = useRef(0);

  // Press 'F' to fit selected bar or beam (or whole model if none)
  useEffect(() => {
    const onKey = (ev) => {
      if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
      const tag = (ev.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || ev.target?.isContentEditable) {
        return;
      }
      if (ev.key.toLowerCase() === 'f') {
        ev.preventDefault();
        requestFit('auto');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestFit]);

  useEffect(() => {
    if (!fitReq || !controls || fitReq.n === lastN.current) return;
    lastN.current = fitReq.n;

    let box = null;
    const reqType = fitReq.target || 'auto';

    if (reqType === 'bar' || (reqType === 'auto' && selectedBar != null && bars[selectedBar])) {
      const idx = reqType === 'bar' && fitReq.idOrIdx != null ? fitReq.idOrIdx : selectedBar;
      const b = bars[idx];
      if (b) {
        box = barAppBox(b);
      }
    } else if (reqType === 'concrete') {
      const cId = fitReq.idOrIdx || bars[selectedBar]?.host || concretes[0]?.id;
      const c = (concretes || []).find((item) => item.id === cId);
      if (c) {
        box = { minX: c.x, maxX: c.x + c.lx, minY: c.y, maxY: c.y + c.ly, minZ: c.z, maxZ: c.z + c.lz };
      }
    }

    if (!box) {
      // Entire model bounding box
      const visibleConc = (concretes || []).filter((c) => c.visible !== false);
      if (!visibleConc.length && !(bars || []).length) return;

      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

      for (const c of visibleConc) {
        minX = Math.min(minX, c.x);
        maxX = Math.max(maxX, c.x + c.lx);
        minY = Math.min(minY, c.y);
        maxY = Math.max(maxY, c.y + c.ly);
        minZ = Math.min(minZ, c.z);
        maxZ = Math.max(maxZ, c.z + c.lz);
      }
      for (const b of bars || []) {
        if (b.hidden) continue;
        const bb = barAppBox(b);
        minX = Math.min(minX, bb.minX);
        maxX = Math.max(maxX, bb.maxX);
        minY = Math.min(minY, bb.minY);
        maxY = Math.max(maxY, bb.maxY);
        minZ = Math.min(minZ, bb.minZ);
        maxZ = Math.max(maxZ, bb.maxZ);
      }
      if (Number.isFinite(minX)) {
        box = { minX, maxX, minY, maxY, minZ, maxZ };
      }
    }

    if (!box) return;

    // Convert app mm to scene meters: ThreeX = AppX, ThreeY = AppZ (up), ThreeZ = -AppY
    const cx = (((box.minX + box.maxX) / 2) || 0) * S;
    const cy = (((box.minZ + box.maxZ) / 2) || 0) * S;
    const cz = -((((box.minY + box.maxY) / 2) || 0) * S);

    const dx = Math.max(0.1, (box.maxX - box.minX) * S);
    const dy = Math.max(0.1, (box.maxZ - box.minZ) * S);
    const dz = Math.max(0.1, (box.maxY - box.minY) * S);
    const size = Math.hypot(dx, dy, dz);
    const d = Math.max(size * 1.5, 0.6);

    // Keep current viewing angle direction vector
    const curDir = new THREE.Vector3().subVectors(camera.position, controls.target);
    if (curDir.lengthSq() < 0.05) {
      curDir.set(0.65, 0.55, 0.65);
    }
    curDir.normalize();

    const targetPos = new THREE.Vector3(cx, cy, cz);
    const cameraPos = new THREE.Vector3(cx + curDir.x * d, cy + curDir.y * d, cz + curDir.z * d);

    animRef.current = {
      fromTgt: controls.target.clone(),
      toTgt: targetPos,
      fromCam: camera.position.clone(),
      toCam: cameraPos,
      t: 0,
    };
  }, [fitReq, concretes, bars, selectedBar, controls, camera]);

  useFrame((_, deltaSec) => {
    if (!animRef.current || !controls) return;
    const a = animRef.current;
    a.t = Math.min(1, a.t + deltaSec * 5.5);
    const ease = 1 - Math.pow(1 - a.t, 3);
    controls.target.lerpVectors(a.fromTgt, a.toTgt, ease);
    camera.position.lerpVectors(a.fromCam, a.toCam, ease);
    controls.update();
    if (a.t >= 1) animRef.current = null;
  });

  return null;
}

export default function Scene() {
  const concretes = useStore((s) => s.concretes);
  const bars = useStore((s) => s.bars);
  const selectedBar = useStore((s) => s.selectedBar);
  const selectBar = useStore((s) => s.selectBar);
  const showConcrete = useStore((s) => s.showConcrete);
  const ifcActive = useStore((s) => s.ifcActive);
  const navOrbit = useStore((s) => s.navMode === 'orbit');
  // Ids of hidden concrete members — bars hosted on them hide too.
  // Tiny array; recomputed per render, no memo needed.
  const hiddenHosts = new Set(concretes.filter((c) => c.visible === false).map((c) => c.id));
  // App-frame boxes of hidden members for spatial hiding (bars within hide too).
  const hiddenBoxes = concretes
    .filter((c) => c.visible === false)
    .map((c) => ({ minX: c.x, minY: c.y, minZ: c.z, maxX: c.x + c.lx, maxY: c.y + c.ly, maxZ: c.z + c.lz }));
  // Lap anchor markers: green/yellow dots on anchor bar splice ends while picking.
  const lapArmed = useStore((s) => s.lapArmed);
  const lapAnchor = useStore((s) => s.lapAnchor);
  const lapAnchorEnds = (lapArmed && lapAnchor != null && bars[lapAnchor])
    ? barSpliceEnds(bars[lapAnchor]).map(([x, y, z]) => [x * S, z * S, -(y * S)])
    : null;

  return (
    <Canvas camera={{ position: [6, 4, -6], fov: 45 }} style={{ background: '#0f172a' }}
      dpr={[1, 1.75]}
      gl={{ preserveDrawingBuffer: AUTOTEST, powerPreference: 'high-performance', stencil: true }}
      onCreated={({ gl }) => {
        gl.localClippingEnabled = true;
        try {
          const attrs = gl.getContextAttributes();
          console.info('[gl] stencil:', !!attrs?.stencil, 'antialias:', !!attrs?.antialias);
        } catch { /* headless */ }
      }}>
      <ambientLight intensity={0.7} />
      <hemisphereLight args={['#ffffff', '#475569', 0.55]} />
      <directionalLight position={[8, 10, 6]} intensity={1.2} />
      {/* Drops render resolution under load, restores when smooth (fill-bound GPUs) */}
      <AdaptiveDpr />
      <Grid infiniteGrid sectionColor="#334155" cellColor="#1e293b" position={[0, -0.01, 0]} />
      <SectionBox />
      {showConcrete && concretes.filter((c) => c.visible !== false).map((c) => <ConcreteMesh key={c.id} c={c} />)}
      <RefLinesGroup />
      {ifcActive && (
        <Suspense fallback={null}>
          <IfcModel />
        </Suspense>
      )}
      {bars.map((b, i) => {
        // View-only hiding: individually hidden bars, bars hosted on a hidden
        // member, and bars spatially inside a hidden member (covers picked/
        // positioned bars that were never assigned a host). Schedule stays whole.
        if (b.hidden) return null;
        if (b.host && hiddenHosts.has(b.host)) return null;
        if (hiddenBoxes.length && barOverlapsBoxes(b, hiddenBoxes)) return null;
        return (
          <RebarMesh
            key={i}
            bar={b}
            selected={i === selectedBar}
            onClick={() => {
              const st = useStore.getState();
              if (st.measure?.active) return;
              // Lap picking: first click anchors, second click laps + selects.
              if (st.lapArmed) {
                if (st.lapAnchor == null) { st.setLapAnchor(i); return; }
                if (st.lapAnchor === i) return;
                st.selectBar(i);
                const r = st.applyLapSplice(st.lapAnchor, i);
                if (!r.ok) alert(r.msg);
                else { st.setLapAnchor(null); st.setLapArmed(false); }
                return;
              }
              selectBar(i);
            }}
            onDoubleClick={() => {
              selectBar(i);
              useStore.getState().requestFit('bar', i);
            }}
          />
        );
      })}
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} panSpeed={1.8} screenSpacePanning enableZoom={false} minDistance={0} maxDistance={Infinity}
        mouseButtons={{ LEFT: navOrbit ? THREE.MOUSE.ROTATE : -1, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN }} />
      <FitIfc />
      <FitModelHandler />
      <AutoClipping />
      <DiveZoom />
      <ViewPreset />
      {/* Engineering/BIM orientation gizmo:
          X = Length (Red), Z = Vertical UP (Blue), Y = Depth (Green).
          Click an axis tip for Top/Bottom/Left/Right/Front/Back, drag to orbit. */}
      <GizmoHelper alignment="top-right" margin={[70, 70]}>
        <GizmoViewport
          labels={['X', 'Z', 'Y']}
          axisColors={['#ef4444', '#3b82f6', '#22c55e']}
          labelColor="white"
        />
      </GizmoHelper>
      <TraceTool />
      <PickHandler />
      <MeasureHandler />
      <MeasureView />
      <SnapPreview />
      {lapAnchorEnds && lapAnchorEnds.map((p, i) => (
        <mesh key={`lap-anchor-${i}`} position={p} renderOrder={9999}>
          <sphereGeometry args={[0.035, 12, 12]} />
          <meshBasicMaterial color={i === 1 ? '#22c55e' : '#84cc16'} depthTest={false} transparent opacity={0.95} />
        </mesh>
      ))}
      {typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('autotest') && <AutotestDump />}
    </Canvas>
  );
}
