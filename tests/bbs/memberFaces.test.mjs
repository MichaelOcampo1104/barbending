import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultCardInputs, facePositions, faceDias, levelDefaults, memberGroups, parseFaceBars, parseMainBars, resolveSchedule,
} from '../../src/bbs/memberReinforcement.js';

const near = (a, b, tol = 0.05) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const group = (res, name) => res.groups.find((g) => g.name === name);
const dias = (rows) => rows.reduce((m, r) => ({ ...m, [r.Dia]: (m[r.Dia] || 0) + 1 }), {});

// Column 1: 2500 x 1000 x 4500, cover 40. The long faces (along X) take 44H40 and the short faces 8H32: 22 bars on each long face
// (corners included) and 4 between the corners on each short face.
const COLUMN1 = { id: 'c4', name: 'C1', kind: 'COLUMN', lx: 2500, ly: 1000, lz: 4500, x: 0, y: 0, z: 0, covB: 40, covT: 40 };
const FACES = '44H40 long + 8H32 short';
const inputs = (schedule, layout = 'all') => ({
  ...defaultCardInputs(40),
  kind: 'Column',
  column: { layout, lap: null, schedule },
  starters: { base: true, top: true, dia: null, lap: null, anchorage: null, bend: null },
});
const base = (over = {}) => ({ name: 'Base', sfl: 0, size: '2500 x 1000', bars: FACES, links: 'H10-100 + 2H10-150 X + 6H10-150 Y', ...over });
const level2 = (over = {}) => ({ name: 'Level 2', sfl: 2.5, size: 'same', bars: 'same', links: 'same', ...over });

test('the long and short faces read as separate counts and sizes, in either order', () => {
  assert.deepEqual(parseFaceBars(FACES), { long: { count: 44, dia: 40 }, short: { count: 8, dia: 32 } });
  assert.deepEqual(parseFaceBars('8H32 short + 44H40 long'), { long: { count: 44, dia: 40 }, short: { count: 8, dia: 32 } });
  assert.equal(parseFaceBars('44H40 long'), null);
  assert.equal(parseFaceBars('44H40 long + 8H32 long'), null);
  assert.equal(parseFaceBars('44H40 long + 8H32 short + 4H25 short'), null);
  assert.equal(parseFaceBars('44H25'), null);
  assert.equal(parseMainBars(FACES), null);
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

test('a row with long and short faces resolves to 52 bars with each face\'s size, and its counts must stay the same up the column', () => {
  const r = resolveSchedule([base()], { lx: 2500, ly: 1000, layout: 'all' });
  assert.equal(r.ok, true, r.msg);
  assert.equal(r.count, 52);
  assert.deepEqual(faceDias(r.rows[0]), { long: 40, short: 32 });
  assert.deepEqual(r.rows[0].bars.faces.long, { count: 44, dia: 40 });
  assert.deepEqual(r.rows[0].bars.faces.short, { count: 8, dia: 32 });
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

test('two levels, long faces 40 then 32 and short faces 32 throughout: each face laps with its own lap and crank', () => {
  const rows = [level2({ bars: '44H32 long + 8H32 short' }), base({ links: 'H10-100' })];
  const res = memberGroups(COLUMN1, inputs(rows), { neighbours: [] });
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

test('per-face bars are refused where the layout, the member or the counts cannot take them', () => {
  const two = memberGroups(COLUMN1, inputs([base()], 'x'), { neighbours: [] });
  assert.equal(two.ok, false);
  assert.match(two.msg, /All faces layout/);
  const odd = memberGroups(COLUMN1, inputs([base({ bars: '45H40 long + 8H32 short' })]), { neighbours: [] });
  assert.match(odd.msg, /even count/);
  const square = memberGroups({ ...COLUMN1, lx: 800, ly: 800 }, inputs([base({ size: '800 x 800' })]), { neighbours: [] });
  assert.match(square.msg, /longer one way/);
  const mixed = memberGroups(COLUMN1, inputs([level2({ bars: '44H32' }), base()]), { neighbours: [] });
  assert.match(mixed.msg, /mixes one size/);
  const counts = memberGroups(COLUMN1, inputs([level2({ bars: '46H40 long + 8H32 short' }), base()]), { neighbours: [] });
  assert.match(counts.msg, /counts on each pair of faces must stay the same/);
});

test('cross-ties are counted against the bars each direction can hook: 20 on the long faces, 4 on the short', () => {
  const many = memberGroups(COLUMN1, inputs([base({ links: 'H10-100 + 21H10-150 Y' })]), { neighbours: [] });
  assert.match(many.msg, /Only 20 bars can take a cross-tie along Y, so 21 do not fit/);
  const x = memberGroups(COLUMN1, inputs([base({ links: 'H10-100 + 5H10-150 X' })]), { neighbours: [] });
  assert.match(x.msg, /Only 4 bars can take a cross-tie along X, so 5 do not fit/);
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
