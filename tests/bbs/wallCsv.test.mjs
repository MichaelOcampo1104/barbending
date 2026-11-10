// The wall CSV: one row per wall, written as a wall schedule writes it. A row builds the card's own form, so the card's rows come back unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWallCsv, wallMembers, wallsFromCsv } from '../../src/bbs/wallCsv.js';
import { cardInputsOf, defaultCardInputs, memberGroups } from '../../src/bbs/memberReinforcement.js';

const HEAD = 'Wall,Thickness (mm),Length (mm),Height (mm),SFL (m),X (mm),Y (mm),Main bars,Distribution bars,Links,Link leg A (mm),Base,Top,Starter bars,Starter lap (mm),Starter anchorage (mm),Starter bend leg (mm),Dowel bars,Dowel length (mm),Dowel projection (mm),Second starter bars,Second starter face,Second starter leg (mm),Second starter foot (mm),Second starter projection (mm),Second starter first level (mm)';
// The wall sample (inputs/wall_sample_auto_bbs.json): 5000 x 200 x 3000, H16 mains at 150, H13 distribution at 150, H13 links at 150 by 300, H13 starters.
const SAMPLE = 'W1,200,5000,3000,,,,H16-150,H13-150,H13-150 x 300,,starters,starters,H13,,,,,,';
const csv = (...rows) => [HEAD, ...rows].join('\n');
const names = (res) => res.groups.map((g) => g.name);
const group = (res, name) => res.groups.find((g) => g.name === name);

const SAMPLE_WALL = { id: 'c1', name: 'W1', kind: 'WALL', lx: 5000, ly: 200, lz: 3000, x: 0, y: 0, z: 0, covB: 40, covT: 40 };
const SAMPLE_INPUTS = () => ({
  ...defaultCardInputs(40),
  kind: 'Wall',
  wall: { mainDia: 16, mainSpacing: 150, distDia: 13, distSpacing: 150, linkDia: 13, linkSpacing: 150, linkVSpacing: 300, legA: 130 },
  starters: { base: true, top: true, dia: 13, lap: null, anchorage: null, bend: null },
});
// What a row of the CSV generates: its card form, read as the card reads it, on the member the row describes.
const generate = (text, member = SAMPLE_WALL, opts = { neighbours: [] }) => {
  const built = wallsFromCsv(text, { cover: 40 });
  assert.equal(built.ok, true, built.msg);
  return memberGroups(member, cardInputsOf(built.walls[0].form, 40, 'good'), opts);
};

test('the wall sample as a CSV row gives the card\'s own rows: 204 of them', () => {
  const res = generate(csv(SAMPLE));
  assert.equal(res.ok, true, res.msg);
  assert.deepEqual(names(res), ['W1 mains', 'W1 distribution', 'W1 links', 'W1 starters']);
  assert.equal(res.groups.flatMap((g) => g.rows).length, 204);
  assert.deepEqual(res.groups, memberGroups(SAMPLE_WALL, SAMPLE_INPUTS(), { neighbours: [] }).groups);
});

test('a row gives the wall its size, level and position, with blanks left for the command to decide', () => {
  const built = wallsFromCsv(csv(SAMPLE, 'W2,250,6000,3200,3.5,1000,2000,H16-150,H13-150,H13-150 x 300,,,,,,,,,,'), { cover: 40 });
  assert.equal(built.ok, true, built.msg);
  const [a, b] = built.walls;
  assert.deepEqual([a.name, a.lx, a.ly, a.lz, a.sfl, a.x, a.y], ['W1', 5000, 200, 3000, null, null, null]);
  assert.deepEqual([b.name, b.lx, b.ly, b.lz, b.sfl, b.x, b.y], ['W2', 6000, 250, 3200, 3.5, 1000, 2000]);
});

test('the link leg A and the starter numbers are the card\'s fields', () => {
  const built = wallsFromCsv(csv('W1,200,5000,3000,,,,H16-150,H13-150,H13-150 x 300,200,starters,none,H13,700,900,180,,,'), { cover: 40 });
  assert.equal(built.ok, true, built.msg);
  const inp = cardInputsOf(built.walls[0].form, 40, 'good');
  assert.equal(inp.wall.legA, 200);
  assert.deepEqual([inp.starters.dia, inp.starters.lap, inp.starters.anchorage, inp.starters.bend], [13, 700, 900, 180]);
  assert.deepEqual([inp.starters.base, inp.starters.top], [true, false]);
  const res = memberGroups(SAMPLE_WALL, inp, { neighbours: [] });
  assert.equal(group(res, 'W1 links').rows[0].c_length_a, 200);
  assert.ok(group(res, 'W1 starters').rows.every((r) => r.Bar_mark.startsWith('ST1-') && r.Dia === 13));
});

