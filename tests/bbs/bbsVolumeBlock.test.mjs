import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultBar, meshVolumeM3 } from '../../src/bbs/shapes.js';
import { toBbsBenchmarkCsv, bbsSchedule, concreteBlock, concreteBlockMembers, concreteBlockRows } from '../../src/bbs/csv.js';

// Three members: a beam (its box, 1.44 m³), a tetrahedron inside a 1 m³ box (its exact mesh, 1/6 m³, is what the file writes) and a slab
// whose name has a comma (the CSV quotes it).
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

// The concrete block: from its heading to the end of the file.
const blockOf = (csv) => csv.slice(csv.indexOf('Concrete volumes\n'));

test('the tetrahedron is a sixth of its box, so the exact mesh is the volume the file uses for it', () => {
  assert.ok(Math.abs(MESH_M3 - 1 / 6) < 1e-12);
  const rows = concreteBlockRows(CONCRETES, null, null);
  assert.deepEqual(rows.map((r) => [r.name, r.source]), [['Beam B1', 'box'], ['Tetra, mesh', 'mesh'], ['Slab S1', 'box']]);
  assert.equal(rows[0].volumeM3, 1.44);
  assert.equal(rows[1].volumeM3, MESH_M3);
  assert.equal(rows[2].volumeM3, 0.8);
});

test('a volume typed for this export replaces the computed one for that member only, and the Source says so', () => {
  const rows = concreteBlockRows(CONCRETES, null, new Map([['b1', 2]]));
  assert.deepEqual(rows.map((r) => [r.volumeM3, r.source]), [[2, 'typed'], [MESH_M3, 'mesh'], [0.8, 'box']]);
  assert.equal(rows[0].computedM3, 1.44, 'the computed volume is still there beside it');
  assert.equal(rows[0].computedSource, 'box', 'and where the computed volume came from');
});

test('a typed value that is not above zero is ignored: the computed volume is written', () => {
  const rows = concreteBlockRows(CONCRETES, null, new Map([['b1', 0], ['c3', -4]]));
  assert.deepEqual(rows.map((r) => r.source), ['box', 'mesh', 'box']);
  assert.deepEqual(rows.map((r) => r.volumeM3), [1.44, MESH_M3, 0.8]);
});

test('the total and the rebar ratio are those of the volumes written', () => {
  const block = concreteBlock(CONCRETES, null, new Map([['b1', 2]]), 300);
  assert.equal(block.totalM3, 2 + MESH_M3 + 0.8);
  assert.equal(block.ratio, 300 / (2 + MESH_M3 + 0.8));
});

test('with no concrete in the file the total is 0 and the ratio is null (written as n/a)', () => {
  assert.deepEqual(concreteBlock([], null, null, 100), { members: [], totalM3: 0, ratio: null });
});

test('the members of a file are the ones in its scope, in the order of the concretes', () => {
  assert.deepEqual(concreteBlockMembers(CONCRETES, null).map((c) => c.id), ['b1', 'm1', 'c3']);
  assert.deepEqual(concreteBlockMembers(CONCRETES, ['c3', 'b1']).map((c) => c.id), ['b1', 'c3']);
  assert.deepEqual(concreteBlockMembers(CONCRETES, []), []);
});

test("the steel total the block divides by is the schedule's own total", () => {
  const { lines, steelKg } = bbsSchedule(BARS, CONCRETES);
  assert.equal(lines.find((l) => l.startsWith('Total,')).split(',')[2], steelKg.toFixed(2));
});

test('the CSV block: heading, columns, a typed volume, and the total and ratio that follow from it', () => {
  const { steelKg } = bbsSchedule(BARS, CONCRETES);
  const csv = toBbsBenchmarkCsv(BARS, CONCRETES, { volumesM3: new Map([['b1', 2]]) });
  const lines = blockOf(csv).split('\n');
  const total = 2 + MESH_M3 + 0.8;
  assert.deepEqual(lines, [
    'Concrete volumes',
    'Member,Volume (m3),Source',
    'Beam B1,2.000,typed',
    `"Tetra, mesh",${MESH_M3.toFixed(3)},mesh`,
    'Slab S1,0.800,box',
    `Total concrete (m3),${total.toFixed(3)}`,
    `Total steel (kg),${steelKg.toFixed(2)}`,
    `Rebar ratio (kg/m3),${(steelKg / total).toFixed(2)}`,
  ]);
});

test('without typed values the block writes the computed volumes', () => {
  const lines = blockOf(toBbsBenchmarkCsv(BARS, CONCRETES, {})).split('\n');
  assert.deepEqual(lines.slice(2, 5), ['Beam B1,1.440,box', `"Tetra, mesh",${MESH_M3.toFixed(3)},mesh`, 'Slab S1,0.800,box']);
});

test('a scoped export writes only the members in its scope, with their own total and ratio', () => {
  const csv = toBbsBenchmarkCsv(BARS, CONCRETES, { memberIds: ['c3'] });
  const lines = blockOf(csv).split('\n');
  const { steelKg } = bbsSchedule(BARS, CONCRETES);
  assert.deepEqual(lines, [
    'Concrete volumes',
    'Member,Volume (m3),Source',
    'Slab S1,0.800,box',
    'Total concrete (m3),0.800',
    `Total steel (kg),${steelKg.toFixed(2)}`,
    `Rebar ratio (kg/m3),${(steelKg / 0.8).toFixed(2)}`,
  ]);
});

test("a file with no member in scope (a ▦ group's own bars) still ends with the block, its ratio n/a", () => {
  const { steelKg } = bbsSchedule(BARS, CONCRETES);
  const lines = blockOf(toBbsBenchmarkCsv(BARS, CONCRETES, { memberIds: [] })).split('\n');
  assert.deepEqual(lines, [
    'Concrete volumes',
    'Member,Volume (m3),Source',
    'Total concrete (m3),0.000',
    `Total steel (kg),${steelKg.toFixed(2)}`,
    'Rebar ratio (kg/m3),n/a',
  ]);
});
