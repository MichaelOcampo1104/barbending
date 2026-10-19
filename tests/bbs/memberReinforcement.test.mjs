import test from 'node:test';
import assert from 'node:assert/strict';
import { genBarPoints, transformBarLocalPoint } from '../../src/bbs/shapes.js';
import {
  ringPositions, faceRowPositions, perimeterPositions, lappedLinkPoints, linkLegs,
  defaultLinkLap, defaultCardInputs, memberGroups,
} from '../../src/bbs/memberReinforcement.js';

const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const byMark = (rows, prefix) => rows.filter((r) => String(r.Bar_mark).startsWith(prefix));
const group = (res, name) => res.groups.find((g) => g.name === name);

// The 800 x 800 x 4500 column of inputs/column_sample_800_auto_bbs.json (origin 0,0,0; cover 40).
const COLUMN = { id: 'c1', name: 'C1', kind: 'COLUMN', lx: 800, ly: 800, lz: 4500, x: 0, y: 0, z: 0, covB: 40, covT: 40 };
// The 5000 x 200 x 3000 wall of inputs/wall_sample_auto_bbs.json (origin 0,0,0; cover 40).
const WALL = { id: 'c1', name: 'W1', kind: 'WALL', lx: 5000, ly: 200, lz: 3000, x: 0, y: 0, z: 0, covB: 40, covT: 40 };

const columnInputs = () => ({
  ...defaultCardInputs(40),
  kind: 'Column',
  column: { mainDia: 25, layout: 'all', mainCount: 16, faceCount: 8, faceAxis: 'x', linkDia: 10, linkSpacing: 150, lap: null },
  starters: { base: true, top: true, dia: 25, lap: null, anchorage: null, bend: null },
});
const wallInputs = () => ({
  ...defaultCardInputs(40),
  kind: 'Wall',
  wall: { mainDia: 16, mainSpacing: 150, distDia: 13, distSpacing: 150, linkDia: 13, linkSpacing: 150, linkVSpacing: 300, legA: 130 },
  starters: { base: true, top: true, dia: 13, lap: null, anchorage: null, bend: null },
});

test('ring with 16 bars: corners at the cage corners, 3 equal bars per side', () => {
  const pts = ringPositions({ x0: 72.5, y0: 72.5, x1: 737.5, y1: 737.5 }, 16);
  assert.equal(pts.length, 16);
  const bottom = pts.filter(([, y]) => y === 72.5).map(([x]) => x).sort((a, b) => a - b);
  assert.deepEqual(bottom.map((x) => Math.round(x * 100) / 100), [72.5, 238.75, 405, 571.25, 737.5]);
  for (const c of [[72.5, 72.5], [737.5, 72.5], [737.5, 737.5], [72.5, 737.5]]) {
    assert.ok(pts.some(([x, y]) => x === c[0] && y === c[1]), `corner ${c}`);
  }
});

test('ring with 10 bars: the 6 extra bars share the sides 2, 2, 1, 1', () => {
  const pts = ringPositions({ x0: 0, y0: 0, x1: 1000, y1: 1000 }, 10);
  assert.equal(pts.length, 10);
  // interior bars per side: points on the side that are not one of the four corners
  const corner = (p) => (p[0] === 0 || p[0] === 1000) && (p[1] === 0 || p[1] === 1000);
  const interior = (fn) => pts.filter((p) => fn(p) && !corner(p)).length;
  assert.equal(interior(([, y]) => y === 0), 2);
  assert.equal(interior(([x]) => x === 1000), 2);
  assert.equal(interior(([, y]) => y === 1000), 1);
  assert.equal(interior(([x]) => x === 0), 1);
});

test('two faces parallel to X: count bars per face, corner to corner, total 2 x count', () => {
  const pts = faceRowPositions({ x0: 72.5, y0: 72.5, x1: 737.5, y1: 737.5 }, 4, 'x');
  assert.equal(pts.length, 8);
  const row = pts.filter(([, y]) => y === 72.5).map(([x]) => x);
  assert.equal(row.length, 4);
  near(row[0], 72.5); near(row[3], 737.5);
  near(row[1] - row[0], 221.67, 0.01); near(row[2] - row[1], 221.67, 0.01);
  assert.equal(pts.filter(([, y]) => y === 737.5).length, 4);
});