test('a blank Base or Top is starters, as the card has it, and "none" leaves the end bare', () => {
  const none = generate(csv('W1,200,5000,3000,,,,H16-150,H13-150,H13-150 x 300,,none,none,,,,,,,'));
  assert.equal(group(none, 'W1 starters'), undefined);
  assert.equal(group(none, 'W1 dowels'), undefined);
  assert.equal(none.groups.flatMap((g) => g.rows).length, 70);
  const blank = generate(csv('W1,200,5000,3000,,,,H16-150,H13-150,H13-150 x 300,,,,H13,,,,,,'));
  assert.equal(group(blank, 'W1 starters').rows.length, 134);
});

test('a top dowel: starters at the base, five H16 dowels at 1000 c/c at the top, 600 long and 300 out', () => {
  const res = generate(csv('W1,200,5000,3000,,,,H16-150,H13-150,H13-150 x 300,,starters,dowels,H13,,,,H16-1000 c/c,600,'));
  assert.equal(res.ok, true, res.msg);
  assert.deepEqual(names(res), ['W1 mains', 'W1 distribution', 'W1 links', 'W1 starters', 'W1 dowels']);
  assert.equal(group(res, 'W1 starters').rows.length, 67);
  const d = group(res, 'W1 dowels').rows;
  assert.equal(d.length, 1);
  assert.deepEqual([d[0].Bar_mark, d[0].Dia, d[0]['Length of Bar'], d[0].qty_x, d[0].spacing_x, d[0].Pos_x, d[0].Pos_z], ['WD2', 16, 600, 5, 1000, 500, 2700]);
});

test('dowels at both ends, with the projection typed', () => {
  const res = generate(csv('W1,200,5000,3000,,,,H16-150,H13-150,H13-150 x 300,,dowels,dowels,,,,,H16-1000,500,250'));
  assert.equal(res.ok, true, res.msg);
  assert.equal(group(res, 'W1 starters'), undefined);
  const [base, top] = group(res, 'W1 dowels').rows;
  assert.deepEqual([base.Bar_mark, base.Pos_z, base['Length of Bar']], ['WD1', -250, 500]);
  assert.deepEqual([top.Bar_mark, top.Pos_z], ['WD2', 3000 - 250]);
  assert.deepEqual(res.dowels, { dia: 16, spacing: 1000, length: 500, out: 250, embed: 250, count: 5, first: 500, last: 4500, ends: ['base', 'top'] });
});

test('cells read as a schedule writes them: any case, spaces, a bare Ø, "c/c", singular words', () => {
  const built = wallsFromCsv(csv('W1,200,5000,3000,,,,h16 - 150,H13- 150,h13-150 X 300,,Starter,Dowel,13,,,,h16-1000 C/C,600,'), { cover: 40 });
  assert.equal(built.ok, true, built.msg);
  const inp = cardInputsOf(built.walls[0].form, 40, 'good');
  assert.deepEqual([inp.wall.mainDia, inp.wall.mainSpacing, inp.wall.distDia, inp.wall.distSpacing], [16, 150, 13, 150]);
  assert.deepEqual([inp.wall.linkDia, inp.wall.linkSpacing, inp.wall.linkVSpacing], [13, 150, 300]);
  assert.deepEqual([inp.starters.dia, inp.starters.dowelDia, inp.starters.dowelSpacing, inp.starters.dowelLength], [13, 16, 1000, 600]);
  assert.deepEqual([inp.starters.base, inp.starters.dowelTop], [true, true]);
});

test('a byte-order mark and quoted cells are read', () => {
  const text = `﻿${csv('"W1, north",200,5000,3000,,,,H16-150,H13-150,H13-150 x 300,,,,H13,,,,,,')}`;
  const built = wallsFromCsv(text, { cover: 40 });
  assert.equal(built.ok, true, built.msg);
  assert.equal(built.walls[0].name, 'W1, north');
});

