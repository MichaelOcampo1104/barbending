// Editing the ▦ groups of the BBS panel: a group is the set of bars that share a `setId`, and that id is also the group's name ("S8" when
// it was made, whatever the user renamed it to). Pure functions over the bar list (no React, no store, no DOM) so Node tests them; the store
// actions in store.js apply the results as one undo step each. Every function returns a NEW array that shares each untouched row with the
// input, so row-keyed caches elsewhere stay valid and the work is one pass over the rows (about a millisecond at 25,000 rows).
//
// Two rules keep a group meaningful: a group has at least two bars (one left alone is released, as ▦ Group needs two to start), and a group
// that was drawn from a face sketch (its bars carry `setSpec`) stops being re-spreadable from that sketch as soon as its membership changes,
// because a later re-spread would bring back removed bars or retire added ones. Such a group becomes an ordinary one: `setSpec` is dropped
// from every bar that is affected, and the functions report which groups lost it (`sketchLost`) so the panel can ask first.

export const GROUP_NAME_MAX = 40;

const validIndices = (bars, idxs) => {
  const out = [];
  const seen = new Set();
  for (const i of idxs || []) {
    if (!Number.isInteger(i) || i < 0 || i >= bars.length || seen.has(i)) continue;
    seen.add(i);
    out.push(i);
  }
  return out;
};

// Every group id in use.
export function groupIds(bars) {
  const ids = new Set();
  for (const b of bars) if (b.setId) ids.add(b.setId);
  return ids;
}

// Cleans a new name (trimmed, runs of spaces collapsed) and checks it: 1 to GROUP_NAME_MAX characters, no control characters, and not the
// name of another group in any letter case (the group may keep its own name, or change only its letter case). `from` is the group's
// current id. Returns { ok: true, name } or { ok: false, msg }.
export function checkGroupName(raw, bars, from = null) {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return { ok: false, msg: 'A group needs a name.' };
  if (name.length > GROUP_NAME_MAX) return { ok: false, msg: `Keep the name to ${GROUP_NAME_MAX} characters or fewer.` };
  if (/\p{Cc}/u.test(name)) return { ok: false, msg: 'The name cannot contain control characters.' };
  const lower = name.toLowerCase();
  for (const id of groupIds(bars)) {
    if (id !== from && String(id).toLowerCase() === lower) return { ok: false, msg: `Another group is already called “${id}”.` };
  }
  return { ok: true, name };
}

// Do the bars of this group carry the face sketch they were drawn from?
export function groupHasSketch(bars, setId) {
  return bars.some((b) => b.setId === setId && b.setSpec);
}

// The selected bars counted: { total, bySet } where bySet maps a group id to how many of the selected bars it holds. Anything that is not a
// valid bar index, and duplicates, are ignored. For a group: bars that could be added = total - bySet.get(id), that could be removed = bySet.get(id).
export function selectionStats(bars, selected) {
  const bySet = new Map();
  const list = validIndices(bars, selected);
  for (const i of list) {
    const g = bars[i].setId;
    if (g) bySet.set(g, (bySet.get(g) || 0) + 1);
  }
  return { total: list.length, bySet };
}

// Size and sketch state of the given groups, in one pass.
function factsOf(bars, ids) {
  const size = new Map();
  const sketch = new Set();
  for (const b of bars) {
    const g = b.setId;
    if (!g || !ids.has(g)) continue;
    size.set(g, (size.get(g) || 0) + 1);
    if (b.setSpec) sketch.add(g);
  }
  return { size, sketch };
}

// Which of the groups that lose `k` bars end (fewer than two left) and which keep going; `sketch` says which had a face sketch.
function planLosses(bars, leavingBy, extraIds = []) {
  const { size, sketch } = factsOf(bars, new Set([...leavingBy.keys(), ...extraIds]));
  const dissolve = new Set();
  const dropSketch = new Set();
  const sketchLost = [];
  for (const id of extraIds) {
    if (sketch.has(id)) { dropSketch.add(id); sketchLost.push(id); }
  }
  for (const [g, k] of leavingBy) {
    if (size.get(g) - k < 2) dissolve.add(g);
    else if (sketch.has(g)) dropSketch.add(g);
    if (sketch.has(g)) sketchLost.push(g);
  }
  return { dissolve, dropSketch, sketchLost };
}

