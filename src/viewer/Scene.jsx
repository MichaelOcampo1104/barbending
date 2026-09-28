import { useEffect, useLayoutEffect, useMemo, useRef, lazy, Suspense } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../store.js';
import { genBarPoints, distOffsets, MAX_RENDER_COPIES } from '../bbs/shapes.js';
import FitIfc from './FitIfc.jsx';
import AutoClipping from './AutoClipping.jsx';
import SectionBox from './SectionBox.jsx';
import { sectionPlanes } from './sectionPlanes.js';
import { stencilMats } from './stencilMats.js';

const noopStencilRaycast = () => null;

// Blender-style direct picking: DOM pointer tracking + manual raycast against
// pickable roots only (IFC group, concrete boxes, rebar tubes). Skips hidden
// subtrees and stencil ghosts, so big models stay interactive. Independent of
// R3F event bubbling; tolerates small pointer drift.
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
      const rect = el.getBoundingClientRect();
      const nx = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.current.setFromCamera(new THREE.Vector2(nx, ny), camera);
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
      const hits = raycaster.current.intersectObjects(targets, false);
      if (autotest) console.info('[pick] up: targets=' + targets.length + ' hits=' + hits.length + ' pick=' + st.ifcPick);
      if (!hits.length) return;
      const h = hits[0];
      let root = h.object;
      while (root && root !== scene && !root.userData?.pickRoot) root = root.parent;
      if (st.ifcPick) {
        let pos;
        if (root && root.userData.pickRoot === 'ifc') {
          const u = st.ifc?.unitToMeters || 1;
          const lp = root.worldToLocal(h.point.clone());
          pos = { Pos_x: Math.round(lp.x * u * 1000), Pos_y: Math.round(-lp.z * u * 1000), Pos_z: Math.round(lp.y * u * 1000) };
        } else {
          // app frame (mm): x right, y plan, z up; scene is metres, Y-up
          pos = { Pos_x: Math.round(h.point.x * 1000), Pos_y: Math.round(-h.point.z * 1000), Pos_z: Math.round(h.point.y * 1000) };
        }
        st.updateBar(st.selectedBar, pos);
        st.setLastPick({ ...pos, at: Date.now() });
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

// Scene units: 1 unit = 1 mm, scaled down by 0.001 inside group for viewing.
const S = 0.001;

const DIA_COLORS = { 10: '#22c55e', 12: '#84cc16', 16: '#f59e0b', 20: '#ef4444', 25: '#a855f7', 32: '#3b82f6', 40: '#e11d48' };
const colorFor = (dia) => DIA_COLORS[dia] || '#f59e0b';

function RebarMesh({ bar, selected, onClick }) {
  const tube = useMemo(() => {
    const g = genBarPoints(bar);
    // mm -> m; local X = bar axis, local Y -> -Z (plan), local Z -> +Y (up)
    const v3 = g.points.map(([x, y, z]) => new THREE.Vector3(x * S, z * S, -y * S));
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
  const rot = THREE.MathUtils.degToRad(Number(bar.Pos_Rotation) || 0);

  return (
    <group userData-pickRoot="rebar" onClick={(e) => { e.stopPropagation(); onClick?.(); }}>
      {copies.map(([ox, oy, oz], i) => (
        <group key={i} position={[bx + ox * S, bz + oz * S, by - oy * S]} rotation={[0, rot, 0]}>
          <mesh geometry={tube}>
            <meshStandardMaterial color={colorFor(Number(bar.Dia))} roughness={0.4} metalness={0.4} emissive={selected ? '#ffffff' : '#000000'} emissiveIntensity={selected ? 0.35 : 0} clippingPlanes={sectionPlanes} />
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
  const [lx, ly, lz] = [c.lx * S, c.lz * S, c.ly * S];
  const geom = useMemo(() => new THREE.BoxGeometry(lx, lz, ly), [lx, ly, lz]);
  const capsOn = useStore((s) => !!(s.section?.enabled && (s.section?.solidCut ?? true)));
  const xray = useStore((s) => s.shading === 'xray');
  const noMarks = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('nomarks') === '1';
  return (
    <mesh userData-pickRoot="concrete" position={[(c.x * S) + lx / 2, (c.z * S) + lz / 2, -((c.y * S) + ly / 2)]} geometry={geom}>
      <meshStandardMaterial color="#9ca3af" transparent opacity={xray ? 0.1 : 0.22} roughness={0.9} depthWrite={false} clippingPlanes={sectionPlanes} />
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(lx, lz, ly)]} />
        <lineBasicMaterial color="#6b7280" />
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

export default function Scene() {
  const concretes = useStore((s) => s.concretes);
  const bars = useStore((s) => s.bars);
  const selectedBar = useStore((s) => s.selectedBar);
  const selectBar = useStore((s) => s.selectBar);
  const showConcrete = useStore((s) => s.showConcrete);
  const ifcActive = useStore((s) => s.ifcActive);
  const navOrbit = useStore((s) => s.navMode === 'orbit');

  return (
    <Canvas camera={{ position: [6, 4, -6], fov: 45 }} style={{ background: '#0f172a' }}
      dpr={[1, 1.75]}
      gl={{ preserveDrawingBuffer: true }}
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
      <Grid infiniteGrid sectionColor="#334155" cellColor="#1e293b" position={[0, -0.01, 0]} />
      <SectionBox />
      {showConcrete && concretes.map((c) => <ConcreteMesh key={c.id} c={c} />)}
      {ifcActive && (
        <Suspense fallback={null}>
          <IfcModel />
        </Suspense>
      )}
      {bars.map((b, i) => (
        <RebarMesh key={i} bar={b} selected={i === selectedBar} onClick={() => selectBar(i)} />
      ))}
      <OrbitControls makeDefault zoomToCursor minDistance={0} maxDistance={Infinity} panSpeed={0.7}
        mouseButtons={{ LEFT: navOrbit ? THREE.MOUSE.ROTATE : -1, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN }} />
      <FitIfc />
      <AutoClipping />
      <PickHandler />
      {typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('autotest') && <AutotestDump />}
    </Canvas>
  );
}
