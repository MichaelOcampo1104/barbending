// The column CSV: its header and cells read as the card reads them, and the levels it gives are the card's own levels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { columnFormFromCsv, parseColumnCsv } from '../../src/bbs/columnCsv.js';
import { cardInputsOf, memberGroups } from '../../src/bbs/memberReinforcement.js';

// The Sub column as entered on the card (inputs/Sub_card_levels.csv): a 3200 x 800 base of 44H40 long and 8H32 short bars, then a 2400 x 800
// section of 40H25 from B1 up, with an 800 mm slab under each of B1, B2 and B3.
const SUB_CSV = [
  'Level,SFL (m),SIZE,MAIN BARS layout,MAIN BARS,MAIN BARS long face,MAIN BARS short face,Outer link,Cross links X,Cross links Y,Slab thk (mm),Longest crank (mm),Lap (good bond),Crank step,Jog',
  'B1,-5.970,2400 x 800,one size on every face,40H25,same,same,H10-100,2H10-100,4H10-100,800,,,,',
  'B2,-12.270,same,same as below,same,same,same,same,same,same,800,,,,',
  'B3 platform,-18.570,same,same as below,same,same,same,same,same,same,800,,,,',
  'Base,-20.870,3200 x 800,long and short faces,44H40,44H40,8H32,H10-125,2H10-125,6H10-125,,,,,',
].join('\n');

// The same levels as the card's form holds them, cell by cell: "same" is a cell that takes the level below.
const SUB_FORM = [
  { name: 'B1', sfl: '-5.970', size: '2400 x 800', layout: 'all', bars: '40H25', barsLong: 'same', barsShort: 'same', linksOuter: 'H10-100', linksX: '2H10-100', linksY: '4H10-100', slab: '800', crankMax: '', lap: '', step: '', jog: '' },
  { name: 'B2', sfl: '-12.270', size: 'same', layout: 'same', bars: 'same', barsLong: 'same', barsShort: 'same', linksOuter: 'same', linksX: 'same', linksY: 'same', slab: '800', crankMax: '', lap: '', step: '', jog: '' },
  { name: 'B3 platform', sfl: '-18.570', size: 'same', layout: 'same', bars: 'same', barsLong: 'same', barsShort: 'same', linksOuter: 'same', linksX: 'same', linksY: 'same', slab: '800', crankMax: '', lap: '', step: '', jog: '' },
  { name: 'Base', sfl: '-20.870', size: '3200 x 800', layout: 'faces', bars: '44H40', barsLong: '44H40', barsShort: '8H32', linksOuter: 'H10-125', linksX: '2H10-125', linksY: '6H10-125', slab: '', crankMax: '', lap: '', step: '', jog: '' },
];
const SUB = { id: 'c1', name: 'Sub', kind: 'SLAB', lx: 3200, ly: 800, lz: 23000, x: 13256.9, y: 48453.2, z: -20870, covB: 50, covT: 40 };

test('the Sub schedule reads from its CSV as the card holds it', () => {
  const parsed = parseColumnCsv(SUB_CSV);
  assert.equal(parsed.ok, true, parsed.msg);
  assert.deepEqual(parsed.schedule, SUB_FORM);
});

test('a byte-order mark at the top of the file is ignored', () => {
  assert.deepEqual(parseColumnCsv(`﻿${SUB_CSV}`).schedule, SUB_FORM);
});

test('the CSV generates the card\'s sets for the column', () => {
  const built = columnFormFromCsv(SUB_CSV, { layout: 'all', cover: 40 });
  assert.equal(built.ok, true, built.msg);
  const plan = memberGroups(SUB, cardInputsOf(built.form, 40, 'good'), { neighbours: [SUB] });
  assert.equal(plan.ok, true, plan.msg);
  assert.deepEqual(plan.groups.map((g) => g.name).sort(), ['Sub links', 'Sub mains', 'Sub starters']);
});

test('quoted cells keep their commas, and blank cells stay blank', () => {
  const parsed = parseColumnCsv('Level,SFL (m),SIZE,MAIN BARS,Outer link\n"Base, lower",0,2500 x 1000,44H25,H10-100');
  assert.equal(parsed.ok, true, parsed.msg);
  assert.equal(parsed.schedule[0].name, 'Base, lower');
  assert.equal(parsed.schedule[0].slab, '');
});

test('"= below" reads as the card\'s "same"', () => {
  const parsed = parseColumnCsv('Level,SFL (m),SIZE,MAIN BARS,Outer link\nBase,0,2500 x 1000,44H25,H10-100\nB1,3,= below,= below,= below');
  assert.equal(parsed.ok, true, parsed.msg);
  assert.deepEqual([parsed.schedule[1].size, parsed.schedule[1].bars, parsed.schedule[1].linksOuter], ['same', 'same', 'same']);
});

test('a CSV that does not match the card is refused with the reason', () => {
  const head = 'Level,SFL (m),SIZE,MAIN BARS,Outer link';
  assert.match(parseColumnCsv('Level,SFL (m),MAIN BARS,Outer link\nBase,0,44H25,H10-100').msg, /needs "SIZE"/);
  assert.match(parseColumnCsv(`${head},Notes\nBase,0,2500 x 1000,44H25,H10-100,x`).msg, /Unknown column "Notes"/);
  assert.match(parseColumnCsv(`${head}\nBase,abc,2500 x 1000,44H25,H10-100`).msg, /is not a number/);
  assert.match(parseColumnCsv('Level,SFL (m),SIZE,MAIN BARS layout,MAIN BARS,Outer link\nBase,0,2500 x 1000,two faces,44H25,H10-100').msg, /is not a MAIN BARS layout/);
  assert.match(parseColumnCsv(head).msg, /no levels/);
});

test('an SFL in millimetres is refused by the card\'s own rule', () => {
  const built = columnFormFromCsv('Level,SFL (m),SIZE,MAIN BARS,Outer link\nB1,-20870,same,same,same\nBase,0,3200 x 800,44H40,H10-125', { cover: 40 });
  assert.equal(built.ok, true, built.msg);
  const plan = memberGroups(SUB, cardInputsOf(built.form, 40, 'good'), { neighbours: [SUB] });
  assert.equal(plan.ok, false);
  assert.match(plan.msg, /over 1000 m/);
});
