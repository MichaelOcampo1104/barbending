import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useStore } from '../../store.js';
import { distCount } from '../../bbs/shapes.js';
import { FieldBuilder } from './fieldClient.js';
import { buildField } from './buildField.js';
import { FieldView } from './fieldObjects.js';
import { computeHiddenMask, composeRowStates, STATE } from './rowState.js';
import { diffRows } from './diffRows.js';
import { forcedOverlayRows, fitsOverlay } from './overlayRows.js';
import { chooseTubeChunks } from './lod.js';
import { qualityState } from './qualityState.js';
import { pickField } from './fieldPick.js';
import { fieldRegistry } from './fieldRegistry.js';
import { isWorldPointInSectionBox } from '../sectionPlanes.js';
import { fieldStatus, fieldStats, publishStats, timed } from './fieldStatus.js';

const REBUILD_DEBOUNCE_MS = 150; // wait out bursts of changes (import, add / remove) before rebuilding
const EDIT_QUIET_MS = 400; // edited rows move from the overlay into the delta chunk after this long
const IDLE_REBUILD_MS = 10000; // a non-empty delta is folded into a full rebuild after this long
const DELTA_FRACTION = 0.05; // delta capacity = 5% of the rows (+64)
const LEGACY_FALLBACK_ROWS = 20000;
const DELTA_MAX_COPIES = 40000; // a flush with more distribution copies than this is rebuilt in the worker instead
const MAX_OVERLAY_COPIES = 5000; // RebarMesh draws at most this many copies of one row
// Bar copies a row costs when drawn by the classic renderer (one mesh each).
const overlayWeight = (bars) => (i) => Math.min(distCount(bars[i]) || 1, MAX_OVERLAY_COPIES);

// The overlay row list as a tiny external store: the effect that keeps the field in sync updates it from
// store subscriptions without calling setState inside an effect, and equal lists never re-render.
function createListStore() {
  let list = [];
  const subs = new Set();
  return {
    get: () => list,
    set(next) {
      if (next.length === list.length && next.every((v, i) => v === list[i])) return;
      list = next;
      subs.forEach((f) => f());
    },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
  };
}

