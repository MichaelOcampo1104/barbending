import test from 'node:test';
import assert from 'node:assert/strict';
import { genBarPoints, transformBarLocalPoint } from '../../src/bbs/shapes.js';
import { defaultCardInputs, memberGroups, resolveSchedule, stepClash } from '../../src/bbs/memberReinforcement.js';

// The C4/C4A column of the drawing, as entered on the card (spec docs/superpowers/specs/2026-10-20-column-size-steps-design.md, sections 2 to
// 4 and 9): a 3200 x 800 base, a 2400 x 800 section from B1 up to the roof soffit, Hz 20900. At the B1 step the lower bars lap as usual, bend
// in, or end in the B1 slab.
const near = (a, b, tol = 0.05) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const group = (res, name) => res.groups.find((g) => g.name === name);
const MEMBER = { id: 'c4', name: 'C4', kind: 'COLUMN', lx: 3200, ly: 800, lz: 20900, x: 0, y: 0, z: 0, covB: 40, covT: 40 };
const LINKS = 'H10-100 + 2H10-100 X + 4H10-100 Y';
const DRAWING = [
  { name: 'B1 concourse', sfl: -5.79, size: '2400 x 800', layout: 'all', bars: '40H25', links: 'same', slab: '800' },
  { name: 'B2 lower concourse', sfl: -12.27, size: 'same', layout: 'same', bars: 'same', barsLong: 'same', barsShort: 'same', links: 'same', slab: '1200' },
  { name: 'B3 platform', sfl: -18.57, size: 'same', layout: 'same', bars: 'same', barsLong: 'same', barsShort: 'same', links: 'same', slab: '1500' },
  { name: 'B3 underplatform', sfl: -20.87, size: '3200 x 800', layout: 'faces', bars: '', barsLong: '40H40', barsShort: '8H32', links: LINKS },
];
const inputs = (schedule) => ({
  ...defaultCardInputs(40),
  kind: 'Column',
  column: { layout: 'all', lap: null, schedule },
  starters: { base: true, top: true, dia: null, lap: null, anchorage: null, bend: null },
});
const built = () => memberGroups(MEMBER, inputs(DRAWING), { neighbours: [] });

test('C4/C4A builds at Hz 20900 with no refusal: 184 mains, 28 links and 88 starters', () => {
  const res = built();
  assert.equal(res.ok, true, res.msg);
  assert.equal(group(res, 'C4 mains').rows.length, 184);
  assert.equal(group(res, 'C4 links').rows.length, 28);
  assert.equal(group(res, 'C4 starters').rows.length, 88);
});

test('the step sits at the B1 SFL: the lower bars split 28 lap as usual, 12 bend in, and 8 end in the slab at 14320 mm', () => {
  assert.deepEqual(built().steps, [{ name: 'B1 concourse', soffit: 14280, zL: 14320, zSFL: 15080, counts: { inside: 28, bend: 12, terminate: 8 } }]);
});

test('the step warning gives the split and where the bars end', () => {
  const warn = built().warnings.find((w) => /the bars change/.test(w));
  assert.match(warn, /^At B1 concourse \(15080 mm above the base\) the bars change: 28 lap as usual, 12 bend in to the new section, and 8 end in the slab, bent in at 14320 mm\./);
});

test('the 28 lower bars inside the new width lap as usual: each cranks 40 mm, jogs 240 mm, and laps 2240 mm from 75 mm above the B1 SFL', () => {
  const inside = group(built(), 'C4 mains').rows.filter((r) => r.Bar_mark.startsWith('V3-') && r.Rebar_Type === 'double_crank' && r.Dia === 40 && r.Crank_step === 40);
  assert.equal(inside.length, 28);
  for (const r of inside) {
    assert.equal(r.Pos_z, 8915);           // the B2 splice's upper bar starts at 8915
    near(r.DC_Lap_Start, 6240, 0.01);      // a = 15155 (75 above the B1 SFL at 15080), less that 8915
    assert.equal(r.DC_Lap_Mid, 240);
    assert.equal(r.DC_Tail_Length, 2240);
  }
});

