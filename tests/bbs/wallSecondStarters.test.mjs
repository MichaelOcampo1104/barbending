// Wall second starters: horizontal L bars that stand out of a face of the wall, in plan (the PB1 H13 of inputs/wall_sample_starter_array_r1.dxf).
// The long leg runs across the thickness, from outside the face into the wall, and the foot lies along the wall, on the -X side of the leg. They are spaced along the
// wall (centred, like the links and the dowels) and up its height. A wall's own bars, starters and dowels are not changed by them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { genBarPoints, transformBarLocalPoint } from '../../src/bbs/shapes.js';
import { defaultCardInputs, memberGroups } from '../../src/bbs/memberReinforcement.js';

// The wall of inputs/wall_sample_starter_array_r1.dxf: 5000 x 313.7 x 3000, origin 0,0,0, cover 40.
const WALL = { id: 'c1', name: 'W1', kind: 'WALL', lx: 5000, ly: 313.7, lz: 3000, x: 0, y: 0, z: 0, covB: 40, covT: 40 };
const COLUMN = { id: 'c1', name: 'C1', kind: 'COLUMN', lx: 800, ly: 800, lz: 4500, x: 0, y: 0, z: 0, covB: 40, covT: 40 };

const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const group = (res, name) => res.groups.find((g) => g.name === name);
// The drawing's PB1 H13: Ø13 at 150 along the wall and 300 up it, a 301 leg, a 49.7 foot, the bend 86.7 out of the north face, first level 233.8.
const wallInputs = (over = {}) => ({
  ...defaultCardInputs(40),
  kind: 'Wall',
  wall: { mainDia: 16, mainSpacing: 150, distDia: 13, distSpacing: 150, linkDia: 13, linkSpacing: 150, linkVSpacing: 300, legA: 130 },
  starters: {
    base: true, top: true, dia: 13, lap: null, anchorage: null, bend: null,
    second: 'north', secondDia: 13, secondSpacing: 150, secondVSpacing: 300, secondLeg: 301, secondFoot: 49.7, secondOut: 86.7, secondZ: 233.8,
    ...over,
  },
});
const build = (over, member = WALL) => memberGroups(member, wallInputs(over), { neighbours: [] });
// A bar's world points: its local polyline placed by Pos and turned by its rotation (the first copy of its distribution).
const worldPoints = (row) => genBarPoints(row).points.map((p) => {
  const t = transformBarLocalPoint(row, p);
  return [row.Pos_x + t[0], row.Pos_y + t[1], row.Pos_z + t[2]];
});

test('the drawing\'s PB1 H13 as card rows: an L in plan out of the north face, 33 along the wall and 10 levels up', () => {
  const res = build({});
  assert.equal(res.ok, true, res.msg);
  assert.deepEqual(res.groups.map((g) => g.name), ['W1 mains', 'W1 distribution', 'W1 links', 'W1 starters', 'W1 second starters']);
  const rows = group(res, 'W1 second starters').rows;
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.Bar_mark, 'WS1');
  assert.equal(r.Rebar_Type, 'profile');
  assert.equal(r.Dia, 13);
  assert.equal(r.Plane, 'XY');
  assert.equal(r.Pos_Rotation, 0);
  assert.deepEqual(JSON.parse(r.legs), [[49.7, 0], [301, 270]]);
  near(r.Pos_x, 100); near(r.Pos_y, 400.4); near(r.Pos_z, 233.8);
  assert.deepEqual([r.qty_x, r.spacing_x, r.qty_y, r.qty_z, r.spacing_z], [33, 150, 1, 10, 300]);
  assert.equal(r.host, 'c1');
  assert.equal(r.Group, 'W1');
});

test('the L stands where the drawing has it: the bend 86.7 out of the north face, the leg ending at y 99.4 inside the wall', () => {
  const r = group(build({}), 'W1 second starters').rows[0];
  const [s, c, e] = worldPoints(r);
  near(s[0], 100); near(s[1], 400.4); near(s[2], 233.8);
  near(c[0], 149.7); near(c[1], 400.4);     // the foot runs 49.7 along the wall
  near(e[0], 149.7); near(e[1], 99.4);      // the leg runs 301 back across the thickness: the drawing's 99.4
  near(e[2], 233.8);                        // flat at its level
});

test('a south face mirrors it: the bend 86.7 out of the south face, the leg ending at y 214.3', () => {
  const res = build({ second: 'south' });
  assert.equal(res.ok, true, res.msg);
  const r = group(res, 'W1 second starters').rows[0];
  assert.equal(r.Bar_mark, 'WS2');
  assert.deepEqual(JSON.parse(r.legs), [[49.7, 0], [301, 90]]);
  const [s, c, e] = worldPoints(r);
  near(s[1], -86.7); near(c[1], -86.7); near(e[1], 214.3);
  near(e[0], 149.7);
});

test('both faces: the north bars, then the south bars, in one set', () => {
  const res = build({ second: 'both' });
  assert.equal(res.ok, true, res.msg);
  assert.deepEqual(group(res, 'W1 second starters').rows.map((r) => [r.Bar_mark, r.Pos_y]), [['WS1', 400.4], ['WS2', -86.7]]);
});

