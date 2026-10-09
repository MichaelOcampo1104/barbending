import test from 'node:test';
import assert from 'node:assert/strict';
import { useStore } from '../../src/store.js';
import { addSelectedToGroup, removeSelectedFromGroup, sketchWarning } from '../../src/bbs/groupCommands.js';

const SKETCH = '{"p1":[0,0,0],"p2":[1000,0,0]}';
const bar = (i, setId, extra = {}) => ({
  Bar_mark: `B${i}`, Rebar_tag: i + 1, Rebar_Type: 'straight', Plane: 'XZ', Dia: 16, 'Length of Bar': 2000, Pos_x: i * 100, Pos_y: 0, Pos_z: 0,
  Pos_Rotation: 0, qty: 1, Visible: 1, ...(setId ? { setId } : {}), ...extra,
});
const load = () => useStore.getState().setBars([
  bar(0, 'S1'), bar(1, 'S1'), bar(2, 'S1'), bar(3, 'S2', { setSpec: SKETCH }), bar(4, 'S2', { setSpec: SKETCH }), bar(5), bar(6), bar(7),
]);
const ids = () => useStore.getState().bars.map((b) => b.setId ?? '-').join(' ');

// The panel's confirm / alert, stubbed: `answer` is what the user clicks.
function withDialogs(answer, fn) {
  const seen = { confirms: [], alerts: [] };
  globalThis.window = { confirm: (m) => { seen.confirms.push(m); return answer; }, alert: (m) => { seen.alerts.push(m); } };
  try { fn(seen); } finally { delete globalThis.window; }
}

test('sketchWarning names the groups and says what changes', () => {
  assert.match(sketchWarning(['S5']), /S5 was drawn from a face sketch/);
  assert.match(sketchWarning(['S5']), /ordinary group/);
  assert.match(sketchWarning(['S5', 'S7']), /S5, S7 were drawn from face sketches/);
});

test('addSelectedToGroup adds the selection without asking when no face sketch is involved', () => {
  load();
  useStore.getState().setSelectedBars([5, 6]);
  withDialogs(true, (seen) => {
    assert.equal(addSelectedToGroup('S1'), true);
    assert.deepEqual(seen.confirms, []);
    assert.deepEqual(seen.alerts, []);
  });
  assert.equal(ids(), 'S1 S1 S1 S2 S2 S1 S1 -');
});

test('addSelectedToGroup asks before a face-sketch group changes, and changes nothing when the answer is no', () => {
  load();
  useStore.getState().setSelectedBars([5]);
  withDialogs(false, (seen) => {
    assert.equal(addSelectedToGroup('S2'), false);
    assert.equal(seen.confirms.length, 1);
    assert.match(seen.confirms[0], /S2 was drawn from a face sketch/);
  });
  assert.equal(ids(), 'S1 S1 S1 S2 S2 - - -');
  assert.equal(useStore.getState().bars[3].setSpec, SKETCH);
  withDialogs(true, () => assert.equal(addSelectedToGroup('S2'), true));
  assert.equal(ids(), 'S1 S1 S1 S2 S2 S2 - -');
  assert.equal(useStore.getState().bars.some((b) => b.setSpec !== undefined), false);
});

test('addSelectedToGroup also asks when the bars come out of a face-sketch group', () => {
  load();
  useStore.getState().setSelectedBars([3]);
  withDialogs(false, (seen) => {
    assert.equal(addSelectedToGroup('S1'), false);
    assert.match(seen.confirms[0], /S2/);
  });
  assert.equal(ids(), 'S1 S1 S1 S2 S2 - - -');
});

test('addSelectedToGroup tells the user when there is nothing to add', () => {
  load();
  useStore.getState().setSelectedBars([0, 1]);
  withDialogs(true, (seen) => {
    assert.equal(addSelectedToGroup('S1'), false);
    assert.equal(seen.alerts.length, 1);
    assert.match(seen.alerts[0], /already/);
  });
  useStore.getState().clearBarSelection();
  withDialogs(true, (seen) => {
    assert.equal(addSelectedToGroup('S1'), false);
    assert.match(seen.alerts[0], /Select the bars/);
  });
});

test('removeSelectedFromGroup takes the selected members out without asking for an ordinary group', () => {
  load();
  useStore.getState().setSelectedBars([0, 5]);
  withDialogs(true, (seen) => {
    assert.equal(removeSelectedFromGroup('S1'), true);
    assert.deepEqual(seen.confirms, []);
  });
  assert.equal(ids(), '- S1 S1 S2 S2 - - -');
});

test('removeSelectedFromGroup asks before a face-sketch group changes', () => {
  load();
  useStore.getState().setSelectedBars([3]);
  withDialogs(false, (seen) => {
    assert.equal(removeSelectedFromGroup('S2'), false);
    assert.match(seen.confirms[0], /S2 was drawn from a face sketch/);
  });
  assert.equal(ids(), 'S1 S1 S1 S2 S2 - - -');
  withDialogs(true, () => assert.equal(removeSelectedFromGroup('S2'), true));
  assert.equal(ids(), 'S1 S1 S1 - - - - -');
});

test('removeSelectedFromGroup tells the user when none of the selected bars is in the group', () => {
  load();
  useStore.getState().setSelectedBars([5, 6]);
  withDialogs(true, (seen) => {
    assert.equal(removeSelectedFromGroup('S1'), false);
    assert.match(seen.alerts[0], /in that group/);
  });
});
