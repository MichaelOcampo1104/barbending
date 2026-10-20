import test from 'node:test';
import assert from 'node:assert/strict';
import { genBarPoints, transformBarLocalPoint } from '../../src/bbs/shapes.js';
import {
  parseSize, parseMainBars, parseLinks, isSameBelow, resolveSchedule, memberGroups, defaultCardInputs,
} from '../../src/bbs/memberReinforcement.js';

const near = (a, b, tol = 0.05) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const group = (res, name) => res.groups.find((g) => g.name === name);

// The drawing's column (2500 x 1000), read top first as the drawing lists it. SFL in metres.
const DRAWING = [
  { name: 'B2 lower concourse', sfl: -12.27, size: 'same', bars: 'same', links: 'same' },
  { name: 'B3 platform', sfl: -18.57, size: 'same', bars: '44H25', links: 'same' },
  { name: 'B3 underplatform', sfl: -20.87, size: '2500 x 1000', bars: '44H32', links: 'H10-150 + 6H10-150' },
];
const MEMBER = { id: 'c3', name: 'C3', kind: 'COLUMN', lx: 2500, ly: 1000, lz: 12000, x: 0, y: 0, z: 0, covB: 40, covT: 40 };
const inputs = (schedule) => ({ ...defaultCardInputs(40), kind: 'Column', column: { layout: 'all', lap: null, schedule }, starters: { base: true, top: true, dia: null, lap: null, anchorage: null, bend: null } });

test('the drawing\'s cell notation reads as numbers', () => {
  assert.deepEqual(parseMainBars('44H25'), { count: 44, dia: 25 });
  assert.deepEqual(parseMainBars(' 52 h 25 '), { count: 52, dia: 25 });
  assert.equal(parseMainBars('44'), null);
  assert.deepEqual(parseSize('2500 x 1000'), { lx: 2500, ly: 1000 });
  assert.deepEqual(parseSize('2800×1400'), { lx: 2800, ly: 1400 });
  assert.equal(parseSize('2500'), null);
  assert.deepEqual(parseLinks('H10-150 + 6H10-150'), { sets: 1, dia: 10, spacing: 150, cross: [{ count: 6, dia: 10, spacing: 150, dir: 'Y' }] });
  assert.deepEqual(parseLinks('H10-100'), { sets: 1, dia: 10, spacing: 100, cross: [] });
  assert.deepEqual(parseLinks('H10-100 + 4H10-100 X + 6H10-100 y'), {
    sets: 1, dia: 10, spacing: 100,
    cross: [{ count: 4, dia: 10, spacing: 100, dir: 'X' }, { count: 6, dia: 10, spacing: 100, dir: 'Y' }],
  });
  assert.equal(parseLinks('H10-100 + 4H10-100 Z'), null);
  assert.equal(parseLinks('3H10-100 + 8H10-100').sets, 3);
  assert.equal(parseLinks('links please'), null);
  assert.equal(isSameBelow('same as below'), true);
  assert.equal(isSameBelow('SAME'), true);
  assert.equal(isSameBelow('44H25'), false);
});

test('the schedule resolves bottom first, with heights from SFL differences and "same as below" copied down', () => {
  const r = resolveSchedule(DRAWING, { lx: 2500, ly: 1000 });
  assert.equal(r.ok, true, r.msg);
  assert.deepEqual(r.rows.map((x) => x.h), [0, 2300, 8600]);
  assert.deepEqual(r.rows.map((x) => x.bars.dia), [32, 25, 25]);
  assert.equal(r.count, 44);
  assert.equal(r.linkDia, 10);
  // the two upper rows take the bottom row's links, as the drawing's "SAME AS BELOW" does
  assert.ok(r.rows.every((x) => x.links.spacing === 150 && x.links.cross[0].count === 6));
});

test('the schedule refuses what it cannot read or model, and says which level', () => {
  const bottomSame = [{ ...DRAWING[2], bars: 'same' }];
  assert.match(resolveSchedule(bottomSame, { lx: 2500, ly: 1000 }).msg, /needs its own MAIN BARS/);
  assert.match(resolveSchedule(DRAWING, { lx: 2800, ly: 1400 }).msg, /does not match this member/);
  const count = [DRAWING[0], { ...DRAWING[1], bars: '52H25' }, DRAWING[2]];
  assert.match(resolveSchedule(count, { lx: 2500, ly: 1000 }).msg, /bar count must stay the same/);
  const link = [DRAWING[0], { ...DRAWING[1], links: 'H12-150' }, DRAWING[2]];
  assert.match(resolveSchedule(link, { lx: 2500, ly: 1000 }).msg, /outer link/);
  const sets = [{ ...DRAWING[0], links: '3H10-100 + 8H10-100' }, DRAWING[1], DRAWING[2]];
  assert.match(resolveSchedule(sets, { lx: 2500, ly: 1000 }).msg, /closed link sets/);
  const order = [DRAWING[0], DRAWING[1], { ...DRAWING[2], sfl: -18.0 }];
  assert.match(resolveSchedule(order, { lx: 2500, ly: 1000 }).msg, /above the level below/);
  const typo = [DRAWING[0], { ...DRAWING[1], bars: '44 bars' }, DRAWING[2]];
  assert.match(resolveSchedule(typo, { lx: 2500, ly: 1000 }).msg, /Could not read MAIN BARS "44 bars" on B3 platform/);
});

