import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { chooseTubeChunks } from './lod.js';
import { qualityState } from './qualityState.js';
import { useStore } from '../../store.js';
import { FieldBuilder } from './fieldClient.js';
import { FieldView } from './fieldObjects.js';
import { computeHiddenMask, composeRowStates } from './rowState.js';
import { fieldStatus, fieldStats, publishStats, timed } from './fieldStatus.js';

// Draws every bar as merged lines in spatial chunks. Task 6 adds tubes + LOD, Task 7 picking and
// Task 8 incremental edits. `renderOverlayBar(i)` draws row i with the classic RebarMesh (selected rows).
export default function BarField({ renderOverlayBar }) {
  const bars = useStore((s) => s.bars);
  const selectedBars = useStore((s) => s.selectedBars);
  const concretes = useStore((s) => s.concretes);
  const root = useMemo(() => new THREE.Group(), []);
  const builderRef = useRef(null);
  const viewRef = useRef(null);
  const [version, setVersion] = useState(0);

  // One builder (and worker) for the component's lifetime.
  useEffect(() => {
    const builder = new FieldBuilder({ onProgress: (f) => fieldStatus.set({ building: true, fraction: f }) });
    builderRef.current = builder;
    return () => { builder.dispose(); builderRef.current = null; };
  }, []);

  // Rebuild the whole field whenever `bars` changes (Task 8 replaces this with diff + delta chunks).
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const builder = builderRef.current;
      if (!builder) return;
      fieldStatus.set({ building: true, fraction: 0, message: '', error: false });
      const t0 = performance.now();
      try {
        const data = await builder.build(bars);
        if (cancelled || !data) return;
        if (data.skippedRows) console.warn(`[barfield] skipped ${data.skippedRows} rows with invalid geometry`);
        timed(() => {
          const next = new FieldView(data);
          const old = viewRef.current;
          root.add(next.group);
          viewRef.current = next;
          if (old) { root.remove(old.group); old.dispose(); }
        });
        publishStats({
          ready: true, version: fieldStats.version + 1, rows: data.rowCount, segments: data.segCount,
          chunks: data.chunkCount, buildMs: Math.round(performance.now() - t0), usingFallback: builder.usingFallback,
        });
        fieldStatus.set({ building: false, fraction: 1 });
        setVersion((v) => v + 1);
      } catch (err) {
        console.error('[barfield] build failed', err);
        fieldStatus.set({ building: false, message: 'Bar renderer failed - see the console', error: true });
      }
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [bars, root]);

  // Free the GPU objects when the component goes away.
  useEffect(() => () => {
    const v = viewRef.current;
    if (v) { root.remove(v.group); v.dispose(); viewRef.current = null; }
    publishStats({ ready: false });
  }, [root]);

  // Row states: hidden rows vanish from the field, selected rows are drawn by the overlay instead.
  // The overlay list is derived during render, and the texture update runs in a layout effect, so a
  // selected row leaves the field and appears as an overlay mesh within the same frame.
  const hiddenMask = useMemo(() => computeHiddenMask({ bars, concretes }), [bars, concretes]);
  const rowStates = useMemo(() => composeRowStates({ hiddenMask, selectedBars }), [hiddenMask, selectedBars]);
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (view) timed(() => view.setStates(rowStates.states));
  }, [rowStates, version]);
  const overlay = rowStates.overlay;

  // Level of detail: at most every 100 ms (and only when something changed) decide which chunks
  // draw as tubes; the rest stay lines. Chunks outside the frustum never spend triangle budget.
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const frustum = useMemo(() => new THREE.Frustum(), []);
  const projView = useMemo(() => new THREE.Matrix4(), []);
  const lod = useRef({ last: 0, prev: new Set(), cam: new THREE.Matrix4(), detail: '', budget: 0, view: null });
  useFrame(() => {
    const view = viewRef.current;
    if (!view) return;
    const st = lod.current;
    const detail = useStore.getState().barDetail || 'auto';
    camera.updateMatrixWorld();
    const unchanged = st.view === view && detail === st.detail && qualityState.budgetTris === st.budget && st.cam.equals(camera.matrixWorld);
    const now = performance.now();
    if (unchanged || now - st.last < 100) return;
    if (st.view !== view) st.prev = new Set();
    st.last = now;
    st.view = view;
    st.detail = detail;
    st.budget = qualityState.budgetTris;
    st.cam.copy(camera.matrixWorld);
    timed(() => {
      projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projView);
      const tubes = chooseTubeChunks({
        chunks: view.items.map((it) => it.chunk),
        cameraPos: [camera.position.x, camera.position.y, camera.position.z],
        fovRad: (camera.fov * Math.PI) / 180,
        viewportHeightPx: gl.domElement.clientHeight || 800,
        budgetTris: qualityState.budgetTris,
        prevTubes: st.prev,
        detail,
        isVisible: (i) => frustum.intersectsSphere(view.items[i].sphere),
      });
      view.applyTubeSet(tubes);
      st.prev = tubes;
    });
  });

  return (
    <>
      <primitive object={root} />
      {overlay.map((i) => (bars[i] ? renderOverlayBar(i) : null))}
    </>
  );
}
