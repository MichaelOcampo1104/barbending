import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCardInputs, linksNotation, memberGroups, parseLinks, resolveSchedule } from '../../src/bbs/memberReinforcement.js';

// Column 1: 2500 x 1000 x 4500, cover 40, entered through the card's link cells.
const COLUMN1 = { id: 'c4', name: 'C1', kind: 'COLUMN', lx: 2500, ly: 1000, lz: 4500, x: 0, y: 0, z: 0, covB: 40, covT: 40 };
const cells = (over = {}) => ({
  name: 'Base', sfl: 0, size: '2500 x 1000', barsLong: '44H40', barsShort: '8H32',
  linksOuter: 'H10-100', linksX: '2H10-150', linksY: '6H10-150', lap: null, step: null, jog: null, ...over,
});
const level = (over = {}) => ({
  name: 'Level 2', sfl: 2.5, size: 'same', barsLong: 'same', barsShort: 'same',
  linksOuter: 'same', linksX: 'same', linksY: 'same', lap: null, step: null, jog: null, ...over,
});
// The card gives each row its notation from the cells, as inputsOf does.
const withLinks = (rows) => {
  const notes = linksNotation(rows);
  return rows.map((r, i) => ({ ...r, links: notes[i] }));
};

test('the three link cells read as the outer link, then the cross links along X and along Y', () => {
  const [note] = linksNotation([cells()]);
  assert.equal(note, 'H10-100 + 2H10-150 X + 6H10-150 Y');
  assert.deepEqual(parseLinks(note).cross, [
    { count: 2, dia: 10, spacing: 150, dir: 'X' },
    { count: 6, dia: 10, spacing: 150, dir: 'Y' },
  ]);
});

test('a blank cross-link cell means none, so the outer link alone is the whole notation', () => {
  assert.deepEqual(linksNotation([cells({ linksX: '', linksY: '   ' })]), ['H10-100']);
});

test('same as below takes each cell from the level under it, one cell at a time', () => {
  const rows = [
    level({ linksX: '4H10-100' }),
    cells({ linksOuter: 'H10-150' }),
  ];
  assert.deepEqual(linksNotation(rows), ['H10-150 + 4H10-100 X + 6H10-150 Y', 'H10-150 + 2H10-150 X + 6H10-150 Y']);
});

test('the bottom level cannot copy, so its "same" is refused with the bottom-row message', () => {
  const rows = [level({ name: 'B3' }), cells({ linksOuter: 'same' })];
  const res = resolveSchedule(withLinks(rows).map((r) => ({ ...r, bars: '44H25' })), { lx: 2500, ly: 1000, layout: 'all' });
  assert.equal(res.ok, false);
  assert.match(res.msg, /The bottom row needs its own LINKS/);
});

test('column 1 entered through the link cells gives the same 165 rows as the notation', () => {
  const rows = withLinks([cells()]);
  const inp = {
    ...defaultCardInputs(40), kind: 'Column', cover: 40,
    column: { layout: 'faces', lap: null, schedule: rows },
    starters: { base: true, top: true, dia: null, lap: null, anchorage: null, bend: null },
  };
  const res = memberGroups(COLUMN1, inp, { neighbours: [] });
  assert.equal(res.ok, true, res.msg);
  assert.equal(res.groups.reduce((s, g) => s + g.rows.length, 0), 165);
  const links = res.groups.find((g) => g.name === 'C1 links').rows;
  assert.equal(links.length, 9); // one outer link set, 2 cross links along X and 6 along Y
});