test('the drawing\'s column: three splices, the bottom bars Z-cranked, 234 rows', () => {
  const res = memberGroups(MEMBER, inputs(DRAWING), { neighbours: [] });
  assert.equal(res.ok, true, res.msg);
  assert.equal(res.groups.reduce((s, g) => s + g.rows.length, 0), 234);
  const mains = group(res, 'C3 mains').rows;
  const v1 = mains.filter((r) => r.Bar_mark.startsWith('V1-'));
  const v2 = mains.filter((r) => r.Bar_mark.startsWith('V2-'));
  const v3 = mains.filter((r) => r.Bar_mark.startsWith('V3-'));
  assert.equal(v1.length + v2.length + v3.length, 132);
  // splice at 2300: lap 1650 (the larger bar, H32), crank 35, jog 210
  assert.ok(v1.every((r) => r.Rebar_Type === 'double_crank' && r.Dia === 32));
  assert.equal(v1[0].DC_Lap_Start, 2319); // a = 2300 + 75, less the bar's bottom (56)
  assert.equal(v1[0].DC_Lap_Mid, 210);
  assert.equal(v1[0].DC_Tail_Length, 1650);
  assert.equal(v1[0].Crank_step, 35);
  // splice at 8600: H25 both sides, so lap 1290, crank 25, jog 150
  assert.ok(v2.every((r) => r.Rebar_Type === 'double_crank' && r.Dia === 25));
  assert.equal(v2[0].DC_Lap_Start, 6090); // a = 8600 + 75, less b of the splice below (2585)
  assert.equal(v2[0].DC_Tail_Length, 1290);
  assert.equal(v2[0].Crank_step, 25);
  assert.ok(v3.every((r) => r.Rebar_Type === 'straight' && r.Dia === 25));
  near(v3[0].Pos_z, 8825, 0.01); // b of the top splice: 8600 + 75 + jog 150
  near(v3[0]['Length of Bar'], 3147.5, 0.01); // to the top end, 11972.5 − 8825
});

test('the links: a stack per run of bar sizes, and six c_link_with_hook cross-ties in each run', () => {
  const res = memberGroups(MEMBER, inputs(DRAWING), { neighbours: [] });
  const links = group(res, 'C3 links').rows;
  // the bars change Ø at the platform (H32 below, H25 above), so the cross-ties restart the links there
  const t1 = links.find((r) => r.Bar_mark === 'T1');
  const t2 = links.find((r) => r.Bar_mark === 'T2');
  assert.equal(t1.qty_z, 16);
  near(t1.Pos_z, 45, 0.01);
  assert.equal(t2.qty_z, 65);
  near(t2.Pos_z, 2305, 0.01);
  const ct1 = links.filter((r) => r.Bar_mark.startsWith('CT1-'));
  const ct2 = links.filter((r) => r.Bar_mark.startsWith('CT2-'));
  assert.equal(ct1.length, 6);
  assert.equal(ct2.length, 6);
  for (const r of ct1) {
    assert.equal(r.Rebar_Type, 'c_link_with_hook');
    assert.equal(r.double_hook, 'yes');
    assert.equal(r.Dia, 10);
    assert.equal(r.Pos_Rotation, 90);
    assert.equal(r.qty_z, 16);
    // spine from the bottom bar row (76) less half the hook (21) to the top bar row (934) plus 21
    near(r.length, 900, 0.01);
    assert.equal(r.c_length_b, 52); // hook: bar 32 + tie 10 + tie 10
    near(r.Pos_y, 55, 0.01);
  }
  for (const r of ct2) {
    near(r.length, 893, 0.01); // bar 25 in the upper run: hook 35
    assert.equal(r.c_length_b, 45);
    assert.equal(r.qty_z, 65);
  }
  // six of the ten bars on each long side, spread evenly; each spine sits half a hook right of its bar
  near(ct1[0].Pos_x, 504.73 + 21, 0.02);
  near(ct1[5].Pos_x, 2005.27 + 21, 0.02);
});

