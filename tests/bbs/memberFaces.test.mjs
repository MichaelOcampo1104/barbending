import test from 'node:test';
import assert from 'node:assert/strict';
import {
  barsText, defaultCardInputs, facePositions, faceDias, levelDefaults, memberGroups, resolveSchedule,
} from '../../src/bbs/memberReinforcement.js';

const near = (a, b, tol = 0.05) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const group = (res, name) => res.groups.find((g) => g.name === name);
const dias = (rows) => rows.reduce((m, r) => ({ ...m, [r.Dia]: (m[r.Dia] || 0) + 1 }), {});

// Column 1: 2500 x 1000 x 4500, cover 40. In the "long and short faces" layout, 44H40 is on the long faces (22 on each, corners
// included) and 8H32 on the short faces (4 on each, between the corners).
const COLUMN1 = { id: 'c4', name: 'C1', kind: 'COLUMN', lx: 2500, ly: 1000, lz: 4500, x: 0, y: 0, z: 0, covB: 40, covT: 40 };
const inputs = (schedule, layout = 'faces') => ({
  ...defaultCardInputs(40),
  kind: 'Column',
  column: { layout, lap: null, schedule },
  starters: { base: true, top: true, dia: null, lap: null, anchorage: null, bend: null },
});
const base = (over = {}) => ({
  name: 'Base', sfl: 0, size: '2500 x 1000', barsLong: '44H40', barsShort: '8H32', links: 'H10-100 + 2H10-150 X + 6H10-150 Y', ...over,
});
const level2 = (over = {}) => ({ name: 'Level 2', sfl: 2.5, size: 'same', barsLong: 'same', barsShort: 'same', links: 'same', ...over });

test('one MAIN BARS cell per face: the long faces take 44H40, the short faces 8H32, 52 bars in all', () => {
  const r = resolveSchedule([base()], { lx: 2500, ly: 1000, layout: 'faces' });
  assert.equal(r.ok, true, r.msg);
  assert.equal(r.count, 52);
  assert.deepEqual(faceDias(r.rows[0]), { long: 40, short: 32 });
  assert.deepEqual(r.rows[0].bars.faces.long, { count: 44, dia: 40 });
  assert.deepEqual(r.rows[0].bars.faces.short, { count: 8, dia: 32 });
  assert.equal(barsText(r.rows[0].bars), '44 × H40 long + 8 × H32 short');
});

test('the one-size layout refuses the long-and-short notation, and says which layout to use', () => {
  const r = resolveSchedule([{ ...base(), bars: '44H40 long + 8H32 short' }], { lx: 2500, ly: 1000, layout: 'all' });
  assert.equal(r.ok, false);
  assert.match(r.msg, /Could not read MAIN BARS "44H40 long \+ 8H32 short" on Base/);
  assert.match(r.msg, /For long and short faces, choose that layout/);
});

test('bars on the long faces run corner to corner; the short faces take the bars between their corners', () => {
  const box = { x0: 76, y0: 80, x1: 2434, y1: 930 };
  const pts = facePositions(box, { long: { count: 44, dia: 40 }, short: { count: 8, dia: 32 } }, 'x');
  assert.equal(pts.length, 52);
  assert.equal(new Set(pts.map((p) => p.join(','))).size, 52);
  const bottom = pts.filter(([, y]) => y === 80);
  const top = pts.filter(([, y]) => y === 930);
  const left = pts.filter(([x, y]) => x === 76 && y > 80 && y < 930);
  const right = pts.filter(([x, y]) => x === 2434 && y > 80 && y < 930);
  assert.equal(bottom.length, 22);
  assert.equal(top.length, 22);
  assert.equal(left.length, 4);
  assert.equal(right.length, 4);
  near(bottom[1][0] - bottom[0][0], 2358 / 21, 1e-9);
  assert.deepEqual(bottom[0], [76, 80]);
  assert.deepEqual(bottom[21], [2434, 80]);
  assert.deepEqual(top[0], [2434, 930]);
  assert.deepEqual(top[21], [76, 930]);
  assert.deepEqual(left.map(([, y]) => Math.round(y)), [760, 590, 420, 250]);
  assert.deepEqual(right.map(([, y]) => Math.round(y)), [250, 420, 590, 760]);
});

