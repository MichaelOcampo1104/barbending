import test from 'node:test';
import assert from 'node:assert/strict';
import { diffRows, geometryKey, MAX_SIGNATURE_ROWS } from '../../src/viewer/barfield/diffRows.js';
import { spreadRows } from './helpers.mjs';

test('identical arrays report no changes', () => {
  const a = spreadRows(10, 2, 1);
  assert.deepEqual(diffRows(a, a.slice()), { sameLength: true, changed: [], needsRebuild: false });
});

test('a replaced row with different geometry is reported', () => {
  const a = spreadRows(10, 2, 1);
  const b = a.map((r, i) => (i === 4 ? { ...r, Pos_x: r.Pos_x + 100 } : r));
  assert.deepEqual(diffRows(a, b), { sameLength: true, changed: [4], needsRebuild: false });
});

test('view-only changes (hidden, Group, Bar_mark, host) are not geometry changes', () => {
  const a = spreadRows(10, 2, 1);
  const b = a.map((r, i) => (i === 2 ? { ...r, hidden: true, Group: 'X', Bar_mark: 'ZZ', host: 'c9' } : r));
  assert.deepEqual(diffRows(a, b).changed, []);
});

test('diameter, length, copies and profile changes count as geometry changes', () => {
  const a = spreadRows(6, 2, 1);
  for (const patch of [{ Dia: 32 }, { 'Length of Bar': 1234 }, { qty_y: 9 }, { spacing_y: 77 }, { Pos_Rotation: 45 }, { legs: '[[10,0]]' }]) {
    const b = a.map((r, i) => (i === 3 ? { ...r, ...patch } : r));
    assert.deepEqual(diffRows(a, b).changed, [3], JSON.stringify(patch));
  }
});

test('a structuredClone of every row (undo) reports only the rows that really changed', () => {
  const a = spreadRows(20, 2, 1);
  const c = structuredClone(a);
  assert.deepEqual(diffRows(a, c).changed, []);
  c[7] = { ...c[7], 'Length of Bar': 1 };
  assert.deepEqual(diffRows(a, c).changed, [7]);
});

test('different lengths need a rebuild', () => {
  const a = spreadRows(5, 1, 1);
  assert.deepEqual(diffRows(a, a.slice(0, 4)), { sameLength: false, changed: [], needsRebuild: true });
});

test('more replaced rows than MAX_SIGNATURE_ROWS need a rebuild without comparing signatures', () => {
  const rows = spreadRows(MAX_SIGNATURE_ROWS + 5, 1, 2);
  const next = rows.map((r) => ({ ...r }));
  assert.deepEqual(diffRows(rows, next), { sameLength: true, changed: [], needsRebuild: true });
});

test('geometryKey ignores view-only keys but not geometry', () => {
  const [r] = spreadRows(1, 2, 1);
  assert.equal(geometryKey(r), geometryKey({ ...r, hidden: true, Visible: 0, Group: 'g', host: 'h', Bar_mark: 'M', Rebar_tag: 99 }));
  assert.notEqual(geometryKey(r), geometryKey({ ...r, Dia: 99 }));
});