test('wall perimeter reproduces the sample: 67 mains, the second at x 197.49', () => {
  const pts = perimeterPositions({ x0: 48, y0: 48, x1: 4952, y1: 152 }, 150);
  assert.equal(pts.length, 67);
  near(pts[0][0], 48); near(pts[0][1], 48);
  near(pts[1][0], 197.49, 0.01); near(pts[1][1], 48);
});

test('lapped link points: the drawn shape at 800 with cover 40, link 10, lap 240', () => {
  const p = lappedLinkPoints({ lx: 800, ly: 800, cover: 40, dia: 10, lap: 240 });
  assert.deepEqual(p, [[295, 55], [55, 55], [55, 755], [755, 755], [755, 45], [45, 45], [45, 295]]);
});

test('lapped link legs sum to the developed length, 3310 mm', () => {
  const legs = linkLegs(lappedLinkPoints({ lx: 800, ly: 800, cover: 40, dia: 10, lap: 240 }));
  assert.equal(legs.length, 6);
  assert.equal(legs.reduce((s, [len]) => s + len, 0), 3310);
  assert.deepEqual(legs.map(([, deg]) => deg), [180, 90, 0, 270, 180, 90]);
});

test('default lap: a third of the link width, nearest 10 mm', () => {
  assert.equal(defaultLinkLap(710), 240);
  assert.equal(defaultLinkLap(700), 230);
});

test('column sample: mains, link stack and starters match the reference rows', () => {
  const res = memberGroups(COLUMN, columnInputs(), { neighbours: [] });
  assert.equal(res.ok, true, res.msg);
  assert.deepEqual(res.groups.map((g) => g.name), ['C1 mains', 'C1 links', 'C1 starters']);
  const mains = group(res, 'C1 mains').rows;
  assert.equal(mains.length, 16);
  for (const r of mains) {
    assert.equal(r.Rebar_Type, 'straight');
    assert.equal(r['Length of Bar'], 4420);
    near(r.Pos_z, 52.5);
    assert.equal(r.Plane, 'XZ');
    assert.equal(r.Pos_Rotation, 90);
    assert.equal(r.host, 'c1');
    assert.equal(r.Group, 'C1');
  }
  const links = group(res, 'C1 links').rows;
  assert.equal(links.length, 1);
  assert.equal(links[0].Rebar_Type, 'profile');
  assert.equal(links[0].qty_z, 30);
  assert.equal(links[0].spacing_z, 150);
  near(links[0].Pos_z, 45);
  const starters = group(res, 'C1 starters').rows;
  assert.equal(starters.length, 32);
  const base = starters.filter((r) => r.Pos_z === 1290);
  const top = starters.filter((r) => r.Pos_z === 3210);
  assert.equal(base.length, 16);
  assert.equal(top.length, 16);
  for (const r of starters) {
    assert.equal(r.Rebar_Type, 'bent');
    assert.equal(r['Length of Bar'], 2330);
    assert.equal(r.H, 250);
    assert.equal(r.bent_up_down, 'up');
    assert.equal(r.bond_condition, 'good');
  }
  assert.ok(base.every((r) => r.Pos_Rotation === -90));
  assert.ok(top.every((r) => r.Pos_Rotation === 90));
});

test('column starters bend outward from the centre (base and top)', () => {
  const res = memberGroups(COLUMN, columnInputs(), { neighbours: [] });
  for (const r of group(res, 'C1 starters').rows) {
    const g = genBarPoints(r);
    const L = r['Length of Bar'];
    const a = transformBarLocalPoint(r, [L, 0, 0]);
    const b = transformBarLocalPoint(r, [L, r.H, 0]);
    const dir = [b[0] - a[0], b[1] - a[1]];
    const out = [r.Pos_x - 400, r.Pos_y - 400];
    assert.ok(dir[0] * out[0] + dir[1] * out[1] > 0, `${r.Bar_mark} bends inward`);
    assert.equal(g.points.length, 3);
  }
});