test('the nearest long-face bar at each end of each long face bends in: it moves 74.6 mm, cranks 114.6, and its crank foot is 690 mm below the B1 SFL', () => {
  const bends = group(built(), 'C4 mains').rows.filter((r) => r.Bar_mark.startsWith('V3-') && r.Rebar_Type === 'double_crank' && r.Dia === 40 && r.Crank_step !== 40);
  assert.equal(bends.length, 4);
  for (const r of bends) {
    near(r.Crank_step, 114.6);
    assert.equal(r.DC_Lap_Mid, 690);
    assert.equal(r.DC_Tail_Length, 2240);
    near(r.DC_Lap_Start, 14390 - 8915, 0.01);   // a = 14390 (the SFL less the jog), less that 8915
  }
});

test('every short-face bar bends in: it moves 396.5 mm, cranks 431.5, and its 2590 mm jog ends at the B1 SFL with a 1650 mm lap', () => {
  const bends = group(built(), 'C4 mains').rows.filter((r) => r.Bar_mark.startsWith('V3-') && r.Rebar_Type === 'double_crank' && r.Dia === 32);
  assert.equal(bends.length, 8);
  for (const r of bends) {
    near(r.Crank_step, 431.5);
    assert.equal(r.DC_Lap_Mid, 2590);
    assert.equal(r.DC_Tail_Length, 1650);
    assert.equal(r.Pos_z, 8885);
    near(r.DC_Lap_Start, 12490 - 8885, 0.01);   // a = 12490 (the SFL less the jog), less that 8885
  }
});

test('the outer long-face bars end in the B1 slab: bent in at 14320 mm, each leg its 2240 mm lap', () => {
  const v3 = group(built(), 'C4 mains').rows.filter((r) => r.Bar_mark.startsWith('V3-') && r.Rebar_Type === 'bent');
  assert.equal(v3.length, 8);
  for (const r of v3) {
    assert.equal(r.Dia, 40);
    assert.equal(r.Pos_Rotation, 90);
    assert.equal(r.bent_up_down, 'up');
    assert.equal(r.H, 2240);
    assert.equal(r.Pos_z, 8915);
    near(r['Length of Bar'], 14320 - 8915);
  }
});

test('the bends point off their own faces: a corner turns diagonally out, a south-face bar straight south', () => {
  const res = built();
  const mains = group(res, 'C4 mains').rows;
  const legEnd = (mark) => {
    const r = mains.find((m) => m.Bar_mark === mark);
    const pts = genBarPoints(r).points.map((p) => {
      const t = transformBarLocalPoint(r, p);
      return [r.Pos_x + t[0], r.Pos_y + t[1], r.Pos_z + t[2]];
    });
    return pts[pts.length - 1];
  };
  const corner = legEnd('V3-1');    // the SW corner bar: (76, 80)
  assert.ok(corner[0] < 76 && corner[1] < 80, `corner leg ends at ${corner}`);
  const south = legEnd('V3-2');     // a bar on the south face: (237, 80)
  near(south[0], 237, 0.5);
  assert.ok(south[1] < 80, `south leg ends at ${south}`);
});

test('the upper section takes the 40 bars that lap or bend in: 28 start at 15395 mm, the 12 bends at the B1 SFL, 15080 mm, each to the top cover', () => {
  const v4 = group(built(), 'C4 mains').rows.filter((r) => r.Bar_mark.startsWith('V4-'));
  assert.equal(v4.length, 40);
  for (const r of v4) {
    assert.equal(r.Rebar_Type, 'straight');
    assert.equal(r.Dia, 25);
    assert.equal(r.Pos_Rotation, 90);
    near(r['Length of Bar'], r.Pos_z === 15395 ? 5477.5 : 5792.5, 0.01);   // 20900 − 40 + 12.5, less its bottom
  }
  assert.equal(v4.filter((r) => r.Pos_z === 15395).length, 28);
  assert.equal(v4.filter((r) => r.Pos_z === 15080).length, 12);
});

test('the upper bars stay inside the 2400 x 800 box: the bends end on its left and right edges, the rest keep their lower positions', () => {
  const v4 = group(built(), 'C4 mains').rows.filter((r) => r.Bar_mark.startsWith('V4-'));
  // The 2400 box is centred on the base: x from 472.5 to 2737.5 (rule H on the left, one link less on the right). The rows keep y 80 and 730.
  near(Math.min(...v4.map((r) => r.Pos_x)), 472.5, 0.01);
  near(Math.max(...v4.map((r) => r.Pos_x)), 2737.5, 0.01);
  near(Math.min(...v4.map((r) => r.Pos_y)), 80, 0.01);
  near(Math.max(...v4.map((r) => r.Pos_y)), 730, 0.01);
  assert.equal(v4.filter((r) => r.Pos_x === 472.5 && r.Pos_z === 15080).length, 6);    // 2 long-face and 4 short-face bends on the left
  assert.equal(v4.filter((r) => r.Pos_x === 2737.5 && r.Pos_z === 15080).length, 6);   // and the same on the right
});

