import { create } from 'zustand';
import { defaultBar, genBarPoints } from './bbs/shapes.js';
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
    { ...defaultBar('straight', 1), Bar_mark: 'SETC_149', 'Length of Bar': 3000 },
  ],
  selectedBar: 0,
  showConcrete: true,

  addConcrete: (c) => set((s) => withHist(s, { concretes: [...s.concretes, { id: `c${Date.now()}`, ...c }] })),
  updateConcrete: (id, patch) => set((s) => withHist(s, {
    concretes: s.concretes.map((c) => (c.id === id ? { ...c, ...patch } : c)),
  })),
  removeConcrete: (id) => set((s) => withHist(s, {
    concretes: s.concretes.filter((c) => c.id !== id),
    // bars hosted on the removed member become unhosted (stay visible)
    bars: s.bars.map((b) => (b.host === id ? { ...b, host: null } : b)),
  })),

  addBar: (type) => {
    tagSeq = Math.max(tagSeq + 1, get().bars.length + 1);
    set((s) => withHist(s, { bars: [...s.bars, defaultBar(type, tagSeq)], selectedBar: s.bars.length }));
  },
  updateBar: (idx, patch) => set((s) => withHist(s, {
    bars: s.bars.map((b, i) => (i === idx ? { ...b, ...patch } : b)),
  })),
  // Full replace (used for shape-type switch so stale dims are dropped)
  replaceBar: (idx, bar) => set((s) => withHist(s, {
    bars: s.bars.map((b, i) => (i === idx ? bar : b)),
  })),
  removeBar: (idx) => set((s) => withHist(s, {
    bars: s.bars.filter((_, i) => i !== idx),
    selectedBar: Math.max(0, s.selectedBar - 1),
  })),
  setBars: (bars) => set((s) => withHist(s, { bars, selectedBar: 0 })),
  selectBar: (idx) => set({ selectedBar: idx }),
  toggleConcrete: () => set((s) => ({ showConcrete: !s.showConcrete })),

  // Undo/redo over the model (bars, concretes, selection, cover).
  past: [],
  future: [],
  undo: () => set((s) => {
    if (!s.past.length) return {};
    const prev = s.past[s.past.length - 1];
    return {
      bars: prev.bars, concretes: prev.concretes,
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
      selectedBar: next.selectedBar, cover: next.cover,
      past: [...s.past, snap(s)].slice(-HIST_MAX),
      future: rest,
    };
  }),

  // Lap splice (straight bars): anchor bar A stays, lapping bar B moves so
  // its start sits one lap length before A's end along A's axis, collinear
  // (B inherits A's plan rotation). Lap length from the EC2 table by the
  // smaller Ø (least size bar). Single history unit. Identical distribution grids stay
  // consistent lap-for-lap.
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
    if (A.Rebar_Type !== 'straight' || B.Rebar_Type !== 'straight') {
      return { ok: false, msg: 'Lap splice needs straight bars on both sides.' };
    }
    const diaA = Number(A.Dia) || 0, diaB = Number(B.Dia) || 0;
    const dia = (diaA > 0 && diaB > 0) ? Math.min(diaA, diaB) : (diaA || diaB);
    const L = lapLengthMm(dia, s.bond);
    if (!L) return { ok: false, msg: `No lap length for Ø${dia}.` };
    const g = genBarPoints(A);
    const t = (Number(A.Pos_Rotation) || 0) * Math.PI / 180;
    const c = Math.cos(t), w = Math.sin(t);
    const loc = ([x, y, z]) => [
      (Number(A.Pos_x) || 0) + x * c - y * w,
      (Number(A.Pos_y) || 0) + x * w + y * c,
      (Number(A.Pos_z) || 0) + z,
    ];
    const S1 = loc(g.points[0]);
    const E1 = loc(g.points[g.points.length - 1]);
    const dx = E1[0] - S1[0], dy = E1[1] - S1[1], dz = E1[2] - S1[2];
    const n = Math.hypot(dx, dy, dz);
    if (!(n > 0)) return { ok: false, msg: 'Anchor bar has zero length.' };
    const P = [E1[0] - (dx / n) * L, E1[1] - (dy / n) * L, E1[2] - (dz / n) * L];
    set((s2) => withHist(s2, {
      bars: s2.bars.map((b, i) => (i === bIdx ? {
        ...b,
        Pos_x: Math.round(P[0]), Pos_y: Math.round(P[1]), Pos_z: Math.round(P[2]),
        Pos_Rotation: A.Pos_Rotation,
      } : b)),
      selectedBar: bIdx,
    }));
    set({ lastLap: { a: A.Bar_mark, b: B.Bar_mark, len: L, bond: s.bond, dia, at: Date.now() } });
    console.info(`[lap] ${B.Bar_mark} → ${A.Bar_mark}: ${L} mm (${s.bond} bond, Ø${dia})`);
    return { ok: true, len: L };
  },
  // Measure tool (ephemeral view aid — never saved, never in BBS/CSV).
  // points: app-mm [x, y, z] surface picks.
  measure: { active: false, points: [] },
  setMeasureActive: (v) => set((s) => ({
    measure: v ? { active: true, points: s.measure.points } : { active: false, points: [] },
  })),
  // Rebar snap magnet (pick + measure). UI pref: never saved, never in history.
  snapEnabled: true,
  setSnapEnabled: (v) => set({ snapEnabled: v }),
  pushMeasurePoint: (p) => set((s) => s.measure.active
    ? { measure: { active: true, points: [...s.measure.points, p].slice(-64) } }
    : {}),
  popMeasurePoint: () => set((s) => ({
    measure: { active: s.measure.active, points: s.measure.points.slice(0, -1) },
  })),
  clearMeasure: () => set((s) => ({ measure: { active: s.measure.active, points: [] } })),
  updateMeasurePoint: (idx, pt) => set((s) => ({
    measure: {
      ...s.measure,
      points: s.measure.points.map((p, i) => i === idx ? pt : p),
    },
  })),
  adjustBarFromMeasure: (barIdx, shiftX = 0, shiftY = 0, shiftZ = 0, targetP2 = null) => {
    const s = get();
    const bar = s.bars[barIdx];
    if (!bar) return;
    const newX = Math.round(((Number(bar.Pos_x) || 0) + shiftX) * 10) / 10;
    const newY = Math.round(((Number(bar.Pos_y) || 0) + shiftY) * 10) / 10;
    const newZ = Math.round(((Number(bar.Pos_z) || 0) + shiftZ) * 10) / 10;
    set((s2) => withHist(s2, {
      bars: s2.bars.map((b, i) => i === barIdx ? { ...b, Pos_x: newX, Pos_y: newY, Pos_z: newZ } : b),
      measure: (targetP2 && s2.measure.points.length >= 2) ? {
        ...s2.measure,
        points: s2.measure.points.map((p, i) => i === 1 ? targetP2 : p),
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
      cover: s.cover, bond: s.bond, selectedBar: s.selectedBar,
    };
  },
  _applyProject: (d) => {
    if (!d || d.v !== 1 || !Array.isArray(d.bars) || !Array.isArray(d.concretes)) return false;
      set({
        bars: d.bars, concretes: d.concretes,
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
  // navMode: 'select' (LMB picks, MMB orbits) or 'orbit' (LMB orbits too).
  navMode: 'select',
  setNavMode: (v) => set({ navMode: v }),
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
