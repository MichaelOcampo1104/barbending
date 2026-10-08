import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROW_H, flattenItems, windowRange, clampScrollTop, revealTop, groupNumberAt, makeRowFilter, groupBySet, filterGroups, orderGroups,
} from '../../src/bbs/tableView.js';

const row = (i, over = {}) => ({ _origIdx: i, Bar_mark: `B${i}`, Rebar_tag: i + 1, Rebar_Type: 'straight', Dia: 16, _copies: 2, Weight_kg: 3, ...over });
const group = (id, rows) => ({ id, name: id, rows, shown: rows });

test('flattenItems lists each group header followed by its rows, and indexes them', () => {
  const g1 = group('g1', [row(0), row(1)]);
  const g2 = group('g2', [row(2)]);
  const it = flattenItems({ groups: [g1, g2], collapsed: {} });
  assert.equal(it.count, 5);
  assert.deepEqual(Array.from(it.kinds), [1, 0, 0, 1, 0]);
  assert.equal(it.refs[0], g1);
  assert.equal(it.refs[1], g1.rows[0]);
  assert.equal(it.refs[3], g2);
  assert.equal(it.rowAt.get(1), 2);
  assert.equal(it.rowAt.get(2), 4);
  assert.equal(it.groupAt.get('g2'), 3);
  assert.deepEqual(Array.from(it.groupItems), [0, 3]);
  assert.equal(it.rowGroup.get(2), 'g2');
});

test('a collapsed group keeps its header but hides its rows; the rows still know their group', () => {
  const g1 = group('g1', [row(0), row(1)]);
  const g2 = group('g2', [row(2)]);
  const it = flattenItems({ groups: [g1, g2], collapsed: { g1: true } });
  assert.equal(it.count, 3);
  assert.deepEqual(Array.from(it.kinds), [1, 1, 0]);
  assert.equal(it.rowAt.get(0), undefined);
  assert.equal(it.rowGroup.get(0), 'g1');
  assert.equal(it.rowAt.get(2), 2);
});

test('flattenItems without groups is the flat list, and a group shows its `shown` rows when it has them', () => {
  const flat = flattenItems({ groups: null, rows: [row(5), row(6)] });
  assert.equal(flat.count, 2);
  assert.deepEqual(Array.from(flat.kinds), [0, 0]);
  assert.equal(flat.groupItems.length, 0);
  assert.equal(flat.rowAt.get(6), 1);
  const g = { id: 'g', name: 'g', rows: [row(0), row(1), row(2)], shown: [row(1)] };
  assert.equal(flattenItems({ groups: [g] }).count, 2);
});

test('windowRange: the rows on screen plus a few more each side, never outside the list', () => {
  assert.equal(ROW_H, 28);
  assert.deepEqual(windowRange(0, 280, 1000), { first: 0, last: 16 });
  assert.deepEqual(windowRange(28 * 100, 280, 1000), { first: 94, last: 116 });
  assert.deepEqual(windowRange(0, 280, 3), { first: 0, last: 3 });
  assert.deepEqual(windowRange(28 * 990, 280, 1000), { first: 984, last: 1000 });
  assert.deepEqual(windowRange(28 * 5000, 280, 10), { first: 10, last: 10 }, 'a stale scroll position past the end gives an empty window, not a crash');
});

test('clampScrollTop pulls a stale scroll position back to where the browser will put it once the list got shorter', () => {
  // count items under one row of column titles, in a viewport of 203 px
  assert.equal(clampScrollTop(11000, 1, 203), 0, 'a one-row list needs no scrolling');
  assert.equal(clampScrollTop(0, 1000, 203), 0);
  assert.equal(clampScrollTop(99999, 1000, 203), 1001 * 28 - 203, 'the end of a long list');
  assert.equal(clampScrollTop(500, 1000, 203), 500, 'a valid position is left alone');
  assert.equal(clampScrollTop(-40, 1000, 203), 0, 'never negative');
  assert.equal(clampScrollTop(300, 5, 0), 6 * 28, 'before the viewport is measured the list is as tall as it is');
  // what the table draws from it: not an empty window
  const w = windowRange(clampScrollTop(11000, 1, 203), 203 - 28, 1);
  assert.deepEqual(w, { first: 0, last: 1 });
});

test('revealTop scrolls only when the row is not fully on screen, and then centres it', () => {
  assert.equal(revealTop({ index: 5, scrollTop: 0, bodyH: 280 }), null);
  assert.notEqual(revealTop({ index: 10, scrollTop: 0, bodyH: 280 }), null, 'a row cut off at the bottom counts as hidden');
  assert.equal(revealTop({ index: 100, scrollTop: 0, bodyH: 280 }), 100 * 28 - 126);
  assert.equal(revealTop({ index: 2, scrollTop: 2800, bodyH: 280 }), 0, 'never negative');
  assert.equal(revealTop({ index: 5, scrollTop: 0, bodyH: 280, force: true }), 14);
});

test('revealTop with an inset: the pinned header covers the first row of the body, so that row counts as hidden', () => {
  // bodyH 280, inset 28: the clear part of the body is [scrollTop + 28, scrollTop + 280)
  assert.equal(revealTop({ index: 1, scrollTop: 0, bodyH: 280, inset: 28 }), null, 'the row just below the pinned header is visible');
  assert.equal(revealTop({ index: 9, scrollTop: 0, bodyH: 280, inset: 28 }), null, 'and so is the last one that fits');
  assert.notEqual(revealTop({ index: 10, scrollTop: 0, bodyH: 280, inset: 28 }), null, 'one more is cut off at the bottom');
  assert.equal(revealTop({ index: 10, scrollTop: 280, bodyH: 280, inset: 28 }), 140, 'a row under the pinned header is centred in the clear part');
  assert.equal(revealTop({ index: 5, scrollTop: 0, bodyH: 280, inset: 28, force: true }), 0);
  assert.equal(revealTop({ index: 100, scrollTop: 0, bodyH: 280, inset: 28 }), 100 * 28 - 28 - 112);
  assert.equal(revealTop({ index: 5, scrollTop: 0, bodyH: 280, inset: 0 }), null, 'no inset is the plain case');
});