test('column links: profile row with the lapped shape, shape code 99 and 5 bends', () => {
  const res = memberGroups(COLUMN, columnInputs(), { neighbours: [] });
  const link = group(res, 'C1 links').rows[0];
  const g = genBarPoints(link);
  assert.equal(g.bends90, 5);
  assert.equal(g.cutLengthMm, 3210);
});

test('shallow element below: the straight part is capped, the bend lengthens', () => {
  // A footing 800 deep whose top is at the column base, under the column footprint.
  const footing = { id: 'f1', name: 'Footing', x: -500, y: -500, z: -800, lx: 1800, ly: 1800, lz: 800, covB: 40, covT: 40 };
  const res = memberGroups(COLUMN, columnInputs(), { neighbours: [footing] });
  const base = group(res, 'C1 starters').rows.filter((r) => r.Pos_z === 1290);
  // straight allowed = 800 - cover 40 = 760; anchorage 1290 -> bend 530; Length = lap 1290 + 760
  assert.ok(base.every((r) => r.H === 530), `H ${base[0].H}`);
  assert.ok(base.every((r) => r['Length of Bar'] === 2050), `L ${base[0]['Length of Bar']}`);
  // No element above, so the top keeps the full anchorage and warns.
  assert.ok(group(res, 'C1 starters').rows.filter((r) => r.Pos_z === 3210).every((r) => r.H === 250));
  assert.ok(res.warnings.some((w) => /above the top/.test(w)));
});

test('no element below: the card keeps the full anchorage and warns (as the sample)', () => {
  const res = memberGroups(COLUMN, columnInputs(), { neighbours: [] });
  assert.ok(res.warnings.some((w) => /below the base/.test(w)));
});

test('wall sample: 67 mains, distribution 2 x 20, links 33 x 10 with spine 107, starters 580 / 2420', () => {
  const res = memberGroups(WALL, wallInputs(), { neighbours: [] });
  assert.equal(res.ok, true, res.msg);
  assert.deepEqual(res.groups.map((g) => g.name), ['W1 mains', 'W1 distribution', 'W1 links', 'W1 starters']);
  assert.equal(group(res, 'W1 mains').rows.length, 67);
  for (const r of group(res, 'W1 mains').rows) {
    assert.equal(r['Length of Bar'], 2920);
    near(r.Pos_z, 48);
  }
  const dist = group(res, 'W1 distribution').rows;
  assert.equal(dist.length, 2);
  for (const r of dist) {
    assert.equal(r.Plane, 'XY');
    assert.equal(r['Length of Bar'], 4800);
    assert.equal(r.qty_z, 20);
    assert.equal(r.spacing_z, 150);
    near(r.Pos_x, 100); near(r.Pos_z, 46.5);
    assert.equal(r.bond_condition, 'poor');
  }
  near(dist[0].Pos_y, 62.5); near(dist[1].Pos_y, 137.5);
  const link = group(res, 'W1 links').rows;
  assert.equal(link.length, 1);
  const l = link[0];
  assert.equal(l.Rebar_Type, 'c_link_with_hook');
  assert.equal(l.Plane, 'XY');
  assert.equal(l.Pos_Rotation, 90);
  assert.equal(l.length, 107);
  assert.equal(l.c_length_a, 130);
  assert.equal(l.c_length_b, 120);
  assert.equal(l.qty_x, 33);
  assert.equal(l.spacing_x, 150);
  assert.equal(l.qty_z, 10);
  assert.equal(l.spacing_z, 300);
  near(l.Pos_x, 100); near(l.Pos_y, 46.5); near(l.Pos_z, 46.5);
  const starters = group(res, 'W1 starters').rows;
  assert.equal(starters.length, 134);
  const base = starters.filter((r) => r.Pos_z === 580);
  const top = starters.filter((r) => r.Pos_z === 2420);
  assert.equal(base.length, 67);
  assert.equal(top.length, 67);
  assert.ok(base.every((r) => r['Length of Bar'] === 1010 && r.H === 150));
  assert.ok(top.every((r) => r['Length of Bar'] === 1010 && r.H === 150));
});

