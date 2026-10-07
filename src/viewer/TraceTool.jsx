import { useEffect, useRef, useState, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { Line, Html } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../store.js';
import { subsetBox, extractMeshGeometry } from '../ifc/session.js';
import { fmtLen, snapMagnet } from './Scene.jsx';
import { snapPrimitives, concreteBox, faceGrid, buildFaceBar, faceFrame, buildSlopedFaceRows } from '../bbs/shapes.js';
import { isWorldPointInSectionBox } from './sectionPlanes.js';

const S = 0.001;
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

const appToWorld = ([x, y, z]) => [x * S, z * S, -y * S];

// App-frame unit normal -> world direction (app X=world X, app Y=-world Z,
// app Z=+world Y — the same mapping PickHandler uses for cover offsets).
const appDirToWorld = ([x, y, z]) => {
  const l = Math.hypot(x, y, z) || 1;
  return new THREE.Vector3(x / l, z / l, -y / l);
};

// App-mm point where a world ray meets a sketched face working plane
// (fs = { normal, origin } in app frame/mm). Double-sided, rounded.
function rayFacePlane(ray, fs) {
  if (!fs?.normal || !fs?.origin) return null;
  const nW = appDirToWorld(fs.normal);
  const oW = fs.origin;
  const planeO = new THREE.Plane().setFromNormalAndCoplanarPoint(
    nW, new THREE.Vector3(oW[0] * S, oW[2] * S, -oW[1] * S));
  const hit = new THREE.Vector3();
  if (!ray.intersectPlane(planeO, hit)) {
    planeO.normal.negate();
    if (!ray.intersectPlane(planeO, hit)) return null;
  }
  return [Math.round(hit.x * 1000), Math.round(-hit.z * 1000), Math.round(hit.y * 1000)];
}

// Project an app-mm point onto a sketched face plane → { q, d }.
function projectOnFace(p, fs) {
  const N = fs.normal, O = fs.origin;
  const k = (p[0] - O[0]) * N[0] + (p[1] - O[1]) * N[1] + (p[2] - O[2]) * N[2];
  return { q: [p[0] - N[0] * k, p[1] - N[1] * k, p[2] - N[2] * k], d: Math.abs(k) };
}

// Convex hull (Andrew monotone chain) of 2D points → ordered loop indices.
function convexHull2(pts) {
  const n = pts.length;
  if (n < 4) return pts.map((_, i) => i);
  const idx = pts.map((_, i) => i).sort((a, b) => pts[a][0] - pts[b][0] || pts[a][1] - pts[b][1]);
  const cross = (o, a, b) => (pts[a][0] - pts[o][0]) * (pts[b][1] - pts[o][1]) - (pts[a][1] - pts[o][1]) * (pts[b][0] - pts[o][0]);
  const lower = [];
  for (const i of idx) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], i) <= 0) lower.pop();
    lower.push(i);
  }
  const upper = [];
  for (let k = idx.length - 1; k >= 0; k--) {
    const i = idx[k];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], i) <= 0) upper.pop();
    upper.push(i);
  }
  lower.pop(); upper.pop();
  return [...lower, ...upper];
}

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
  const faceSketch = useStore((s) => s.faceSketch);
  const setFaceSketch = useStore((s) => s.setFaceSketch);
  const addFaceBar = useStore((s) => s.addFaceBar);
  const sketchDia = useStore((s) => s.sketchDia);
  const sketchSpacing = useStore((s) => s.sketchSpacing);
  const cover = useStore((s) => s.cover);

  const raycaster = useRef(new THREE.Raycaster());
  const mouse = useRef(new THREE.Vector2());
  const [liveSnap, setLiveSnap] = useState(null);

  // Headless hook (?autotest=facebar): project app-mm points to client px
  // + read bars, so the CDP probe can click exact face points and assert rows.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (new URLSearchParams(window.location.search).get('autotest') !== 'facebar') return undefined;
    window.__facebarTest = {
      project: ([x, y, z]) => {
        _v1.set(x * S, z * S, -y * S).project(camera);
        const r = gl.domElement.getBoundingClientRect();
        return [(_v1.x * 0.5 + 0.5) * r.width + r.left, (-_v1.y * 0.5 + 0.5) * r.height + r.top];
      },
      state: () => {
        const s = useStore.getState();
        return {
          face: s.faceSketch, note: s.faceNote, mode: s.drawMode,
          nBars: s.bars.length, nConc: s.concretes.length,
          conc: s.concretes.map((c) => ({ id: c.id, name: c.name, mesh: !!(c.meshData?.positions?.length) })),
        };
      },
      bars: () => useStore.getState().bars.map((b) => ({
        mark: b.Bar_mark, type: b.Rebar_Type, dia: b.Dia,
        pos: [b.Pos_x, b.Pos_y, b.Pos_z], rot: b.Pos_Rotation, plan: b.Plan || b.plane,
        plane: b.Plane, len: b['Length of Bar'] ?? b.length,
        qx: b.qty_x, sx: b.spacing_x, qy: b.qty_y, sy: b.spacing_y, qz: b.qty_z, sz: b.spacing_z,
        group: b.Group, host: b.host,
      })),
    };
    return () => { delete window.__facebarTest; };
  }, [gl, camera]);

  // Keyboard Escape cancels drawing
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        const st = useStore.getState();
        if (st.faceSketch?.p1) { st.setFaceSketch({ ...st.faceSketch, p1: null }); e.preventDefault(); }
        else if (st.faceSketch) { st.setFaceSketch(null); e.preventDefault(); }
        else if (drawStart) { setDrawStart(null); e.preventDefault(); }
        else if (drawMode) { setDrawMode(null); e.preventDefault(); }
        else {
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

      // Face-sketch rebar: once a face is picked, the cursor lives on the
      // cover-offset working plane (general ray∩plane math, any orientation).
      // Snap-assist pulls toward nearby Ends/Midpoints projected on the plane.
      if (st.drawMode === 'bar_face' && st.faceSketch?.normal && st.faceSketch?.origin) {
        const fs = st.faceSketch;
        mouse.current.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.current.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.current.setFromCamera(mouse.current, camera);
        const wp = rayFacePlane(raycaster.current.ray, fs);
        if (!wp || !isWorldPointInSectionBox(
          { x: wp[0] * S, y: wp[2] * S, z: -wp[1] * S }, st.section)) { clearSnap(); return; }
        let sx = wp[0], sy = wp[1], sz = wp[2], kind = 'Face Plane';
        const prims = snapPrimitives(st.bars, st.concretes, st.refLines, -1, true);
        const pts = [...prims.ends, ...prims.mids];
        const step = Math.max(1, Math.floor(pts.length / 1500));
        let bestPx = 14;
        for (let i = 0; i < pts.length; i += step) {
          const pr = projectOnFace(pts[i], fs);
          if (pr.d > 150) continue;
          _v1.set(pr.q[0] * S, pr.q[2] * S, -pr.q[1] * S).project(camera);
          if (_v1.z > 1) continue;
          const px = (_v1.x * 0.5 + 0.5) * rect.width;
          const py = (-_v1.y * 0.5 + 0.5) * rect.height;
          const dd = Math.hypot(px - (ev.clientX - rect.left), py - (ev.clientY - rect.top));
          if (dd < bestPx) {
            bestPx = dd;
            sx = Math.round(pr.q[0]); sy = Math.round(pr.q[1]); sz = Math.round(pr.q[2]);
            kind = 'Snap';
          }
        }
        const appPos = {
          x: sx, y: sy, z: sz,
          worldPos: [sx * S, sz * S, -sy * S],
          type: kind,
          hitObject: null,
        };
        liveSnapRef.current = appPos;
        setLiveSnap(appPos);
        setSnapNode(appPos);
        return;
      }

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

    // MODE 0: Face-sketch rebar — click 1 picks the concrete face (working
    // plane at cover depth), click 2 starts the bar line, click 3 commits a
    // straight bar with the transverse grid auto-filled. Stays armed.
    // Resolves purely from ray∩plane math (live snap only refines), so
    // clicks never depend on mesh hits. Rejections report to the HUD.
    const handleFaceClick = (ev) => {
      const st2 = useStore.getState();
      const snapNow = liveSnapRef.current;
      const castAt = () => {
        const r2 = el.getBoundingClientRect();
        raycaster.current.setFromCamera(new THREE.Vector2(
          ((ev.clientX - r2.left) / r2.width) * 2 - 1,
          -((ev.clientY - r2.top) / r2.height) * 2 + 1), camera);
        return raycaster.current.ray;
      };
      const pointOnFacePlane = () => {
        const fs2 = useStore.getState().faceSketch;
        if (!fs2?.normal || !fs2?.origin) return null;
        if (snapNow) {
          const c = [snapNow.x, snapNow.y, snapNow.z];
          if (projectOnFace(c, fs2).d <= 250) {
            const pr = projectOnFace(c, fs2).q;
            return [Math.round(pr[0]), Math.round(pr[1]), Math.round(pr[2])];
          }
        }
        return rayFacePlane(castAt(), fs2);
      };
      if (!st2.faceSketch) {
        // Click 1: pick the concrete face directly (IFC/rebar clicks pass
        // through — only concrete roots qualify).
        const ray = castAt();
        const roots = [];
        scene.traverse((o) => { if (o.userData?.pickRoot) roots.push(o); });
        const targets = [];
        for (const r of roots) {
          if (!r.visible) continue;
          if (r.userData.pickRoot === 'concrete' && r.isMesh) targets.push(r);
          else r.traverse((o) => { if (o.isMesh && o.visible && !o.userData?.stencil) targets.push(o); });
        }
        const hits = raycaster.current.intersectObjects(targets, false);
        const hit = hits.find((h) => isWorldPointInSectionBox(h.point, st2.section)) || null;
        if (hit?.face?.normal) {
          let o = hit.object, root = null, cid = null;
          while (o && o !== scene) {
            if (!cid && o.userData?.concreteId) cid = o.userData.concreteId;
            if (o.userData?.pickRoot) { root = o.userData.pickRoot; break; }
            o = o.parent;
          }
            if (root === 'concrete') {
              const wn = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
              const an = [wn.x, -wn.z, wn.y];
              const nl = Math.hypot(an[0], an[1], an[2]) || 1;
              const n = [an[0] / nl, an[1] / nl, an[2] / nl];
              const axIdx = Math.abs(n[0]) >= Math.abs(n[1]) && Math.abs(n[0]) >= Math.abs(n[2]) ? 0
                : Math.abs(n[1]) >= Math.abs(n[2]) ? 1 : 2;
              const axis = 'xyz'[axIdx];
              const sign = (n[axIdx] < 0 ? -1 : 1);
              // Tilted when the normal leans >6° off the dominant axis —
              // sloped faces take the true-plane path, axis faces keep the
              // legacy path (byte-identical bars).
              const tilted = Math.abs(n[axIdx]) < 0.9945;
              const hp = [Math.round(hit.point.x * 1000), Math.round(-hit.point.z * 1000), Math.round(hit.point.y * 1000)];
              const member = (st2.concretes || []).find((c) => c.id === (cid || resolveConcreteHostId(hp, hit.object, st2.concretes)));
              const box = member ? concreteBox(member) : null;
              if (member && box) {
                const dia = Number(st2.sketchDia) || 16;
                const need = (Number(st2.cover) || 0) + dia / 2;
                const thick = box[axis + '1'] - box[axis + '0'];
                let plane, origin;
                if (thick < 2 * need) {
                  // Thin member: work plane through the middle (both paths).
                  origin = [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, (box.z0 + box.z1) / 2];
                  plane = origin[axIdx];
                } else if (!tilted) {
                  plane = hp[axIdx] - sign * need;
                  origin = [hp[0], hp[1], hp[2]];
                  origin[axIdx] = plane;
                } else {
                  // Sloped face: cover offset along the true normal.
                  origin = [hp[0] - n[0] * need, hp[1] - n[1] * need, hp[2] - n[2] * need];
                  plane = origin[axIdx];
                }
                plane = Math.round(plane * 10) / 10;
                origin = origin.map((v) => Math.round(v * 10) / 10);
                const slopeDeg = Math.round(Math.acos(Math.min(1, Math.abs(n[2]))) * 180 / Math.PI * 10) / 10;
                st2.setFaceSketch({
                  memberId: member.id, axis, sign, plane: Math.round(plane * 10) / 10,
                  normal: n, origin, tilted, slopeDeg, p1: null,
                });
                st2.setFaceNote(null);
                console.info(`[TraceTool] Face sketch on ${member.name} ${sign > 0 ? '+' : ''}${axis.toUpperCase()} face @ ${Math.round(plane)}${tilted ? ` (slope ${slopeDeg}°)` : ''}`);
                return;
              }
            }
        }
        st2.setFaceNote('Click a concrete face — IFC and rebar clicks pass through.');
        return;
      }
      const p = pointOnFacePlane();
      if (!p) {
        st2.setFaceNote('No hit on the working plane — orbit to face it and click again.');
        console.info('[TraceTool] Face p2 ignored: ray parallel to working plane, no snap nearby.');
        return;
      }
      const fs2 = useStore.getState().faceSketch;
      if (!fs2.p1) {
        useStore.getState().setFaceSketch({ ...fs2, p1: p });
        useStore.getState().setFaceNote(null);
        console.info(`[TraceTool] Face bar start (${p[0]}, ${p[1]}, ${p[2]})`);
      } else {
        try {
          const s3 = useStore.getState();
          const member = (s3.concretes || []).find((c) => c.id === fs2.memberId);
          const triedLen = Math.round(Math.hypot(p[0] - fs2.p1[0], p[1] - fs2.p1[1], p[2] - fs2.p1[2]));
          const dims = {
            member, p1: fs2.p1, p2: p,
            dia: s3.sketchDia, spacing: s3.sketchSpacing, cover: s3.cover,
          };
          const rows = fs2.tilted
            ? buildSlopedFaceRows({ ...dims, normal: fs2.normal })
            : [buildFaceBar({ ...dims, axis: fs2.axis, planeCoord: fs2.plane })].filter(Boolean);
          if (!rows.length) {
            s3.setFaceNote(`Bar rejected (${triedLen} mm) — draw at least 50 mm along the face.`);
            console.info(`[TraceTool] Face p2 rejected: no rows (len ${triedLen}).`);
            return;
          }
          s3.addFaceBars(rows, {
            spec: JSON.stringify({
              p1: fs2.p1, p2: p, cover: s3.cover,
              ...(fs2.tilted
                ? { tilted: true, normal: fs2.normal }
                : { axis: fs2.axis, planeCoord: fs2.plane }),
            }),
          });
          s3.setFaceNote(null);
          const first = rows[0];
          console.info(`[TraceTool] Face bar ${first['Length of Bar']}mm × ${rows.length} on ${member?.name || fs2.memberId} (${first.Plane} rot ${first.Pos_Rotation})`);
          useStore.getState().setFaceSketch({ ...fs2, p1: null });
        } catch (err) {
          useStore.getState().setFaceNote(`Commit failed: ${err?.message || err}`);
          console.error('[TraceTool] Face commit failed:', err);
        }
      }
    };

    const onDown = (ev) => {
      if (ev.button === 0) downPos = [ev.clientX, ev.clientY];
      else if (ev.button === 2) {
        // Right click cancels current step
        const st = useStore.getState();
        if (st.faceSketch?.p1) {
          st.setFaceSketch({ ...st.faceSketch, p1: null });
          ev.preventDefault();
        } else if (st.faceSketch) {
          st.setFaceSketch(null);
          ev.preventDefault();
        } else if (drawStart) {
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

      // MODE 0 first: face-sketch clicks resolve from the working plane (ray
      // math needs no mesh hit), so they must not depend on the snap gate.
      if (drawMode === 'bar_face') {
        handleFaceClick(ev);
        return;
      }

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
  }, [gl, camera, scene, drawMode, drawStart, concretes, selectedConcrete, addConcrete, addRefLine, setDrawStart]);

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

  // Face-sketch previews: allowed-zone loop on the working plane, the bar
  // line p1->cursor with length badge, and the auto transverse grid extent.
  // Tilted faces loop the bbox convex hull projected on the true plane and
  // preview stepped rows; axis faces keep the legacy loop + single grid.
  const facePreview = useMemo(() => {
    if (drawMode !== 'bar_face' || !faceSketch) return null;
    const member = (concretes || []).find((c) => c.id === faceSketch.memberId);
    const box = member ? concreteBox(member) : null;
    if (!box) return null;
    const dia = Number(sketchDia) || 16;
    const inset = (Number(cover) || 0) + dia / 2;
    const { axis, plane, tilted } = faceSketch;
    let loop = null;
    if (!tilted) {
      const loopOf = (a0, a1, b0, b1) => {
        // (a,b) are the two in-face app axes in order
        const P = (a, b) => axis === 'x' ? [plane, a, b] : axis === 'y' ? [a, plane, b] : [a, b, plane];
        return [P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1), P(a0, b0)].map(appToWorld);
      };
      if (axis === 'x') loop = loopOf(box.y0 + inset, box.y1 - inset, box.z0 + inset, box.z1 - inset);
      else if (axis === 'y') loop = loopOf(box.x0 + inset, box.x1 - inset, box.z0 + inset, box.z1 - inset);
      else loop = loopOf(box.x0 + inset, box.x1 - inset, box.y0 + inset, box.y1 - inset);
    } else if (faceSketch.normal && faceSketch.origin) {
      // Hull of the bbox corners projected on the true working plane.
      const fr = faceFrame(faceSketch.normal);
      if (fr) {
        const corners = [];
        for (const cx of [box.x0, box.x1]) for (const cy of [box.y0, box.y1]) for (const cz of [box.z0, box.z1]) corners.push([cx, cy, cz]);
        const proj = corners.map((c) => {
          const k = (c[0] - faceSketch.origin[0]) * fr.N[0] + (c[1] - faceSketch.origin[1]) * fr.N[1] + (c[2] - faceSketch.origin[2]) * fr.N[2];
          const q = [c[0] - fr.N[0] * k, c[1] - fr.N[1] * k, c[2] - fr.N[2] * k];
          return { q, u: q[0] * fr.U[0] + q[1] * fr.U[1] + q[2] * fr.U[2], v: q[0] * fr.V[0] + q[1] * fr.V[1] + q[2] * fr.V[2] };
        });
        const order = convexHull2(proj.map((p) => [p.u, p.v]));
        loop = [...order.map((i) => appToWorld(proj[i].q)), appToWorld(proj[order[0]].q)];
      }
    }
    const out = { loop, memberName: member.name, axis, plane };
    if (!loop) return out;
    if (faceSketch.p1 && liveSnap) {
      const p1 = faceSketch.p1;
      const p2 = [liveSnap.x, liveSnap.y, liveSnap.z];
      const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
      out.bar = { p1World: appToWorld(p1), p2World: appToWorld(p2), len: Math.round(L) };
      const dims = {
        member, p1, p2, dia, spacing: sketchSpacing, cover,
      };
      const rows = tilted
        ? buildSlopedFaceRows({ ...dims, normal: faceSketch.normal })
        : [buildFaceBar({ ...dims, axis, planeCoord: plane })].filter(Boolean);
      const spec = rows[0];
      if (spec && rows.length === 1) {
        const tAxis = spec.qty_x > 1 ? 'x' : spec.qty_y > 1 ? 'y' : 'z';
        const n = spec['qty_' + tAxis], sp = spec['spacing_' + tAxis];
        const ti = { x: 0, y: 1, z: 2 }[tAxis];
        const mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, (p1[2] + p2[2]) / 2];
        const half = ((n - 1) * sp) / 2;
        const e1 = [...mid], e2 = [...mid];
        e1[ti] = spec[['Pos_x', 'Pos_y', 'Pos_z'][ti]] - half;
        e2[ti] = spec[['Pos_x', 'Pos_y', 'Pos_z'][ti]] + half;
        // end ticks run along the bar direction (60 mm)
        const ux = (p2[0] - p1[0]) / (L || 1), uy = (p2[1] - p1[1]) / (L || 1), uz = (p2[2] - p1[2]) / (L || 1);
        const t1a = [e1[0] - ux * 30, e1[1] - uy * 30, e1[2] - uz * 30];
        const t1b = [e1[0] + ux * 30, e1[1] + uy * 30, e1[2] + uz * 30];
        const t2a = [e2[0] - ux * 30, e2[1] - uy * 30, e2[2] - uz * 30];
        const t2b = [e2[0] + ux * 30, e2[1] + uy * 30, e2[2] + uz * 30];
        out.grid = {
          extent: [appToWorld(e1), appToWorld(e2)],
          tick1: [appToWorld(t1a), appToWorld(t1b)],
          tick2: [appToWorld(t2a), appToWorld(t2b)],
          mid: appToWorld(mid),
          label: `${n} @ ${sp}`,
        };
      } else if (spec && rows.length > 1) {
        // Stepped set: extent from first to last row, ticks along the bar.
        const a = [rows[0].Pos_x, rows[0].Pos_y, rows[0].Pos_z];
        const b = [rows[rows.length - 1].Pos_x, rows[rows.length - 1].Pos_y, rows[rows.length - 1].Pos_z];
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
        const ux = (p2[0] - p1[0]) / (L || 1), uy = (p2[1] - p1[1]) / (L || 1), uz = (p2[2] - p1[2]) / (L || 1);
        out.grid = {
          extent: [appToWorld(a), appToWorld(b)],
          tick1: [appToWorld([a[0] - ux * 30, a[1] - uy * 30, a[2] - uz * 30]), appToWorld([a[0] + ux * 30, a[1] + uy * 30, a[2] + uz * 30])],
          tick2: [appToWorld([b[0] - ux * 30, b[1] - uy * 30, b[2] - uz * 30]), appToWorld([b[0] + ux * 30, b[1] + uy * 30, b[2] + uz * 30])],
          mid: appToWorld(mid),
          label: `${rows.length} × ${Math.round(spec['Length of Bar'])}`,
        };
      }
    }
    return out;
  }, [drawMode, faceSketch, liveSnap, concretes, sketchDia, sketchSpacing, cover]);

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
          <Html position={refLinePreview.mid} center zIndexRange={[50, 0]} wrapperClass="facebadge-wrap">
            <div className="refline-badge preview">📏 {fmtLen(refLinePreview.len)}</div>
          </Html>
        </group>
      )}

      {/* Live Face-Sketch Previews */}
      {facePreview && (
        <group>
          {facePreview.loop && (
            <Line
              points={facePreview.loop}
              color="#22d3ee"
              lineWidth={2}
              transparent
              opacity={0.9}
              depthTest={false}
            />
          )}
          {facePreview.bar && (
            <Line
              points={[facePreview.bar.p1World, facePreview.bar.p2World]}
              color="#4ade80"
              lineWidth={4}
              depthTest={false}
            />
          )}
          {facePreview.bar && (
            <Html position={facePreview.bar.p2World} center zIndexRange={[50, 0]} wrapperClass="facebadge-wrap">
              <div className="refline-badge preview">🔩 {fmtLen(facePreview.bar.len)}</div>
            </Html>
          )}
          {facePreview.grid && (
            <group>
              <Line points={facePreview.grid.extent} color="#f59e0b" lineWidth={2} dashed dashScale={12} depthTest={false} transparent opacity={0.95} />
              <Line points={facePreview.grid.tick1} color="#f59e0b" lineWidth={2} depthTest={false} />
              <Line points={facePreview.grid.tick2} color="#f59e0b" lineWidth={2} depthTest={false} />
              <Html position={facePreview.grid.mid} center zIndexRange={[50, 0]} wrapperClass="facebadge-wrap">
                <div className="refline-badge preview">↔ {facePreview.grid.label}</div>
              </Html>
            </group>
          )}
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