test('groupNumberAt finds the group that owns an item', () => {
  const gi = Int32Array.from([0, 40, 90]);
  assert.equal(groupNumberAt(gi, 0), 0);
  assert.equal(groupNumberAt(gi, 39), 0);
  assert.equal(groupNumberAt(gi, 40), 1);
  assert.equal(groupNumberAt(gi, 500), 2);
  assert.equal(groupNumberAt(new Int32Array(0), 5), -1);
  assert.equal(groupNumberAt(Int32Array.from([3]), 1), 0, 'before the first header must not crash');
});

test('makeRowFilter: every word must match something in the row, any case', () => {
  assert.equal(makeRowFilter(''), null);
  assert.equal(makeRowFilter('   '), null);
  const f = makeRowFilter('b1 16');
  assert.ok(f(row(1, { Dia: 16 })));
  assert.ok(!f(row(1, { Dia: 20 })));
  assert.ok(!f(row(2, { Dia: 16 })));
  assert.ok(makeRowFilter('c link')(row(0, { Rebar_Type: 'c_link_with_hook' })), 'underscores read as spaces');
  assert.ok(makeRowFilter('ø25')(row(0, { Dia: 25 })));
  assert.ok(makeRowFilter('d25')(row(0, { Dia: 25 })));
  assert.ok(makeRowFilter('s8')(row(0, { setId: 'S8' })));
  assert.ok(makeRowFilter('POOR')(row(0, { bond_condition: 'poor' })));
});

test('makeRowFilter also searches the member name', () => {
  assert.ok(makeRowFilter('beam')(row(0), 'Beam B12'));
  assert.ok(!makeRowFilter('beam')(row(0), 'Column C1'));
});

test('groupBySet: one group per ▦ set in natural order, ungrouped rows last, totals added up', () => {
  const rows = [row(0, { setId: 'S2' }), row(1), row(2, { setId: 'S10' }), row(3, { setId: 'S2' }), row(4, { setId: 'S1' })];
  const gs = groupBySet(rows);
  assert.deepEqual(gs.map((g) => g.name), ['S1', 'S2', 'S10', 'No group']);
  assert.deepEqual(gs.map((g) => g.id), ['set:S1', 'set:S2', 'set:S10', 'set:none']);
  assert.deepEqual(gs[1].rows.map((r) => r._origIdx), [0, 3]);
  assert.equal(gs[1].totalBars, 4);
  assert.equal(gs[1].totalW, 6);
  assert.equal(gs[3].setId, null);
  assert.equal(groupBySet([row(0, { setId: 'S1' })]).length, 1, 'no "No group" header when every row is in a set');
});

test('filterGroups keeps the full rows for the totals and lists only the matching ones as shown', () => {
  const g1 = group('g1', [row(0, { Bar_mark: 'AA' }), row(1, { Bar_mark: 'BB' })]);
  const g2 = group('g2', [row(2, { Bar_mark: 'CC' })]);
  const none = filterGroups({ groups: [g1, g2], pred: null });
  assert.equal(none.length, 2);
  assert.equal(none[0].shown, g1.rows, 'without a filter nothing is copied');
  const hit = filterGroups({ groups: [g1, g2], pred: makeRowFilter('bb'), hostNameOf: () => '' });
  assert.equal(hit.length, 1);
  assert.deepEqual(hit[0].shown.map((r) => r.Bar_mark), ['BB']);
  assert.equal(hit[0].rows.length, 2);
  const empty = { id: 'e', name: 'e', rows: [], shown: [] };
  assert.equal(filterGroups({ groups: [empty, g2], pred: null }).length, 2, 'an empty header stays when nothing is searched for');
  assert.equal(filterGroups({ groups: [empty, g2], pred: makeRowFilter('cc'), hostNameOf: () => '' }).length, 1, 'and goes when something is');
});

test('orderGroups narrows by name or member and sorts without touching its input', () => {
  const mk = (id, name, rows, bars, kg) => ({ id, name, rows: Array.from({ length: rows }, (_, i) => row(i)), totalBars: bars, totalW: kg });
  const gs = [mk('a', 'Beam B10', 5, 50, 90), mk('b', 'Beam B2', 9, 20, 10), mk('c', 'S3', 1, 5, 400)];
  const hostsBy = new Map([['c', ['Slab L1']]]);
  assert.deepEqual(orderGroups({ groups: gs }).map((g) => g.id), ['a', 'b', 'c'], 'no sort keeps the order');
  assert.deepEqual(orderGroups({ groups: gs, words: ['beam'] }).map((g) => g.id), ['a', 'b']);
  assert.deepEqual(orderGroups({ groups: gs, words: ['slab'], hostsBy }).map((g) => g.id), ['c'], 'a group is found by its member too');
  assert.deepEqual(orderGroups({ groups: gs, sortKey: 'name' }).map((g) => g.id), ['b', 'a', 'c'], 'B2 before B10');
  assert.deepEqual(orderGroups({ groups: gs, sortKey: 'rows', dir: -1 }).map((g) => g.id), ['b', 'a', 'c']);
  assert.deepEqual(orderGroups({ groups: gs, sortKey: 'kg', dir: -1 }).map((g) => g.id), ['c', 'a', 'b']);
  assert.deepEqual(gs.map((g) => g.id), ['a', 'b', 'c']);
});