test('same as below takes each face from the level under it, one face at a time', () => {
  const r = resolveSchedule([level2({ barsShort: '8H32' }), base()], { lx: 2500, ly: 1000, layout: 'faces' });
  assert.equal(r.ok, true, r.msg);
  assert.deepEqual(r.rows[1].bars.faces.long, { count: 44, dia: 40 });
  assert.deepEqual(r.rows[1].bars.faces.short, { count: 8, dia: 32 });
});

test('the bottom row needs both face cells, and an unreadable cell names its face', () => {
  const noLong = resolveSchedule([base({ barsLong: 'same' })], { lx: 2500, ly: 1000, layout: 'faces' });
  assert.match(noLong.msg, /The bottom row needs its own MAIN BARS on the long faces/);
  const typo = resolveSchedule([base({ barsShort: '8 bars' })], { lx: 2500, ly: 1000, layout: 'faces' });
  assert.match(typo.msg, /Could not read MAIN BARS on the short faces "8 bars" on Base/);
});

test('column 1: 44H40 long, 8H32 short, 2 X and 6 Y cross-ties at 150, adds 165 rows', () => {
  const res = memberGroups(COLUMN1, inputs([base()]), { neighbours: [] });
  assert.equal(res.ok, true, res.msg);
  assert.equal(res.groups.reduce((s, g) => s + g.rows.length, 0), 165);

  const mains = group(res, 'C1 mains').rows;
  assert.equal(mains.length, 52);
  assert.deepEqual(dias(mains), { 32: 8, 40: 44 });
  assert.equal(mains.filter((r) => r.Pos_y === 80 && r.Dia === 40).length, 22);
  assert.equal(mains.filter((r) => r.Pos_x === 76 && r.Dia === 32).length, 4);
  near(mains[0]['Length of Bar'], 4420, 0.01);

  const st = group(res, 'C1 starters').rows;
  assert.equal(st.length, 104);
  assert.deepEqual(dias(st), { 32: 16, 40: 88 });

  const links = group(res, 'C1 links').rows;
  assert.equal(links.find((r) => r.Bar_mark === 'T1').qty_z, 45);
  const ct = links.filter((r) => r.Bar_mark.startsWith('CT1-'));
  const cx = links.filter((r) => r.Bar_mark.startsWith('CX1-'));
  assert.equal(ct.length, 6);
  assert.equal(cx.length, 2);
  for (const r of ct) {
    assert.equal(r.Rebar_Type, 'c_link_with_hook');
    assert.equal(r.double_hook, 'yes');
    assert.equal(r.Dia, 10);
    assert.equal(r.Pos_Rotation, 90);
    assert.equal(r.c_length_b, 60); // a Y tie holds the long-face bar: 40 + 10 + 10
    near(r.length, 900, 0.01); // 850 between the rows plus the 50 hook
    assert.equal(r.qty_z, 30);
    near(r.Pos_y, 55, 0.01);
    near(r.Pos_z, 45, 0.01);
  }
  for (const r of cx) {
    assert.equal(r.Rebar_Type, 'c_link_with_hook');
    assert.equal(r.double_hook, 'yes');
    assert.equal(r.Pos_Rotation, 0);
    assert.equal(r.c_length_b, 52); // an X tie holds the short-face bar: 32 + 10 + 10
    near(r.length, 2400, 0.01); // 2358 between the columns plus the 42 hook
    assert.equal(r.qty_z, 30);
    near(r.Pos_x, 55, 0.01); // the left column's bar centre (76) less half the hook
    near(r.Pos_z, 55, 0.01); // one tie diameter above the Y ties (item M)
  }
  // Y ties sit on the 3rd and 6th interior bars of the bottom row; X ties on the 2nd and 3rd interior bars of the left column.
  near(ct[0].Pos_x, 437.86, 0.02);
  near(ct[5].Pos_x, 2122.14, 0.02);
  near(cx[0].Pos_y, 399, 0.01);
  near(cx[1].Pos_y, 569, 0.01);
});

