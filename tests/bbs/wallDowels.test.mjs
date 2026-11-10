// Wall dowels: a wall end set to dowels gets single straight dowels in place of its starters. The wall's own bars still end inside the wall.
// The dowels stand in the middle of the thickness, centred along the wall at the given spacing, with the given length and projection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { genBarPoints, transformBarLocalPoint } from '../../src/bbs/shapes.js';
import { defaultCardInputs, memberGroups } from '../../src/bbs/memberReinforcement.js';

// The 5000 x 200 x 3000 wall of inputs/wall_sample_auto_bbs.json (origin 0,0,0; cover 40).
const WALL = { id: 'c1', name: 'W1', kind: 'WALL', lx: 5000, ly: 200, lz: 3000, x: 0, y: 0, z: 0, covB: 40, covT: 40 };
const COLUMN = { id: 'c1', name: 'C1', kind: 'COLUMN', lx: 800, ly: 800, lz: 4500, x: 0, y: 0, z: 0, covB: 40, covT: 40 };

const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const group = (res, name) => res.groups.find((g) => g.name === name);
const wallInputs = (over = {}) => ({
  ...defaultCardInputs(40),
  kind: 'Wall',
  wall: { mainDia: 16, mainSpacing: 150, distDia: 13, distSpacing: 150, linkDia: 13, linkSpacing: 150, linkVSpacing: 300, legA: 130 },
  starters: {
    base: true, top: true, dia: 13, lap: null, anchorage: null, bend: null,
    dowelBase: false, dowelTop: false, dowelDia: 16, dowelSpacing: 1000, dowelLength: 600, dowelOut: null,
    ...over,
  },
});
const build = (over, member = WALL, opts = { neighbours: [] }) => memberGroups(member, wallInputs(over), opts);

// A bar's world points: its local polyline placed by Pos and turned by its rotation (the first copy of its distribution).
const worldPoints = (row) => genBarPoints(row).points.map((p) => {
  const t = transformBarLocalPoint(row, p);
  return [row.Pos_x + t[0], row.Pos_y + t[1], row.Pos_z + t[2]];
});

test('a top dowel replaces the top starters: the base starters stay, five dowels stand centred along the wall', () => {
  const res = build({ dowelTop: true });
  assert.equal(res.ok, true, res.msg);
  assert.deepEqual(res.groups.map((g) => g.name), ['W1 mains', 'W1 distribution', 'W1 links', 'W1 starters', 'W1 dowels']);
  const starters = group(res, 'W1 starters').rows;
  assert.equal(starters.length, 67);
  assert.ok(starters.every((r) => r.Bar_mark.startsWith('ST1-')), 'only the base starters remain');
  const dowels = group(res, 'W1 dowels').rows;
  assert.equal(dowels.length, 1);
  const d = dowels[0];
  assert.equal(d.Bar_mark, 'WD2');
  assert.equal(d.Rebar_Type, 'straight');
  assert.equal(d.Dia, 16);
  assert.equal(d.Plane, 'XZ');
  assert.equal(d.Pos_Rotation, 90);
  assert.equal(d['Length of Bar'], 600);
  assert.equal(d.qty_x, 5);
  assert.equal(d.spacing_x, 1000);
  near(d.Pos_x, 500); near(d.Pos_y, 100); near(d.Pos_z, 2700);
  assert.equal(d.host, 'c1');
  assert.equal(d.Group, 'W1');
});

test('a base dowel stands from below the base face, as far into the wall as the length less the projection', () => {
  const res = build({ dowelBase: true });
  assert.equal(res.ok, true, res.msg);
  const starters = group(res, 'W1 starters').rows;
  assert.equal(starters.length, 67);
  assert.ok(starters.every((r) => r.Bar_mark.startsWith('ST2-')), 'only the top starters remain');
  const d = group(res, 'W1 dowels').rows[0];
  assert.equal(d.Bar_mark, 'WD1');
  near(d.Pos_z, -300);
});

test('dowels at both ends leave no starters at all', () => {
  const res = build({ dowelBase: true, dowelTop: true });
  assert.equal(res.ok, true, res.msg);
  assert.deepEqual(res.groups.map((g) => g.name), ['W1 mains', 'W1 distribution', 'W1 links', 'W1 dowels']);
  assert.deepEqual(group(res, 'W1 dowels').rows.map((r) => r.Bar_mark), ['WD1', 'WD2']);
});

test('a dowel end wins over its starters flag, and a wall without dowels is the card as it was', () => {
  const both = build({ dowelTop: true, top: true, base: false });
  assert.equal(group(both, 'W1 starters'), undefined);
  const none = build({});
  assert.equal(none.groups.length, 4);
  assert.equal(none.groups.flatMap((g) => g.rows).length, 204);
  assert.equal(none.dowels, null);
});

test('the wall bars end inside the wall: the dowels do not change the mains, the distribution or the links', () => {
  const plain = build({});
  const dow = build({ dowelBase: true, dowelTop: true });
  for (const name of ['W1 mains', 'W1 distribution', 'W1 links']) {
    assert.deepEqual(group(dow, name).rows, group(plain, name).rows, name);
  }
  const mains = group(dow, 'W1 mains').rows;
  assert.ok(mains.every((r) => r['Length of Bar'] === 2920 && Math.abs(r.Pos_z - 48) < 0.01), 'the mains run from cover to cover');
});

