import { create } from 'zustand';
import { defaultBar, defaultBarForHost, resolveBarHost, genBarPoints, barMainLength, barSpliceEnds, distToBar, barOverlapsBoxes } from './bbs/shapes.js';
import { lapLengthMm } from './bbs/calc.js';
import { defaultSectionBox, normalizeSection } from './viewer/sectionPlanes.js';

let tagSeq = 1;

const SAVE_KEY = 'barbending.save.v1';
const HIST_MAX = 50;

// Undo snapshot: the model (view-only flags ride along on their objects).
// IFC reference state, section box, and UI toggles are NOT history.
const snap = (s) => ({
  bars: structuredClone(s.bars),
  concretes: structuredClone(s.concretes),
  refLines: structuredClone(s.refLines || []),
  selectedBar: s.selectedBar,
  cover: s.cover,
});
// Push pre-mutation snapshot, drop redo branch. Called inside set() updaters
// so the snapshot is atomic with the mutation.
const withHist = (s, patch) => ({
  ...patch,
  past: [...s.past.slice(-(HIST_MAX - 1)), snap(s)],
  future: [],
});

// Nearest VISIBLE bar to an app-mm point, or null. Tolerance covers a tube
// surface hit (dia/2) plus a few mm of click slop. Mirrors the visibility
// rules in rebarSnapNodes so hidden bars never attract measure control.
const nearestVisibleBar = (pt, bars, concretes) => {
  const hiddenIds = new Set((concretes || []).filter((c) => c.visible === false).map((c) => c.id));
  const hiddenBoxes = (concretes || []).filter((c) => c.visible === false)
    .map((c) => ({ minX: c.x, minY: c.y, minZ: c.z, maxX: c.x + c.lx, maxY: c.y + c.ly, maxZ: c.z + c.lz }));
  let best = null, bestD = Infinity;
  (bars || []).forEach((b, i) => {
    if (b.hidden) return;
    if (b.host && hiddenIds.has(b.host)) return;
    if (hiddenBoxes.length && barOverlapsBoxes(b, hiddenBoxes)) return;
    const d = distToBar(pt, b);
    const tol = (Number(b.Dia) || 16) / 2 + 8;
    if (d < bestD && d <= tol) { bestD = d; best = i; }
  });
  return best;
};

// IFC bbox is stored in raw model units; camera fit scales by the active unit
// so unit overrides keep the view consistent.
const fitOf = (m) => (m ? {
  center: m.bbox.center.map((c) => c * m.unitToMeters),
  radius: m.bbox.radius * m.unitToMeters,
  n: Date.now(),
} : null);

