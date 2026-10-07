// Pure: which UNSELECTED rows are drawn as classic overlay meshes. The classic renderer costs one mesh
// per bar copy, so overlay rows must stay few (spec 6.4): edited rows wait in the overlay for their delta
// flush, and rows added since the field was built show at once - each group only while it fits the overlay
// limits (rows and bar copies). For more (a bulk edit, an import) the caller flushes the delta / waits for
// the rebuild instead of mounting thousands of meshes.
import { SELECTION_OVERLAY_LIMIT, OVERLAY_COPY_BUDGET } from './rowState.js';

// True when drawing these rows as classic meshes stays affordable: at most `limit` rows and at most
// `budget` bar copies in total (`weightOf(row)` = copies of a row, default 1).
export function fitsOverlay(rows, { weightOf = null, limit = SELECTION_OVERLAY_LIMIT, budget = OVERLAY_COPY_BUDGET } = {}) {
  let count = 0;
  let weight = 0;
  for (const i of rows) {
    count += 1;
    if (count > limit) return false;
    weight += weightOf ? weightOf(i) : 1;
    if (weight > budget) return false;
  }
  return true;
}

export function forcedOverlayRows({
  pending, builtRowCount, barCount, weightOf = null, limit = SELECTION_OVERLAY_LIMIT, budget = OVERLAY_COPY_BUDGET,
}) {
  const out = new Set();
  const opts = { weightOf, limit, budget };
  if (fitsOverlay(pending, opts)) for (const i of pending) out.add(i);
  const added = barCount - builtRowCount;
  if (added > 0 && added <= limit) {
    const rows = [];
    for (let i = builtRowCount; i < barCount; i++) rows.push(i);
    if (fitsOverlay(rows, opts)) for (const i of rows) out.add(i);
  }
  return out;
}