test('the B2 splice sits below the step: its lower bars crank at 8675 mm and lap to 11155 mm (H40), 10535 mm (H32)', () => {
  const mains = group(built(), 'C4 mains').rows;
  const v2Long = mains.filter((r) => r.Bar_mark.startsWith('V2-') && r.Dia === 40);
  assert.equal(v2Long.length, 40);
  for (const r of v2Long) {
    assert.equal(r.Rebar_Type, 'double_crank');
    assert.equal(r.Pos_z, 2615);            // the B3 splice's upper bar starts at b
    near(r.DC_Lap_Start, 6060, 0.01);       // a = 8675, less that b
    assert.equal(r.DC_Lap_Mid, 240);
    assert.equal(r.DC_Tail_Length, 2240);
    assert.equal(r.Crank_step, 40);
  }
  const v2Short = mains.filter((r) => r.Bar_mark.startsWith('V2-') && r.Dia === 32);
  for (const r of v2Short) {
    assert.equal(r.Pos_z, 2585);
    near(r.DC_Lap_Start, 6090, 0.01);
    assert.equal(r.DC_Lap_Mid, 210);
    assert.equal(r.DC_Tail_Length, 1650);
    assert.equal(r.Crank_step, 35);
  }
});

test('the links stop at the B1 slab: four runs, and the upper one runs from the B1 SFL to the top cover', () => {
  const links = group(built(), 'C4 links').rows;
  const t = links.filter((r) => /^T\d+$/.test(r.Bar_mark));
  assert.deepEqual(t.map((r) => r.Pos_z), [45, 2305, 8605, 15085]);
  assert.deepEqual(t.map((r) => r.qty_z), [8, 51, 57, 58]);
  assert.ok(t.every((r) => r.spacing_z === 100));
  assert.equal(links.filter((r) => r.Bar_mark.startsWith('CX')).length, 8);   // two X ties in each run
  assert.equal(links.filter((r) => r.Bar_mark.startsWith('CT')).length, 16);  // four Y ties in each run
});

test('the X ties that pass through the bars bending in below the step are warned: 36 crossings, between 12490 and 15080 mm', () => {
  const warn = built().warnings.find((w) => /cross-tie crossings along X/.test(w));
  assert.ok(warn, 'no crossing warning');
  assert.match(warn, /^36 cross-tie crossings along X in the storey below B1 concourse/);
  assert.match(warn, /between 12490 and 15080 mm/);
});

test('the top starters go up into the roof slab: 40 H25 bars, each with its 1290 mm lap at 19610 mm', () => {
  const st = group(built(), 'C4 starters').rows.filter((r) => r.Bar_mark.startsWith('ST2-'));
  assert.equal(st.length, 40);
  assert.ok(st.every((r) => r.Dia === 25 && r.Pos_z === 19610 && r.H === 250));
});

test('each level reads its own layout: the base and the levels that say same as below have faces, B1 has one size', () => {
  const r = resolveSchedule(DRAWING, { lx: 3200, ly: 800, layout: 'all' });
  assert.equal(r.ok, true, r.msg);
  // Bottom first: the base, B3 platform, B2 lower concourse, then B1.
  assert.deepEqual(r.rows.map((x) => x.layout), ['faces', 'faces', 'faces', 'all']);
  assert.deepEqual(r.rows.map((x) => x.section), [0, 0, 0, 1]);
  assert.equal(r.sections, 2);
});