// Draws every bar through the chunked field (lines far, tubes near), keeps it in sync with the store,
// and lets selected / just-edited rows use the classic RebarMesh through `renderOverlayBar(i)`.
export default function BarField({ renderOverlayBar }) {
  const bars = useStore((s) => s.bars);
  const concretes = useStore((s) => s.concretes);
  const root = useMemo(() => new THREE.Group(), []);
  const viewRef = useRef(null);
  const deltaRowsRef = useRef([]); // virtual id k (view.rowCount + k) -> bar index
  const lod = useRef({ last: 0, prev: new Set(), cam: new THREE.Matrix4(), detail: '', budget: 0, view: null });
  const overlayStore = useMemo(() => createListStore(), []);
  const overlay = useSyncExternalStore(overlayStore.subscribe, overlayStore.get);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const builder = new FieldBuilder({ onProgress: (f) => fieldStatus.set({ building: true, fraction: f }) });
    const timers = { rebuild: 0, quiet: 0, idle: 0 };
    const pending = new Set(); // edited rows waiting for the quiet period (drawn by the overlay)
    const forceFail = new URLSearchParams(window.location.search).has('fieldfail');
    let disposed = false;
    let seq = 0;
    let builtFrom = null; // the bars array the static field was built from
    let deltaSet = new Set(); // bar indices drawn by the delta chunk
    let deltaBuilt = new Map(); // bar index -> the row object the delta was built from
    let hidden = { bars: null, concretes: null, mask: null };

    const hiddenMask = (b, c) => {
      if (hidden.bars !== b || hidden.concretes !== c) hidden = { bars: b, concretes: c, mask: computeHiddenMask({ bars: b, concretes: c }) };
      return hidden.mask;
    };

    // Compose the row states from the store (hidden mask, selection, pending edits) and apply them.
    const applyStates = () => {
      const st = useStore.getState();
      const view = viewRef.current;
      // Edited rows wait in the overlay for the quiet period and rows added since the build show as overlay at
      // once, each only up to the overlay limit (a bulk edit flushes its delta immediately instead, and after
      // an import the field is simply stale until the rebuild lands).
      const weightOf = overlayWeight(st.bars);
      const force = view ? forcedOverlayRows({ pending, builtRowCount: view.rowCount, barCount: st.bars.length, weightOf }) : new Set();
      const { states, overlay: list } = composeRowStates({
        hiddenMask: hiddenMask(st.bars, st.concretes), selectedBars: st.selectedBars, forceOverlay: force, weightOf,
      });
      if (view) {
        timed(() => {
          const tex = new Uint8Array(view.texelCount);
          const n = Math.min(states.length, view.rowCount);
          for (let i = 0; i < n; i++) tex[i] = deltaSet.has(i) ? STATE.HIDDEN : states[i];
          const dr = deltaRowsRef.current;
          for (let k = 0; k < dr.length; k++) tex[view.rowCount + k] = dr[k] < states.length ? states[dr[k]] : STATE.HIDDEN;
          view.setStates(tex);
        });
      }
      overlayStore.set(list);
    };

    const scheduleRebuild = (delay) => {
      clearTimeout(timers.rebuild);
      timers.rebuild = setTimeout(runRebuild, delay);
    };

    // Move the edited rows from the overlay into a small delta chunk (spec 5.6).
    const flushDelta = () => {
      const view = viewRef.current;
      if (disposed || !view || !builtFrom) return;
      const cur = useStore.getState().bars;
      if (cur.length !== builtFrom.length) { scheduleRebuild(0); return; }
      const d = diffRows(builtFrom, cur);
      if (d.needsRebuild || d.changed.length > view.texelCount - view.rowCount) { scheduleRebuild(0); return; }
      const rows = d.changed;
      if (rows.reduce((sum, i) => sum + distCount(cur[i]), 0) > DELTA_MAX_COPIES) { scheduleRebuild(0); return; }
      try {
        timed(() => {
          view.removeDelta();
          if (rows.length) {
            const ids = rows.map((_, k) => view.rowCount + k);
            const data = buildField(rows.map((i) => cur[i]), { rowIds: ids });
            view.addChunks(data, true);
            for (let k = 0; k < rows.length; k++) view.writeRowAttrs(view.rowCount + k, data.rows.colorIdx[k], data.rows.radiusM[k]);
            view.touch();
          }
        });
      } catch (err) {
        console.error('[barfield] delta build failed', err);
        scheduleRebuild(0);
        return;
      }
      deltaRowsRef.current = rows;
      deltaSet = new Set(rows);
      deltaBuilt = new Map(rows.map((i) => [i, cur[i]]));
      pending.clear();
      lod.current.view = null; // chunk list changed: re-evaluate the LOD
      applyStates();
    };

    // Compare the current rows with the ones the field was built from and queue delta / rebuild work.
    const reconcile = (cur) => {
      const view = viewRef.current;
      if (!view || !builtFrom) return;
      if (cur.length !== builtFrom.length) { scheduleRebuild(REBUILD_DEBOUNCE_MS); return; }
      const d = diffRows(builtFrom, cur);
      if (d.needsRebuild || d.changed.length > view.texelCount - view.rowCount) { scheduleRebuild(REBUILD_DEBOUNCE_MS); return; }
      const changed = new Set(d.changed);
      pending.clear();
      let stale = false;
      for (const i of changed) if (deltaBuilt.get(i) !== cur[i]) { pending.add(i); stale = true; }
      for (const i of deltaSet) if (!changed.has(i)) stale = true; // reverted to the built geometry (undo)
      if (stale) {
        clearTimeout(timers.idle);
        timers.idle = setTimeout(() => scheduleRebuild(0), IDLE_REBUILD_MS);
        clearTimeout(timers.quiet);
        // Too many (or too heavy) edited rows for overlay meshes: flush the delta chunk at once instead of waiting.
        if (!fitsOverlay(pending, { weightOf: overlayWeight(cur) })) flushDelta();
        else timers.quiet = setTimeout(flushDelta, EDIT_QUIET_MS);
      }
    };

    async function runRebuild() {
      if (disposed) return;
      const snapshot = useStore.getState().bars;
      const mySeq = ++seq;
      fieldStatus.set({ building: true, fraction: 0, message: '', error: false });
      const t0 = performance.now();
      try {
        if (forceFail) throw new Error('forced by ?fieldfail');
        const data = await builder.build(snapshot);
        if (disposed || !data || mySeq !== seq) return;
        if (data.skippedRows) console.warn(`[barfield] skipped ${data.skippedRows} rows with invalid geometry`);
        timed(() => {
          const next = new FieldView(data, { deltaCapacity: Math.ceil(data.rowCount * DELTA_FRACTION) + 64 });
          const old = viewRef.current;
          root.add(next.group);
          viewRef.current = next;
          if (old) { root.remove(old.group); old.dispose(); }
        });
        builtFrom = snapshot;
        deltaRowsRef.current = [];
        deltaSet = new Set();
        deltaBuilt = new Map();
        pending.clear();
        clearTimeout(timers.quiet);
        clearTimeout(timers.idle);
        lod.current.view = null;
        publishStats({
          ready: true, version: fieldStats.version + 1, rows: data.rowCount, segments: data.segCount,
          chunks: data.chunkCount, buildMs: Math.round(performance.now() - t0), usingFallback: builder.usingFallback,
        });
        fieldStatus.set({ building: false, fraction: 1, message: '', error: false });
        setFailed(false);
        reconcile(useStore.getState().bars); // edits made while it was building
        applyStates();
      } catch (err) {
        console.error('[barfield] build failed', err);
        if (disposed) return;
        setFailed(true);
        fieldStatus.set({ building: false, message: 'Bar renderer unavailable - showing the classic view (first 20,000 bars)', error: true });
      }
    }

    const barsChanged = (cur) => {
      if (!viewRef.current) scheduleRebuild(REBUILD_DEBOUNCE_MS);
      else reconcile(cur);
      applyStates();
    };

    const unsub = useStore.subscribe((state, prev) => {
      if (state.bars !== prev.bars) barsChanged(state.bars);
      else if (state.selectedBars !== prev.selectedBars || state.concretes !== prev.concretes) applyStates();
    });

    // Let PickHandler / QueryHandler pick bars through the field (rays are in scene metres). Both
    // handlers listen to the same pointer-up, and the first one to run may select the bar, which turns
    // its row into an overlay row the picker skips: so the result is computed once per event object.
    const pickRow = (ray, fovRad, viewportHeightPx) => {
      const view = viewRef.current;
      if (!view) return null;
      const section = useStore.getState().section;
      const r = { origin: [ray.origin.x, ray.origin.y, ray.origin.z], dir: [ray.direction.x, ray.direction.y, ray.direction.z] };
      let best = null;
      for (const data of view.dataSets()) {
        const hit = pickField(data, r, {
          fovRad, viewportHeightPx, tolPx: 6, rowStates: view.states, rowRadiusM: view.radiusM,
          accept: (p) => isWorldPointInSectionBox({ x: p[0], y: p[1], z: p[2] }, section),
        });
        if (hit && (!best || hit.distance < best.distance)) best = hit;
      }
      if (!best) return null;
      const row = best.row < view.rowCount ? best.row : (deltaRowsRef.current[best.row - view.rowCount] ?? -1);
      if (row < 0) return null;
      return { row, distance: best.distance, point: new THREE.Vector3(best.point[0], best.point[1], best.point[2]) };
    };
    let lastPick = { ev: null, res: null };
    fieldRegistry.current = {
      pick(ray, { fovRad, viewportHeightPx, ev = null }) {
        if (ev && lastPick.ev === ev) return lastPick.res;
        const res = pickRow(ray, fovRad, viewportHeightPx);
        if (ev) lastPick = { ev, res };
        return res;
      },
    };

    barsChanged(useStore.getState().bars);

    return () => {
      disposed = true;
      Object.values(timers).forEach((t) => clearTimeout(t));
      unsub();
      builder.dispose();
      fieldRegistry.current = null;
      const v = viewRef.current;
      if (v) { root.remove(v.group); v.dispose(); viewRef.current = null; }
      publishStats({ ready: false });
    };
  }, [root, overlayStore]);

  // Level of detail: at most every 100 ms (and only when something changed) decide which chunks
  // draw as tubes; the rest stay lines. Chunks outside the frustum never spend triangle budget.
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const frustum = useMemo(() => new THREE.Frustum(), []);
  const projView = useMemo(() => new THREE.Matrix4(), []);
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

  // If the field cannot be built, the classic renderer takes over for the first rows so the app still works.
  const failedList = useMemo(() => {
    if (!failed) return null;
    const mask = computeHiddenMask({ bars, concretes });
    const out = [];
    for (let i = 0; i < bars.length && out.length < LEGACY_FALLBACK_ROWS; i++) if (!mask[i]) out.push(i);
    return out;
  }, [failed, bars, concretes]);
  const list = failedList || overlay;

  return (
    <>
      <primitive object={root} />
      {list.map((i) => (bars[i] ? renderOverlayBar(i) : null))}
    </>
  );
}
