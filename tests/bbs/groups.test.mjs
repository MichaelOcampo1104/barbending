import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUP_NAME_MAX, groupIds, checkGroupName, groupHasSketch, selectionStats,
  renameGroupRows, addToGroupRows, removeFromGroupRows,
} from '../../src/bbs/groups.js';

const SKETCH = '{"p1":[0,0,0],"p2":[1000,0,0]}';
const bar = (i, setId, extra = {}) => ({ Bar_mark: `B${i}`, Rebar_tag: i, Dia: 16, ...(setId ? { setId } : {}), ...extra });
// 0-2 in S1, 3-4 in S2 (drawn from a face sketch), 5 alone in S3, 6-7 in no group
const make = () => [
  bar(0, 'S1'), bar(1, 'S1'), bar(2, 'S1'),
  bar(3, 'S2', { setSpec: SKETCH }), bar(4, 'S2', { setSpec: SKETCH }),
  bar(5, 'S3'), bar(6), bar(7),
];
const idOf = (bars) => bars.map((b) => b.setId ?? '-').join(' ');

test('groupIds lists every group in use once', () => {
  assert.deepEqual([...groupIds(make())].sort(), ['S1', 'S2', 'S3']);
  assert.equal(groupIds([]).size, 0);
});

test('checkGroupName trims, collapses spaces and enforces the rules', () => {
  const bars = make();
  assert.deepEqual(checkGroupName('  Roof   ties ', bars, 'S1'), { ok: true, name: 'Roof ties' });
  assert.equal(checkGroupName('', bars, 'S1').ok, false);
  assert.equal(checkGroupName('   ', bars, 'S1').ok, false);
  assert.equal(checkGroupName(undefined, bars, 'S1').ok, false);
  assert.equal(checkGroupName('x'.repeat(GROUP_NAME_MAX), bars, 'S1').ok, true);
  assert.equal(checkGroupName('x'.repeat(GROUP_NAME_MAX + 1), bars, 'S1').ok, false);
  assert.equal(checkGroupName('a\u0001b', bars, 'S1').ok, false, 'control characters are refused');
  assert.equal(checkGroupName('Stair A, flight 2 "top"', bars, 'S1').ok, true, 'commas and quotes are fine (the CSV writer quotes them)');
  assert.equal(checkGroupName('S99', bars, 'S1').ok, true, 'a number-like name is fine while it is free');
});

test('checkGroupName refuses a name another group has, in any case, but allows the group its own name in another case', () => {
  const bars = make();
  const r = checkGroupName('s2', bars, 'S1');
  assert.equal(r.ok, false);
  assert.match(r.msg, /S2/);
  assert.deepEqual(checkGroupName('s1', bars, 'S1'), { ok: true, name: 's1' });
  assert.deepEqual(checkGroupName('S1', bars, 'S1'), { ok: true, name: 'S1' });
});

test('groupHasSketch is true only for a group whose bars carry the face sketch', () => {
  const bars = make();
  assert.equal(groupHasSketch(bars, 'S2'), true);
  assert.equal(groupHasSketch(bars, 'S1'), false);
  assert.equal(groupHasSketch(bars, 'nope'), false);
});

test('selectionStats counts the selected bars per group and ignores anything that is not a bar', () => {
  const bars = make();
  const st = selectionStats(bars, [0, 1, 3, 6, 6, 99, -1, 1.5, '2']);
  assert.equal(st.total, 4);
  assert.equal(st.bySet.get('S1'), 2);
  assert.equal(st.bySet.get('S2'), 1);
  assert.equal(st.bySet.has('S3'), false);
  assert.deepEqual(selectionStats(bars, undefined), { total: 0, bySet: new Map() });
});

test('renameGroupRows renames every member and shares every other row with the input', () => {
  const bars = make();
  const r = renameGroupRows(bars, 'S1', 'Roof ties');
  assert.equal(r.ok, true);
  assert.equal(r.changed, true);
  assert.equal(r.count, 3);
  assert.equal(r.name, 'Roof ties');
  assert.equal(idOf(r.bars), 'Roof ties Roof ties Roof ties S2 S2 S3 - -');
  assert.notEqual(r.bars, bars);
  for (const i of [3, 4, 5, 6, 7]) assert.equal(r.bars[i], bars[i], `row ${i} is the same object`);
  assert.equal(bars[0].setId, 'S1', 'the input is not changed');
  assert.equal(r.bars[3].setSpec, SKETCH, 'a sketch stays with its bars');
});