test('two levels: the long faces go 40 then 32 and the short faces stay 32, each face laps with its own lap and crank', () => {
  const rows = [level2({ barsLong: '44H32', barsShort: '8H32' }), base({ links: 'H10-100' })];
  // The 2.5 m level's splice (40 → 32 on the long faces, lap 2240) runs up to 5055 mm, so this test uses a 5.5 m member.
  const res = memberGroups({ ...COLUMN1, lz: 5500 }, inputs(rows), { neighbours: [] });
  assert.equal(res.ok, true, res.msg);
  const mains = group(res, 'C1 mains').rows;
  assert.equal(mains.length, 104);
  const cranks = mains.filter((r) => r.Rebar_Type === 'double_crank');
  assert.equal(cranks.length, 52);
  const longCranks = cranks.filter((r) => r.Dia === 40);
  const shortCranks = cranks.filter((r) => r.Dia === 32);
  assert.equal(longCranks.length, 44);
  assert.equal(shortCranks.length, 8);
  assert.ok(longCranks.every((r) => r.Crank_step === levelDefaults(40, 32).step && r.DC_Tail_Length === levelDefaults(40, 32).lap));
  assert.ok(shortCranks.every((r) => r.Crank_step === levelDefaults(32, 32).step && r.DC_Tail_Length === levelDefaults(32, 32).lap));
  assert.ok(mains.filter((r) => r.Rebar_Type === 'straight').every((r) => r.Dia === 32));
});

test('the starters take each face\'s bar: H40 on the long faces, H32 on the short faces, at both ends', () => {
  const res = memberGroups(COLUMN1, inputs([base({ links: 'H10-100' })]), { neighbours: [] });
  const st = group(res, 'C1 starters').rows;
  assert.equal(st.filter((r) => r.Bar_mark.startsWith('ST1-')).length, 52);
  assert.equal(st.filter((r) => r.Bar_mark.startsWith('ST2-')).length, 52);
  assert.deepEqual(dias(st.filter((r) => r.Bar_mark.startsWith('ST1-'))), { 32: 8, 40: 44 });
  assert.deepEqual(dias(st.filter((r) => r.Bar_mark.startsWith('ST2-'))), { 32: 8, 40: 44 });
});

test('per-face bars are refused where the counts or the member cannot take them', () => {
  const odd = memberGroups(COLUMN1, inputs([base({ barsLong: '45H40' })]), { neighbours: [] });
  assert.equal(odd.ok, false);
  assert.match(odd.msg, /even count/);
  const square = memberGroups({ ...COLUMN1, lx: 800, ly: 800 }, inputs([base({ size: '800 x 800' })]), { neighbours: [] });
  assert.match(square.msg, /longer one way/);
  const counts = memberGroups(COLUMN1, inputs([level2({ barsLong: '46H40' }), base()]), { neighbours: [] });
  assert.match(counts.msg, /counts on each pair of faces must stay the same/);
});

test('cross-ties are counted against the bars each direction can hook: 20 on the long faces, 4 on the short', () => {
  const many = memberGroups(COLUMN1, inputs([base({ links: 'H10-100 + 21H10-150 Y' })]), { neighbours: [] });
  assert.match(many.msg, /Only 20 bars can take a cross-tie along Y, so 21 do not fit/);
  const x = memberGroups(COLUMN1, inputs([base({ links: 'H10-100 + 5H10-150 X' })]), { neighbours: [] });
  assert.match(x.msg, /Only 4 bars can take a cross-tie along X, so 5 do not fit/);
});

