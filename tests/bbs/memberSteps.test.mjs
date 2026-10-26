import test from 'node:test';
import assert from 'node:assert/strict';
import { genBarPoints, transformBarLocalPoint } from '../../src/bbs/shapes.js';
import { defaultCardInputs, memberGroups, resolveSchedule, stepClash } from '../../src/bbs/memberReinforcement.js';

// The C4/C4A column of the drawing, as entered on the card (spec docs/superpowers/specs/2026-10-20-column-size-steps-design.md, sections 2 to
// 4 and 12): a 3200 x 800 base of 44H40 long and 8H32 short bars, a 2400 x 800 section from B1 up to the roof, of 40H25, Hz 20900. The bar
// diameter changes at B1, so every bar below ends in the B1 slab and 40 starters rise from it to lap the main bars (spec 12).
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

test('C4/C4A builds with starters at B1: 224 mains, 28 links and 88 starters', () => {
  const res = built();
  assert.equal(res.ok, true, res.msg);
  assert.equal(group(res, 'C4 mains').rows.length, 224);
  assert.equal(group(res, 'C4 links').rows.length, 28);
  assert.equal(group(res, 'C4 starters').rows.length, 88);
});

test('the step sits at the B1 SFL: all 48 lower bars end in the slab at 14320 mm, and 40 starters bend in at 14400 mm', () => {
  assert.deepEqual(built().steps, [{
    name: 'B1 concourse', soffit: 14280, zL: 14320, zSFL: 15080, counts: { inside: 0, bend: 0, terminate: 48 }, starters: { zS: 14400, a: 15155, count: 40 },
  }]);
});

test('the step warning says the diameter changes, where the lower bars end and where the starters bend and lap', () => {
  const warn = built().warnings.find((w) => /the bar diameter changes/.test(w));
  assert.match(warn, /^At B1 concourse \(15080 mm above the base\) the bar diameter changes: the 48 bars below end in the slab at 14320 mm, and 40 starters bent in at 14400 mm rise past the SFL to lap the main bars from 15155 mm\./);
});

test('the lower bars end in the B1 slab, bent in the slab: 40 long bars with 2240 mm legs, 8 short bars with 1650 mm legs', () => {
  const v3 = group(built(), 'C4 mains').rows.filter((r) => r.Bar_mark.startsWith('V3-'));
  assert.equal(v3.length, 48);
  for (const r of v3) {
    assert.equal(r.Rebar_Type, 'bent');
    assert.equal(r.Pos_Rotation, 90);
    assert.equal(r.bent_up_down, 'up');
    if (r.Dia === 40) {
      assert.equal(r.H, 2240);
      assert.equal(r.Pos_z, 8915);
      near(r['Length of Bar'], 14320 - 8915);
    } else {
      assert.equal(r.Dia, 32);
      assert.equal(r.H, 1650);
      assert.equal(r.Pos_z, 8885);
      near(r['Length of Bar'], 14320 - 8885);
    }
  }
  assert.equal(v3.filter((r) => r.Dia === 40).length, 40);
  assert.equal(v3.filter((r) => r.Dia === 32).length, 8);
});