const without = (b, ...keys) => {
  const next = { ...b };
  for (const k of keys) delete next[k];
  return next;
};

// Rename a group: every member gets the new id. { ok: true, bars, name, changed, count } (changed is false, and `bars` is the same
// array, when the name is the group's own), or { ok: false, msg }.
export function renameGroupRows(bars, from, to) {
  const checked = checkGroupName(to, bars, from);
  if (!checked.ok) return checked;
  const name = checked.name;
  let count = 0;
  for (const b of bars) if (b.setId === from) count += 1;
  if (!count) return { ok: false, msg: 'That group no longer exists.' };
  if (name === from) return { ok: true, bars, name, changed: false, count };
  return { ok: true, bars: bars.map((b) => (b.setId === from ? { ...b, setId: name } : b)), name, changed: true, count };
}

// Add bars to a group. Bars already in it are ignored; a bar that was in another group moves over (the old group keeps its other bars, or
// is dissolved when fewer than two are left). The joining bars change nothing else: they keep their own diameter and dimensions.
// { ok: true, bars, added, dissolved: [ids that ended], sketchLost: [ids that had a face sketch and lost it] } or { ok: false, msg }.
export function addToGroupRows(bars, idxs, setId) {
  const list = validIndices(bars, idxs);
  if (!list.length) return { ok: false, msg: 'Select the bars to add first.' };
  if (!groupIds(bars).has(setId)) return { ok: false, msg: 'That group no longer exists.' };
  const joining = list.filter((i) => bars[i].setId !== setId);
  if (!joining.length) return { ok: false, msg: 'Those bars are already in this group.' };
  const leavingBy = new Map();
  for (const i of joining) {
    const g = bars[i].setId;
    if (g) leavingBy.set(g, (leavingBy.get(g) || 0) + 1);
  }
  const { dissolve, dropSketch, sketchLost } = planLosses(bars, leavingBy, [setId]);
  const joinSet = new Set(joining);
  const out = bars.map((b, i) => {
    if (joinSet.has(i)) return without({ ...b, setId }, 'setSpec');
    const g = b.setId;
    if (!g) return b;
    if (dissolve.has(g)) return without(b, 'setId', 'setSpec');
    if (dropSketch.has(g) && b.setSpec !== undefined) return without(b, 'setSpec');
    return b;
  });
  return { ok: true, bars: out, added: joining.length, dissolved: [...dissolve], sketchLost };
}

// Take bars out of a group (`setId`), or out of whatever group they are in when `setId` is omitted. Bars that are not in that group are
// ignored. The bars keep all their dimensions, they just edit solo again; a group left with fewer than two bars is dissolved.
// { ok: true, bars, removed, dissolved, sketchLost } or { ok: false, msg }.
export function removeFromGroupRows(bars, idxs, setId = null) {
  const list = validIndices(bars, idxs);
  if (!list.length) return { ok: false, msg: 'Select the bars to remove first.' };
  const leaving = list.filter((i) => bars[i].setId && (setId == null || bars[i].setId === setId));
  if (!leaving.length) return { ok: false, msg: setId == null ? 'None of the selected bars is in a group.' : 'None of the selected bars is in that group.' };
  const leavingBy = new Map();
  for (const i of leaving) {
    const g = bars[i].setId;
    leavingBy.set(g, (leavingBy.get(g) || 0) + 1);
  }
  const { dissolve, dropSketch, sketchLost } = planLosses(bars, leavingBy);
  const leaveSet = new Set(leaving);
  const out = bars.map((b, i) => {
    const g = b.setId;
    if (!g) return b;
    if (leaveSet.has(i) || dissolve.has(g)) return without(b, 'setId', 'setSpec');
    if (dropSketch.has(g) && b.setSpec !== undefined) return without(b, 'setSpec');
    return b;
  });
  return { ok: true, bars: out, removed: leaving.length, dissolved: [...dissolve], sketchLost };
}
