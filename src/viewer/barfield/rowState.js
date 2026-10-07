// Pure row-state helpers (spec 5.5 and 6.4): which rows the field hides, overlays or tints, and how
// per-row data is packed into the lookup texture. No three.js and no DOM.
import { barOverlapsBoxes } from '../../bbs/shapes.js';

export const STATE = Object.freeze({ NORMAL: 0, HIDDEN: 1, OVERLAY: 2, TINT: 3 });
export const ROW_TEX_WIDTH = 2048;
export const SELECTION_OVERLAY_LIMIT = 300;

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
export function composeRowStates({ hiddenMask, selectedBars, forceOverlay, selectionOverlayLimit = SELECTION_OVERLAY_LIMIT }) {
  const n = hiddenMask.length;
  const states = new Uint8Array(n);
  const overlay = [];
  const sel = Array.isArray(selectedBars) ? selectedBars : [];
  const selSet = new Set(sel);
  const tint = sel.length > selectionOverlayLimit;
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
