// Pure logic of the bottom BBS panel's table: which items (group headers and bar rows) are listed, which of them are on screen,
// where to scroll to find one, how a find query matches a row, and how rows are grouped by ▦ set. No React, no DOM, no three.js,
// so Node tests can load it. The panel draws only the items that are on screen: at 25,000 rows (1M bars) drawing every row froze
// the page for about 14 s and made every selection redraw them all again.

export const ROW_H = 28; // px: every table row, group headers included, is exactly this tall (the CSS enforces it), so scroll maths is plain arithmetic
export const OVERSCAN = 6; // rows drawn beyond each edge of the window, so a fast scroll never shows a gap

// The items in display order: a group header (kind 1) and then its rows (kind 0) for each group, or just the rows without groups.
// A group lists its `shown` rows when it has them (the rows that match the find box), else all of its `rows`; a collapsed group
// (`collapsed[id]`) keeps its header only. Returns parallel arrays and the lookups the panel needs:
//   rowAt: bar index -> item index (rows of collapsed groups are absent), groupAt: group id -> item index of its header,
//   rowGroup: bar index -> group id (also for collapsed rows), groupItems: item indices of the headers, ascending.
export function flattenItems({ groups = null, collapsed = {}, rows = [] }) {
  const refs = [];
  const kinds = [];
  const rowAt = new Map();
  const groupAt = new Map();
  const rowGroup = new Map();
  const groupItems = [];
  if (groups) {
    for (const g of groups) {
      groupAt.set(g.id, refs.length);
      groupItems.push(refs.length);
      refs.push(g);
      kinds.push(1);
      const open = !collapsed[g.id];
      for (const r of g.shown || g.rows) {
        rowGroup.set(r._origIdx, g.id);
        if (open) {
          rowAt.set(r._origIdx, refs.length);
          refs.push(r);
          kinds.push(0);
        }
      }
    }
  } else {
    for (const r of rows) {
      rowAt.set(r._origIdx, refs.length);
      refs.push(r);
      kinds.push(0);
    }
  }
  return { count: refs.length, kinds: Uint8Array.from(kinds), refs, rowAt, groupAt, rowGroup, groupItems: Int32Array.from(groupItems) };
}

// The items to draw for a scroll position: `bodyH` is the height of the table body (the viewport without its sticky header).
// `first` is inclusive, `last` exclusive, and first <= last whatever the scroll position (a stale one past the end gives an empty window).
export function windowRange(scrollTop, bodyH, count, overscan = OVERSCAN, rowH = ROW_H) {
  const first = Math.min(count, Math.max(0, Math.floor(scrollTop / rowH) - overscan));
  const last = Math.min(count, Math.ceil((scrollTop + Math.max(bodyH, 0)) / rowH) + overscan);
  return { first, last: Math.max(first, last) };
}

// The scroll position the browser really has: the one the table keeps in state goes stale for a frame or two when the list gets shorter
// (a find, Collapse all) while it is scrolled far down, and drawing from it would show an empty table. The scrollable height is the
// items plus the row of column titles; `viewH` is the viewport's height (the titles included).
export function clampScrollTop(scrollTop, count, viewH, rowH = ROW_H) {
  return Math.min(Math.max(0, scrollTop), Math.max(0, (count + 1) * rowH - viewH));
}

// The scroll position that brings item `index` into view, or null when it is fully on screen already (unless `force`). A row that has
// to move is centred, which also leaves room to see the rows around it. `inset` is the height the pinned group header covers at the
// top of the body (one row in a grouped table, else 0): a row under it is not on screen.
export function revealTop({ index, scrollTop, bodyH, force = false, rowH = ROW_H, inset = 0 }) {
  const top = index * rowH;
  if (!force && top >= scrollTop + inset && top + rowH <= scrollTop + bodyH) return null;
  return Math.max(0, Math.round(top - inset - (bodyH - inset - rowH) / 2));
}

// Which group (0-based, among `groupItems`) owns the item at `index`: the last header at or before it. -1 when there are no groups.
export function groupNumberAt(groupItems, index) {
  let lo = 0;
  let hi = groupItems.length - 1;
  let found = groupItems.length ? 0 : -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (groupItems[mid] <= index) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

// The find box: every word of the query must occur somewhere in the row (any case): mark, # tag, type (underscores read as spaces),
// Ø (as "ø16" or "d16"), ▦ set id, bond, and the member's name. Returns null for an empty query (nothing to filter).
export function makeRowFilter(query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return (row, hostName = '') => {
    const type = String(row.Rebar_Type ?? '');
    const hay = `${row.Bar_mark ?? ''} ${row.Rebar_tag ?? ''} ${type} ${type.replace(/_/g, ' ')} ø${row.Dia ?? ''} d${row.Dia ?? ''} ${row.setId ?? ''} ${row.bond_condition ?? ''} ${hostName}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  };
}

const totalsOf = (rows) => ({
  totalBars: rows.reduce((a, r) => a + (r._copies || 1), 0),
  totalW: rows.reduce((a, r) => a + (r.Weight_kg || 0), 0),
});
const setNumber = (id) => { const m = /^S(\d+)$/.exec(String(id)); return m ? Number(m[1]) : Infinity; };

// Rows grouped by ▦ set (the Set column): S1, S2, S10 in natural order, then the rows that are in no set. Rows keep their order inside a group.
// The group objects have the same shape as the element groups (id, name, rows, totalBars, totalW), plus kind 'set' and the setId.
export function groupBySet(rows) {
  const bySet = new Map();
  let none = null;
  for (const r of rows) {
    if (r.setId) {
      let g = bySet.get(r.setId);
      if (!g) { g = { id: `set:${r.setId}`, kind: 'set', setId: r.setId, name: String(r.setId), rows: [] }; bySet.set(r.setId, g); }
      g.rows.push(r);
    } else {
      if (!none) none = { id: 'set:none', kind: 'set', setId: null, name: 'No group', rows: [] };
      none.rows.push(r);
    }
  }
  const out = [...bySet.values()].sort((a, b) => (setNumber(a.setId) - setNumber(b.setId))
    || String(a.setId).localeCompare(String(b.setId), undefined, { numeric: true }));
  if (none) out.push(none);
  return out.map((g) => ({ ...g, ...totalsOf(g.rows) }));
}

// Applies the find box to groups: each group keeps its full `rows` (for its totals) and gets `shown`, the rows that match. With no
// filter nothing is copied; with one, groups with no match are dropped.
export function filterGroups({ groups, pred, hostNameOf = () => '' }) {
  if (!pred) return groups.map((g) => (g.shown === g.rows ? g : { ...g, shown: g.rows }));
  const out = [];
  for (const g of groups) {
    const shown = g.rows.filter((r) => pred(r, hostNameOf(r)));
    if (shown.length) out.push({ ...g, shown });
  }
  return out;
}

// The Groups overview: groups narrowed by the find words (against the group's name and its members' names, `hostsBy`: group id -> names) and
// sorted by 'name' (natural order), 'rows', 'bars' or 'kg'; 'none' keeps the given order. Never changes its input.
export function orderGroups({ groups, words = [], sortKey = 'none', dir = 1, hostsBy = new Map() }) {
  const hit = words.length
    ? groups.filter((g) => {
      const hay = `${g.name} ${(hostsBy.get(g.id) || []).join(' ')}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    : groups;
  if (sortKey === 'none') return hit;
  const val = (g) => (sortKey === 'name' ? g.name : sortKey === 'rows' ? g.rows.length : sortKey === 'bars' ? g.totalBars : g.totalW);
  return [...hit].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' })) * dir;
  });
}
