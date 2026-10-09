import test from 'node:test';
import assert from 'node:assert/strict';
import { useStore } from '../../src/store.js';

const SKETCH = '{"p1":[0,0,0],"p2":[1000,0,0]}';
const bar = (i, setId, extra = {}) => ({
  Bar_mark: `B${i}`, Rebar_tag: i + 1, Rebar_Type: 'straight', Plane: 'XZ', Dia: 16, 'Length of Bar': 2000, Pos_x: i * 100, Pos_y: 0, Pos_z: 0,
  Pos_Rotation: 0, qty: 1, Visible: 1, ...(setId ? { setId } : {}), ...extra,
});
// 0-2 in S1, 3-4 in S2 (face sketch), 5-7 in no group
const load = () => {
  const bars = [bar(0, 'S1'), bar(1, 'S1'), bar(2, 'S1'), bar(3, 'S2', { setSpec: SKETCH }), bar(4, 'S2', { setSpec: SKETCH }), bar(5), bar(6), bar(7)];
  useStore.getState().setBars(bars);
  return bars;
};
const ids = () => useStore.getState().bars.map((b) => b.setId ?? '-').join(' ');
const depth = () => useStore.getState().past.length;

test('renameGroup renames every member in one undo step', () => {
  load();
  const before = depth();
  const r = useStore.getState().renameGroup('S1', 'Roof ties');
  assert.equal(r.ok, true);
  assert.equal(ids(), 'Roof ties Roof ties Roof ties S2 S2 - - -');
  assert.equal(depth(), before + 1);
  useStore.getState().undo();
  assert.equal(ids(), 'S1 S1 S1 S2 S2 - - -');
});

test('renameGroup leaves the model and the history alone when the name is refused or unchanged', () => {
  load();
  const before = depth();
  const bars = useStore.getState().bars;
  assert.equal(useStore.getState().renameGroup('S1', 's2').ok, false, 'another group has that name');
  assert.equal(useStore.getState().renameGroup('S1', '   ').ok, false);
  assert.equal(useStore.getState().renameGroup('S9', 'Roof').ok, false, 'no such group');
  const same = useStore.getState().renameGroup('S1', 'S1');
  assert.equal(same.ok, true);
  assert.equal(same.changed, false);
  assert.equal(useStore.getState().bars, bars);
  assert.equal(depth(), before);
});

test('renameGroup keeps the selection', () => {
  load();
  useStore.getState().setSelectedBars([1, 2]);
  useStore.getState().renameGroup('S1', 'Roof ties');
  assert.deepEqual(useStore.getState().selectedBars, [1, 2]);
});

test('addToGroup adds the selected bars by default, in one undo step', () => {
  load();
  useStore.getState().setSelectedBars([5, 6]);
  const before = depth();
  const r = useStore.getState().addToGroup('S1');
  assert.equal(r.ok, true);
  assert.equal(r.added, 2);
  assert.equal(ids(), 'S1 S1 S1 S2 S2 S1 S1 -');
  assert.equal(depth(), before + 1);
  assert.deepEqual(useStore.getState().selectedBars, [5, 6], 'the selection stays');
  useStore.getState().undo();
  assert.equal(ids(), 'S1 S1 S1 S2 S2 - - -');
});

test('addToGroup takes an explicit list, and does nothing without bars to add', () => {
  load();
  const before = depth();
  assert.equal(useStore.getState().addToGroup('S1', [7]).ok, true);
  assert.equal(ids(), 'S1 S1 S1 S2 S2 - - S1');
  assert.equal(useStore.getState().addToGroup('S1', [0, 1]).ok, false, 'already members');
  useStore.getState().clearBarSelection();
  assert.equal(useStore.getState().addToGroup('S1').ok, false, 'a cleared selection adds nothing, not the active bar');
  assert.equal(depth(), before + 1);
});

test('addToGroup reports the sketch groups that lose their sketch', () => {
  load();
  const r = useStore.getState().addToGroup('S2', [5]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.sketchLost, ['S2']);
  assert.equal(useStore.getState().bars.some((b) => b.setSpec !== undefined), false);
  useStore.getState().undo();
  assert.equal(useStore.getState().bars[3].setSpec, SKETCH, 'undo brings the sketch back');
});

test('removeFromGroup takes the selected members out, keeps their dimensions, in one undo step', () => {
  load();
  useStore.getState().setSelectedBars([0, 5]); // 5 is in no group
  const before = depth();
  const r = useStore.getState().removeFromGroup('S1');
  assert.equal(r.ok, true);
  assert.equal(r.removed, 1);
  assert.equal(ids(), '- S1 S1 S2 S2 - - -');
  assert.equal(useStore.getState().bars[0].Dia, 16);
  assert.equal(depth(), before + 1);
  useStore.getState().undo();
  assert.equal(ids(), 'S1 S1 S1 S2 S2 - - -');
});

test('removeFromGroup dissolves a group that would keep fewer than two bars', () => {
  load();
  const r = useStore.getState().removeFromGroup('S1', [0, 1]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.dissolved, ['S1']);
  assert.equal(ids(), '- - - S2 S2 - - -');
});

test('removeFromGroup refuses when none of the bars is in the group', () => {
  load();
  const before = depth();
  assert.equal(useStore.getState().removeFromGroup('S1', [5, 6]).ok, false);
  assert.equal(depth(), before);
});
