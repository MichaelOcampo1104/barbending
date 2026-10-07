import { useEffect, useLayoutEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, AdaptiveDpr, Line, Html, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../store.js';
import { genBarPoints, transformBarLocalPoint, distOffsets, distCount, barOverlapsBoxes, snapPrimitives, barBaseEnds, barSpliceEnds, MAX_RENDER_COPIES, barAppBox } from '../bbs/shapes.js';
import { enrichBar } from '../bbs/csv.js';
import { ifcSession, subsetBox } from '../ifc/session.js';
import FitIfc from './FitIfc.jsx';
import AutoClipping from './AutoClipping.jsx';
import SectionBox from './SectionBox.jsx';
import TraceTool from './TraceTool.jsx';
import { sectionPlanes } from './sectionPlanes.js';
import { stencilMats } from './stencilMats.js';
import BarField from './barfield/BarField.jsx';
import { isFieldRendererActive } from './barfield/rendererFlag.js';
import { fieldRegistry } from './barfield/fieldRegistry.js';

const noopStencilRaycast = () => null;
const SNAP_PX = 14; // screen-space aperture for the snap magnet
const SNAP_OPTS_FALLBACK = { end: true, mid: true, center: true, nearest: true, perp: true };

// Unified osnap magnet over categorized primitives (see snapPrimitives):
// enabled Endpoint/Midpoint/Center nodes, Nearest point along any edge/leg,
// and the Perpendicular foot from refPt (measure's last point) onto an edge.
// Every candidate is gated by the same SNAP_PX cursor aperture and the
// closest one wins — returns { p: app-mm [x,y,z], kind } or null. Points
// behind the camera are skipped (projection flips there).
// Exported for TraceTool so draw modes share the same snap options.
export function snapMagnet(ev, camera, rect, prim, opts, refPt) {
  const o = opts || SNAP_OPTS_FALLBACK;
  const cx = ev.clientX - rect.left, cy = ev.clientY - rect.top;
  const v = new THREE.Vector3();
  const cam = new THREE.Vector3();
  let best = null;
  // Project an app-mm point to screen px, or null when behind the camera.
  const toScreen = ([x, y, z]) => {
    v.set(x * S, z * S, -y * S);
    cam.copy(v).applyMatrix4(camera.matrixWorldInverse);
    if (cam.z > -1e-6) return null;
    v.project(camera);
    return [(v.x * 0.5 + 0.5) * rect.width, (-v.y * 0.5 + 0.5) * rect.height];
  };
  const consider = (p, kind, sx, sy) => {
    const d = Math.hypot(sx - cx, sy - cy);
    if (d < SNAP_PX && (!best || d < best.d)) best = { p, kind, d };
  };
  if (o.end) for (const p of prim.ends || []) { const s = toScreen(p); if (s) consider(p, 'end', s[0], s[1]); }
  if (o.mid) for (const p of prim.mids || []) { const s = toScreen(p); if (s) consider(p, 'mid', s[0], s[1]); }
  if (o.center) for (const p of prim.centers || []) { const s = toScreen(p); if (s) consider(p, 'center', s[0], s[1]); }
  const segs = prim.segments || [];
  if (o.nearest) {
    for (const seg of segs) {
      const [ax, ay, az] = seg[0];
      const [bx, by, bz] = seg[1];
      const sa = toScreen(seg[0]);
      const sb = toScreen(seg[1]);
      if (!sa || !sb) continue;
      const dx = sb[0] - sa[0], dy = sb[1] - sa[1];
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? ((cx - sa[0]) * dx + (cy - sa[1]) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      consider(
        [ax + t * (bx - ax), ay + t * (by - ay), az + t * (bz - az)],
        'nearest', sa[0] + t * dx, sa[1] + t * dy,
      );
    }
  }
  if (o.perp && refPt) {
    const [rx, ry, rz] = refPt;
    for (const seg of segs) {
      const [ax, ay, az] = seg[0];
      const [bx, by, bz] = seg[1];
      const abx = bx - ax, aby = by - ay, abz = bz - az;
      const ab2 = abx * abx + aby * aby + abz * abz;
      if (!(ab2 > 1e-9)) continue;
      const t = ((rx - ax) * abx + (ry - ay) * aby + (rz - az) * abz) / ab2;
      if (t <= 0 || t >= 1) continue; // endpoints are covered by nodes
      const foot = [ax + t * abx, ay + t * aby, az + t * abz];
      const s = toScreen(foot);
      if (s) consider(foot, 'perp', s[0], s[1]);
    }
  }
  return best;
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
    // Concrete root is a group (box mesh + edge lines + stencil ghosts), not
    // a mesh — traverse its children like any other root so the box stays
    // pickable for measure + pick-to-place. Stencil ghosts stay excluded.
    if (r.userData.pickRoot === 'concrete' && !r.isMesh) {
      r.traverse((o) => {
        if (!o.isMesh || !isShown(o) || o.userData?.stencil) return;
        targets.push(o);
      });
      continue;
    }
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
// Runaway-zoom guardrails (a trackpad fling used to slingshot the camera
// hundreds of metres out so the model vanished): momentum cap, hard
// camera-pivot range, and a last-good restore if math ever goes non-finite.
const VEL_MAX = 0.6;
const CAM_MIN_R = 0.002;
const CAM_MAX_R = 400;
function DiveZoom() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  const zoomVel = useRef(0);
  const cursorNDC = useRef(new THREE.Vector2(0, 0));
  const dir = useRef(new THREE.Vector3());
  const clampV = useRef(new THREE.Vector3());
  const lastPos = useRef(null);
  const lastTgt = useRef(null);

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

      // Cap extreme delta spikes to keep motion continuous; Nav panel scales it.
      // Velocity itself is capped so one fling can't build runaway momentum.
      const clamped = Math.max(-250, Math.min(250, delta));
      const gain = useStore.getState().nav?.zoomSpeed ?? 1;
      if ((useStore.getState().nav?.style ?? 'fluid') === 'cad') {
        // CAD direct: one immediate step per notch (a full glide's worth, no tail)
        zoomVel.current = 0;
        applyStep(clamped * 0.0022 * gain);
      } else {
        zoomVel.current = Math.max(-VEL_MAX, Math.min(VEL_MAX, zoomVel.current + clamped * 0.0022 * gain));
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [gl, controls]);

  // Shared dolly step (zoom-to-cursor or pivot dolly + guardrails). Fluid
  // mode feeds it decayed velocity every frame; CAD mode feeds one direct
  // step per wheel notch — the same distance, zero glide.
  const applyStep = (step) => {
    const ctl = controls;
    if (!ctl) return;
    const r = Math.max(camera.position.distanceTo(ctl.target), 0.005);

    // Zoom→cursor off: classic orbit dolly straight at the pivot (pivot stays).
    if ((useStore.getState().nav?.zoomToCursor ?? true) === false) {
      dir.current.subVectors(ctl.target, camera.position).normalize();
      camera.position.addScaledVector(dir.current, -step * Math.max(r * 0.5, 0.02));
    } else {
      dir.current.set(cursorNDC.current.x, cursorNDC.current.y, 1)
        .unproject(camera)
        .sub(camera.position)
        .normalize();

      const d = dir.current;

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
    }

    // Guardrails: clamp the camera-pivot range so a fling can fling the view
    // at most 400 m out (model stays findable; Home/F recover), never through
    // the pivot (which flips the orbit), and restore last-good on NaN.
    const o = clampV.current.subVectors(camera.position, ctl.target);
    const rr = o.length();
    if (!Number.isFinite(rr)) {
      if (lastPos.current && lastTgt.current) {
        camera.position.copy(lastPos.current);
        ctl.target.copy(lastTgt.current);
      }
      zoomVel.current = 0;
    } else if (rr > CAM_MAX_R) {
      camera.position.copy(ctl.target).addScaledVector(o, CAM_MAX_R / rr);
      if (zoomVel.current > 0) zoomVel.current = 0;
    } else if (rr < CAM_MIN_R) {
      if (rr > 1e-9) camera.position.copy(ctl.target).addScaledVector(o, CAM_MIN_R / rr);
      else camera.position.copy(ctl.target).add(new THREE.Vector3(0, 0, CAM_MIN_R));
      if (zoomVel.current < 0) zoomVel.current = 0;
      if (!lastPos.current) lastPos.current = new THREE.Vector3();
      if (!lastTgt.current) lastTgt.current = new THREE.Vector3();
      lastPos.current.copy(camera.position);
      lastTgt.current.copy(ctl.target);
    } else {
      if (!lastPos.current) lastPos.current = new THREE.Vector3();
      if (!lastTgt.current) lastTgt.current = new THREE.Vector3();
      lastPos.current.copy(camera.position);
      lastTgt.current.copy(ctl.target);
    }

    ctl.update();

    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('autotest')) {
      console.info(`[dive] r=${r.toFixed(3)} vel=${zoomVel.current.toFixed(3)} cam=[${camera.position.toArray().map((v) => +v.toFixed(3)).join(',')}] tgt=[${ctl.target.toArray().map((v) => +v.toFixed(3)).join(',')}]`);
    }
  };

  useFrame((_, deltaSec) => {
    // CAD style never glides: kill leftover velocity, wheel steps apply direct.
    if ((useStore.getState().nav?.style ?? 'fluid') === 'cad') { zoomVel.current = 0; return; }
    const ctl = controls;
    if (!ctl || Math.abs(zoomVel.current) < 1e-5) {
      zoomVel.current = 0;
      return;
    }
    const decay = Math.exp(-20 * Math.min(deltaSec, 0.1));
    const step = zoomVel.current * (1 - decay);
    zoomVel.current *= decay;
    applyStep(step);
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
      if (st.drawMode || st.measure?.active || st.boxSelect) return; // Drawing / tracing / measuring / box-select own their clicks
      const t0 = performance.now();
      const rect = el.getBoundingClientRect();
      const nx = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.current.setFromCamera(new THREE.Vector2(nx, ny), camera);
      const targets = collectPickTargets(scene);
      const meshHits = raycaster.current.intersectObjects(targets, false);
      // BarField bars are not meshes: pick them from the field data, then run the same click
      // handlers a RebarMesh would. A field bar counts as the nearest hit when it is at least as
      // close as any mesh, so the empty-space and IFC branches below behave as they did before.
      const fh = fieldRegistry.current
        ? fieldRegistry.current.pick(raycaster.current.ray, { fovRad: (camera.fov * Math.PI) / 180, viewportHeightPx: rect.height, ev })
        : null;
      if (fh) fieldBarClick(fh.row, ev);
      const hits = fh && (!meshHits.length || fh.distance <= meshHits[0].distance)
        ? [{ object: { userData: {} }, point: fh.point, distance: fh.distance, face: null }]
        : meshHits;
      const ms = performance.now() - t0;
      // Always-on one-liner (remote diagnosis: slow raycast vs clean miss).
      console.info(`[pick] targets=${targets.length} hits=${meshHits.length} field=${fh ? fh.row : '-'} raycast=${ms < 10 ? ms.toFixed(1) : Math.round(ms)}ms pick=${st.ifcPick}`);
      if (!hits.length) {
        // Clicked empty space: drop the bar selection. Never while placing
        // (that would lose the bar being positioned) or lap-picking.
        if (!st.ifcPick && !st.lapArmed) st.clearBarSelection();
        return;
      }
      const h = hits[0];
      let root = h.object;
      while (root && root !== scene && !root.userData?.pickRoot) root = root.parent;
      if (st.ifcPick) {
        // Snap on the rebar first: a visible bar node, mid-leg point, or any
        // point along a bar leg near the cursor wins over the surface point
        // (exact centreline point, no cover offset).
        const snap = st.snapEnabled !== false
          ? snapMagnet(ev, camera, rect,
              snapPrimitives(st.bars, st.concretes, [], st.selectedBar, false),
              st.snapOpts, null)
          : null;
        if (snap) {
          const pos = {
            Pos_x: Math.round(snap.p[0] * 10) / 10,
            Pos_y: Math.round(snap.p[1] * 10) / 10,
            Pos_z: Math.round(snap.p[2] * 10) / 10,
          };
          st.placeSelectionAt(pos);
          st.setLastPick({ ...pos, snapped: `rebar-${snap.kind}`, at: Date.now() });
          console.info('[pick] placed ' + JSON.stringify(pos) + ` (snapped rebar-${snap.kind})`);
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
        st.placeSelectionAt(pos);
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

// FreeCAD-style window select (Shift+B arms, then LMB drags a rectangle).
// Rebar only: every visible bar whose projected bbox touches the window joins
// the selection (Ctrl held = add to current set, else replace). One-shot —
// the mode disarms on mouse-up or Esc so normal orbit/click resumes.
function BoxSelect() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  const boxSelect = useStore((s) => s.boxSelect);
  useEffect(() => {
    const el = gl.domElement;
    if (!boxSelect) { el.style.cursor = ''; return; }
    el.style.cursor = 'crosshair';
    // Floating rectangle, parked in the canvas wrapper (pointer-events none
    // so the drag keeps flowing to the canvas).
    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;display:none;z-index:50;pointer-events:none;'
      + 'border:1px dashed #38bdf8;background:rgba(56,189,248,0.12);';
    const wrap = el.parentElement;
    const prevPos = wrap ? window.getComputedStyle(wrap).position : '';
    if (wrap && (prevPos === 'static' || !prevPos)) wrap.style.position = 'relative';
    if (wrap) wrap.appendChild(box);
    let start = null;
    let additive = false;
    let moved = false;
    const paint = (a, b) => {
      const r = el.getBoundingClientRect();
      const x1 = Math.min(a[0], b[0]) - r.left;
      const y1 = Math.min(a[1], b[1]) - r.top;
      const x2 = Math.max(a[0], b[0]) - r.left;
      const y2 = Math.max(a[1], b[1]) - r.top;
      box.style.display = 'block';
      box.style.left = `${x1}px`;
      box.style.top = `${y1}px`;
      box.style.width = `${Math.max(0, x2 - x1)}px`;
      box.style.height = `${Math.max(0, y2 - y1)}px`;
    };
    const onDown = (ev) => {
      if (ev.button !== 0) return;
      const st = useStore.getState();
      if (!st.boxSelect || st.drawMode || st.measure?.active) return;
      start = [ev.clientX, ev.clientY];
      additive = !!(ev.ctrlKey || ev.metaKey);
      moved = false;
      if (controls) controls.enabled = false;
      ev.preventDefault();
      ev.stopPropagation();
    };
    const onMove = (ev) => {
      if (!start) return;
      moved = true;
      paint(start, [ev.clientX, ev.clientY]);
    };
    const onUp = (ev) => {
      if (!start) return;
      const s = start;
      const wasAdd = additive || ev.ctrlKey || ev.metaKey;
      start = null;
      box.style.display = 'none';
      if (controls) controls.enabled = true;
      const st = useStore.getState();
      const dx = ev.clientX - s[0];
      const dy = ev.clientY - s[1];
      if (!moved || dx * dx + dy * dy < 25) {
        // Click, not a window — disarm and let the next click select normally.
        st.setBoxSelect(false);
        return;
      }
      ev.preventDefault();
      ev.stopPropagation();
      const rect = el.getBoundingClientRect();
      const rx0 = (Math.min(s[0], ev.clientX) - rect.left);
      const ry0 = (Math.min(s[1], ev.clientY) - rect.top);
      const rx1 = (Math.max(s[0], ev.clientX) - rect.left);
      const ry1 = (Math.max(s[1], ev.clientY) - rect.top);
      const v = new THREE.Vector3();
      const toPx = ([x, y, z]) => {
        v.set(x * S, z * S, -y * S).project(camera);
        if (v.z > 1) return null; // behind camera
        return [(v.x * 0.5 + 0.5) * rect.width, (-v.y * 0.5 + 0.5) * rect.height];
      };
      const hiddenHosts = new Set((st.concretes || []).filter((c) => c.visible === false).map((c) => c.id));
      const hiddenBoxes = (st.concretes || []).filter((c) => c.visible === false)
        .map((c) => ({ minX: c.x, minY: c.y, minZ: c.z, maxX: c.x + c.lx, maxY: c.y + c.ly, maxZ: c.z + c.lz }));
      const hit = [];
      (st.bars || []).forEach((b, i) => {
        if (b.hidden) return;
        if (b.host && hiddenHosts.has(b.host)) return;
        if (hiddenBoxes.length && barOverlapsBoxes(b, hiddenBoxes)) return;
        let bb;
        try { bb = barAppBox(b); } catch { return; }
        if (![bb.minX, bb.minY, bb.minZ, bb.maxX, bb.maxY, bb.maxZ].every(Number.isFinite)) return;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        let any = false;
        for (const cx of [bb.minX, bb.maxX]) {
          for (const cy of [bb.minY, bb.maxY]) {
            for (const cz of [bb.minZ, bb.maxZ]) {
              const p = toPx([cx, cy, cz]);
              if (!p) continue;
              any = true;
              if (p[0] < x0) x0 = p[0];
              if (p[0] > x1) x1 = p[0];
              if (p[1] < y0) y0 = p[1];
              if (p[1] > y1) y1 = p[1];
            }
          }
        }
        if (!any) return;
        if (x0 <= rx1 && x1 >= rx0 && y0 <= ry1 && y1 >= ry0) hit.push(i);
      });
      if (wasAdd) {
        const merged = [...new Set([...(st.selectedBars || []), ...hit])].sort((a, b) => a - b);
        if (merged.length) st.setSelectedBars(merged);
      } else {
        st.setSelectedBars(hit);
      }
      console.info(`[box] window ${Math.round(rx1 - rx0)}x${Math.round(ry1 - ry0)}px → ${hit.length} bars${wasAdd ? ' (added)' : ''}`);
      st.setBoxSelect(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        useStore.getState().setBoxSelect(false);
        e.preventDefault(); // consumed — App's Esc cascade must not clear the selection too
      }
    };
    // Capture phase: beat OrbitControls / R3F click handling to the drag.
    el.addEventListener('pointerdown', onDown, { capture: true });
    window.addEventListener('pointermove', onMove, { capture: true });
    window.addEventListener('pointerup', onUp, { capture: true });
    window.addEventListener('keydown', onKey);
    return () => {
      el.style.cursor = '';
      el.removeEventListener('pointerdown', onDown, { capture: true });
      window.removeEventListener('pointermove', onMove, { capture: true });
      window.removeEventListener('pointerup', onUp, { capture: true });
      window.removeEventListener('keydown', onKey);
      box.remove();
      if (controls) controls.enabled = true;
    };
  }, [gl, camera, controls, boxSelect]);
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
      if (!st.measure?.active || st.boxSelect) return;
      if (ev.button === 2) { st.popMeasurePoint(); return; } // right-click: drop last
      if (ev.button !== 0 || btn !== 0) return;
      const rect = el.getBoundingClientRect();
      raycaster.current.setFromCamera(new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      ), camera);
      const hits = raycaster.current.intersectObjects(collectPickTargets(scene), false);
      if (!hits.length) return;
      // Osnap magnet over rebar, concrete, and reference lines: enabled
      // Endpoint/Midpoint/Center nodes, Nearest along edges, and the
      // Perpendicular foot from the last placed point. Closest wins.
      const pts = st.measure.points || [];
      const refPt = pts.length ? pts[pts.length - 1] : null;
      const snapped = st.snapEnabled !== false
        ? snapMagnet(ev, camera, rect,
            snapPrimitives(st.bars, st.concretes, st.refLines, -1, true),
            st.snapOpts, refPt)
        : null;
      if (snapped) {
        st.pushMeasurePoint(snapped.p.map((v) => Math.round(v * 10) / 10));
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
        e.preventDefault(); // consumed — App's Esc cascade must not clear the selection too
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

// ⓘ Query tool: while armed, LMB click reads the clicked rebar / concrete /
// IFC object into store.query.result (floating panel). Exact surface point,
// no snap; misses keep the last result. Measuring / drawing / box-select own
// their clicks, so the handler steps aside for them. Esc exits (consumed).
function QueryHandler() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const raycaster = useRef(null);
  if (!raycaster.current) raycaster.current = new THREE.Raycaster();
  const fmtPt = (p) => p.map((v) => (+v).toFixed(1)).join(', ');
  useEffect(() => {
    const el = gl.domElement;
    let down = null;
    const onDown = (ev) => {
      if (ev.button === 0) down = [ev.clientX, ev.clientY];
    };
    const onUp = (ev) => {
      if (!down) return;
      const dx = ev.clientX - down[0];
      const dy = ev.clientY - down[1];
      down = null;
      if (dx * dx + dy * dy > 25) return; // drag (orbit/pan), not a click
      const st = useStore.getState();
      if (!st.query?.active) return;
      if (st.measure?.active || st.drawMode || st.boxSelect) {
        // Another tool owns canvas clicks — say so in the panel instead of
        // silently swallowing the click. Never clobbers a real result.
        const owner = st.measure?.active ? 'Measure' : st.drawMode ? `draw (${st.drawMode})` : 'Box-select';
        console.info(`[query] click ignored — ${owner} owns canvas clicks`);
        if (!st.query?.result) st.setQueryResult({ kind: 'paused', title: 'Query paused', sub: `${owner} owns canvas clicks — finish it (or Esc) first.`, rows: [], at: Date.now() });
        return;
      }
      if (ev.button !== 0) return;
      const rect = el.getBoundingClientRect();
      raycaster.current.setFromCamera(new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      ), camera);
      const targets = collectPickTargets(scene);
      const hits = raycaster.current.intersectObjects(targets, false);
      const fh = fieldRegistry.current
        ? fieldRegistry.current.pick(raycaster.current.ray, { fovRad: (camera.fov * Math.PI) / 180, viewportHeightPx: rect.height, ev })
        : null;
      console.info(`[query] targets=${targets.length} hits=${hits.length} field=${fh ? fh.row : '-'}`);
      if (fh && (!hits.length || fh.distance <= hits[0].distance)) {
        // BarField bar nearer than any mesh: same panel as a RebarMesh hit.
        const fp = fh.point;
        const fieldPt = [fp.x * 1000, -fp.z * 1000, fp.y * 1000].map((v) => Math.round(v * 10) / 10);
        const res = buildRebarQueryResult(st, fh.row, fieldPt);
        if (res) st.setQueryResult({ ...res, at: Date.now() });
        return;
      }
      if (!hits.length) return; // miss keeps the last result (hint shows when empty)
      const h = hits[0];
      let root = h.object;
      while (root && root !== scene && !root.userData?.pickRoot) root = root.parent;
      const kind = root?.userData?.pickRoot || null;
      const wp = h.point;
      // App frame (mm), exact surface point — same mapping as MeasureHandler.
      const appPt = [wp.x * 1000, -wp.z * 1000, wp.y * 1000].map((v) => Math.round(v * 10) / 10);
      let result = null;
      try {
      if (kind === 'rebar') {
        result = buildRebarQueryResult(st, root.userData?.barIndex, appPt);
        if (!result) { console.info('[query] rebar hit has no bar record — skipped'); return; }
      } else if (kind === 'concrete') {
        const c = (st.concretes || []).find((k) => k.id === root.userData?.concreteId);
        if (!c) { console.info('[query] concrete hit has no member record — skipped'); return; }
        result = {
          kind,
          title: `Concrete ${c.name || c.id}`,
          sub: `${c.lx}×${c.ly}×${c.lz} mm`,
          point: appPt,
          rows: [
            ['Origin (app mm)', fmtPt([c.x, c.y, c.z])],
            ['Size Lx·Ly·Lz (mm)', fmtPt([c.lx, c.ly, c.lz])],
            ['Bbox min (app mm)', fmtPt([c.x, c.y, c.z])],
            ['Bbox max (app mm)', fmtPt([c.x + c.lx, c.y + c.ly, c.z + c.lz])],
            ['Center (app mm)', fmtPt([c.x + c.lx / 2, c.y + c.ly / 2, c.z + c.lz / 2])],
            ['Click point (app mm)', fmtPt(appPt)],
          ],
        };
      } else if (kind === 'ifc') {
        const key = h.object.userData?.ifcKey || root.userData?.ifcKey || null;
        const meta = st.ifc;
        const found = (meta?.elements || []).find((e) => e.key === key);
        const typ = !found && key && key.startsWith('type:')
          ? (meta?.types || []).find((t) => `type:${t.key}` === key)
          : null;
        const elName = found?.name || typ?.label || key || '(unknown)';
        const elType = found?.typeLabel || found?.type || typ?.label || '';
        // Model-frame click mm — same math as the MeasureHandler IFC branch
        // (group-local coords × unit → metres → mm).
        let ifcPt = null;
        if (root) {
          const u = st.ifc?.unitToMeters || 1;
          const lp = root.worldToLocal(wp.clone());
          ifcPt = [lp.x * u * 1000, -lp.z * u * 1000, lp.y * u * 1000].map((v) => Math.round(v * 10) / 10);
        }
        // Live index-aware world bbox (subsetBox skips the shared-buffer trap),
        // restated on app-like axes in mm — includes user placement.
        const rows = [
          ['Key', String(key || '—')],
          ['Type', String(elType || '—')],
          ['Storey', String(found?.storey || '—')],
          ['Express ID', String(found?.expressID ?? '—')],
        ];
        const mesh = key && ifcSession.meshes[key];
        if (mesh) {
          try {
            const bb = subsetBox(mesh);
            if (!bb.isEmpty()) {
              const mn = [bb.min.x * 1000, -bb.max.z * 1000, bb.min.y * 1000];
              const mx = [bb.max.x * 1000, -bb.min.z * 1000, bb.max.y * 1000];
              rows.push(
                ['Bbox min (mm, placed)', fmtPt(mn)],
                ['Bbox max (mm, placed)', fmtPt(mx)],
                ['Bbox size (mm)', fmtPt([mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]])],
                ['Center (mm, placed)', fmtPt([(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2])],
              );
            }
          } catch { /* degenerate geometry — meta rows still stand */ }
        }
        if (ifcPt) rows.push(['Click point (model mm)', fmtPt(ifcPt)]);
        rows.push(['Click point (app mm)', fmtPt(appPt)]);
        result = {
          kind, title: `IFC ${elName}`, sub: elType, point: appPt, rows,
        };
      } else {
        console.info('[query] hit is not rebar/concrete/IFC — skipped');
        return;
      }
      } catch (err) {
        console.warn('[query] result build failed:', err);
        result = { kind: 'error', title: 'Query failed', sub: 'See console (F12) for details', point: appPt, rows: [['Error', String((err && err.message) || err)]] };
      }
      if (!result) return;
      st.setQueryResult({ ...result, at: Date.now() });
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && useStore.getState().query?.active) {
        useStore.getState().setQueryActive(false);
        e.preventDefault(); // consumed — App's Esc cascade must not clear the selection too
      }
    };
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [gl, camera, scene]);
  return null;
}

// Snap magnet preview: while pick-to-place or measure is armed (and snap is
// enabled), hovering near an enabled osnap target shows exactly where a click
// would snap — pink for Endpoint/Midpoint/Center/Nearest, green for
// Perpendicular. Local state only — no store churn per mousemove.
const SNAP_KIND_COLORS = { end: '#ec4899', mid: '#ec4899', center: '#ec4899', nearest: '#a78bfa', perp: '#22c55e' };
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
      let prim, refPt;
      if (inMeasure) {
        prim = snapPrimitives(st.bars, st.concretes, st.refLines, -1, true);
        const pts = st.measure.points || [];
        refPt = pts.length ? pts[pts.length - 1] : null;
      } else {
        prim = snapPrimitives(st.bars, st.concretes, [], inPick ? st.selectedBar : -1, false);
        refPt = null;
      }
      const sn = snapMagnet(ev, camera, rect, prim, st.snapOpts, refPt);
      setHover((h) => {
        const key = sn ? `${sn.kind}:${sn.p.map((v) => v.toFixed(1)).join(',')}` : '';
        const old = h ? `${h.kind}:${h.p.map((v) => v.toFixed(1)).join(',')}` : '';
        return old === key ? h : sn;
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
  const [x, y, z] = hover.p;
  const pos = [x * S, z * S, -y * S];
  const color = SNAP_KIND_COLORS[hover.kind] || '#ec4899';
  return (
    <group position={pos}>
      <mesh renderOrder={9999}>
        <octahedronGeometry args={[0.05, 0]} />
        <meshBasicMaterial color={color} wireframe depthTest={false} transparent opacity={0.95} />
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
    window.__store = useStore; // browser checks drive edits / hiding through the real store
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
    // Section-driving belongs to the section harness only — other ?autotest
    // runs (e.g. facebar) must keep the model whole.
    if (new URLSearchParams(window.location.search).get('autotest') === 'section') {
      if (!st.section) st.toggleSection();
      st.thirdSection();
    }
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
      // BarField census: chunk line / tube objects and how many are currently drawn.
      let fieldLines = 0, fieldTubes = 0, fieldVisible = 0, rebarMeshes = 0;
      scene.traverse((o) => {
        if (o.userData?.barField === 'lines') { fieldLines += 1; if (o.visible) fieldVisible += 1; }
        else if (o.userData?.barField === 'tubes') { fieldTubes += 1; if (o.visible) fieldVisible += 1; }
        else if (o.isMesh && o.geometry?.type === 'TubeGeometry') rebarMeshes += 1; // classic RebarMesh tubes (overlay rows)
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
        field: { lines: fieldLines, tubes: fieldTubes, visible: fieldVisible, rebarMeshes },
        selectedBars: useStore.getState().selectedBars,
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

// Click handling shared by the classic RebarMesh groups and the BarField picker: select,
// Ctrl/Cmd/Shift toggle, lap picking. Same behaviour as the closure that used to live in Scene().
function handleBarClick(i, ev) {
  const st = useStore.getState();
  if (st.measure?.active || st.boxSelect) return;
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
  // Ctrl/Cmd/Shift-click toggles into the multi-selection so the box result can be adjusted bar by bar.
  const add = ev && (ev.ctrlKey || ev.metaKey || ev.shiftKey);
  if (add) st.toggleBarSelected(i);
  else st.selectBar(i);
}

function handleBarDoubleClick(i) {
  const st = useStore.getState();
  st.selectBar(i);
  st.requestFit('bar', i);
}

// A click on a BarField bar: same handlers as RebarMesh, and two clicks on the same bar within
// 300 ms also fire the double-click action (select + zoom to the bar).
let lastFieldClick = { row: -1, t: 0 };
function fieldBarClick(row, ev) {
  handleBarClick(row, ev);
  const now = performance.now();
  if (lastFieldClick.row === row && now - lastFieldClick.t < 300) {
    handleBarDoubleClick(row);
    lastFieldClick = { row: -1, t: 0 };
  } else {
    lastFieldClick = { row, t: now };
  }
}

// Query-panel rows for bar index i (shared by the mesh hit path and the BarField pick path).
function buildRebarQueryResult(st, i, appPt) {
  const b = Number.isInteger(i) ? st.bars[i] : null;
  if (!b) return null;
  const fmt = (p) => p.map((v) => (+v).toFixed(1)).join(', ');
  const bb = barAppBox(b);
  const en = enrichBar(b);
  return {
    kind: 'rebar',
    title: `Rebar ${b.Bar_mark || `#${i}`}`,
    sub: `${b.Rebar_Type} · Ø${b.Dia}`,
    point: appPt,
    rows: [
      ['Bar index', String(i)],
      ['Position (app mm)', fmt([b.Pos_x || 0, b.Pos_y || 0, b.Pos_z || 0])],
      ['Bbox min (app mm)', fmt([bb.minX, bb.minY, bb.minZ])],
      ['Bbox max (app mm)', fmt([bb.maxX, bb.maxY, bb.maxZ])],
      ['Bbox size (mm)', fmt([bb.maxX - bb.minX, bb.maxY - bb.minY, bb.maxZ - bb.minZ])],
      ['Distribution', `${en._copies ?? distCount(b)} bars`],
      ['Cut length', `${(en._cut || 0).toLocaleString('en-US')} mm`],
      ['Click point (app mm)', fmt(appPt)],
    ],
  };
}

function RebarMesh({ bar, index, selected, onClick, onDoubleClick }) {
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
    <group userData-pickRoot="rebar" userData-barIndex={index}
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
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
  const capsOn = useStore((s) => !!(s.section?.enabled && (s.section?.solidCut ?? true)));
  const shading = useStore((s) => s.shading);
  const isWireframe = shading === 'wireframe';
  const xray = shading === 'xray';
  const concreteStyle = useStore((s) => s.concreteStyle || 'ghost');
  const concreteOpacity = useStore((s) => s.concreteOpacity ?? 0.25);
  const concreteColor = useStore((s) => s.concreteColor || '#94a3b8');
  const concreteEdges = useStore((s) => s.concreteEdges !== false);
  const requestFit = useStore((s) => s.requestFit);
  const noMarks = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('nomarks') === '1';

  // Geometry: Exact mesh (openings, chamfers, penetrations) vs Parametric Box
  const { geom, edgesGeom } = useMemo(() => {
    let g;
    if (c.meshData && c.meshData.positions?.length && c.meshData.indices?.length) {
      g = new THREE.BufferGeometry();
      const pts = c.meshData.positions;
      const sceneCoords = new Float32Array(pts.length);
      for (let i = 0; i < pts.length; i += 3) {
        sceneCoords[i] = pts[i] * S;        // App X -> Three X
        sceneCoords[i + 1] = pts[i + 2] * S; // App Z -> Three Y (Height)
        sceneCoords[i + 2] = -pts[i + 1] * S; // App Y -> Three Z (Depth)
      }
      g.setAttribute('position', new THREE.BufferAttribute(sceneCoords, 3));
      g.setIndex(c.meshData.indices);
      g.computeVertexNormals();
    } else {
      const sx = c.lx * S, sy = c.lz * S, sz = c.ly * S;
      g = new THREE.BoxGeometry(sx, sy, sz);
      const cx = (c.x + c.lx / 2) * S, cy = (c.z + c.lz / 2) * S, cz = -((c.y + c.ly / 2) * S);
      g.translate(cx, cy, cz);
    }
    const eg = new THREE.EdgesGeometry(g, 25);
    return { geom: g, edgesGeom: eg };
  }, [c.meshData, c.lx, c.ly, c.lz, c.x, c.y, c.z]);

  // Dynamic Shading Material Styles
  const { matColor, opacity, roughness, metalness, depthWrite, wire } = useMemo(() => {
    if (isWireframe) {
      return { matColor: '#38bdf8', opacity: 0.05, roughness: 0.9, metalness: 0, depthWrite: false, wire: true };
    }
    if (xray) {
      return { matColor: concreteColor, opacity: 0.12, roughness: 0.5, metalness: 0.1, depthWrite: false, wire: false };
    }
    if (concreteStyle === 'solid') {
      return { matColor: concreteColor, opacity: 1.0, roughness: 0.85, metalness: 0.05, depthWrite: true, wire: false };
    }
    if (concreteStyle === 'blueprint') {
      return { matColor: '#0284c7', opacity: 0.35, roughness: 0.3, metalness: 0.2, depthWrite: false, wire: false };
    }
    if (concreteStyle === 'textured') {
      return { matColor: '#78716c', opacity: 0.92, roughness: 0.95, metalness: 0, depthWrite: true, wire: false };
    }
    // Default 'ghost' style: transparent preview
    return { matColor: concreteColor, opacity: concreteOpacity, roughness: 0.8, metalness: 0, depthWrite: concreteOpacity >= 0.95, wire: false };
  }, [isWireframe, xray, concreteStyle, concreteOpacity, concreteColor]);

  return (
    <group userData-pickRoot="concrete" userData-concreteId={c.id}>
      <mesh
        geometry={geom}
        onDoubleClick={(e) => {
          e.stopPropagation();
          requestFit('concrete', c.id);
        }}
      >
        <meshStandardMaterial
          color={matColor}
          transparent={opacity < 0.99}
          opacity={opacity}
          roughness={roughness}
          metalness={metalness}
          depthWrite={depthWrite}
          wireframe={wire}
          side={THREE.DoubleSide}
          clippingPlanes={sectionPlanes}
        />
      </mesh>
      {concreteEdges && (
        <lineSegments geometry={edgesGeom}>
          <lineBasicMaterial
            color={isWireframe ? "#38bdf8" : concreteStyle === 'blueprint' ? "#38bdf8" : "#475569"}
            clippingPlanes={sectionPlanes}
            transparent={opacity < 0.9}
            opacity={0.85}
          />
        </lineSegments>
      )}
      {capsOn && !noMarks && [0, 1, 2, 3, 4, 5].map((i) => (
        <group key={i}>
          <mesh geometry={geom} material={stencilMats[i].back} renderOrder={3 * i} raycast={noopStencilRaycast} />
          <mesh geometry={geom} material={stencilMats[i].front} renderOrder={3 * i + 1} raycast={noopStencilRaycast} />
        </group>
      ))}
    </group>
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

// Keyboard navigation: arrows pan, Shift+arrows orbit in 15° steps, +/−
// dolly, Home fits the model. Speeds follow the Nav panel. Skipped while
// typing or with Ctrl/Meta held (those belong to undo/copy/paste).
function NavKeys() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  useEffect(() => {
    const off = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    const onKey = (ev) => {
      const t = ev.target;
      if (t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const ctl = controls;
      if (!ctl) return;
      const st = useStore.getState();
      const k = ev.key;
      const isArrow = k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown';
      const isZoom = k === '+' || k === '=' || k === '-' || k === '_';
      const isHome = k === 'Home';
      if (!isArrow && !isZoom && !isHome) return;
      ev.preventDefault();
      if (isHome) { st.requestFit('all'); return; }
      const r = Math.max(camera.position.distanceTo(ctl.target), 0.05);
      if (isZoom) {
        const dirIn = k === '+' || k === '=';
        const f = Math.pow(dirIn ? 1 / 1.2 : 1.2, st.nav?.zoomSpeed ?? 1);
        off.subVectors(camera.position, ctl.target).multiplyScalar(f);
        // Clamp mega-zoom-outs so one key repeat can't lose the model.
        if (off.length() > 500) off.setLength(500);
        camera.position.copy(ctl.target).add(off);
        ctl.update();
        return;
      }
      const panMul = st.nav?.panSpeed ?? 1;
      if (ev.shiftKey) {
        // Orbit the camera around the pivot in fixed steps.
        const rotMul = st.nav?.rotateSpeed ?? 1;
        const a = (Math.PI / 12) * Math.min(Math.max(rotMul, 0.2), 2.5);
        off.subVectors(camera.position, ctl.target);
        const yaw = (k === 'ArrowLeft' ? 1 : k === 'ArrowRight' ? -1 : 0) * a;
        const pitch = (k === 'ArrowUp' ? 1 : k === 'ArrowDown' ? -1 : 0) * a;
        if (yaw) off.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        if (pitch) {
          right.setFromMatrixColumn(camera.matrix, 0);
          const pol = Math.atan2(Math.hypot(off.x, off.z), off.y);
          const np = Math.min(Math.max(pol - pitch, 0.05), Math.PI - 0.05);
          const rr = off.length();
          const phi = Math.atan2(off.z, off.x);
          off.set(rr * Math.sin(np) * Math.cos(phi), rr * Math.cos(np), rr * Math.sin(np) * Math.sin(phi));
        }
        camera.position.copy(ctl.target).add(off);
        ctl.update();
        return;
      }
      // Pan target + camera together in the screen plane.
      const step = Math.max(r * 0.12, 0.01) * panMul;
      right.setFromMatrixColumn(camera.matrix, 0);
      up.setFromMatrixColumn(camera.matrix, 1);
      off.set(0, 0, 0);
      if (k === 'ArrowLeft') off.addScaledVector(right, -step);
      if (k === 'ArrowRight') off.addScaledVector(right, step);
      if (k === 'ArrowUp') off.addScaledVector(up, step);
      if (k === 'ArrowDown') off.addScaledVector(up, -step);
      camera.position.add(off);
      ctl.target.add(off);
      ctl.update();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [camera, controls]);
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
  const selectedBars = useStore((s) => s.selectedBars);
  const showConcrete = useStore((s) => s.showConcrete);
  const ifcActive = useStore((s) => s.ifcActive);
  const navOrbit = useStore((s) => s.navMode === 'orbit');
  const nav = useStore((s) => s.nav);
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

  const useField = useMemo(() => isFieldRendererActive(), []);
  const renderBar = (b, i) => (
    <RebarMesh
      key={i}
      bar={b}
      index={i}
      selected={(selectedBars || []).includes(i)}
      onClick={(ev) => handleBarClick(i, ev)}
      onDoubleClick={() => handleBarDoubleClick(i)}
    />
  );

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
      {useField ? (
        <BarField renderOverlayBar={(i) => renderBar(bars[i], i)} />
      ) : bars.map((b, i) => {
        // View-only hiding: individually hidden bars, bars hosted on a hidden
        // member, and bars spatially inside a hidden member (covers picked/
        // positioned bars that were never assigned a host). Schedule stays whole.
        if (b.hidden) return null;
        if (b.host && hiddenHosts.has(b.host)) return null;
        if (hiddenBoxes.length && barOverlapsBoxes(b, hiddenBoxes)) return null;
        return renderBar(b, i);
      })}
      <OrbitControls makeDefault enableDamping={nav.style !== 'cad' && nav.damping !== false} dampingFactor={0.08}
        rotateSpeed={nav.rotateSpeed ?? 1} panSpeed={1.8 * (nav.panSpeed ?? 1)} screenSpacePanning enableZoom={false} minDistance={0} maxDistance={Infinity}
        mouseButtons={{ LEFT: navOrbit ? THREE.MOUSE.ROTATE : -1, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN }} />
      <FitIfc />
      <FitModelHandler />
      <NavKeys />
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
      <BoxSelect />
      <QueryHandler />
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
