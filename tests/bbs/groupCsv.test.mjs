import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultBar } from '../../src/bbs/shapes.js';
import { toCsv, parseCsv } from '../../src/bbs/csv.js';
import { renameGroupRows } from '../../src/bbs/groups.js';

// A renamed group is saved in the setId column of the CSV, so a name with a comma, quotes or a slash must come back unchanged.
const NAMES = ['Stair A, flight "2" / top mat', 'Roof ties', 'S12', 'Ø16 corner, bottom'];

test('the CSV keeps a renamed group name whatever it contains', () => {
  for (const name of NAMES) {
    const bars = [defaultBar('straight', 1), defaultBar('straight', 2), defaultBar('straight', 3)].map((b) => ({ ...b, setId: 'S1' }));
    bars[2] = { ...bars[2], setId: 'S2' };
    const renamed = renameGroupRows(bars, 'S1', name);
    assert.equal(renamed.ok, true, name);
    const back = parseCsv(toCsv(renamed.bars), [], []);
    assert.equal(back.length, 3, `${name}: three rows come back`);
    assert.deepEqual(back.map((b) => b.setId), [name, name, 'S2'], name);
  }
});

test('bars in no group are still in no group after the CSV (the importer reads an empty setId column as an empty string, which means no group)', () => {
  const bars = [defaultBar('straight', 1), defaultBar('straight', 2)];
  const back = parseCsv(toCsv(bars), [], []);
  assert.deepEqual(back.map((b) => Boolean(b.setId)), [false, false]);
  const joined = renameGroupRows([{ ...bars[0], setId: 'S1' }, { ...bars[1], setId: 'S1' }, ...back], 'S1', 'Roof');
  assert.equal(joined.count, 2, 'the empty-string bars are not counted as a group');
});
