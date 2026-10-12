import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultBar, meshVolumeM3 } from '../../src/bbs/shapes.js';
import { enrichBar, rebarRatioKgM3 } from '../../src/bbs/csv.js';
import { rowsOf, totalsOf } from '../../src/bbs/modelTotals.js';

// The same three members as bbsVolumeBlock.test.mjs: a beam (its box, 1.44 m³), a tetrahedron whose exact mesh (1/6 m³) is its volume, and a slab.
const BEAM = { id: 'b1', name: 'Beam B1', lx: 6000, ly: 400, lz: 600 };
const TETRA = {
  id: 'm1', name: 'Tetra, mesh', lx: 1000, ly: 1000, lz: 1000,
  meshData: { positions: [0, 0, 0, 1000, 0, 0, 0, 1000, 0, 0, 0, 1000], indices: [0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2] },
};
const SLAB = { id: 'c3', name: 'Slab S1', lx: 2000, ly: 2000, lz: 200 };
const CONCRETES = [BEAM, TETRA, SLAB];
const MESH_M3 = meshVolumeM3(TETRA.meshData);
const BARS = [
  { ...defaultBar('straight', 1), host: 'b1' },
  { ...defaultBar('straight', 2), host: 'b1' },
  { ...defaultBar('straight', 3), host: 'm1' },
  { ...defaultBar('straight', 4), host: 'c3' },
];

test("the rows carry each bar's copies and steel, the values the viewer's own rows carry", () => {
  const rows = rowsOf(BARS, CONCRETES);
  assert.equal(rows.length, BARS.length);
  assert.equal(rows[0].kg, enrichBar(BARS[0], CONCRETES).Weight_kg);
  assert.equal(rows[2].copies, enrichBar(BARS[2], CONCRETES)._copies);
});

test("with no volume typed the totals are the viewer's own: bars, steel, the computed concrete and the ratio", () => {
  const rows = rowsOf(BARS, CONCRETES);
  const t = totalsOf(rows, CONCRETES);
  const kg = rows.reduce((s, r) => s + (r.kg || 0), 0);
  const m3 = 1.44 + MESH_M3 + 0.8;
  assert.equal(t.bars, rows.reduce((s, r) => s + (r.copies || 1), 0));
  assert.equal(t.kg, kg);
  assert.equal(t.computedM3, m3);
  assert.equal(t.ratio, rebarRatioKgM3(kg, m3));
  assert.equal(t.typedM3, null);
  assert.equal(t.typedRatio, null);
  assert.deepEqual(t.typedMembers, []);
});

test('a typed volume replaces the computed one for its member; the typed ratio divides the same steel by the typed concrete', () => {
  const t = totalsOf(rowsOf(BARS, CONCRETES), CONCRETES, new Map([['b1', 2]]));
  const typedM3 = 2 + MESH_M3 + 0.8;
  assert.equal(t.computedM3, 1.44 + MESH_M3 + 0.8, 'the computed figure stays');
  assert.equal(t.typedM3, typedM3);
  assert.equal(t.typedRatio, rebarRatioKgM3(t.kg, typedM3));
  assert.deepEqual(t.typedMembers.map((m) => [m.name, m.volumeM3, m.computedM3]), [['Beam B1', 2, 1.44]]);
});

test('a typed value that is not above zero is ignored, and with none left there are no typed figures', () => {
  const t = totalsOf(rowsOf(BARS, CONCRETES), CONCRETES, new Map([['b1', 0], ['c3', -4]]));
  assert.equal(t.typedM3, null);
  assert.equal(t.typedRatio, null);
});

test('a model with no concrete has no volume and no ratio', () => {
  const t = totalsOf(rowsOf(BARS, []), []);
  assert.equal(t.computedM3, 0);
  assert.equal(t.ratio, null);
  assert.equal(t.typedM3, null);
});
