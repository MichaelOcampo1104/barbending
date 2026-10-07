import { create } from 'zustand';
import { defaultBar, defaultBarForHost, resolveBarHost, genBarPoints, barMainLength, barSpliceEnds, distToBar, barOverlapsBoxes, buildFaceBar, buildSlopedFaceRows, applyTypeDefaults } from './bbs/shapes.js';
import { lapLengthMm, lapBondFor } from './bbs/calc.js';
import { defaultSectionBox, normalizeSection } from './viewer/sectionPlanes.js';
import { isAxisView } from './viewer/cameraMath.js';

let tagSeq = 1;

const SAVE_KEY = 'barbending.save.v1';
const DETAIL_KEY = 'barbending.barDetail';
const readBarDetail = () => {
  try {
    const v = localStorage.getItem(DETAIL_KEY);
    return v === 'lines' || v === 'tubes' ? v : 'auto';
  } catch { return 'auto'; }
};
const HIST_MAX = 50;

// Undo snapshot: the model (view-only flags ride along on their objects).
// IFC reference state, section box, and UI toggles are NOT history.
const snap = (s) => ({
  bars: structuredClone(s.bars),
  concretes: structuredClone(s.concretes),
  refLines: structuredClone(s.refLines || []),
  selectedBar: s.selectedBar,
  selectedBars: Array.isArray(s.selectedBars) ? [...s.selectedBars] : [],
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

// Pure: reposition set members along new app-mm positions. Survivors keep
// everything but Pos (tag/mark/type/dims stay); extras clone the set
// template with fresh tags; surplus rows retire. Returns { out, sel, nextTag }.
const repositionSetRows = (bars, idx, positions) => {
  let nextTag = bars.reduce((m, b) => Math.max(m, Number(b.Rebar_tag) || 0), 0);
  const template = bars[idx[0]];
  const keep = new Set(idx);
  const rebuilt = positions.map((p, i) => {
    if (i < idx.length) {
      const old = bars[idx[i]];
      return { ...old, Pos_x: p[0], Pos_y: p[1], Pos_z: p[2] };
    }
    nextTag += 1;
    const { Rebar_tag, Bar_mark, ...rest } = template;
    return { ...rest, Pos_x: p[0], Pos_y: p[1], Pos_z: p[2], Rebar_tag: nextTag, Bar_mark: `B${nextTag}` };
  });
  const out = [];
  bars.forEach((b, i) => {
    if (keep.has(i)) {
      const k = idx.indexOf(i);
      if (k < rebuilt.length) out.push(rebuilt[k]);
      // surplus rows retire (dropped)
    } else out.push(b);
  });
  // extras append in bar order after the set block
  for (let i = idx.length; i < rebuilt.length; i++) out.push(rebuilt[i]);
  const keptIdx = idx.slice(0, Math.min(idx.length, rebuilt.length));
  const extraBase = out.length - (rebuilt.length - idx.length);
  const extraIdx = rebuilt.slice(idx.length).map((_, k) => extraBase + k);
  return { out, sel: [...keptIdx, ...extraIdx], nextTag };
};

// Scale one bar's length dims to a target total (mm): single-key types set
// the key, double_crank scales its three parts proportionally.
const SET_LENGTH_KEYS = {
  straight: ['Length of Bar'], bent: ['Length of Bar'], crank: ['Long_length'],
  double_crank: ['DC_Lap_Start', 'DC_Lap_Mid', 'DC_Tail_Length'],
  c_link: ['length'], c_link_with_hook: ['length'], tie: ['length'],
};
const scaleBarLength = (bar, target) => {
  if (!(target > 0)) return null;
  const keys = SET_LENGTH_KEYS[bar?.Rebar_Type] || ['Length of Bar'];
  if (keys.length > 1) {
    const cur = keys.reduce((s, k) => s + (Number(bar[k]) || 0), 0);
    if (!(cur > 0)) return null;
    const next = { ...bar };
    for (const k of keys) next[k] = Math.round(((Number(bar[k]) || 0) * target) / cur * 10) / 10;
    return next;
  }
  return { ...bar, [keys[0]]: Math.round(target * 10) / 10 };
};

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
  // Multi-selection (rebar indices). selectedBar stays the active/edited bar
  // (last of the set) so the single-bar editor keeps working unchanged.
  selectedBars: [0],
  // Box/window select armed by Shift+B (one-shot: next LMB drag selects).
  boxSelect: false,
  setBoxSelect: (v) => set({ boxSelect: !!v }),
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
      selectedBars: [state.bars.length],
      selectedConcrete: hostObj ? hostObj.id : state.selectedConcrete,
    }));
  },
  appendBars: (newBars) => set((s) => withHist(s, {
    bars: [...s.bars, ...newBars],
    selectedBar: s.bars.length,
    selectedBars: newBars.length ? [s.bars.length] : (s.selectedBars || []),
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
      selectedBars: [insertIdx],
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
      selectedBars: [insertIdx],
    }));
  },
  removeBar: (idx) => set((s) => withHist(s, {
    bars: s.bars.filter((_, i) => i !== idx),
    selectedBar: Math.max(0, s.selectedBar - 1),
    selectedBars: (Array.isArray(s.selectedBars) ? s.selectedBars : [s.selectedBar])
      .filter((i) => i !== idx).map((i) => (i > idx ? i - 1 : i)),
  })),
  setBars: (bars) => set((s) => withHist(s, { bars, selectedBar: 0, selectedBars: bars.length ? [0] : [] })),
  selectBar: (idx) => set((s) => {
    const bar = s.bars[idx];
    const host = bar ? (resolveBarHost(bar, s.concretes) || bar.host) : s.selectedConcrete;
    return { selectedBar: idx, selectedBars: [idx], selectedConcrete: host || s.selectedConcrete };
  }),
  // Replace the whole multi-selection (box select / BBS ctrl-click).
  // Active bar = last index so the single-bar form follows the set.
  setSelectedBars: (idxs) => set((s) => {
    const clean = [...new Set((idxs || []).filter((i) => Number.isInteger(i) && i >= 0 && i < s.bars.length))].sort((a, b) => a - b);
    if (!clean.length) return { selectedBars: [] };
    const active = clean[clean.length - 1];
    const bar = s.bars[active];
    const host = bar ? (resolveBarHost(bar, s.concretes) || bar.host) : s.selectedConcrete;
    return { selectedBar: active, selectedBars: clean, selectedConcrete: host || s.selectedConcrete };
  }),
  toggleBarSelected: (idx) => set((s) => {
    const cur = new Set(Array.isArray(s.selectedBars) ? s.selectedBars : [s.selectedBar]);
    if (cur.has(idx)) cur.delete(idx);
    else if (Number.isInteger(idx) && idx >= 0 && idx < s.bars.length) cur.add(idx);
    const clean = [...cur].filter((i) => i >= 0 && i < s.bars.length).sort((a, b) => a - b);
    if (!clean.length) return { selectedBars: [] };
    const active = clean[clean.length - 1];
    const bar = s.bars[active];
    const host = bar ? (resolveBarHost(bar, s.concretes) || bar.host) : s.selectedConcrete;
    return { selectedBar: active, selectedBars: clean, selectedConcrete: host || s.selectedConcrete };
  }),
  clearBarSelection: () => set({ selectedBars: [] }),
  // Bulk ops over an explicit index list (defaults to current selection).
  removeBars: (idxs) => set((s) => {
    const set_idx = new Set(idxs ?? s.selectedBars ?? [s.selectedBar]);
    if (!set_idx.size) return {};
    const keep = s.bars.filter((_, i) => !set_idx.has(i));
    return withHist(s, {
      bars: keep,
      selectedBar: 0,
      selectedBars: keep.length ? [0] : [],
    });
  }),
  duplicateBars: (idxs) => {
    const s = get();
    const list = [...new Set(idxs ?? s.selectedBars ?? [s.selectedBar])]
      .filter((i) => Number.isInteger(i) && i >= 0 && i < s.bars.length).sort((a, b) => a - b);
    if (!list.length) return;
    let maxTag = s.bars.reduce((max, b) => Math.max(max, Number(b.Rebar_tag) || 0), 0);
    const clones = list.map((i) => {
      maxTag += 1;
      const src = s.bars[i];
      let newMark = src.Bar_mark || `B${maxTag}`;
      const m = String(newMark).match(/^(.*?)(\d+)$/);
      if (m) newMark = `${m[1]}${String(parseInt(m[2], 10) + 1).padStart(m[2].length, '0')}`;
      else newMark = `${newMark}_copy`;
      return { ...structuredClone(src), Rebar_tag: maxTag, Bar_mark: newMark };
    });
    set((s2) => withHist(s2, {
      bars: [...s2.bars, ...clones],
      selectedBar: s2.bars.length + clones.length - 1,
      selectedBars: clones.map((_, k) => s2.bars.length + k),
    }));
  },
  hideBars: (idxs, hidden = true) => set((s) => {
    const set_idx = new Set(idxs ?? s.selectedBars ?? [s.selectedBar]);
    if (!set_idx.size) return {};
    return withHist(s, {
      bars: s.bars.map((b, i) => (set_idx.has(i) ? { ...b, hidden: hidden ? true : undefined } : b)),
    });
  }),
  moveBars: (idxs, dx = 0, dy = 0, dz = 0) => set((s) => {
    const set_idx = new Set(idxs ?? s.selectedBars ?? [s.selectedBar]);
    if (!set_idx.size || (!dx && !dy && !dz)) return {};
    const r1 = (v) => Math.round(v * 10) / 10;
    return withHist(s, {
      bars: s.bars.map((b, i) => (set_idx.has(i) ? {
        ...b,
        Pos_x: r1((Number(b.Pos_x) || 0) + dx),
        Pos_y: r1((Number(b.Pos_y) || 0) + dy),
        Pos_z: r1((Number(b.Pos_z) || 0) + dz),
      } : b)),
    });
  }),
  // Pick-to-place relocation: the active bar lands exactly on pos, every
  // other selected bar rides along by the same delta (formation move, e.g.
  // whole bar sets relocate together). Single selection = plain update.
  placeSelectionAt: (pos) => {
    const s = get();
    const active = s.bars[s.selectedBar];
    if (!active || !pos) return;
    const dx = (Number(pos.Pos_x) || 0) - (Number(active.Pos_x) || 0);
    const dy = (Number(pos.Pos_y) || 0) - (Number(active.Pos_y) || 0);
    const dz = (Number(pos.Pos_z) || 0) - (Number(active.Pos_z) || 0);
    const idx = (s.selectedBars || []).filter((i) => i >= 0 && i < s.bars.length);
    if (idx.length > 1 && idx.includes(s.selectedBar)) {
      get().moveBars(idx, dx, dy, dz);
    } else {
      s.updateBar(s.selectedBar, pos);
    }
  },
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
      selectedBar: prev.selectedBar, selectedBars: prev.selectedBars || [prev.selectedBar], cover: prev.cover,
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
      selectedBar: next.selectedBar, selectedBars: next.selectedBars || [next.selectedBar], cover: next.cover,
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
    // Per-bar bond wins (poor wins a mixed pair); the global bond is only
    // the fallback for bars with no explicit/inferrable value.
    const bondEff = lapBondFor(A, B, s.bond);
    const L = lapLengthMm(dia, bondEff);
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
      selectedBars: [bIdx],
    }));
    set({ lastLap: { a: A.Bar_mark, b: B.Bar_mark, len: L, bond: bondEff, dia, at: Date.now() } });
    console.info(`[lap] ${B.Bar_mark} → ${A.Bar_mark}: ${L} mm (${bondEff} bond, Ø${dia})`);
    return { ok: true, len: L };
  },
  // Query tool (ephemeral inspect aid — never saved, never in BBS/CSV).
  // Armed via ⓘ Query; click any rebar / concrete / IFC object to read its
  // coordinates into a floating panel. result: {kind, title, sub, point,
  // rows:[[label, value]...]} built by QueryHandler in Scene.jsx.
  query: { active: false, result: null },
  setQueryActive: (v) => set((s) => ({
    query: v
      ? { active: true, result: s.query?.result ?? null }
      : { active: false, result: null },
  })),
  setQueryResult: (r) => set((s) => ({
    query: { active: s.query?.active ?? false, result: r },
  })),
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
      selectedBars: Array.isArray(s.selectedBars) ? s.selectedBars : [s.selectedBar],
    };
  },
  _applyProject: (d) => {
    if (!d || d.v !== 1 || !Array.isArray(d.bars) || !Array.isArray(d.concretes)) return false;
      const sel = Math.min(Number(d.selectedBar) || 0, Math.max(0, d.bars.length - 1));
      const multi = Array.isArray(d.selectedBars)
        ? [...new Set(d.selectedBars.filter((i) => Number.isInteger(i) && i >= 0 && i < d.bars.length))].sort((a, b) => a - b)
        : [sel];
      set({
        bars: d.bars, concretes: d.concretes,
        refLines: Array.isArray(d.refLines) ? d.refLines : [],
        cover: typeof d.cover === 'number' ? d.cover : 40,
        bond: d.bond === 'good' || d.bond === 'poor' ? d.bond : 'poor',
      selectedBar: sel,
      selectedBars: multi.length ? multi : (d.bars.length ? [sel] : []),
      boxSelect: false,
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
  // Coordination merge: append another project file's bars + concretes into
  // the live model (Open-plus-Insert). Concrete ids are remapped on clash
  // (both sample files use c1) and incoming Rebar_tags renumbered past the
  // max; hosted bars/refLines follow their remapped member. Globals (cover,
  // bond) and selection stay as-is. Returns {bars, concretes} or false.
  appendProject: (d) => {
    if (!d || d.v !== 1 || !Array.isArray(d.bars) || !Array.isArray(d.concretes)) return false;
    const s = get();
    const used = new Set((s.concretes || []).map((c) => c.id));
    const idMap = {};
    const freshConcretes = (d.concretes || []).map((c) => {
      let nid = (c && c.id) || `c${Date.now()}`;
      if (used.has(nid)) {
        let k = 2;
        while (used.has(`${nid}_${k}`)) k += 1;
        nid = `${nid}_${k}`;
      }
      used.add(nid);
      if (c && c.id) idMap[c.id] = nid;
      return { ...c, id: nid };
    });
    let maxTag = s.bars.reduce((m, b) => Math.max(m, Number(b.Rebar_tag) || 0), 0);
    const freshBars = (d.bars || []).map((b) => {
      maxTag += 1;
      const host = b.host && idMap[b.host] ? idMap[b.host] : b.host;
      return { ...structuredClone(b), Rebar_tag: maxTag, host };
    });
    const freshRefs = (d.refLines || []).map((l) => ({
      ...structuredClone(l),
      id: `ref_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      host: l.host && idMap[l.host] ? idMap[l.host] : l.host,
    }));
    const at = s.bars.length;
    set((s2) => withHist(s2, {
      bars: [...s2.bars, ...freshBars],
      concretes: [...s2.concretes, ...freshConcretes],
      refLines: [...(s2.refLines || []), ...freshRefs],
      selectedBar: freshBars.length ? at : s2.selectedBar,
      selectedBars: freshBars.length ? [at] : s2.selectedBars,
    }));
    return { bars: freshBars.length, concretes: freshConcretes.length };
  },

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
  // Bar detail for the BarField renderer: 'auto' (lines far, tubes near) | 'lines' | 'tubes'.
  // Persisted like the layout preferences.
  barDetail: readBarDetail(),
  setBarDetail: (v) => {
    const next = v === 'lines' || v === 'tubes' ? v : 'auto';
    try { localStorage.setItem(DETAIL_KEY, next); } catch { /* storage unavailable */ }
    set({ barDetail: next });
  },
  concreteOpacity: 0.25,
  setConcreteOpacity: (v) => set({ concreteOpacity: v }),
  concreteColor: '#94a3b8',
  setConcreteColor: (v) => set({ concreteColor: v }),
  concreteEdges: true,
  setConcreteEdges: (v) => set({ concreteEdges: v }),
  // navMode: 'select' (LMB picks, MMB orbits) or 'orbit' (LMB orbits too).
  navMode: 'select',
  setNavMode: (v) => set({ navMode: v }),
  // Navigation tuning (session-only view prefs: never saved, never in history).
  // Speeds are multipliers on the Blender-style defaults (1.0 = current feel).
  nav: { style: 'fluid', rotateSpeed: 1, panSpeed: 1, zoomSpeed: 1, damping: true, zoomToCursor: true },
  setNav: (patch) => set((s) => ({ nav: { ...s.nav, ...patch } })),
  resetNav: () => set({ nav: { style: 'fluid', rotateSpeed: 1, panSpeed: 1, zoomSpeed: 1, damping: true, zoomToCursor: true } }),
  // Preset view request (Blender-style Top/Bottom/Left/Right/Front/Back/Iso).
  // Scene consumes {dir, n} and keeps the current orbit target (focus stays). The six true views are
  // drawn in orthographic projection, Iso in perspective; the projection can be toggled on its own.
  viewReq: null,
  requestView: (dir) => set({ viewReq: { dir, n: Date.now() }, projection: isAxisView(dir) ? 'ortho' : 'persp' }),
  projection: 'persp', // 'persp' | 'ortho': which camera the viewport uses
  setProjection: (p) => set({ projection: p === 'ortho' ? 'ortho' : 'persp' }),
  toggleProjection: () => set((s) => ({ projection: s.projection === 'ortho' ? 'persp' : 'ortho' })),
  // Which preset the camera is looking along ('top' ... 'iso', or 'free'); kept up to date by CameraRig.
  viewName: 'iso',
  // Returning the same state object is a true no-op (an empty patch would still notify every subscriber).
  setViewName: (name) => set((s) => (s.viewName === name ? s : { viewName: name })),
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
  // Concrete tracing and drawing tool ('beam' | 'column' | 'slab' | 'box' | 'trace_ifc' | 'bar_face' | null)
  drawMode: null,
  setDrawMode: (mode) => set({ drawMode: mode, drawStart: null, faceSketch: null, faceNote: null }),
  drawStart: null,
  setDrawStart: (pt) => set({ drawStart: pt }),
  snapNode: null,
  setSnapNode: (node) => set({ snapNode: node }),
  // Face-sketch rebar (FreeCAD-workbench style): pick a concrete face, draw
  // the bar line on its cover-offset working plane; distribution auto-fills
  // the transverse in-face axis. Axis-aligned faces carry { memberId, axis,
  // sign, plane, p1 }; sloped faces add the true { normal, origin } frame
  // (app-mm) plus slopeDeg. | null.
  faceSketch: null,
  setFaceSketch: (fs) => set({ faceSketch: fs }),
  sketchDia: 16,
  setSketchDia: (v) => set({ sketchDia: v }),
  sketchSpacing: 150,
  setSketchSpacing: (v) => set({ sketchSpacing: v }),
  // Last face-sketch rejection reason (shown in the HUD; null = no warning).
  faceNote: null,
  setFaceNote: (v) => set({ faceNote: v || null }),
  // Commit face-sketched straight bars (specs from buildFaceBar /
  // buildSlopedFaceRows): tags them sequentially, hosts them, selects them.
  // One undo step; caller stays armed for the next bar. With meta.spec
  // (JSON sketch inputs) and >1 row, rows share a minted setId so spacing
  // re-spreads and Dia/type edit all members later.
  addFaceBar: (spec) => get().addFaceBars(spec ? [spec] : []),
  addFaceBars: (specs, meta) => {
    const list = (Array.isArray(specs) ? specs : [specs]).filter(Boolean);
    if (!list.length) return [];
    const s0 = get();
    tagSeq = Math.max(tagSeq + 1, s0.bars.length + 1);
    let setId = null;
    if (meta?.spec && list.length > 1) {
      let mx = 0;
      for (const b of s0.bars || []) {
        const m = /^S(\d+)$/.exec(String(b.setId || ''));
        if (m) mx = Math.max(mx, Number(m[1]));
      }
      setId = `S${mx + 1}`;
    }
    const bars = list.map((spec) => {
      const bar = {
        ...spec,
        Rebar_tag: tagSeq,
        Bar_mark: spec.Bar_mark || `B${tagSeq}`,
        qty: 1,
        Visible: 1,
      };
      if (setId) { bar.setId = setId; bar.setSpec = meta.spec; }
      tagSeq += 1;
      return bar;
    });
    const first = s0.bars.length;
    set((state) => withHist(state, {
      bars: [...state.bars, ...bars],
      selectedBar: state.bars.length + bars.length - 1,
      selectedBars: bars.map((_, i) => first + i),
      selectedConcrete: bars[0].host || state.selectedConcrete,
    }));
    return bars.map((_, i) => first + i);
  },
  // All live indices carrying a setId, in bar order.
  setIndices: (setId) => {
    if (!setId) return [];
    const out = [];
    (get().bars || []).forEach((b, i) => { if (b.setId === setId) out.push(i); });
    return out;
  },
  // Parse a row's sketch spec (stored JSON string) or null.
  setSpecOf: (bar) => {
    const s = bar?.setSpec;
    if (!s) return null;
    if (typeof s === 'object') return s;
    try {
      const o = JSON.parse(String(s));
      return o && typeof o === 'object' ? o : null;
    } catch { return null; }
  },
  // Dia across the whole set (lengths/weights derive; no rebuild).
  updateSetDia: (setId, dia) => {
    const d = Number(dia);
    if (!setId || !(d > 0)) return;
    const idx = get().setIndices(setId);
    if (!idx.length) return;
    const inSet = new Set(idx);
    set((state) => withHist(state, {
      bars: state.bars.map((b, i) => (inSet.has(i) ? { ...b, Dia: d } : b)),
    }));
  },
  // Dimension fields across the whole set (legs, hooks, H, crank steps… —
  // same fields the single-bar editor shows for the set's type). One undo.
  updateSetDims: (setId, patch) => {
    if (!setId || !patch || typeof patch !== 'object') return;
    const keys = Object.keys(patch);
    if (!keys.length) return;
    const idx = get().setIndices(setId);
    if (!idx.length) return;
    const inSet = new Set(idx);
    set((state) => withHist(state, {
      bars: state.bars.map((b, i) => (inSet.has(i) ? { ...b, ...patch } : b)),
    }));
  },
  // Orientation across the whole set (links need this — bent bars also
  // have up/down): absolute Plane / in-plane rotation / plan rotation.
  // One undo step; invalid values ignored.
  updateSetOrientation: (setId, patch) => {
    if (!setId || !patch || typeof patch !== 'object') return;
    const clean = {};
    if (patch.Plane !== undefined) {
      const p = String(patch.Plane || '').toUpperCase();
      if (!['XY', 'XZ', 'YZ'].includes(p)) return;
      clean.Plane = p;
    }
    for (const k of ['Pos_Rotation', 'plan_rotation']) {
      if (patch[k] !== undefined && patch[k] !== '' && Number.isFinite(Number(patch[k]))) {
        clean[k] = Number(patch[k]);
      }
    }
    if (!Object.keys(clean).length) return;
    const idx = get().setIndices(setId);
    if (!idx.length) return;
    const inSet = new Set(idx);
    set((state) => withHist(state, {
      bars: state.bars.map((b, i) => (inSet.has(i) ? { ...b, ...clean } : b)),
    }));
  },
  // Rotate every member in place by deg (added to its own Pos_Rotation,
  // so mixed orientations keep their differences). One undo step.
  rotateSet: (setId, deg) => {
    const d = Number(deg);
    if (!setId || !Number.isFinite(d) || d === 0) return;
    const idx = get().setIndices(setId);
    if (!idx.length) return;
    const inSet = new Set(idx);
    const r1 = (v) => Math.round(v * 10) / 10;
    set((state) => withHist(state, {
      bars: state.bars.map((b, i) => (inSet.has(i)
        ? { ...b, Pos_Rotation: r1((Number(b.Pos_Rotation) || 0) + d) }
        : b)),
    }));
  },
  // Re-spread a set at a new spacing: rebuild from the sketch spec, keep
  // each surviving row's tag/mark/type/dims (only positions move); extra
  // rows mint fresh tags, surplus rows retire. One undo step.
  respreadSet: (setId, spacing) => {
    const sp = Number(spacing);
    if (!setId || !(sp > 0)) return { ok: false, msg: 'Spacing must be > 0.' };
    const s = get();
    const idx = s.setIndices(setId);
    if (!idx.length) return { ok: false, msg: 'Set is empty.' };
    const first = s.bars[idx[0]];
    const spec = s.setSpecOf(first);
    if (!spec) return { ok: false, msg: 'No sketch spec on this set.' };
    const member = (s.concretes || []).find((c) => c.id === first.host);
    if (!member) return { ok: false, msg: 'Set host member is gone.' };
    const dia = Number(first.Dia) || 16;
    const dims = {
      member, p1: spec.p1, p2: spec.p2, dia,
      spacing: sp, cover: spec.cover ?? s.cover,
    };
    const fresh = spec.tilted
      ? buildSlopedFaceRows({ ...dims, normal: spec.normal })
      : [buildFaceBar({ ...dims, axis: spec.axis, planeCoord: spec.planeCoord })].filter(Boolean);
    if (!fresh.length) return { ok: false, msg: 'Rebuild came back empty.' };
    const built = repositionSetRows(s.bars, idx, fresh.map((r) => [r.Pos_x, r.Pos_y, r.Pos_z]));
    tagSeq = Math.max(tagSeq, built.nextTag);
    set((state) => withHist(state, {
      bars: built.out,
      selectedBar: built.sel.length ? built.sel[built.sel.length - 1] : state.selectedBar,
      selectedBars: built.sel.length ? built.sel : state.selectedBars,
    }));
    return { ok: true, count: built.sel.length };
  },
  // Re-spread a set to an exact bar count, with optional spacing:
  //   count + spacing → N bars at S anchored at the first bar (explicit
  //     extent = (N-1)*S along the current first-to-last direction);
  //   count only → even split over the current first-to-last extent.
  // Tags/marks kept, extras minted. One undo step.
  respreadSetCount: (setId, count, spacing) => {
    const n = Math.floor(Number(count));
    if (!setId || !(n >= 1)) return { ok: false, msg: 'Count must be ≥ 1.' };
    if (n > 5000) return { ok: false, msg: 'Count capped at 5000.' };
    const s = get();
    const idx = s.setIndices(setId);
    if (!idx.length) return { ok: false, msg: 'Set is empty.' };
    const sp = spacing === undefined ? NaN : Number(spacing);
    const a = s.bars[idx[0]], b = s.bars[idx[idx.length - 1]];
    const P0 = [Number(a.Pos_x) || 0, Number(a.Pos_y) || 0, Number(a.Pos_z) || 0];
    const P1 = [Number(b.Pos_x) || 0, Number(b.Pos_y) || 0, Number(b.Pos_z) || 0];
    const positions = [];
    if (sp > 0) {
      // anchored: step along the current set direction from the first bar
      const vx = P1[0] - P0[0], vy = P1[1] - P0[1], vz = P1[2] - P0[2];
      const L = Math.hypot(vx, vy, vz);
      const ux = L > 0 ? vx / L : 1, uy = L > 0 ? vy / L : 0, uz = L > 0 ? vz / L : 0;
      for (let i = 0; i < n; i++) {
        positions.push([
          Math.round((P0[0] + ux * sp * i) * 10) / 10,
          Math.round((P0[1] + uy * sp * i) * 10) / 10,
          Math.round((P0[2] + uz * sp * i) * 10) / 10,
        ]);
      }
    } else {
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1);
        positions.push([
          Math.round((P0[0] + (P1[0] - P0[0]) * t) * 10) / 10,
          Math.round((P0[1] + (P1[1] - P0[1]) * t) * 10) / 10,
          Math.round((P0[2] + (P1[2] - P0[2]) * t) * 10) / 10,
        ]);
      }
    }
    const built = repositionSetRows(s.bars, idx, positions);
    tagSeq = Math.max(tagSeq, built.nextTag);
    set((state) => withHist(state, {
      bars: built.out,
      selectedBar: built.sel.length ? built.sel[built.sel.length - 1] : state.selectedBar,
      selectedBars: built.sel.length ? built.sel : state.selectedBars,
    }));
    return { ok: true, count: n };
  },
  // Set lengths across the set: uniform (every member one length) or taper
  // (linear first-to-last interpolation, fan slabs). One undo step.
  setSetLengths: (setId, spec) => {
    const idx = get().setIndices(setId);
    if (!setId || !idx.length) return { ok: false };
    const n = idx.length;
    const targets = [];
    if (spec?.mode === 'taper') {
      const l0 = Number(spec.a), l1 = Number(spec.b);
      if (!Number.isFinite(l0) || !Number.isFinite(l1) || l0 <= 0 || l1 <= 0) return { ok: false };
      for (let i = 0; i < n; i++) targets.push(n === 1 ? l0 : l0 + ((l1 - l0) * i) / (n - 1));
    } else {
      const L = Number(spec?.a);
      if (!(L > 0)) return { ok: false };
      for (let i = 0; i < n; i++) targets.push(L);
    }
    const inSet = new Set(idx);
    set((state) => withHist(state, {
      bars: state.bars.map((bar, i) => {
        if (!inSet.has(i)) return bar;
        return scaleBarLength(bar, targets[idx.indexOf(i)]) || bar;
      }),
    }));
    return { ok: true };
  },
  // Switch every set member to a new shape type. Identity, position and
  // distribution are kept per member (no host refit — refitting would
  // collapse all stepped rows onto one identical stirrup); only the type's
  // dimension fields reset to defaults for per-bar editing after.
  convertSetType: (setId, type) => {
    if (!setId || !type) return;
    const s = get();
    const idx = s.setIndices(setId);
    if (!idx.length) return;
    const inSet = new Set(idx);
    set((state) => withHist(state, {
      bars: state.bars.map((b, i) => {
        if (!inSet.has(i)) return b;
        const next = applyTypeDefaults(b, type, null, state.cover);
        next.setId = b.setId;
        if (b.setSpec) next.setSpec = b.setSpec;
        return next;
      }),
    }));
  },
  selectSet: (setId) => {
    const idx = get().setIndices(setId);
    if (!idx.length) return;
    set({ selectedBars: idx, selectedBar: idx[idx.length - 1] });
  },
  // Ad-hoc parametric group: tag the given (or currently selected) bars with
  // a fresh setId so they edit together in the Set card (Dia, dims,
  // orientation, lengths, type). Unlike face-sketch sets there is no sketch
  // spec, so grid re-spread stays disabled — positions/lengths still edit
  // via the multi-select move + uniform/taper lengths. One undo step.
  groupBars: (idxs) => {
    const s = get();
    const list = [...new Set(idxs ?? s.selectedBars ?? [s.selectedBar])]
      .filter((i) => Number.isInteger(i) && i >= 0 && i < s.bars.length).sort((a, b) => a - b);
    if (list.length < 2) return { ok: false, msg: 'Select at least 2 bars to group.' };
    let mx = 0;
    for (const b of s.bars || []) {
      const m = /^S(\d+)$/.exec(String(b.setId || ''));
      if (m) mx = Math.max(mx, Number(m[1]));
    }
    const setId = `S${mx + 1}`;
    const inSet = new Set(list);
    set((state) => withHist(state, {
      bars: state.bars.map((b, i) => {
        if (!inSet.has(i)) return b;
        const next = { ...b, setId };
        delete next.setSpec;
        return next;
      }),
      selectedBars: list,
      selectedBar: list[list.length - 1],
    }));
    return { ok: true, setId };
  },
  // Remove bars from any group (ungroup a whole setId or just listed bars).
  // Members keep all dims — they simply edit solo again. One undo step.
  ungroupBars: (idxs) => {
    const s = get();
    const list = [...new Set(idxs ?? s.selectedBars ?? [s.selectedBar])]
      .filter((i) => Number.isInteger(i) && i >= 0 && i < s.bars.length);
    if (!list.length) return;
    const inSet = new Set(list);
    set((state) => withHist(state, {
      bars: state.bars.map((b, i) => {
        if (!inSet.has(i) || !b.setId) return b;
        const next = { ...b };
        delete next.setId;
        delete next.setSpec;
        return next;
      }),
    }));
  },
  ungroupSet: (setId) => {
    if (!setId) return;
    set((state) => withHist(state, {
      bars: state.bars.map((b) => {
        if (b.setId !== setId) return b;
        const next = { ...b };
        delete next.setId;
        delete next.setSpec;
        return next;
      }),
    }));
  },
}));
