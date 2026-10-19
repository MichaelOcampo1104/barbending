import test from 'node:test';
import assert from 'node:assert/strict';
import { genBarPoints, transformBarLocalPoint } from '../../src/bbs/shapes.js';
import { levelDefaults, resolveLevels, memberGroups, defaultCardInputs } from '../../src/bbs/memberReinforcement.js';

const near = (a, b, tol = 0.05) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const group = (res, name) => res.groups.find((g) => g.name === name);

// The 800 x 800 x 4500 column of inputs/column_sample_800_auto_bbs.json (origin 0,0,0; cover 40).
const COLUMN = { id: 'c1', name: 'C1', kind: 'COLUMN', lx: 800, ly: 800, lz: 4500, x: 0, y: 0, z: 0, covB: 40, covT: 40 };
const BOX = { mainDia: 25, covB: 40, covT: 40, lz: 4500 };
const inputs = (levels = []) => ({
  ...defaultCardInputs(40),
  kind: 'Column',
  column: { mainDia: 25, layout: 'all', mainCount: 16, faceCount: 8, linkDia: 10, linkSpacing: 150, lap: null, levels },
  starters: { base: true, top: true, dia: null, lap: null, anchorage: null, bend: null, topDia: null },
});
const ONE = [{ level: 2000, dia: 20, lap: null, step: null, jog: null }];

test('level defaults: the larger bar\'s table lap, a crank step of the larger Ø, and a jog of 1 in 6', () => {
  assert.deepEqual(levelDefaults(25, 20), { lap: 1290, step: 25, jog: 150 });
  assert.deepEqual(levelDefaults(20, 25), { lap: 1290, step: 25, jog: 150 });
});

test('a level centres its splice: the upper bar starts at level − lap/2, the lower bar cranks over the jog below that', () => {
  const r = resolveLevels(ONE, BOX);
  assert.equal(r.ok, true, r.msg);
  assert.deepEqual(r.list.map(({ level, dia, lap, step, jog, a, b, c }) => ({ level, dia, lap, step, jog, a, b, c })), [
    { level: 2000, dia: 20, lap: 1290, step: 25, jog: 150, a: 1205, b: 1355, c: 2645 },
  ]);
});

test('levels that leave no room for their splice are refused', () => {
  assert.equal(resolveLevels([{ level: 100, dia: 20 }], BOX).ok, false); // the first splice runs into the base
  assert.equal(resolveLevels([{ level: 4300, dia: 20 }], BOX).ok, false); // the splice runs past the top
  assert.equal(resolveLevels([{ level: 1500, dia: 20 }, { level: 1900, dia: 16 }], BOX).ok, false); // two splices overlap
  assert.equal(resolveLevels([{ level: 0, dia: 20 }], BOX).ok, false);
  assert.equal(resolveLevels([{ level: 2000, dia: 0 }], BOX).ok, false);
  assert.equal(resolveLevels([{ level: 2000, dia: 20, step: 25, jog: 0 }], BOX).ok, false); // a crank needs a jog
});

test('one level: the lower bar is a double crank (Z) and the upper bar a straight bar of the new Ø', () => {
  const res = memberGroups(COLUMN, inputs(ONE), { neighbours: [] });
  assert.equal(res.ok, true, res.msg);
  const mains = group(res, 'C1 mains').rows;
  const low = mains.filter((r) => r.Bar_mark.startsWith('V1-'));
  const up = mains.filter((r) => r.Bar_mark.startsWith('V2-'));
  assert.equal(low.length, 16);
  assert.equal(up.length, 16);
  for (const r of low) {
    assert.equal(r.Rebar_Type, 'double_crank');
    assert.equal(r.Dia, 25);
    near(r.Pos_z, 52.5, 0.01);
    near(r.DC_Lap_Start, 1152.5, 0.01);
    assert.equal(r.DC_Lap_Mid, 150);
    assert.equal(r.DC_Tail_Length, 1290);
    assert.equal(r.Crank_step, 25);
    assert.equal(typeof r.plan_rotation, 'number');
  }
  for (const r of up) {
    assert.equal(r.Rebar_Type, 'straight');
    assert.equal(r.Dia, 20);
    near(r.Pos_z, 1355, 0.01);
    near(r['Length of Bar'], 3115, 0.01);
  }
});