test('validation: too few bars, a wall along Y, or a spine that is not positive', () => {
  const few = columnInputs();
  few.column.mainCount = 3;
  assert.equal(memberGroups(COLUMN, few, { neighbours: [] }).ok, false);
  const yWall = { ...WALL, lx: 200, ly: 5000 };
  const bad = memberGroups(yWall, wallInputs(), { neighbours: [] });
  assert.equal(bad.ok, false);
  assert.match(bad.msg, /along X/);
  const thin = { ...WALL, ly: 90 };
  assert.equal(memberGroups(thin, wallInputs(), { neighbours: [] }).ok, false);
});

test('starter Ø defaults to the main Ø when not given', () => {
  const inp = columnInputs();
  inp.starters.dia = null;
  const res = memberGroups(COLUMN, inp, { neighbours: [] });
  assert.ok(group(res, 'C1 starters').rows.every((r) => r.Dia === 25));
  assert.ok(group(res, 'C1 starters').rows.every((r) => r['Length of Bar'] === 2330));
});

test('marks follow the reference: V1-n, T1 for columns; WV1-n, WH1/WH2, WL1, ST1-n, ST2-n', () => {
  const col = memberGroups(COLUMN, columnInputs(), { neighbours: [] });
  assert.equal(byMark(group(col, 'C1 mains').rows, 'V1-')[0].Bar_mark, 'V1-1');
  assert.equal(group(col, 'C1 links').rows[0].Bar_mark, 'T1');
  assert.equal(byMark(group(col, 'C1 starters').rows, 'ST1-').length, 16);
  assert.equal(byMark(group(col, 'C1 starters').rows, 'ST2-').length, 16);
  const wall = memberGroups(WALL, wallInputs(), { neighbours: [] });
  assert.equal(byMark(group(wall, 'W1 mains').rows, 'WV1-')[0].Bar_mark, 'WV1-1');
  assert.deepEqual(group(wall, 'W1 distribution').rows.map((r) => r.Bar_mark), ['WH1', 'WH2']);
  assert.equal(group(wall, 'W1 links').rows[0].Bar_mark, 'WL1');
});

test('two faces: 2 x count mains, on the two faces the layout names; one bar per face is refused', () => {
  const inp = columnInputs();
  inp.column.layout = 'x';
  inp.column.faceCount = 4;
  const x = memberGroups(COLUMN, inp, { neighbours: [] });
  const mx = group(x, 'C1 mains').rows;
  assert.equal(mx.length, 8);
  assert.deepEqual([...new Set(mx.map((r) => r.Pos_y))].sort((a, b) => a - b), [72.5, 737.5]);
  inp.column.layout = 'y';
  const y = memberGroups(COLUMN, inp, { neighbours: [] });
  const my = group(y, 'C1 mains').rows;
  assert.equal(my.length, 8);
  assert.deepEqual([...new Set(my.map((r) => r.Pos_x))].sort((a, b) => a - b), [72.5, 737.5]);
  inp.column.faceCount = 1;
  assert.equal(memberGroups(COLUMN, inp, { neighbours: [] }).ok, false);
});

test('an entered link lap replaces the drawn-proportion default in the first leg', () => {
  const inp = columnInputs();
  inp.column.lap = 300;
  const res = memberGroups(COLUMN, inp, { neighbours: [] });
  const legs = JSON.parse(group(res, 'C1 links').rows[0].legs);
  assert.equal(legs[0][0], 300);
  // the lapped corner moves with the lap: the closing leg ends 300 + 10 past the first corner
  assert.equal(legs[5][0], 310);
});