export const useStore = create((set, get) => ({
  concretes: [
    { id: 'c1', name: 'Beam B1', lx: 6000, ly: 400, lz: 600, x: 0, y: 0, z: 0 },
  ],
  bars: [
    { ...defaultBar('straight', 1), host: 'c1', Bar_mark: 'SETC_149', 'Length of Bar': 3000 },
  ],
  refLines: [],
  selectedRefLine: null,
  selectRefLine: (id) => set({ selectedRefLine: id }),
  selectedBar: 0,
  selectedConcrete: 'c1',
  showConcrete: true,

  selectConcrete: (id) => set({ selectedConcrete: id }),

  addConcrete: (c) => {
    const nid = (c && c.id) || `c${Date.now()}`;
    return set((s) => withHist(s, {
      concretes: [...s.concretes, { ...c, id: nid }],
      selectedConcrete: nid,
    }));
  },
  updateConcrete: (id, patch) => set((s) => {
    const old = s.concretes.find((c) => c.id === id);
    // Host-follow: translating a member (x/y/z edit) carries its explicit
    // children — hosted bars shift Pos, hosted refLines shift p1/p2 by the
    // same delta, atomically (one undo step). Resize (lx/ly/lz), rename, and
    // visibility never move children. Only explicit b.host/l.host === id
    // follow; spatially-coincident but unhosted bars stay put.
    let dx = 0, dy = 0, dz = 0;
    if (old) {
      const nx = patch.x !== undefined ? Number(patch.x) : Number(old.x);
      const ny = patch.y !== undefined ? Number(patch.y) : Number(old.y);
      const nz = patch.z !== undefined ? Number(patch.z) : Number(old.z);
      if (Number.isFinite(nx) && Number.isFinite(Number(old.x))) dx = nx - Number(old.x);
      if (Number.isFinite(ny) && Number.isFinite(Number(old.y))) dy = ny - Number(old.y);
      if (Number.isFinite(nz) && Number.isFinite(Number(old.z))) dz = nz - Number(old.z);
    }
    if (dx === 0 && dy === 0 && dz === 0) {
      return withHist(s, {
        concretes: s.concretes.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      });
    }
    const r1 = (v) => Math.round(v * 10) / 10;
    return withHist(s, {
      concretes: s.concretes.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      bars: s.bars.map((b) => (b.host === id ? {
        ...b,
        Pos_x: r1((Number(b.Pos_x) || 0) + dx),
        Pos_y: r1((Number(b.Pos_y) || 0) + dy),
        Pos_z: r1((Number(b.Pos_z) || 0) + dz),
      } : b)),
      refLines: (s.refLines || []).map((l) => (l.host === id ? {
        ...l,
        p1: l.p1 ? [r1(l.p1[0] + dx), r1(l.p1[1] + dy), r1(l.p1[2] + dz)] : l.p1,
        p2: l.p2 ? [r1(l.p2[0] + dx), r1(l.p2[1] + dy), r1(l.p2[2] + dz)] : l.p2,
      } : l)),
    });
  }),
  removeConcrete: (id) => set((s) => withHist(s, {
    concretes: s.concretes.filter((c) => c.id !== id),
    // bars hosted on the removed member become unhosted (stay visible)
    bars: s.bars.map((b) => (b.host === id ? { ...b, host: null } : b)),
    // reference lines parented to the removed concrete element are removed
    refLines: (s.refLines || []).filter((l) => l.host !== id),
    selectedConcrete: s.selectedConcrete === id ? (s.concretes.find((c) => c.id !== id)?.id || null) : s.selectedConcrete,
  })),

  // Reference lines parented to concrete elements (for dimension checks, rebar alignment & snapping)
  addRefLine: (line) => set((s) => withHist(s, {
    refLines: [
      ...(s.refLines || []),
      {
        id: `ref_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        visible: true,
        color: '#f59e0b',
        name: `Ref Line ${(s.refLines || []).length + 1}`,
        ...line,
      },
    ],
  })),
  updateRefLine: (id, patch) => set((s) => withHist(s, {
    refLines: (s.refLines || []).map((l) => (l.id === id ? { ...l, ...patch } : l)),
  })),
  removeRefLine: (id) => set((s) => withHist(s, {
    refLines: (s.refLines || []).filter((l) => l.id !== id),
    selectedRefLine: s.selectedRefLine === id ? null : s.selectedRefLine,
  })),

  addBar: (type, targetHostId = null) => {
    tagSeq = Math.max(tagSeq + 1, get().bars.length + 1);
    const s = get();
    const concs = s.concretes || [];
    const activeBar = s.bars[s.selectedBar];
    const hostId = targetHostId || s.selectedConcrete || (activeBar ? (resolveBarHost(activeBar, concs) || activeBar?.host) : null) || (concs.length > 0 ? concs[0].id : null);
    const hostObj = concs.find((c) => c.id === hostId) || concs[0] || null;
    const bar = defaultBarForHost(type, tagSeq, hostObj, s.cover);
    set((state) => withHist(state, {
      bars: [...state.bars, bar],
      selectedBar: state.bars.length,
      selectedConcrete: hostObj ? hostObj.id : state.selectedConcrete,
    }));
  },
  appendBars: (newBars) => set((s) => withHist(s, {
    bars: [...s.bars, ...newBars],
    selectedBar: s.bars.length,
  })),
  updateBar: (idx, patch) => set((s) => withHist(s, {
    bars: s.bars.map((b, i) => (i === idx ? { ...b, ...patch } : b)),
  })),
  // Full replace (used for shape-type switch so stale dims are dropped)
  replaceBar: (idx, bar) => set((s) => withHist(s, {
    bars: s.bars.map((b, i) => (i === idx ? bar : b)),
  })),
  duplicateBar: (idx) => {
    const s = get();
    const targetIdx = idx != null ? idx : s.selectedBar;
    const bar = s.bars[targetIdx];
    if (!bar) return;
    const maxTag = s.bars.reduce((max, b) => Math.max(max, Number(b.Rebar_tag) || 0), 0);
    const newTag = maxTag + 1;
    let newMark = bar.Bar_mark || `B${newTag}`;
    const match = String(newMark).match(/^(.*?)(\d+)$/);
    if (match) {
      const prefix = match[1];
      const num = parseInt(match[2], 10) + 1;
      const padded = String(num).padStart(match[2].length, '0');
      newMark = `${prefix}${padded}`;
    } else {
      newMark = `${newMark}_copy`;
    }
    const newBar = {
      ...structuredClone(bar),
      Rebar_tag: newTag,
      Bar_mark: newMark,
    };
    const insertIdx = targetIdx + 1;
    const newBars = [...s.bars];
    newBars.splice(insertIdx, 0, newBar);
    set((state) => withHist(state, {
      bars: newBars,
      selectedBar: insertIdx,
    }));
  },
  clipboardBar: null,
  copyBar: (idx) => {
    const s = get();
    const targetIdx = idx != null ? idx : s.selectedBar;
    const bar = s.bars[targetIdx];
    if (bar) {
      set({ clipboardBar: structuredClone(bar) });
    }
  },
  pasteBar: () => {
    const s = get();
    const clip = s.clipboardBar;
    if (!clip) return;
    const maxTag = s.bars.reduce((max, b) => Math.max(max, Number(b.Rebar_tag) || 0), 0);
    const newTag = maxTag + 1;
    let newMark = clip.Bar_mark || `B${newTag}`;
    const match = String(newMark).match(/^(.*?)(\d+)$/);
    if (match) {
      const prefix = match[1];
      const num = parseInt(match[2], 10) + 1;
      const padded = String(num).padStart(match[2].length, '0');
      newMark = `${prefix}${padded}`;
    } else {
      newMark = `${newMark}_copy`;
    }
    const newBar = {
      ...structuredClone(clip),
      Rebar_tag: newTag,
      Bar_mark: newMark,
    };
    const insertIdx = s.selectedBar != null && s.selectedBar >= 0 && s.selectedBar < s.bars.length
      ? s.selectedBar + 1
      : s.bars.length;
    const newBars = [...s.bars];
    newBars.splice(insertIdx, 0, newBar);
    set((state) => withHist(state, {
      bars: newBars,
      selectedBar: insertIdx,
    }));
  },
  removeBar: (idx) => set((s) => withHist(s, {
    bars: s.bars.filter((_, i) => i !== idx),
    selectedBar: Math.max(0, s.selectedBar - 1),
  })),
  setBars: (bars) => set((s) => withHist(s, { bars, selectedBar: 0 })),
  selectBar: (idx) => set((s) => {
    const bar = s.bars[idx];
    const host = bar ? (resolveBarHost(bar, s.concretes) || bar.host) : s.selectedConcrete;
    return { selectedBar: idx, selectedConcrete: host || s.selectedConcrete };
  }),
  toggleConcrete: () => set((s) => ({ showConcrete: !s.showConcrete })),

  // Undo/redo over the model (bars, concretes, refLines, selection, cover).
  past: [],
  future: [],
  undo: () => set((s) => {
    if (!s.past.length) return {};
    const prev = s.past[s.past.length - 1];
    return {
      bars: prev.bars, concretes: prev.concretes,
      refLines: prev.refLines || [],
      selectedBar: prev.selectedBar, cover: prev.cover,
      past: s.past.slice(0, -1),
      future: [snap(s), ...s.future].slice(0, HIST_MAX),
    };
  }),
  redo: () => set((s) => {
    if (!s.future.length) return {};
    const [next, ...rest] = s.future;
    return {
      bars: next.bars, concretes: next.concretes,
      refLines: next.refLines || [],
      selectedBar: next.selectedBar, cover: next.cover,
      past: [...s.past, snap(s)].slice(-HIST_MAX),
      future: rest,
    };
  }),

  // Lap splice (longitudinal bars: straight, bent, crank, double_crank):
  // anchor bar A stays, lapping bar B moves so its main leg splices onto A's
  // main leg by one lap length, collinear (B inherits A's plan rotation and level).
  // Slices onto anchor end or start based on closest proximity. Lap length
  // calculated from EC2 table by the smaller Ø (least size bar).
  bond: 'poor',
  setBond: (v) => set({ bond: v }),
  lapArmed: false,
  lapAnchor: null,
  lastLap: null,
  setLapArmed: (v) => set({ lapArmed: v, lapAnchor: v ? get().lapAnchor : null }),
  setLapAnchor: (i) => set({ lapAnchor: i }),
  applyLapSplice: (aIdx, bIdx) => {
    const s = get();
    const A = s.bars[aIdx], B = s.bars[bIdx];
    if (!A || !B) return { ok: false, msg: 'Pick two bars first (🔗 Lap, then click anchor + lapping bar).' };
    if (aIdx === bIdx) return { ok: false, msg: 'Anchor and lapping bar must be different bars.' };

    const validTypes = new Set(['straight', 'bent', 'crank', 'double_crank']);
    if (!validTypes.has(A.Rebar_Type) || !validTypes.has(B.Rebar_Type)) {
      return { ok: false, msg: 'Lap splice works with longitudinal bars (straight, bent, crank, double_crank).' };
    }

    const diaA = Number(A.Dia) || 0, diaB = Number(B.Dia) || 0;
    const dia = (diaA > 0 && diaB > 0) ? Math.min(diaA, diaB) : (diaA || diaB);
    const L = lapLengthMm(dia, s.bond);
    if (!L) return { ok: false, msg: `No lap length for Ø${dia}.` };

    const LA = barMainLength(A);
    const LB = barMainLength(B);
    if (!(LA > 0) || !(LB > 0)) return { ok: false, msg: 'Bars must have non-zero length.' };

    const [SA, EA] = barSpliceEnds(A);
    const ux = (EA[0] - SA[0]) / LA;
    const uy = (EA[1] - SA[1]) / LA;
    const uz = (EA[2] - SA[2]) / LA;

    const curBX = Number(B.Pos_x) || 0, curBY = Number(B.Pos_y) || 0, curBZ = Number(B.Pos_z) || 0;
    const distToStart = Math.hypot(curBX - SA[0], curBY - SA[1], curBZ - SA[2]);
    const distToEnd = Math.hypot(curBX - EA[0], curBY - EA[1], curBZ - EA[2]);

    let P;
    if (distToStart < distToEnd) {
      // Lap at anchor start: Bar B ends L mm after SA, extending backward
      P = [
        SA[0] + ux * L - ux * LB,
        SA[1] + uy * L - uy * LB,
        SA[2] + uz * L - uz * LB,
      ];
    } else {
      // Lap at anchor end: Bar B starts L mm before EA, extending forward
      P = [
        EA[0] - ux * L,
        EA[1] - uy * L,
        EA[2] - uz * L,
      ];
    }

    set((s2) => withHist(s2, {
      bars: s2.bars.map((b, i) => (i === bIdx ? {
        ...b,
        Pos_x: Math.round(P[0] * 10) / 10,
        Pos_y: Math.round(P[1] * 10) / 10,
        Pos_z: Math.round(P[2] * 10) / 10,
        Pos_Rotation: A.Pos_Rotation,
        Plane: A.Plane,
        plan_rotation: A.plan_rotation,
      } : b)),
      selectedBar: bIdx,
    }));
    set({ lastLap: { a: A.Bar_mark, b: B.Bar_mark, len: L, bond: s.bond, dia, at: Date.now() } });
    console.info(`[lap] ${B.Bar_mark} → ${A.Bar_mark}: ${L} mm (${s.bond} bond, Ø${dia})`);
    return { ok: true, len: L };
  },
  // Measure tool (ephemeral view aid — never saved, never in BBS/CSV).
  // points: app-mm [x, y, z] surface picks.
  // barPointIdx: which point rides on the controlled rebar (the other is the
  // fixed ref). measureBarIdx: auto-detected bar under that point (null = none).
  measure: { active: false, points: [], barPointIdx: 1, measureBarIdx: null },
  setMeasureActive: (v) => set((s) => ({
    measure: v
      ? { active: true, points: s.measure.points, barPointIdx: s.measure.barPointIdx ?? 1, measureBarIdx: s.measure.measureBarIdx ?? null }
      : { active: false, points: [], barPointIdx: 1, measureBarIdx: null },
  })),
  // Rebar snap magnet (pick + measure). UI pref: never saved, never in history.
  snapEnabled: true,
  setSnapEnabled: (v) => set({ snapEnabled: v }),
  // Osnap-style snap options (ViewportBar ▾ menu). All on by default so the
  // magnet behaves as before; toggling narrows what it grabs. Session-only
  // UI prefs: never saved, never in history.
  //   end: bar vertices, concrete corners, ref-line endpoints
  //   mid: bar-leg / concrete-edge midpoints
  //   center: concrete face centers
  //   nearest: anywhere along an edge/leg/line (cursor-nearest point)
  //   perp: foot of perpendicular from the last measure point onto an edge
  snapOpts: { end: true, mid: true, center: true, nearest: true, perp: true },
  setSnapOpt: (k, v) => set((s) => ({ snapOpts: { ...s.snapOpts, [k]: v } })),
  pushMeasurePoint: (p) => set((s) => {
    if (!s.measure.active) return {};
    const pts = [...s.measure.points, p].slice(-64);
    // Auto-detect: if the new point lands on a visible bar's centerline
    // (snapped node or tube surface), that point becomes the bar-side point
    // and its bar becomes the controlled one — so Set moves the bar you
    // actually clicked, not just the selected one.
    let barPointIdx = s.measure.barPointIdx ?? 1;
    let measureBarIdx = s.measure.measureBarIdx ?? null;
    const newIdx = pts.length - 1;
    if (newIdx < 2) {
      const hit = nearestVisibleBar(p, s.bars, s.concretes);
      if (hit != null) {
        barPointIdx = newIdx;
        measureBarIdx = hit;
      }
    }
    return { measure: { active: true, points: pts, barPointIdx, measureBarIdx } };
  }),
  popMeasurePoint: () => set((s) => {
    const pts = s.measure.points.slice(0, -1);
    return {
      measure: {
        active: s.measure.active,
        points: pts,
        barPointIdx: pts.length ? Math.min(s.measure.barPointIdx ?? 1, pts.length - 1) : 1,
        measureBarIdx: pts.length ? s.measure.measureBarIdx ?? null : null,
      },
    };
  }),
  clearMeasure: () => set((s) => ({ measure: { active: s.measure.active, points: [], barPointIdx: 1, measureBarIdx: null } })),
  // Manual override: which point follows the controlled bar (0 or 1).
  setMeasureBarPoint: (idx) => set((s) => ({
    measure: { ...s.measure, barPointIdx: idx === 0 ? 0 : 1 },
  })),
  updateMeasurePoint: (idx, pt) => set((s) => ({
    measure: {
      ...s.measure,
      points: s.measure.points.map((p, i) => i === idx ? pt : p),
    },
  })),
  adjustBarFromMeasure: (barIdx, shiftX = 0, shiftY = 0, shiftZ = 0, targetBarPoint = null, barPointIdx = 1) => {
    const s = get();
    const bar = s.bars[barIdx];
    if (!bar) return;
    const newX = Math.round(((Number(bar.Pos_x) || 0) + shiftX) * 10) / 10;
    const newY = Math.round(((Number(bar.Pos_y) || 0) + shiftY) * 10) / 10;
    const newZ = Math.round(((Number(bar.Pos_z) || 0) + shiftZ) * 10) / 10;
    set((s2) => withHist(s2, {
      bars: s2.bars.map((b, i) => i === barIdx ? { ...b, Pos_x: newX, Pos_y: newY, Pos_z: newZ } : b),
      measure: (targetBarPoint && s2.measure.points.length >= 2) ? {
        ...s2.measure,
        points: s2.measure.points.map((p, i) => i === barPointIdx ? targetBarPoint : p),
      } : s2.measure,
    }));
  },
  // Browser save + portable .json project file (bars + concrete + cover + bond).
  // IFC files are view-only and must be reloaded by hand; section box is
  // session state. Browser save auto-loads on boot; the file transfers
  // the same payload to another system.
  saveStamp: null,
  _projectData: () => {
    const s = get();
    return {
      v: 1, app: 'barbending', savedAt: Date.now(),
      bars: s.bars, concretes: s.concretes,
      refLines: s.refLines || [],
      cover: s.cover, bond: s.bond, selectedBar: s.selectedBar,
    };
  },
  _applyProject: (d) => {
    if (!d || d.v !== 1 || !Array.isArray(d.bars) || !Array.isArray(d.concretes)) return false;
      set({
        bars: d.bars, concretes: d.concretes,
        refLines: Array.isArray(d.refLines) ? d.refLines : [],
        cover: typeof d.cover === 'number' ? d.cover : 40,
        bond: d.bond === 'good' || d.bond === 'poor' ? d.bond : 'poor',
      selectedBar: Math.min(Number(d.selectedBar) || 0, Math.max(0, d.bars.length - 1)),
      saveStamp: d.savedAt || null,
      past: [], future: [],
    });
    return true;
  },
  saveProject: () => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(get()._projectData()));
      set({ saveStamp: Date.now() });
      return true;
    } catch {
      return false;
    }
  },
  loadProject: () => {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const ok = get()._applyProject(JSON.parse(raw));
      if (ok) console.info('[save] restored browser project');
      return ok;
    } catch {
      return false;
    }
  },
  // Portable transfer (FileBar builds the Blob / reads the file around these).
  exportProject: () => JSON.stringify(get()._projectData(), null, 2),
  importProject: (d) => get()._applyProject(d),

  // IFC reference model (three.js objects live in ifc/session.js; metadata here)
  ifc: null,
  ifcRev: 0,
  ifcFit: null,
  ifcPick: false,
  ifcActive: false,
  setIfc: (meta) => set((s) => ({
    ifc: meta,
    ifcActive: true,
    ifcSelected: null,
    ifcXform: { pos: [0, 0, 0], rot: [0, 0, 0] },
    ifcRev: s.ifcRev + 1,
    ifcFit: fitOf(meta),
  })),
  clearIfc: () => set((s) => ({ ifc: null, ifcRev: s.ifcRev + 1, ifcFit: null, ifcPick: false, ifcSelected: null, ifcXform: null })),
  toggleIfcType: (key) => set((s) => ({
    ifc: s.ifc && { ...s.ifc, types: s.ifc.types.map((t) => (t.key === key ? { ...t, visible: !t.visible } : t)) },
    ifcRev: s.ifcRev + 1,
  })),
  // element-level (right IFC panel)
  toggleIfcElement: (key) => set((s) => ({
    ifc: s.ifc && { ...s.ifc, elements: s.ifc.elements.map((e) => (e.key === key ? { ...e, visible: !e.visible } : e)) },
    ifcRev: s.ifcRev + 1,
  })),
  setIfcElements: (fn) => set((s) => ({
    ifc: s.ifc && { ...s.ifc, elements: s.ifc.elements.map(fn) },
    ifcRev: s.ifcRev + 1,
  })),
  setIfcOpacity: (v) => set((s) => ({
    ifc: s.ifc && { ...s.ifc, opacity: v },
    ifcRev: s.ifcRev + 1,
  })),
  setIfcUnit: (toMeters, label) => set((s) => ({
    ifc: s.ifc && { ...s.ifc, unitToMeters: toMeters, unitLabel: label },
    ifcRev: s.ifcRev + 1,
  })),
  refitIfc: () => set((s) => ({ ifcFit: fitOf(s.ifc) })),
  setIfcPick: (v) => set({ ifcPick: v }),
  // last click-to-place result (diagnostics + UI feedback)
  lastPick: null,
  setLastPick: (v) => set({ lastPick: v }),
  // Snap-to-cover: pick-to-place pushes the bar origin inside the clicked
  // face by cover + Dia/2 along the inward face normal (mm).
  cover: 40,
  setCover: (v) => set({ cover: v }),
  // section box (Revit-style): center/size/quat in scene units (metres).
  // mode: 'faces' (push/pull) | 'translate' (move gizmo) | 'rotate' (rotate gizmo)
  section: null,
  toggleSection: () => set((s) => {
    if (!s.section) {
      const b = defaultSectionBox(s.ifc);
      console.info('[section] on:', JSON.stringify(b.center.map((v) => +v.toFixed(2))), JSON.stringify(b.size.map((v) => +v.toFixed(2))));
      return { section: { enabled: true, mode: 'faces', solidCut: true, showBox: true, center: b.center, size: b.size, quat: [0, 0, 0, 1] } };
    }
    // migrate pre-rotation {min, max} state on the spot
    const norm = normalizeSection(s.section);
    console.info('[section] toggled:', !norm.enabled);
    return { section: { ...norm, enabled: !norm.enabled } };
  }),
  setSection: (patch) => set((s) => ({
    section: s.section ? { ...s.section, ...patch } : s.section,
  })),
  fitSectionToIfc: () => set((s) => {
    if (!s.ifc) return {};
    const b = defaultSectionBox(s.ifc);
    return { section: { enabled: true, mode: s.section?.mode ?? 'faces', solidCut: s.section?.solidCut ?? true, showBox: s.section?.showBox ?? true, center: b.center, size: b.size, quat: [0, 0, 0, 1] } };
  }),
  // Shrink to middle third (no dragging needed) — proves the cut works, restores via Fit box
  thirdSection: () => set((s) => {
    if (!s.section?.center || !s.section?.size) return {};
    return { section: { ...s.section, enabled: true, size: s.section.size.map((v) => Math.max(0.05, v / 3)) } };
  }),
  // IFC placement: model-frame offset (mm) + rotation (deg, XYZ order, Y up).
  // Applied on top of the loaded model; Reset restores file placement.
  ifcXform: null,
  setIfcXform: (patch) => set((s) => ({
    ifcXform: { ...(s.ifcXform || { pos: [0, 0, 0], rot: [0, 0, 0] }), ...patch },
  })),
  resetIfcXform: () => set({ ifcXform: { pos: [0, 0, 0], rot: [0, 0, 0] } }),
  // Viewport (Blender-style): shading mode + live perf stats (2 Hz).
  shading: 'solid',
  setShading: (v) => set({ shading: v }),
  // Concrete rendering options: 'ghost' | 'solid' | 'blueprint' | 'textured'
  concreteStyle: 'ghost',
  setConcreteStyle: (v) => set({ concreteStyle: v }),
  concreteOpacity: 0.25,
  setConcreteOpacity: (v) => set({ concreteOpacity: v }),
  concreteColor: '#94a3b8',
  setConcreteColor: (v) => set({ concreteColor: v }),
  concreteEdges: true,
  setConcreteEdges: (v) => set({ concreteEdges: v }),
  // navMode: 'select' (LMB picks, MMB orbits) or 'orbit' (LMB orbits too).
  navMode: 'select',
  setNavMode: (v) => set({ navMode: v }),
  // Preset view request (Blender-style Top/Bottom/Left/Right/Front/Back/Iso).
  // Scene consumes {dir, n} and keeps the current orbit target (focus stays).
  viewReq: null,
  requestView: (dir) => set({ viewReq: { dir, n: Date.now() } }),
  // Fit / Zoom to Selected (bar / concrete / all) view request
  fitReq: null,
  requestFit: (target = 'auto', idOrIdx = null) => set({ fitReq: { target, idOrIdx, n: Date.now() } }),
  perf: { fps: 0, dist: 0 },
  setPerf: (fps, dist) => set((s) => {
    if (Math.abs(s.perf.fps - fps) < 1 && Math.abs(s.perf.dist - dist) / Math.max(dist, 1e-6) < 0.05) return {};
    return { perf: { fps, dist } };
  }),
  leftOpen: true,
  setLeftOpen: (v) => set({ leftOpen: v }),
  // element selection (Blender-style query/edit)
  ifcSelected: null,
  setIfcSelected: (key) => set({ ifcSelected: key }),
  renameIfcElement: (key, name) => set((s) => ({
    ifc: s.ifc && { ...s.ifc, elements: s.ifc.elements.map((e) => (e.key === key ? { ...e, name } : e)) },
    ifcRev: s.ifcRev + 1,
  })),
  moveIfcElement: (key, storey) => set((s) => ({
    ifc: s.ifc && { ...s.ifc, elements: s.ifc.elements.map((e) => (e.key === key ? { ...e, storey } : e)) },
    ifcRev: s.ifcRev + 1,
  })),
  // camera focus on an explicit scene-unit box (zoom-to-element)
  setIfcFitBox: (center, radius) => set({ ifcFit: { center, radius, n: Date.now() } }),
  // Concrete tracing and drawing tool ('beam' | 'column' | 'slab' | 'box' | 'trace_ifc' | null)
  drawMode: null,
  setDrawMode: (mode) => set({ drawMode: mode, drawStart: null }),
  drawStart: null,
  setDrawStart: (pt) => set({ drawStart: pt }),
  snapNode: null,
  setSnapNode: (node) => set({ snapNode: node }),
}));
