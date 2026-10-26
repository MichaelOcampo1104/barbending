import test from 'node:test';
import assert from 'node:assert/strict';
import { useStore } from '../../src/store.js';
import { hasSections, sectionsOfRows, sectionVolumeM3 } from '../../src/bbs/columnSections.js';
import { concreteVolumeM3, concreteVolumeSource } from '../../src/bbs/csv.js';

// The volume of a stepped column comes from its schedule (spec 11): the rows of the C4 schedule as resolveSchedule gives them (bottom first),
// a 3200 x 800 base up to the B1 level at 14900 mm, then 2400 x 800 up to the top.
const near = (a, b, tol = 0.0005) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const ROWS = [
  { h: 0, size: { lx: 3200, ly: 800 } },
  { h: 2300, size: { lx: 3200, ly: 800 } },
  { h: 8600, size: { lx: 3200, ly: 800 } },
  { h: 14900, size: { lx: 2400, ly: 800 } },
];
const COLUMN = { id: 'c4', name: 'C4', kind: 'COLUMN', lx: 3200, ly: 800, lz: 23000, x: 0, y: 0, z: 0, covB: 40, covT: 40, slope: 0 };

test('the sections of a schedule: a new section where the SIZE changes, and the levels of one size stay in the section below', () => {
  assert.deepEqual(sectionsOfRows(ROWS), [{ from: 0, lx: 3200, ly: 800 }, { from: 14900, lx: 2400, ly: 800 }]);
});

test('the volume from the schedule of a column 23000 mm high: 53.696 m³, where its box would be 58.880 m³', () => {
  const sections = sectionsOfRows(ROWS);
  near(sectionVolumeM3(sections, 23000), 53.696);
  near(3200 * 800 * 23000 / 1e9, 58.88);
});

test('the volume of the C4 drawing with B1 at 15080 mm and Hz 20900 mm: 49.779 m³', () => {
  const rows = ROWS.map((r) => (r.h === 14900 ? { ...r, h: 15080 } : r));
  near(sectionVolumeM3(sectionsOfRows(rows), 20900), 49.779);
});

test('a column of one size has no sections to use, so its volume stays the box', () => {
  assert.equal(hasSections({ sections: [{ from: 0, lx: 3200, ly: 800 }] }), false);
  assert.equal(hasSections({ sections: null }), false);
  assert.equal(hasSections({}), false);
});

test('a stepped column takes its volume and its source from the schedule; a column without sections keeps its box', () => {
  const stepped = { ...COLUMN, sections: sectionsOfRows(ROWS) };
  near(concreteVolumeM3(stepped), 53.696);
  assert.equal(concreteVolumeSource(stepped), 'schedule');
  near(concreteVolumeM3(COLUMN), 58.88);
  assert.equal(concreteVolumeSource(COLUMN), 'box');
});

test('generating the sets of a stepped column stores its sections on it in one undo step, and undo puts the box back', () => {
  useStore.setState({ concretes: [COLUMN], bars: [], past: [], future: [], selectedConcrete: 'c4' });
  const before = useStore.getState().past.length;
  const groups = [{ name: 'C4 mains', rows: [{ Bar_mark: 'V1-1', Rebar_Type: 'straight', Dia: 25, Plane: 'XZ', Pos_Rotation: 90, Pos_x: 0, Pos_y: 0, Pos_z: 0, 'Length of Bar': 1000, bond_condition: 'good' }] }];
  const sections = sectionsOfRows(ROWS);
  const r = useStore.getState().addMemberRows(groups, { hostId: 'c4', sections });
  assert.equal(r.ok, true, r.msg);
  assert.equal(useStore.getState().past.length, before + 1);
  assert.deepEqual(useStore.getState().concretes[0].sections, sections);
  near(concreteVolumeM3(useStore.getState().concretes[0]), 53.696);
  useStore.getState().undo();
  assert.equal(hasSections(useStore.getState().concretes[0]), false);
  assert.equal(useStore.getState().bars.length, 0);
});

test('generating sets without a host leaves the columns alone', () => {
  useStore.setState({ concretes: [COLUMN], bars: [], past: [], future: [], selectedConcrete: 'c4' });
  const groups = [{ name: 'C4 links', rows: [{ Bar_mark: 'T1', Rebar_Type: 'profile', Dia: 10, Plane: 'XY', Pos_Rotation: 0, Pos_x: 0, Pos_y: 0, Pos_z: 0 }] }];
  const r = useStore.getState().addMemberRows(groups);
  assert.equal(r.ok, true, r.msg);
  assert.equal(useStore.getState().concretes[0].sections, undefined);
  assert.equal(concreteVolumeSource(useStore.getState().concretes[0]), 'box');
});