test('a header that does not match the wall schedule is refused with the reason', () => {
  assert.match(parseWallCsv(csv(SAMPLE).replace('Main bars,', '')).msg, /needs "Main bars"/);
  assert.match(parseWallCsv(csv(SAMPLE).replace('Wall,', 'Wall,Notes,')).msg, /Unknown column "Notes"/);
  assert.match(parseWallCsv(`${HEAD},Length (mm)\n${SAMPLE},5000`).msg, /"Length \(mm\)" is in the header twice/);
  assert.match(parseWallCsv(HEAD).msg, /no walls/);
});

test('a cell that is not written as the schedule writes it is refused, and the message names the wall and the cell', () => {
  const row = (cell, value) => {
    const cols = HEAD.split(',');
    const line = SAMPLE.split(',');
    line[cols.indexOf(cell)] = value;
    return csv(line.join(','));
  };
  assert.match(wallsFromCsv(row('Main bars', 'H16')).msg, /W1.*Main bars.*H16-150/);
  assert.match(wallsFromCsv(row('Distribution bars', '16 at 150')).msg, /W1.*Distribution bars/);
  assert.match(wallsFromCsv(row('Links', 'H13-150')).msg, /W1.*Links.*H13-150 x 300/);
  assert.match(wallsFromCsv(row('Starter bars', 'H13-150')).msg, /W1.*Starter bars.*H13/);
  assert.match(wallsFromCsv(row('Top', 'sliding')).msg, /W1.*Top.*starters, dowels or none/);
  assert.match(wallsFromCsv(row('Length (mm)', 'five metres')).msg, /W1.*Length \(mm\).*not a number/);
  assert.match(wallsFromCsv(row('Dowel bars', 'H16')).msg, /W1.*Dowel bars.*H16-1000/);
});

test('an end set to dowels needs the dowel Ø, spacing and length, and dowel cells with no dowel end are refused', () => {
  const ends = 'W1,200,5000,3000,,,,H16-150,H13-150,H13-150 x 300,,starters,dowels,H13,,,,';
  assert.match(wallsFromCsv(csv(`${ends},,600,`)).msg, /W1.*Top.*Dowel bars/);
  assert.match(wallsFromCsv(csv(`${ends}H16-1000,,`)).msg, /W1.*Top.*Dowel length/);
  const stray = 'W1,200,5000,3000,,,,H16-150,H13-150,H13-150 x 300,,starters,starters,H13,,,,H16-1000,600,';
  assert.match(wallsFromCsv(csv(stray)).msg, /W1.*dowel.*neither Base nor Top/);
});

test('a wall needs a name, and two walls cannot share one', () => {
  assert.match(wallsFromCsv(csv(SAMPLE.replace('W1', ''))).msg, /Row 1 has no name.*"Wall"/);
  assert.match(wallsFromCsv(csv(SAMPLE, SAMPLE)).msg, /"W1" is on two rows/);
});

test('new walls are placed from their rows, and a blank Y stacks the next wall behind the one before', () => {
  const built = wallsFromCsv(csv(SAMPLE, 'W2,250,6000,3200,3.5,,,H16-150,H13-150,H13-150 x 300,,,,H13,,,,,,', 'W3,300,4000,2800,,100,7000,H16-150,H13-150,H13-150 x 300,,,,H13,,,,,,'), { cover: 40 });
  assert.equal(built.ok, true, built.msg);
  const res = wallMembers(built.walls, { concretes: [], cover: 40 });
  assert.equal(res.ok, true, res.msg);
  assert.deepEqual(res.members.map((m) => [m.member.name, m.member.x, m.member.y, m.member.z, m.member.lx, m.member.ly, m.member.lz, m.isNew]), [
    ['W1', 0, 0, 0, 5000, 200, 3000, true],
    ['W2', 0, 1200, 3500, 6000, 250, 3200, true],     // 1000 mm behind W1 (0 + 200 + 1000), on a base at SFL 3.5 m
    ['W3', 100, 7000, 0, 4000, 300, 2800, true],      // its own X and Y
  ]);
  assert.ok(res.members.every((m) => m.member.kind === 'WALL' && m.member.covB === 40 && m.member.covT === 40));
  assert.deepEqual(res.members.map((m) => m.member.id), ['c1', 'c2', 'c3']);
  assert.deepEqual(res.concretes.map((c) => c.name), ['W1', 'W2', 'W3']);
});