test('renameGroupRows to the same name changes nothing, and refuses a taken name or a group that is gone', () => {
  const bars = make();
  const same = renameGroupRows(bars, 'S1', 'S1');
  assert.equal(same.ok, true);
  assert.equal(same.changed, false);
  assert.equal(same.bars, bars, 'no new array, so no history entry');
  const taken = renameGroupRows(bars, 'S1', 'S2');
  assert.equal(taken.ok, false);
  assert.match(taken.msg, /S2/);
  const gone = renameGroupRows(bars, 'S9', 'Roof');
  assert.equal(gone.ok, false);
  assert.equal(renameGroupRows(bars, 'S1', '  ').ok, false);
});

test('addToGroupRows tags free bars with the group and touches nothing else', () => {
  const bars = make();
  const r = addToGroupRows(bars, [6, 7], 'S1');
  assert.equal(r.ok, true);
  assert.equal(r.added, 2);
  assert.deepEqual(r.dissolved, []);
  assert.deepEqual(r.sketchLost, []);
  assert.equal(idOf(r.bars), 'S1 S1 S1 S2 S2 S3 S1 S1');
  for (const i of [0, 1, 2, 3, 4, 5]) assert.equal(r.bars[i], bars[i], `row ${i} is the same object`);
  assert.equal(bars[6].setId, undefined, 'the input is not changed');
});

test('addToGroupRows ignores bars that are already members, bad indices and duplicates', () => {
  const bars = make();
  const r = addToGroupRows(bars, [0, 6, 6, 99, -3, 2.5], 'S1');
  assert.equal(r.ok, true);
  assert.equal(r.added, 1);
  assert.equal(idOf(r.bars), 'S1 S1 S1 S2 S2 S3 S1 -');
  const none = addToGroupRows(bars, [0, 1], 'S1');
  assert.equal(none.ok, false);
  assert.match(none.msg, /already/);
  assert.equal(addToGroupRows(bars, [6], 'S9').ok, false, 'a group that is gone');
  assert.equal(addToGroupRows(bars, [], 'S1').ok, false);
});

test('addToGroupRows moves a bar out of its old group, which keeps its other members', () => {
  const bars = make();
  const r = addToGroupRows(bars, [2], 'S3'); // S1 keeps 0 and 1
  assert.equal(r.ok, true);
  assert.equal(idOf(r.bars), 'S1 S1 S3 S2 S2 S3 - -');
  assert.deepEqual(r.dissolved, []);
});

test('addToGroupRows dissolves a group that is left with fewer than two bars', () => {
  const bars = make();
  const r = addToGroupRows(bars, [0, 1], 'S3'); // S1 would keep only bar 2
  assert.equal(r.ok, true);
  assert.equal(idOf(r.bars), 'S3 S3 - S2 S2 S3 - -');
  assert.deepEqual(r.dissolved, ['S1']);
});

test('addToGroupRows drops the face sketch of every group whose membership changes, and of the joining bars', () => {
  const bars = make();
  // joining the sketch group S2: it stops being a sketch group, the joiners carry no sketch
  const toSketch = addToGroupRows(bars, [6], 'S2');
  assert.equal(toSketch.ok, true);
  assert.deepEqual(toSketch.sketchLost, ['S2']);
  assert.equal(idOf(toSketch.bars), 'S1 S1 S1 S2 S2 S3 S2 -');
  assert.equal(toSketch.bars.some((b) => b.setSpec !== undefined), false);
  // leaving a sketch group (S2 keeps 1 bar: dissolved, its sketch goes too)
  const fromSketch = addToGroupRows(bars, [3], 'S1');
  assert.equal(fromSketch.ok, true);
  assert.deepEqual(fromSketch.dissolved, ['S2']);
  assert.deepEqual(fromSketch.sketchLost, ['S2']);
  assert.equal(idOf(fromSketch.bars), 'S1 S1 S1 S1 - S3 - -');
  assert.equal(fromSketch.bars.some((b) => b.setSpec !== undefined), false);
  assert.equal(bars[3].setSpec, SKETCH, 'the input is not changed');
});

test('addToGroupRows keeps a bigger sketch group as an ordinary group when it only loses a member', () => {
  const bars = [...make(), bar(8, 'S2', { setSpec: SKETCH })]; // S2 = 3, 4, 8
  const r = addToGroupRows(bars, [4], 'S1');
  assert.equal(r.ok, true);
  assert.deepEqual(r.sketchLost, ['S2']);
  assert.deepEqual(r.dissolved, []);
  assert.equal(r.bars[3].setId, 'S2');
  assert.equal(r.bars[3].setSpec, undefined, 'the two that stay lose the sketch');
  assert.equal(r.bars[8].setSpec, undefined);
  assert.equal(r.bars[4].setId, 'S1');
});