test('a c_link_with_hook cross-tie holds its bar: the bar sits between the spine and the return, a half hook from each', () => {
  const res = memberGroups(MEMBER, inputs(DRAWING), { neighbours: [] });
  const ct = group(res, 'C3 links').rows.find((r) => r.Bar_mark === 'CT1-1');
  const pts = genBarPoints(ct).points.map((p) => {
    const t = transformBarLocalPoint(ct, p);
    return [ct.Pos_x + t[0], ct.Pos_y + t[1]];
  });
  // the hook: return end, closure, spine, closure, return end. Spine at x 525.73, return at 483.73, bar centre at 504.73
  const spineX = ct.Pos_x, returnX = ct.Pos_x - (ct.c_length_b - ct.Dia);
  near(spineX - returnX, 42, 0.01);
  near(pts[2][0], spineX, 0.01);
  near(pts[0][0], returnX, 0.01);
  near(returnX + (spineX - returnX) / 2, 504.73, 0.02);
  // the bar's row (76) sits between the closure below it (55) and the spine's far end above it
  near(pts[1][1] + (ct.c_length_b - ct.Dia) / 2 - 76, 0, 0.01);
});

test('the starters take each end\'s bar: H32 at the base, H25 at the top', () => {
  const res = memberGroups(MEMBER, inputs(DRAWING), { neighbours: [] });
  const st = group(res, 'C3 starters').rows;
  assert.equal(st.length, 88);
  assert.equal(st.filter((r) => r.Dia === 32).length, 44);
  assert.equal(st.filter((r) => r.Dia === 25).length, 44);
});

test('a schedule that leaves no room for its top splice is refused', () => {
  const short = { ...MEMBER, lz: 9000 };
  const res = memberGroups(short, inputs(DRAWING), { neighbours: [] });
  assert.equal(res.ok, false);
  assert.match(res.msg, /room/);
});

test('links never run past the top of the member (a height where the old count overshot)', () => {
  // intH 4500 divides by the 150 spacing exactly, which made the old count one link too many.
  const tall = { ...MEMBER, lx: 800, ly: 800, lz: 4580 };
  const res = memberGroups(tall, inputs([{ name: 'Base', sfl: 0, size: '800 x 800', bars: '16H25', links: 'H10-150' }]), { neighbours: [] });
  const t1 = group(res, 'C3 links').rows.find((r) => r.Bar_mark === 'T1');
  assert.equal(t1.qty_z, 30);
  const last = t1.Pos_z + (t1.qty_z - 1) * t1.spacing_z;
  assert.ok(last + 5 <= 4580 - 40, `last link top ${last + 5} is above the cover line`);
});

test('two faces read the count per face: 4H25 on each of the two faces gives 8 mains and 2 cross-ties per layer', () => {
  const member = { ...MEMBER, lx: 800, ly: 800, lz: 4500 };
  const rows = [{ name: 'Base', sfl: 0, size: '800 x 800', bars: '4H25', links: 'H10-150 + 2H10-150' }];
  const inp = { ...defaultCardInputs(40), kind: 'Column', column: { layout: 'x', lap: null, schedule: rows }, starters: { base: true, top: true, dia: null, lap: null, anchorage: null, bend: null } };
  const res = memberGroups(member, inp, { neighbours: [] });
  assert.equal(res.ok, true, res.msg);
  assert.equal(group(res, 'C3 mains').rows.length, 8);
  assert.equal(group(res, 'C3 links').rows.filter((r) => r.Bar_mark.startsWith('CT1-')).length, 2);
});

test('cross-ties are refused when the top and bottom rows have too few bars to hook', () => {
  // 16 bars on 800 x 800 leave 3 interior bars on each long side, so 4 cross-ties do not fit
  const member = { ...MEMBER, lx: 800, ly: 800, lz: 4500 };
  const rows = [{ name: 'Base', sfl: 0, size: '800 x 800', bars: '16H25', links: 'H10-150 + 4H10-150' }];
  const inp = { ...defaultCardInputs(40), kind: 'Column', column: { layout: 'all', lap: null, schedule: rows }, starters: { base: true, top: true, dia: null, lap: null, anchorage: null, bend: null } };
  const res = memberGroups(member, inp, { neighbours: [] });
  assert.equal(res.ok, false);
  assert.match(res.msg, /Only 3 bars/);
});