test('a new wall needs its length, thickness and height', () => {
  const built = wallsFromCsv(csv('W1,,5000,3000,,,,H16-150,H13-150,H13-150 x 300,,,,H13,,,,,,'), { cover: 40 });
  assert.equal(built.ok, true, built.msg);
  const res = wallMembers(built.walls, { concretes: [], cover: 40 });
  assert.equal(res.ok, false);
  assert.match(res.msg, /W1.*Thickness/);
});

test('a wall that is in the project is that member: its size stays unless the row gives one', () => {
  const project = [
    { id: 'c7', name: 'W1', kind: 'WALL', lx: 5000, ly: 200, lz: 3000, x: 2000, y: 2000, z: 500, covB: 40, covT: 40, slope: 0 },
    { id: 'c8', name: 'Slab above', kind: 'SLAB', lx: 6000, ly: 1000, lz: 200, x: 1500, y: 1700, z: 3500, covB: 40, covT: 40, slope: 0 },
  ];
  const built = wallsFromCsv(csv('W1,,,3200,,,,H16-150,H13-150,H13-150 x 300,,,,H13,,,,,,', 'W2,200,4000,3000,,,,H16-150,H13-150,H13-150 x 300,,,,H13,,,,,,'), { cover: 40 });
  assert.equal(built.ok, true, built.msg);
  const res = wallMembers(built.walls, { concretes: project, cover: 40 });
  assert.equal(res.ok, true, res.msg);
  const [w1, w2] = res.members;
  assert.equal(w1.isNew, false);
  assert.deepEqual([w1.member.id, w1.member.lx, w1.member.ly, w1.member.lz, w1.member.x, w1.member.y, w1.member.z], ['c7', 5000, 200, 3200, 2000, 2000, 500]);
  assert.equal(w2.isNew, true);
  assert.equal(w2.member.id, 'c1');   // the first id the project does not use
  assert.deepEqual(res.concretes.map((c) => c.id), ['c7', 'c8', 'c1']);
  assert.equal(res.concretes[0].lz, 3200);
});

// ---- a wall with no links ----

test('a wall with no links: Links blank or none, and Link leg A left out', () => {
  const blank = generate(csv('W1,200,5000,3000,,,,H16-150,H13-150,,,starters,starters,H13,,,,,,'));
  assert.equal(blank.ok, true, blank.msg);
  assert.deepEqual(names(blank), ['W1 mains', 'W1 distribution', 'W1 starters']);
  assert.equal(blank.groups.flatMap((g) => g.rows).length, 203);
  const none = generate(csv('W1,200,5000,3000,,,,H16-150,H13-150,none,,starters,starters,H13,,,,,,'));
  assert.deepEqual(names(none), ['W1 mains', 'W1 distribution', 'W1 starters']);
  const no = generate(csv('W1,200,5000,3000,,,,H16-150,H13-150, No ,,starters,starters,H13,,,,,,'));
  assert.deepEqual(names(no), ['W1 mains', 'W1 distribution', 'W1 starters']);
});

test('the Links column may be left out of the file altogether', () => {
  const head = HEAD.replace('Links,', '').replace('Link leg A (mm),', '');
  const built = wallsFromCsv([head, 'W1,200,5000,3000,,,,H16-150,H13-150,starters,starters,H13'].join('\n'), { cover: 40 });
  assert.equal(built.ok, true, built.msg);
  const res = memberGroups(SAMPLE_WALL, cardInputsOf(built.walls[0].form, 40, 'good'), { neighbours: [] });
  assert.deepEqual(names(res), ['W1 mains', 'W1 distribution', 'W1 starters']);
});

test('a wall with links still has them, and the other bars are the same without them', () => {
  const withLinks = generate(csv(SAMPLE));
  const without = generate(csv('W1,200,5000,3000,,,,H16-150,H13-150,,,starters,starters,H13,,,,,,'));
  assert.equal(group(withLinks, 'W1 links').rows.length, 1);
  for (const name of ['W1 mains', 'W1 distribution', 'W1 starters']) assert.deepEqual(group(without, name).rows, group(withLinks, name).rows, name);
});

test('a link leg A with no links is refused, and so is a Links cell that is not the schedule\'s notation', () => {
  assert.match(wallsFromCsv(csv('W1,200,5000,3000,,,,H16-150,H13-150,,130,,,,,,,,,')).msg, /W1.*link leg A, but no Links/);
  assert.match(wallsFromCsv(csv('W1,200,5000,3000,,,,H16-150,H13-150,H13-150,,,,,,,,,,')).msg, /W1.*Links.*H13-150 x 300.*blank/);
});

