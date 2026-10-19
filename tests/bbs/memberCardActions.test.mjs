import test from 'node:test';
import assert from 'node:assert/strict';
import { useStore } from '../../src/store.js';
import { memberGroups, defaultCardInputs } from '../../src/bbs/memberReinforcement.js';

const COLUMN = { id: 'c1', name: 'C1', kind: 'COLUMN', lx: 800, ly: 800, lz: 4500, x: 0, y: 0, z: 0, covB: 40, covT: 40 };
const inputs = () => ({
  ...defaultCardInputs(40),
  kind: 'Column',
  column: { mainDia: 25, layout: 'all', mainCount: 4, faceCount: 8, linkDia: 10, linkSpacing: 150, lap: null },
  starters: { base: false, top: false, dia: null, lap: null, anchorage: null, bend: null },
});
const existing = () => [
  { Bar_mark: 'B1', Rebar_tag: 1, Rebar_Type: 'straight', Dia: 16, 'Length of Bar': 2000, Pos_x: 0, Pos_y: 0, Pos_z: 0, Plane: 'XZ', qty: 1, Visible: 1 },
  { Bar_mark: 'B2', Rebar_tag: 2, Rebar_Type: 'straight', Dia: 16, 'Length of Bar': 2000, Pos_x: 100, Pos_y: 0, Pos_z: 0, Plane: 'XZ', qty: 1, Visible: 1 },
];
const depth = () => useStore.getState().past.length;
const groupsOf = () => memberGroups(COLUMN, inputs(), { neighbours: [] }).groups;

test('addMemberRows adds the sets in one undo step, and undo removes them all', () => {
  useStore.getState().setBars(existing());
  const before = depth();
  const r = useStore.getState().addMemberRows(groupsOf());
  assert.deepEqual(r, { ok: true, count: 5, sets: 2 });
  const bars = useStore.getState().bars;
  assert.equal(bars.length, 7);
  assert.equal(depth(), before + 1);
  assert.deepEqual(bars.slice(2).map((b) => b.setId), ['C1 mains', 'C1 mains', 'C1 mains', 'C1 mains', 'C1 links']);
  assert.ok(bars.slice(2).every((b) => b.host === 'c1' && b.Group === 'C1' && b.Visible === 1));
  assert.equal(new Set(bars.map((b) => b.Rebar_tag)).size, bars.length);
  useStore.getState().undo();
  assert.equal(useStore.getState().bars.length, 2);
});

test('addMemberRows refuses a set name already in use, and changes nothing', () => {
  useStore.getState().setBars(existing());
  assert.equal(useStore.getState().addMemberRows(groupsOf()).ok, true);
  const before = depth();
  const len = useStore.getState().bars.length;
  const again = useStore.getState().addMemberRows(groupsOf());
  assert.equal(again.ok, false);
  assert.match(again.msg, /C1 mains/);
  assert.equal(useStore.getState().bars.length, len);
  assert.equal(depth(), before);
});

test('addMemberRows refuses a name over 40 characters', () => {
  useStore.getState().setBars(existing());
  const before = depth();
  const long = [{ name: 'x'.repeat(41), rows: [{ Bar_mark: 'V1-1', Rebar_Type: 'straight', Dia: 25 }] }];
  const r = useStore.getState().addMemberRows(long);
  assert.equal(r.ok, false);
  assert.equal(depth(), before);
});

test('addMemberRows with nothing to add changes nothing', () => {
  useStore.getState().setBars(existing());
  const before = depth();
  assert.equal(useStore.getState().addMemberRows([]).ok, false);
  assert.equal(depth(), before);
});