test('cross-ties off the bars: with looseTies the drawn count is kept and the output warns, and a count past the faces is still refused', () => {
  // 25 bars on 1500 x 800: the four corners leave 21 for the sides, so the bottom row has six between its corners and the top row five. No Y tie
  // finds a bar on both rows, but the six ties keep their count and length.
  const C5 = { id: 'c5', name: 'C5', kind: 'COLUMN', lx: 1500, ly: 800, lz: 4000, x: 0, y: 0, z: 0, covB: 40, covT: 40 };
  const row = { name: 'Base', sfl: 0, size: '1500 x 800', bars: '25H25', links: 'H10-125 + 2H10-125 X + 6H10-125 Y' };
  const refused = memberGroups(C5, inputs([row], 'all'), { neighbours: [] });
  assert.match(refused.msg, /Cross-ties along Y hook bars/);
  const res = memberGroups(C5, inputs([row], 'all'), { neighbours: [], looseTies: true });
  assert.equal(res.ok, true, res.msg);
  const links = group(res, 'C5 links').rows;
  assert.equal(links.filter((r) => r.Bar_mark.startsWith('CT1-')).length, 6);
  assert.equal(links.filter((r) => r.Bar_mark.startsWith('CX1-')).length, 2);
  assert.ok(res.warnings.some((w) => /6 cross-ties along Y sit at evenly spaced positions, because no bars line up/.test(w)), res.warnings.join('\n'));
  const past = memberGroups(C5, inputs([{ ...row, links: 'H10-125 + 7H10-125 Y' }], 'all'), { neighbours: [], looseTies: true });
  assert.match(past.msg, /Only 6 bars can take a cross-tie along Y, so 7 do not fit/);
});

test('a member longer along Y has its long faces as the left and right columns, and the hook widths swap', () => {
  const tall = { ...COLUMN1, lx: 1000, ly: 2500 };
  const rows = [base({ size: '1000 x 2500', links: 'H10-100 + 6H10-150 X + 2H10-150 Y' })];
  const res = memberGroups(tall, inputs(rows), { neighbours: [] });
  assert.equal(res.ok, true, res.msg);
  const mains = group(res, 'C1 mains').rows;
  assert.deepEqual(dias(mains), { 32: 8, 40: 44 });
  assert.equal(mains.filter((r) => r.Pos_x === 80 && r.Dia === 40).length, 22);
  const links = group(res, 'C1 links').rows;
  const cx = links.filter((r) => r.Bar_mark.startsWith('CX1-'));
  const ct = links.filter((r) => r.Bar_mark.startsWith('CT1-'));
  assert.equal(cx.length, 6);
  assert.equal(ct.length, 2);
  for (const r of cx) {
    assert.equal(r.c_length_b, 60); // X ties hold the long faces on the left and right
    near(r.length, 900, 0.01); // 850 between the columns plus 50
  }
  for (const r of ct) {
    assert.equal(r.c_length_b, 52); // Y ties hold the short faces at the top and bottom
    near(r.length, 2400, 0.01); // 2358 between the rows plus 42
  }
});

test('a level above the top names the level and both heights, so a short member is easy to spot', () => {
  const res = memberGroups(COLUMN1, inputs([level2({ sfl: 9 }), base()]), { neighbours: [] });
  assert.equal(res.ok, false);
  assert.match(res.msg, /Level 2 is 9000 mm above the base, but this member is only 4500 mm high, so the level is not below its top/);
});

test('SFL is in metres: the drawing\'s values fit a 12 m member, and a millimetre value is refused by name', () => {
  const tall = { ...COLUMN1, lz: 12000 };
  const drawing = [
    level2({ name: 'B2 concourse', sfl: -12.27, barsLong: 'same', barsShort: 'same' }),
    level2({ name: 'B3 platform', sfl: -18.57, barsLong: 'same', barsShort: 'same' }),
    base({ name: 'B3 underplatform', sfl: -20.87, links: 'H10-150' }),
  ];
  const ok = memberGroups(tall, inputs(drawing), { neighbours: [] });
  assert.equal(ok.ok, true, ok.msg);
  assert.deepEqual(resolveSchedule(drawing, { lx: 2500, ly: 1000, layout: 'faces' }).rows.map((r) => r.h), [0, 2300, 8600]);
  const mm = [level2({ name: 'B2 concourse', sfl: -12270 }), base({ name: 'B3 underplatform', sfl: -20870, links: 'H10-150' })];
  const refused = memberGroups(tall, inputs(mm), { neighbours: [] });
  assert.equal(refused.ok, false);
  assert.match(refused.msg, /B3 underplatform: SFL -20870 is over 1000 m/);
});