// ---- second starters: the PB1 H13 of the r1 drawing ----

// inputs/wall_sample_starter_array_r1.dxf as a row: 313.7 thick, H13 links at 300 by 300 with leg A 100, H13 starters, and its PB1 H13 L bars
// (150 along the wall, 300 up it, a 301 leg, a 49.7 foot, the bend 86.7 out of the north face, the first level 233.8).
const R1 = 'W1,313.7,5000,3000,,,,H16-150,H13-150,H13-300 x 300,100,starters,starters,H13,,,,,,,H13-150 x 300,north,301,49.7,86.7,233.8';
const R1_WALL = { ...SAMPLE_WALL, ly: 313.7 };

test('the r1 drawing\'s wall as one row gives its PB1 H13 as second starters, where the drawing has them', () => {
  const res = generate(csv(R1), R1_WALL);
  assert.equal(res.ok, true, res.msg);
  assert.deepEqual(names(res), ['W1 mains', 'W1 distribution', 'W1 links', 'W1 starters', 'W1 second starters']);
  const r = group(res, 'W1 second starters').rows[0];
  assert.deepEqual([r.Bar_mark, r.Rebar_Type, r.Dia, r.Plane, r.Pos_Rotation], ['WS1', 'profile', 13, 'XY', 0]);
  assert.deepEqual(JSON.parse(r.legs), [[49.7, 0], [301, 270]]);
  assert.deepEqual([r.Pos_y, r.Pos_z, r.qty_x, r.spacing_x, r.qty_z, r.spacing_z], [400.4, 233.8, 33, 150, 10, 300]);
  assert.equal(group(res, 'W1 links').rows[0].c_length_a, 100);
});

test('second starters on the south face, on both, and with the optional cells left blank', () => {
  const south = generate(csv(R1.replace('north', 'South')), R1_WALL);
  assert.deepEqual(group(south, 'W1 second starters').rows.map((r) => r.Bar_mark), ['WS2']);
  const both = generate(csv(R1.replace('north', ' BOTH ')), R1_WALL);
  assert.deepEqual(group(both, 'W1 second starters').rows.map((r) => r.Bar_mark), ['WS1', 'WS2']);
  const plain = generate(csv('W1,313.7,5000,3000,,,,H16-150,H13-150,,,starters,starters,H13,,,,,,,H13-150 x 300,both,301,,,'), R1_WALL);
  assert.equal(plain.ok, true, plain.msg);
  assert.deepEqual(JSON.parse(group(plain, 'W1 second starters').rows[0].legs), [[150, 0], [301, 270]]);   // the card's default foot
});

test('second starters need their face and leg, refuse stray cells, and are written as the schedule writes them', () => {
  const cell = (label, value) => {
    const cols = HEAD.split(',');
    const line = R1.split(',');
    while (line.length < cols.length) line.push('');
    line[cols.indexOf(label)] = value;
    return csv(line.join(','));
  };
  assert.match(wallsFromCsv(cell('Second starter face', '')).msg, /W1.*Second starter face.*north, south or both/);
  assert.match(wallsFromCsv(cell('Second starter face', 'east')).msg, /W1.*Second starter face.*"east" is not north, south or both/);
  assert.match(wallsFromCsv(cell('Second starter leg (mm)', '')).msg, /W1.*Second starter leg/);
  assert.match(wallsFromCsv(cell('Second starter bars', 'H13-150')).msg, /W1.*Second starter bars.*H13-150 x 300/);
  assert.match(wallsFromCsv(cell('Second starter bars', '')).msg, /W1.*second starter cells, but no "Second starter bars"/);
  assert.match(wallsFromCsv(cell('Second starter leg (mm)', 'long')).msg, /W1.*Second starter leg \(mm\).*not a number/);
});

test('the second starter inputs the card refuses come back with the card\'s own message', () => {
  const bad = wallsFromCsv(csv(R1.replace('86.7', '301')), { cover: 40 });
  assert.equal(bad.ok, true, bad.msg);
  const res = memberGroups(R1_WALL, cardInputsOf(bad.walls[0].form, 40, 'good'), { neighbours: [] });
  assert.equal(res.ok, false);
  assert.match(res.msg, /projection/);
});