test('blank foot, projection and first level are the card\'s defaults: a 10 x Ø foot (150 at least), half the leg out, the bottom cover', () => {
  const res = build({ secondFoot: null, secondOut: null, secondZ: null });
  assert.equal(res.ok, true, res.msg);
  const r = group(res, 'W1 second starters').rows[0];
  assert.deepEqual(JSON.parse(r.legs), [[150, 0], [301, 270]]);
  near(r.Pos_y, 313.7 + 150.5);
  near(r.Pos_z, 46.5);          // the bottom cover plus half the bar
  assert.equal(r.qty_z, 10);    // 46.5 up to 2746.5 at 300, the last one under the top cover
  assert.deepEqual(res.second.out, 150.5);
});

test('the bars centre along the wall, like the links and the dowels', () => {
  const cases = [
    // wall length, spacing, count, first x
    [5000, 150, 33, 100],
    [4800, 150, 31, 150],
    [1500, 1000, 2, 250],
  ];
  for (const [lx, spacing, count, first] of cases) {
    const res = build({ secondSpacing: spacing }, { ...WALL, lx });
    assert.equal(res.ok, true, `${lx}: ${res.msg}`);
    const r = group(res, 'W1 second starters').rows[0];
    assert.equal(r.qty_x, count, `${lx} at ${spacing}: count`);
    near(r.Pos_x, first);
    near(lx - (r.Pos_x + (r.qty_x - 1) * r.spacing_x), first, 0.02);
  }
});

test('the levels run from the first one up while the bar stays under the top cover', () => {
  // 233.8 + 9 x 300 = 2933.8 fits under 3000 - 40 - 6.5; an 11th level would not
  assert.equal(group(build({}), 'W1 second starters').rows[0].qty_z, 10);
  assert.equal(group(build({ secondVSpacing: 1000 }), 'W1 second starters').rows[0].qty_z, 3);
  assert.equal(group(build({ secondVSpacing: 5000 }), 'W1 second starters').rows[0].qty_z, 1);
  assert.equal(group(build({ secondZ: 2900 }), 'W1 second starters').rows[0].qty_z, 1);
});

test('the card reads the second starters back', () => {
  assert.deepEqual(build({ second: 'both' }).second, {
    face: 'both', dia: 13, spacing: 150, vSpacing: 300, leg: 301, foot: 49.7, out: 86.7, embed: 214.3,
    count: 33, first: 100, last: 4900, levels: 10, zFirst: 233.8, zLast: 2933.8,
  });
  assert.equal(build({ second: '' }).second, null);
});

test('second starters need a face, a Ø, both spacings and a leg, and say which one is missing', () => {
  assert.match(build({ second: 'east' }).msg, /face/);
  assert.match(build({ secondDia: null }).msg, /second starters need a Ø/);
  assert.match(build({ secondSpacing: null }).msg, /spacing along the wall/);
  assert.match(build({ secondVSpacing: null }).msg, /spacing up the wall/);
  assert.match(build({ secondLeg: null }).msg, /leg/);
  assert.match(build({ secondFoot: 0 }).msg, /foot/);
});

test('the projection must leave some of the leg in the wall, and the part in the wall must fit the thickness', () => {
  assert.match(build({ secondOut: 301 }).msg, /projection/);
  assert.match(build({ secondOut: 0 }).msg, /projection/);
  assert.match(build({ secondOut: 10 }).msg, /thickness/);        // 291 in a 313.7 wall with a 40 cover: 273.7 at most
  assert.equal(build({ secondOut: 30 }).ok, true);                // 271 in
});

test('the first level must lie between the covers', () => {
  assert.match(build({ secondZ: 10 }).msg, /first level/);
  assert.match(build({ secondZ: 2990 }).msg, /first level/);
  assert.equal(build({ secondZ: 46.5 }).ok, true);
});

test('second starter inputs are only checked when a face is chosen', () => {
  assert.equal(build({ second: '', secondDia: null, secondSpacing: null, secondLeg: null }).ok, true);
  assert.equal(build({ second: '' }).groups.some((g) => g.name === 'W1 second starters'), false);
});

test('the second starters do not change the wall\'s other bars, and work with dowels', () => {
  const plain = build({ second: '' });
  const withSecond = build({ second: 'both' });
  for (const name of ['W1 mains', 'W1 distribution', 'W1 links', 'W1 starters']) {
    assert.deepEqual(group(withSecond, name).rows, group(plain, name).rows, name);
  }
  const dowels = build({ second: 'north', dowelTop: true, dowelDia: 16, dowelSpacing: 1000, dowelLength: 600 });
  assert.equal(dowels.ok, true, dowels.msg);
  assert.deepEqual(dowels.groups.map((g) => g.name), ['W1 mains', 'W1 distribution', 'W1 links', 'W1 starters', 'W1 dowels', 'W1 second starters']);
});

test('a column ignores the second starter settings', () => {
  const col = (over) => ({
    ...defaultCardInputs(40),
    kind: 'Column',
    column: { mainDia: 25, layout: 'all', mainCount: 16, faceCount: 8, faceAxis: 'x', linkDia: 10, linkSpacing: 150, lap: null },
    starters: { base: true, top: true, dia: 25, lap: null, anchorage: null, bend: null, ...over },
  });
  const plain = memberGroups(COLUMN, col({}), { neighbours: [] });
  const withSecond = memberGroups(COLUMN, col({ second: 'both', secondDia: 13, secondSpacing: 150, secondVSpacing: 300, secondLeg: 301 }), { neighbours: [] });
  assert.deepEqual(withSecond.groups, plain.groups);
  assert.equal(withSecond.second, null);
});