test('cross-ties are refused with two faces along Y, where no bars sit on the top and bottom rows', () => {
  const member = { ...MEMBER, lx: 800, ly: 800, lz: 4500 };
  const rows = [{ name: 'Base', sfl: 0, size: '800 x 800', bars: '4H25', links: 'H10-150 + 2H10-150' }];
  const inp = { ...defaultCardInputs(40), kind: 'Column', column: { layout: 'y', lap: null, schedule: rows }, starters: { base: true, top: true, dia: null, lap: null, anchorage: null, bend: null } };
  const res = memberGroups(member, inp, { neighbours: [] });
  assert.equal(res.ok, false);
  assert.match(res.msg, /top and bottom rows/);
});

test('column 2 (2800 x 1400, 52H25): outer H10-100, 4 cross-ties along X and 6 along Y, both H10-100, 167 rows', () => {
  const member = { ...MEMBER, lx: 2800, ly: 1400, lz: 4500 };
  const rows = [{ name: 'Base', sfl: 0, size: '2800 x 1400', bars: '52H25', links: 'H10-100 + 4H10-100 X + 6H10-100 Y' }];
  const res = memberGroups(member, inputs(rows), { neighbours: [] });
  assert.equal(res.ok, true, res.msg);
  assert.equal(res.groups.reduce((s, g) => s + g.rows.length, 0), 167);
  const links = group(res, 'C3 links').rows;
  const t1 = links.find((r) => r.Bar_mark === 'T1');
  assert.equal(t1.qty_z, 45);
  assert.equal(t1.spacing_z, 100);
  const cx = links.filter((r) => r.Bar_mark.startsWith('CX1-'));
  const ct = links.filter((r) => r.Bar_mark.startsWith('CT1-'));
  assert.equal(cx.length, 4);
  assert.equal(ct.length, 6);
  for (const r of cx) {
    assert.equal(r.Rebar_Type, 'c_link_with_hook');
    assert.equal(r.double_hook, 'yes');
    assert.equal(r.Pos_Rotation, 0);
    near(r.length, 2700, 0.01); // 2665 between the bar centres plus the 35 mm hook
    assert.equal(r.c_length_b, 45);
    assert.equal(r.qty_z, 45);
    near(r.Pos_x, 55, 0.01); // the left bar's centre (72.5) less half the hook
    near(r.Pos_z, 55, 0.01); // one tie diameter above the Y ties' layer (45)
  }
  near(cx[0].Pos_y, 346.92, 0.02); // the 3rd interior bar of the left column (364.42), less half the hook
  near(cx[3].Pos_y, 1028.08, 0.02);
  for (const r of ct) {
    near(r.length, 1300, 0.01); // 1265 between the bar rows plus the 35 mm hook
    assert.equal(r.qty_z, 45);
    near(r.Pos_z, 45, 0.01);
  }
  near(ct[0].Pos_x, 500, 0.02);
  // the X tie's hook: its spine runs from the left bar to the right bar, and the bar lies between the spine and the return
  const pts = genBarPoints(cx[0]).points.map((p) => {
    const t = transformBarLocalPoint(cx[0], p);
    return [cx[0].Pos_x + t[0], cx[0].Pos_y + t[1]];
  });
  near(pts[2][0], 55, 0.01); // the closure, outside the left bar
  near(pts[3][0], 2755, 0.01); // the far closure, outside the right bar (2737.5 + 17.5)
  near(pts[2][1], 346.92, 0.01);
  near((pts[1][1] + pts[2][1]) / 2, 364.42, 0.02); // the bar's row, midway between spine and return
});

test('X cross-ties are refused with two faces along X, and when the left column has too few bars', () => {
  const member = { ...MEMBER, lx: 800, ly: 800, lz: 4500 };
  const two = [{ name: 'Base', sfl: 0, size: '800 x 800', bars: '4H25', links: 'H10-100 + 2H10-100 X' }];
  const inpTwo = { ...defaultCardInputs(40), kind: 'Column', column: { layout: 'x', lap: null, schedule: two }, starters: { base: true, top: true, dia: null, lap: null, anchorage: null, bend: null } };
  const refusedTwo = memberGroups(member, inpTwo, { neighbours: [] });
  assert.equal(refusedTwo.ok, false);
  assert.match(refusedTwo.msg, /left and right faces/);
  const many = [{ name: 'Base', sfl: 0, size: '800 x 800', bars: '16H25', links: 'H10-100 + 4H10-100 X' }];
  const refusedMany = memberGroups(member, inputs(many), { neighbours: [] });
  assert.equal(refusedMany.ok, false);
  assert.match(refusedMany.msg, /Only 3 bars can take a cross-tie along X, so 4 do not fit/);
});