test('the dowel stands where the app draws it: a vertical bar, 300 mm in the wall and 300 mm out of its top', () => {
  const d = group(build({ dowelTop: true }), 'W1 dowels').rows[0];
  const pts = worldPoints(d);
  assert.equal(pts.length, 2);
  const [a, b] = pts;
  near(a[0], 500); near(b[0], 500);
  near(a[1], 100); near(b[1], 100);
  near(Math.min(a[2], b[2]), 2700); near(Math.max(a[2], b[2]), 3300);
});

test('the projection defaults to half the length, and a typed one moves the dowel', () => {
  const top = group(build({ dowelTop: true, dowelOut: 250 }), 'W1 dowels').rows[0];
  near(top.Pos_z, 3000 - 350);
  assert.equal(top['Length of Bar'], 600);
  const base = group(build({ dowelBase: true, dowelOut: 250 }), 'W1 dowels').rows[0];
  near(base.Pos_z, -250);
});

test('the dowels centre along the wall whatever its length', () => {
  const cases = [
    // wall length, spacing, count, first x
    [5000, 1000, 5, 500],
    [4800, 1000, 5, 400],
    [1500, 1000, 2, 250],
    [300, 1000, 1, 150],
    [3000, 500, 6, 250],
  ];
  for (const [lx, spacing, count, first] of cases) {
    const res = build({ dowelTop: true, dowelSpacing: spacing }, { ...WALL, lx });
    assert.equal(res.ok, true, `${lx}: ${res.msg}`);
    const d = group(res, 'W1 dowels').rows[0];
    assert.equal(d.qty_x, count, `${lx} at ${spacing}: count`);
    near(d.Pos_x, first);
    const last = d.Pos_x + (d.qty_x - 1) * d.spacing_x;
    near(lx - last, first, 0.02);   // the last dowel is as far from the far end as the first is from the near end
  }
});

test('the card reads the dowels back: where they stand and how far in and out', () => {
  const res = build({ dowelBase: true, dowelTop: true });
  assert.deepEqual(res.dowels, {
    dia: 16, spacing: 1000, length: 600, out: 300, embed: 300, count: 5, first: 500, last: 4500, ends: ['base', 'top'],
  });
});

test('dowels need a Ø, a spacing and a length, and a projection that leaves some of the dowel in the wall', () => {
  assert.match(build({ dowelTop: true, dowelDia: null }).msg, /Ø/);
  assert.match(build({ dowelTop: true, dowelSpacing: null }).msg, /spacing/);
  assert.match(build({ dowelTop: true, dowelLength: null }).msg, /length/);
  assert.match(build({ dowelTop: true, dowelOut: 600 }).msg, /projection/);
  assert.match(build({ dowelTop: true, dowelOut: 0 }).msg, /projection/);
});

test('dowels must fit the wall: between the covers across the thickness, and within its height', () => {
  assert.match(build({ dowelTop: true, dowelDia: 130 }).msg, /between the covers/);
  assert.match(build({ dowelTop: true, dowelLength: 3100, dowelOut: 100 }).msg, /height/);
  assert.equal(build({ dowelTop: true, dowelLength: 3000, dowelOut: 100 }).ok, true);
});

test('dowel inputs are only checked where an end uses them', () => {
  assert.equal(build({ dowelDia: null, dowelSpacing: null, dowelLength: null }).ok, true);
});

test('a slab that is shallower than the projection is flagged, and a deep enough one is not', () => {
  const slab = (lz) => ({ id: 'c2', name: 'S1', kind: 'SLAB', lx: 6000, ly: 1000, lz, x: -500, y: -400, z: 3000, covB: 40, covT: 40 });
  const shallow = build({ dowelTop: true }, WALL, { neighbours: [slab(200)] });
  assert.ok(shallow.warnings.some((w) => /dowels/.test(w) && /160 mm/.test(w)), shallow.warnings.join(' | '));
  const deep = build({ dowelTop: true }, WALL, { neighbours: [slab(400)] });
  assert.ok(!deep.warnings.some((w) => /dowels/.test(w)), deep.warnings.join(' | '));
});

test('a column ignores the dowel settings', () => {
  const col = (over) => ({
    ...defaultCardInputs(40),
    kind: 'Column',
    column: { mainDia: 25, layout: 'all', mainCount: 16, faceCount: 8, faceAxis: 'x', linkDia: 10, linkSpacing: 150, lap: null },
    starters: { base: true, top: true, dia: 25, lap: null, anchorage: null, bend: null, ...over },
  });
  const plain = memberGroups(COLUMN, col({}), { neighbours: [] });
  const withDowels = memberGroups(COLUMN, col({ dowelTop: true, dowelBase: true, dowelDia: 16, dowelSpacing: 1000, dowelLength: 600 }), { neighbours: [] });
  assert.deepEqual(withDowels.groups, plain.groups);
  assert.equal(withDowels.dowels, null);
});
