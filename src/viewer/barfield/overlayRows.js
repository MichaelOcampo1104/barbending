// Pure: which UNSELECTED rows are drawn as classic overlay meshes. The classic renderer costs one mesh
// per bar copy, so overlay rows must stay few (spec 6.4): edited rows wait in the overlay for their delta
// flush, and rows added since the field was built show at once - each group only up to the overlay limit.
// For more (a bulk edit, an import) the caller flushes the delta / waits for the rebuild instead of
// mounting thousands of meshes.
import { SELECTION_OVERLAY_LIMIT } from './rowState.js';

export function forcedOverlayRows({ pending, builtRowCount, barCount, limit = SELECTION_OVERLAY_LIMIT }) {
  const out = new Set();
  if (pending.size <= limit) for (const i of pending) out.add(i);
  const added = barCount - builtRowCount;
  if (added > 0 && added <= limit) for (let i = builtRowCount; i < barCount; i++) out.add(i);
  return out;
}
