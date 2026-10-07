// Pure row-state helpers (spec 5.5 and 6.4): which rows the field hides, overlays or tints, and how
// per-row data is packed into the lookup texture. No three.js and no DOM.
import { barOverlapsBoxes } from '../../bbs/shapes.js';

export const STATE = Object.freeze({ NORMAL: 0, HIDDEN: 1, OVERLAY: 2, TINT: 3 });
export const ROW_TEX_WIDTH = 2048;
export const SELECTION_OVERLAY_LIMIT = 300;
// Overlay rows are classic meshes, one per bar copy, and cost real frame time (measured on the reference
// machine at 1M bars: +2 ms at ~200 copies, +5 ms at ~430, +18 ms at ~980, +90 ms at ~2,000). Staying
// under ~400 copies keeps the frame rate above 30 fps; a heavier selection is tinted in place instead.
export const OVERLAY_COPY_BUDGET = 400;

export function rowTexDims(texelCount) {
  return { width: ROW_TEX_WIDTH, height: Math.max(1, Math.ceil(texelCount / ROW_TEX_WIDTH)) };
}

// Float RGBA texel per row id: R = state, G = colour slot, B = radius (m), A = 1.
export function createRowTexelData(texelCount) {
  const { width, height } = rowTexDims(texelCount);
  return new Float32Array(width * height * 4);
}

export function writeRowAttributes(data, id, colorIdx, radiusM) {
  data[id * 4 + 1] = colorIdx;
  data[id * 4 + 2] = radiusM;
  data[id * 4 + 3] = 1;
}

export function writeRowState(data, id, state) {
  data[id * 4] = state;
}

// The expensive part: rows hidden by the user, by a hidden host member, or lying inside a hidden member.
// Same rules as the legacy renderer in Scene.jsx. Recompute only when `bars` or `concretes` change.
export function computeHiddenMask({ bars, concretes }) {
  const hiddenIds = new Set((concretes || []).filter((c) => c.visible === false).map((c) => c.id));
  const hiddenBoxes = (concretes || []).filter((c) => c.visible === false)
    .map((c) => ({ minX: c.x, minY: c.y, minZ: c.z, maxX: c.x + c.lx, maxY: c.y + c.ly, maxZ: c.z + c.lz }));
  const mask = new Uint8Array(bars.length);
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (b.hidden || (b.host && hiddenIds.has(b.host)) || (hiddenBoxes.length > 0 && barOverlapsBoxes(b, hiddenBoxes))) mask[i] = 1;
  }
  return mask;
}

// The cheap part, rerun on every selection change: combine the hidden mask with the selection and
// with rows forced to overlay (for example rows edited but not yet rebuilt).
// `weightOf(row)` (optional) is the number of bar copies a row would draw as classic meshes; a selection
// heavier than `overlayBudget` copies in total, or longer than `selectionOverlayLimit` rows, is tinted.
export function composeRowStates({
  hiddenMask, selectedBars, forceOverlay, selectionOverlayLimit = SELECTION_OVERLAY_LIMIT, weightOf = null, overlayBudget = OVERLAY_COPY_BUDGET,
}) {
  const n = hiddenMask.length;
  const states = new Uint8Array(n);
  const overlay = [];
  const sel = Array.isArray(selectedBars) ? selectedBars : [];
  const selSet = new Set(sel);
  let tint = sel.length > selectionOverlayLimit;
  if (!tint && weightOf) {
    let weight = 0;
    for (const i of selSet) {
      if (i >= 0 && i < n && !hiddenMask[i]) weight += weightOf(i);
      if (weight > overlayBudget) { tint = true; break; }
    }
  }
  for (let i = 0; i < n; i++) {
    if (hiddenMask[i]) { states[i] = STATE.HIDDEN; continue; }
    if (selSet.has(i)) {
      if (tint) states[i] = STATE.TINT;
      else { states[i] = STATE.OVERLAY; overlay.push(i); }
    } else if (forceOverlay && forceOverlay.has(i)) {
      states[i] = STATE.OVERLAY;
      overlay.push(i);
    }
  }
  return { states, overlay };
}
