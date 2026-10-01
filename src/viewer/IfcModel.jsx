import { useEffect } from 'react';
import * as THREE from 'three';
import { useStore } from '../store.js';
import { ifcSession, SOLID_CAP_TYPES } from '../ifc/session.js';
import { sectionPlanes } from './sectionPlanes.js';
import { stencilMats } from './stencilMats.js';

// Highlight material for the selected element (opacity synced with ghost).
let hlMat = null;
function highlightMaterial(opacity, isWireframe = false) {
  if (!hlMat) {
    hlMat = new THREE.MeshStandardMaterial({
      color: '#f59e0b', emissive: '#7c2d12', emissiveIntensity: 0.7,
      roughness: 0.6, metalness: 0, side: THREE.DoubleSide,
      clippingPlanes: sectionPlanes,
    });
  }
  hlMat.wireframe = isWireframe;
  hlMat.opacity = opacity;
  hlMat.transparent = opacity < 0.999;
  hlMat.depthWrite = opacity >= 0.999;
  return hlMat;
}

// Renders the loaded IFC subsets (objects owned by ifcSession; ifcRev re-renders).
// Click = select element (Blender-style query); pick mode = move selected bar there.
export default function IfcModel() {
  const ifc = useStore((s) => s.ifc);
  const rev = useStore((s) => s.ifcRev);
  const selected = useStore((s) => s.ifcSelected);
  const capsOn = useStore((s) => !!(s.section?.enabled && (s.section?.solidCut ?? true)));
  const shading = useStore((s) => s.shading);
  const isWireframe = shading === 'wireframe';
  const xray = shading === 'xray';
  const xform = useStore((s) => s.ifcXform);
  const group = ifcSession.group;
  void rev;

  useEffect(() => {
    if (!group || !ifc) return;
    group.scale.setScalar(ifc.unitToMeters);
    // User placement: mm offset + deg rotation, model frame (Y up).
    const p = xform?.pos || [0, 0, 0];
    const r = xform?.rot || [0, 0, 0];
    const d = Math.PI / 180;
    group.position.set(p[0] / 1000, p[1] / 1000, p[2] / 1000);
    group.rotation.set(r[0] * d, r[1] * d, r[2] * d);
    // Shading mode: Wireframe, X-ray, or Solid
    const o = isWireframe ? 0.9 : xray ? 0.15 : (ifc.opacity ?? 1);
    if (ifcSession.material) {
      const m = ifcSession.material;
      m.wireframe = isWireframe;
      m.opacity = o;
      m.transparent = o < 0.999;
      m.depthWrite = o >= 0.999 && !isWireframe;
      m.clippingPlanes = sectionPlanes;
      m.needsUpdate = true;
    }
    const applyHL = (mesh, on) => {
      if (!mesh) return;
      mesh.material = on ? highlightMaterial(o, isWireframe) : ifcSession.material;
    };
    if (ifc.level === 'element') {
      for (const e of ifc.elements) {
        const mesh = ifcSession.meshes[e.key];
        if (mesh) {
          mesh.visible = e.visible;
          applyHL(mesh, e.key === selected);
        }
      }
    } else {
      for (const t of ifc.types) {
        const mesh = ifcSession.meshes[`type:${t.key}`];
        if (mesh) mesh.visible = t.visible;
      }
    }
    group.updateMatrixWorld(true);
  }, [group, ifc, selected, xform, shading, isWireframe, xray, rev]);

  // Solid-cut stencil children: same geometry, no colour/depth writes, inherit
  // the subset transform automatically. Removed when caps are off/unloaded.
  useEffect(() => {
    if (!group) return undefined;
    const stale = [];
    group.traverse((o) => { if (o.userData?.stencil) stale.push(o); });
    stale.forEach((m) => m.removeFromParent());
    if (!capsOn || !ifc) return undefined;
    // Only solid element types get caps (thin shells project whole-surface
    // fills; they still clip to correct thin hollow cuts).
    const solidKeys = new Set();
    if (ifc.level === 'element') {
      for (const e of ifc.elements) {
        const meshKey = e.key;
        if (SOLID_CAP_TYPES.has(e.type) && ifcSession.meshes[meshKey]) solidKeys.add(meshKey);
      }
    } else {
      for (const t of ifc.types) {
        if (SOLID_CAP_TYPES.has(t.key) && ifcSession.meshes[`type:${t.key}`]) solidKeys.add(`type:${t.key}`);
      }
    }
    const added = [];
    for (const key of solidKeys) {
      const src = ifcSession.meshes[key];
      // Hidden subsets need no marks (effect re-runs on visibility toggles).
      // Marks share src geometry (now tight spheres), so frustum culling
      // decides identically for src and marks — safe to cull both.
      if (!src || !src.geometry || !src.visible) continue;
      for (let i = 0; i < 6; i++) {
        const b = new THREE.Mesh(src.geometry, stencilMats[i].back);
        b.renderOrder = 3 * i;
        b.userData.stencil = true;
        b.frustumCulled = true;
        b.raycast = () => null;
        const f = new THREE.Mesh(src.geometry, stencilMats[i].front);
        f.renderOrder = 3 * i + 1;
        f.userData.stencil = true;
        f.frustumCulled = true;
        f.raycast = () => null;
        src.add(b, f);
        added.push(b, f);
      }
    }
    return () => { added.forEach((m) => m.removeFromParent()); };
  }, [group, ifc, rev, capsOn]);

  useEffect(() => () => {
    // restore shared material on unmount so no mesh keeps the highlight ref
    if (group && ifcSession.material) {
      group.traverse((ob) => { if (ob.isMesh) ob.material = ifcSession.material; });
    }
  }, [group]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') useStore.getState().setIfcSelected(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!group) return null;

  return <primitive object={group} />;
}