test('the crank steps inward: its tail lies one crank step from the upper bar, toward the column centre', () => {
  const res = memberGroups(COLUMN, inputs(ONE), { neighbours: [] });
  const rows = group(res, 'C1 mains').rows.filter((r) => r.Rebar_Type === 'double_crank');
  assert.equal(rows.length, 16);
  for (const r of rows) {
    const world = genBarPoints(r).points.map((p) => {
      const t = transformBarLocalPoint(r, p);
      return [r.Pos_x + t[0], r.Pos_y + t[1], r.Pos_z + t[2]];
    });
    // world[1] is the jog's foot, world[3] the tail's far end (the lap's top, at the splice's top)
    const dx = world[3][0] - r.Pos_x, dy = world[3][1] - r.Pos_y;
    near(Math.hypot(dx, dy), 25, 0.05);
    assert.ok(dx * (400 - r.Pos_x) + dy * (400 - r.Pos_y) > 0, `${r.Bar_mark} crank steps away from the centre`);
    near(world[3][2], 2645, 0.05);
    near(world[1][2], 1205, 0.05);
  }
});

test('one level on the 800 column: 32 main rows, 32 starters and one link set, 65 rows in all', () => {
  const res = memberGroups(COLUMN, inputs(ONE), { neighbours: [] });
  assert.equal(res.groups.reduce((s, g) => s + g.rows.length, 0), 65);
});

test('the top starters take the top bar\'s Ø and get their own lap', () => {
  const res = memberGroups(COLUMN, inputs(ONE), { neighbours: [] });
  const st = group(res, 'C1 starters').rows;
  const base = st.filter((r) => r.Pos_z === 1290);
  const top = st.filter((r) => r.Dia === 20);
  assert.equal(base.length, 16);
  assert.ok(base.every((r) => r.Dia === 25));
  assert.equal(top.length, 16);
  // lap 990 for Ø20, bend 200 (10 × Ø), straight 790, so the bar is 990 + 790 = 1780 long
  assert.ok(top.every((r) => r.Pos_z === 3510 && r['Length of Bar'] === 1780 && r.H === 200));
});

test('two levels: the bottom two bars are double cranks, the top one straight', () => {
  const res = memberGroups(COLUMN, inputs([{ level: 1500, dia: 20 }, { level: 3000, dia: 16 }]), { neighbours: [] });
  assert.equal(res.ok, true, res.msg);
  const mains = group(res, 'C1 mains').rows;
  const v1 = mains.filter((r) => r.Bar_mark.startsWith('V1-'));
  const v2 = mains.filter((r) => r.Bar_mark.startsWith('V2-'));
  const v3 = mains.filter((r) => r.Bar_mark.startsWith('V3-'));
  assert.equal(v1.length + v2.length + v3.length, 48);
  assert.ok(v1.every((r) => r.Rebar_Type === 'double_crank' && r.Dia === 25));
  assert.ok(v2.every((r) => r.Rebar_Type === 'double_crank' && r.Dia === 20));
  assert.ok(v3.every((r) => r.Rebar_Type === 'straight' && r.Dia === 16));
  near(v1[0].DC_Lap_Start, 652.5, 0.01); // a_1 = 1500 − 645 − 150 = 705
  near(v2[0].Pos_z, 855, 0.01); // b_1 = 1500 − 645
  near(v2[0].DC_Lap_Start, 1530, 0.01); // a_2 = 3000 − 495 − 120 = 2385, less b_1
  assert.equal(v2[0].DC_Lap_Mid, 120);
  assert.equal(v2[0].DC_Tail_Length, 990);
  assert.equal(v2[0].Crank_step, 20);
  near(v3[0].Pos_z, 2505, 0.01); // b_2 = 3000 − 495
  near(v3[0]['Length of Bar'], 1963, 0.01); // to the top end, 4460 + 8
});

test('a zero crank step gives straight lapped bars, with a warning that the bars share a position', () => {
  const res = memberGroups(COLUMN, inputs([{ level: 2000, dia: 20, lap: null, step: 0, jog: null }]), { neighbours: [] });
  assert.equal(res.ok, true, res.msg);
  const v1 = group(res, 'C1 mains').rows.filter((r) => r.Bar_mark.startsWith('V1-'));
  assert.ok(v1.every((r) => r.Rebar_Type === 'straight'));
  near(v1[0]['Length of Bar'], 2645 - 52.5, 0.01);
  assert.ok(res.warnings.some((w) => /share a position/.test(w)));
});

test('memberGroups refuses levels with no room for their splices, and says so', () => {
  const res = memberGroups(COLUMN, inputs([{ level: 1500, dia: 20 }, { level: 1900, dia: 16 }]), { neighbours: [] });
  assert.equal(res.ok, false);
  assert.match(res.msg, /room/);
});
