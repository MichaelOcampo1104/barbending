import { create } from 'zustand';
import { defaultBar } from './bbs/shapes.js';
import { defaultSectionBox, normalizeSection } from './viewer/sectionPlanes.js';

let tagSeq = 1;

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

  addConcrete: (c) => set((s) => ({ concretes: [...s.concretes, { id: `c${Date.now()}`, ...c }] })),
  updateConcrete: (id, patch) => set((s) => ({
    concretes: s.concretes.map((c) => (c.id === id ? { ...c, ...patch } : c)),
  })),
  removeConcrete: (id) => set((s) => ({ concretes: s.concretes.filter((c) => c.id !== id) })),

  addBar: (type) => {
    tagSeq = Math.max(tagSeq + 1, get().bars.length + 1);
    set((s) => ({ bars: [...s.bars, defaultBar(type, tagSeq)], selectedBar: s.bars.length }));
  },
  updateBar: (idx, patch) => set((s) => ({
    bars: s.bars.map((b, i) => (i === idx ? { ...b, ...patch } : b)),
  })),
  // Full replace (used for shape-type switch so stale dims are dropped)
  replaceBar: (idx, bar) => set((s) => ({
    bars: s.bars.map((b, i) => (i === idx ? bar : b)),
  })),
  removeBar: (idx) => set((s) => ({
    bars: s.bars.filter((_, i) => i !== idx),
    selectedBar: Math.max(0, s.selectedBar - 1),
  })),
  setBars: (bars) => set({ bars, selectedBar: 0 }),
  selectBar: (idx) => set({ selectedBar: idx }),
  toggleConcrete: () => set((s) => ({ showConcrete: !s.showConcrete })),

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
}));
