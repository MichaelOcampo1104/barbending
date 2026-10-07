// Pure: which rows changed GEOMETRY between two `bars` arrays (spec 5.6). Rows are immutable objects,
// so unchanged rows keep their identity; view-only fields never count as geometry changes.
const VIEW_ONLY = new Set(['hidden', 'Visible', 'host', 'Group', 'Bar_mark', 'Rebar_tag', 'setId', 'setSpec', 'bond_condition', 'feature']);

export const MAX_SIGNATURE_ROWS = 2000;

export function geometryKey(row) {
  return JSON.stringify(row, (k, v) => (VIEW_ONLY.has(k) ? undefined : v));
}

// -> { sameLength, changed: number[], needsRebuild }
//  - different lengths: the caller must rebuild
//  - rows whose identity changed are candidates; more than MAX_SIGNATURE_ROWS candidates (undo, redo,
//    import) are not compared one by one: rebuild instead
//  - otherwise `changed` holds the candidates whose geometryKey differs
export function diffRows(prev, next) {
  if (prev.length !== next.length) return { sameLength: false, changed: [], needsRebuild: true };
  const candidates = [];
  for (let i = 0; i < next.length; i++) if (prev[i] !== next[i]) candidates.push(i);
  if (candidates.length > MAX_SIGNATURE_ROWS) return { sameLength: true, changed: [], needsRebuild: true };
  const changed = [];
  for (const i of candidates) if (geometryKey(prev[i]) !== geometryKey(next[i])) changed.push(i);
  return { sameLength: true, changed, needsRebuild: false };
}