test('a level above the step that keeps its size is refused: it would be a splice starting in the step\'s slab', () => {
  const roof = { name: 'Roof level', sfl: 2.03, size: 'same', layout: 'same', bars: 'same', barsLong: 'same', barsShort: 'same', links: 'same', slab: '2000' };
  const res = memberGroups(MEMBER, inputs([roof, ...DRAWING]), { neighbours: [] });
  assert.equal(res.ok, false);
  assert.match(res.msg, /would be a splice starting in the step's slab/);
});

test('only one size step is modelled: a second change of SIZE is refused', () => {
  const mid = { name: 'Mid level', sfl: -8.79, size: '2000 x 800', layout: 'all', bars: '40H25', links: 'same', slab: '800' };
  const res = memberGroups(MEMBER, inputs([DRAWING[0], mid, ...DRAWING.slice(1)]), { neighbours: [] });
  assert.equal(res.ok, false);
  assert.match(res.msg, /Only one size step is modelled/);
});

test('a SIZE bigger than the member is refused, with both sizes', () => {
  const wide = [{ ...DRAWING[0], size: '3400 x 800' }, ...DRAWING.slice(1)];
  const res = memberGroups(MEMBER, inputs(wide), { neighbours: [] });
  assert.equal(res.ok, false);
  assert.match(res.msg, /SIZE 3400 x 800 on B1 concourse is bigger than this member \(3200 x 800\)/);
});

test('a size step keeps the depth: a SIZE with a different depth is refused', () => {
  const deep = [{ ...DRAWING[0], size: '2400 x 600' }, ...DRAWING.slice(1)];
  const res = memberGroups(MEMBER, inputs(deep), { neighbours: [] });
  assert.equal(res.ok, false);
  assert.match(res.msg, /SIZE 2400 x 600 on B1 concourse changes the depth/);
});

test('the bars that lap or bend in must match the MAIN BARS of the level: 48H25 at B1 is refused, with the count the section takes', () => {
  const b1 = { ...DRAWING[0], bars: '48H25' };
  const res = memberGroups(MEMBER, inputs([b1, ...DRAWING.slice(1)]), { neighbours: [] });
  assert.equal(res.ok, false);
  assert.match(res.msg, /B1 concourse is 48 bars, but the section above it takes 40: 28 lap as usual, 12 bend in, and 8 end in the slab/);
});

test('the MAIN BARS layout stays the same up a column unless the SIZE changes', () => {
  const b2 = { ...DRAWING[1], layout: 'all', bars: '40H40' };
  const res = memberGroups(MEMBER, inputs([DRAWING[0], b2, DRAWING[2], DRAWING[3]]), { neighbours: [] });
  assert.equal(res.ok, false);
  assert.match(res.msg, /The MAIN BARS layout on B2 lower concourse must stay the same/);
});

test('a level that says same as below cannot copy long and short faces into one cell', () => {
  const b1 = { ...DRAWING[0], bars: 'same' };
  const res = memberGroups(MEMBER, inputs([b1, ...DRAWING.slice(1)]), { neighbours: [] });
  assert.equal(res.ok, false);
  assert.match(res.msg, /is "same as below", but the level below has long and short faces/);
});

test('a size step needs its slab: some of its bars end in it', () => {
  const b1 = { ...DRAWING[0], slab: '' };
  const res = memberGroups(MEMBER, inputs([b1, ...DRAWING.slice(1)]), { neighbours: [] });
  assert.equal(res.ok, false);
  assert.match(res.msg, /changes SIZE, so some of its bars end in its slab: give it SLAB THK/);
});

test('bends in the step slab keep a clear gap of one bar diameter: two parallel H40 ends 20 mm apart clash, well-spaced ends do not', () => {
  const bent = (mark, x) => ({
    Bar_mark: mark, Rebar_Type: 'bent', Dia: 40, Plane: 'XZ', Pos_Rotation: 90, Pos_x: x, Pos_y: 80, Pos_z: 14000,
    'Length of Bar': 300, H: 2000, bent_up_down: 'up', hook_start: 'no', plan_rotation: 225,
  });
  const clash = stepClash([{ row: bent('A', 100), lower: 0, bent: true }, { row: bent('B', 120), lower: 1, bent: true }]);
  assert.ok(clash);
  assert.equal(clash.need, 80);   // the two radii (40) plus one bar diameter (40)
  assert.ok(clash.gap < 80);
  assert.equal(stepClash([{ row: bent('A', 100), lower: 0, bent: true }, { row: bent('B', 500), lower: 1, bent: true }]), null);
});

test('a bar is not checked against its own partner at the step: a lower bar and the upper bar it laps are one splice', () => {
  const bent = (mark, x) => ({
    Bar_mark: mark, Rebar_Type: 'bent', Dia: 40, Plane: 'XZ', Pos_Rotation: 90, Pos_x: x, Pos_y: 80, Pos_z: 14000,
    'Length of Bar': 300, H: 2000, bent_up_down: 'up', hook_start: 'no', plan_rotation: 225,
  });
  assert.equal(stepClash([{ row: bent('A', 100), lower: 0, bent: true }, { row: bent('B', 100), lower: 0, bent: false }]), null);
});