test('the bends of the lower bars point off their own faces: a corner turns diagonally out, a south-face bar straight south', () => {
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

test('the 40 main bars start at 15155 mm (75 above the B1 SFL) and run to the top cover, 40 H25 on the ring of the 2400 x 800 box', () => {
  const v4 = group(built(), 'C4 mains').rows.filter((r) => r.Bar_mark.startsWith('V4-'));
  assert.equal(v4.length, 40);
  for (const r of v4) {
    assert.equal(r.Rebar_Type, 'straight');
    assert.equal(r.Dia, 25);
    assert.equal(r.Pos_z, 15155);
    near(r['Length of Bar'], 20900 - 40 + 12.5 - 15155, 0.01);   // up to the top cover
  }
  // The 2400 box is centred on the base: x from 472.5 to 2737.5, y from 72.5 to 737.5 (the ring's outer bars sit on its edges).
  near(Math.min(...v4.map((r) => r.Pos_x)), 472.5, 0.01);
  near(Math.max(...v4.map((r) => r.Pos_x)), 2737.5, 0.01);
  near(Math.min(...v4.map((r) => r.Pos_y)), 72.5, 0.01);
  near(Math.max(...v4.map((r) => r.Pos_y)), 737.5, 0.01);
});

test('each starter bends in the B1 slab at 14400 mm, runs up past the SFL and laps the main bar above it by its 1290 mm lap', () => {
  const mains = group(built(), 'C4 mains').rows;
  const starters = mains.filter((r) => r.Bar_mark.startsWith('VS-'));
  const main = mains.filter((r) => r.Bar_mark.startsWith('V4-'));
  assert.equal(starters.length, 40);
  for (const s of starters) {
    assert.equal(s.Rebar_Type, 'bent');
    assert.equal(s.Dia, 25);
    assert.equal(s.Pos_Rotation, -90);   // the bar runs down from its top to a bend at its bottom
    assert.equal(s.H, 1290);
    assert.equal(s.Pos_z, 16445);        // a + the lap: the top of the starter
    near(s['Length of Bar'], 16445 - 14400, 0.01);
    const m = main.find((r) => r.Pos_x === s.Pos_x && r.Pos_y === s.Pos_y);
    assert.ok(m, `no main bar under the starter at ${s.Pos_x}, ${s.Pos_y}`);
    assert.equal(s.Pos_z - m.Pos_z, 1290);   // the overlap is the lap
  }
});

test('each starter bend points out of the column: its leg ends at 14400 mm and further from the centre than the starter', () => {
  const starters = group(built(), 'C4 mains').rows.filter((r) => r.Bar_mark.startsWith('VS-'));
  const cx = 1600, cy = 400;
  for (const s of starters) {
    const pts = genBarPoints(s).points.map((p) => {
      const t = transformBarLocalPoint(s, p);
      return [s.Pos_x + t[0], s.Pos_y + t[1], s.Pos_z + t[2]];
    });
    const end = pts[pts.length - 1];
    near(end[2], 14400, 0.5);
    const d0 = Math.hypot(s.Pos_x - cx, s.Pos_y - cy), d1 = Math.hypot(end[0] - cx, end[1] - cy);
    assert.ok(d1 > d0 + 500, `leg from ${d0} to ${d1} from the centre`);
  }
});

test('the cross-ties at B1 hook the ring: 2 X ties and 4 Y ties in each of the four runs', () => {
  const links = group(built(), 'C4 links').rows;
  assert.equal(links.filter((r) => r.Bar_mark.startsWith('CX')).length, 8);
  assert.equal(links.filter((r) => r.Bar_mark.startsWith('CT')).length, 16);
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
});

test('no lower bar cranks through the storey below B1, so no cross-tie crosses a bend there: no crossing warning', () => {
  assert.equal(built().warnings.some((w) => /cross-tie crossings along X/.test(w)), false);
});

test('the top starters go up into the roof slab: 40 H25 bars, each with its 1290 mm lap at 19610 mm', () => {
  const st = group(built(), 'C4 starters').rows.filter((r) => r.Bar_mark.startsWith('ST2-'));
  assert.equal(st.length, 40);
  assert.ok(st.every((r) => r.Dia === 25 && r.Pos_z === 19610 && r.H === 250));
});

test('the B1 MAIN BARS set how many starters there are: 48H25 gives 48 starters, 32H25 gives 32', () => {
  for (const [bars, n] of [['48H25', 48], ['32H25', 32]]) {
    const res = memberGroups(MEMBER, inputs([{ ...DRAWING[0], bars }, ...DRAWING.slice(1)]), { neighbours: [] });
    assert.equal(res.ok, true, res.msg);
    assert.equal(res.steps[0].starters.count, n);
    assert.equal(group(res, 'C4 mains').rows.filter((r) => r.Bar_mark.startsWith('VS-')).length, n);
  }
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

test('a slab too thin for the starters to bend in is refused, and the message says to make it thicker', () => {
  const thin = { ...DRAWING[0], slab: '100' };
  const res = memberGroups(MEMBER, inputs([thin, ...DRAWING.slice(1)]), { neighbours: [] });
  assert.equal(res.ok, false);
  assert.equal(res.msg, 'B1 concourse: the slab below it is too thin for the starters to bend in. Give it a thicker SLAB THK.');
});

test('a size step that keeps the bar diameter still carries bars up: 40H25 under a 44H25 base is refused with its two ways out', () => {
  const sameDia = [{ ...DRAWING[0], bars: '40H25' }, DRAWING[1], DRAWING[2], { ...DRAWING[3], barsLong: '44H25', barsShort: '8H25' }];
  const res = memberGroups(MEMBER, inputs(sameDia), { neighbours: [] });
  assert.equal(res.ok, false);
  assert.match(res.msg, /^B1 concourse is 40 bars, but 36 carry on into the section above it: 32 lap as usual, 4 crank in, and 16 bend outward and end in the slab\. Set MAIN BARS to 36, or set Longest crank to 255 mm: then 40 carry on\.$/);
});

test('Longest crank must be a number of mm, 0 or more', () => {
  for (const bad of ['-1', 'abc']) {
    const res = memberGroups(MEMBER, inputs([{ ...DRAWING[0], crankMax: bad }, ...DRAWING.slice(1)]), { neighbours: [] });
    assert.equal(res.ok, false, bad);
    assert.match(res.msg, /^B1 concourse: Longest crank must be a number of mm, 0 or more\.$/, bad);
  }
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