test('removeFromGroupRows takes only the listed members out and keeps their dimensions', () => {
  const bars = make().map((b, i) => ({ ...b, Dia: 10 + i }));
  const r = removeFromGroupRows(bars, [1], 'S1');
  assert.equal(r.ok, true);
  assert.equal(r.removed, 1);
  assert.deepEqual(r.dissolved, []);
  assert.deepEqual(r.sketchLost, []);
  assert.equal(idOf(r.bars), 'S1 - S1 S2 S2 S3 - -');
  assert.equal(r.bars[1].Dia, 11, 'dimensions stay');
  for (const i of [0, 2, 3, 4, 5, 6, 7]) assert.equal(r.bars[i], bars[i], `row ${i} is the same object`);
});

test('removeFromGroupRows ignores bars that are not in that group', () => {
  const bars = make();
  const r = removeFromGroupRows(bars, [3, 6, 0], 'S1');
  assert.equal(r.ok, true);
  assert.equal(r.removed, 1);
  assert.equal(idOf(r.bars), '- S1 S1 S2 S2 S3 - -');
  const none = removeFromGroupRows(bars, [3, 6], 'S1');
  assert.equal(none.ok, false);
  assert.match(none.msg, /group/);
  assert.equal(removeFromGroupRows(bars, [], 'S1').ok, false);
});

test('removeFromGroupRows dissolves a group that is left with fewer than two bars', () => {
  const bars = make();
  const r = removeFromGroupRows(bars, [0, 1], 'S1'); // bar 2 would be alone
  assert.equal(r.ok, true);
  assert.equal(r.removed, 2);
  assert.deepEqual(r.dissolved, ['S1']);
  assert.equal(idOf(r.bars), '- - - S2 S2 S3 - -');
  const all = removeFromGroupRows(bars, [0, 1, 2], 'S1');
  assert.equal(idOf(all.bars), '- - - S2 S2 S3 - -');
});

test('removeFromGroupRows without a group takes the listed bars out of whatever group they are in', () => {
  const bars = make();
  const r = removeFromGroupRows(bars, [0, 3, 6]);
  assert.equal(r.ok, true);
  assert.equal(r.removed, 2);
  assert.deepEqual(r.dissolved.sort(), ['S2']);
  assert.equal(idOf(r.bars), '- S1 S1 - - S3 - -');
});

test('removeFromGroupRows drops the face sketch when a sketch group changes', () => {
  const bars = make();
  const r = removeFromGroupRows(bars, [3], 'S2'); // S2 would keep 1 bar: dissolved
  assert.equal(r.ok, true);
  assert.deepEqual(r.sketchLost, ['S2']);
  assert.equal(r.bars.some((b) => b.setSpec !== undefined), false);
  const big = [...make(), bar(8, 'S2', { setSpec: SKETCH })];
  const r2 = removeFromGroupRows(big, [3], 'S2'); // S2 keeps 4 and 8 as an ordinary group
  assert.deepEqual(r2.dissolved, []);
  assert.deepEqual(r2.sketchLost, ['S2']);
  assert.equal(r2.bars[4].setId, 'S2');
  assert.equal(r2.bars[4].setSpec, undefined);
  assert.equal(r2.bars[8].setSpec, undefined);
  assert.equal(big[4].setSpec, SKETCH, 'the input is not changed');
});

test('group edits are linear in the number of bars: 200,000 bars, 99,500 added, removed and the group renamed in well under 1.5 s', () => {
  const n = 200000;
  const bars = Array.from({ length: n }, (_, i) => (i < 1000 ? { Bar_mark: `B${i}`, setId: 'S1' } : { Bar_mark: `B${i}` }));
  const idxs = Array.from({ length: (n - 1000) / 2 }, (_, i) => 1000 + i * 2); // every other free bar
  const t0 = performance.now();
  const added = addToGroupRows(bars, idxs, 'S1');
  const removed = removeFromGroupRows(added.bars, idxs, 'S1');
  const renamed = renameGroupRows(removed.bars, 'S1', 'Roof');
  const ms = performance.now() - t0;
  assert.equal(added.added, idxs.length);
  assert.equal(removed.removed, idxs.length);
  assert.equal(renamed.count, 1000);
  assert.ok(ms < 1500, `took ${ms.toFixed(0)} ms`);
});
