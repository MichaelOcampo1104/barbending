import test from 'node:test';
import assert from 'node:assert/strict';
import { genBarPoints, transformBarLocalPoint } from '../../src/bbs/shapes.js';
import { defaultCardInputs, memberGroups, resolveSchedule, stepClash } from '../../src/bbs/memberReinforcement.js';

// The C4/C4A column of the drawing, as entered on the card (spec docs/superpowers/specs/2026-10-20-column-size-steps-design.md, sections 2 to
// 4): a 3200 x 800 base, a 2400 x 800 section from B1 up to the roof soffit, Hz 20900. The bars turn in the B1 slab.
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

test('the step sits in the B1 slab: the lower bars turn at 14320 mm, the upper bars one bar diameter above them, at 14392.5 mm', () => {
  assert.deepEqual(built().steps, [{ name: 'B1 concourse', soffit: 14280, zL: 14320, zU: 14392.5 }]);
});

test('the lower bars end in bends at the B1 slab: each leg is its lap length (2240 for H40, 1650 for H32)', () => {
  const v3 = group(built(), 'C4 mains').rows.filter((r) => r.Bar_mark.startsWith('V3-'));
  assert.equal(v3.length, 48);
  for (const r of v3) {
    assert.equal(r.Rebar_Type, 'bent');
    assert.equal(r.Pos_Rotation, 90);
    assert.equal(r.bent_up_down, 'up');
    assert.equal(r.H, r.Dia === 40 ? 2240 : 1650);
    near(r['Length of Bar'], 14320 - r.Pos_z);
  }
  assert.equal(v3.filter((r) => r.Dia === 40).length, 40);
  assert.equal(v3.filter((r) => r.Dia === 32).length, 8);
  assert.ok(v3.filter((r) => r.Dia === 40).every((r) => r.Pos_z === 8915));   // the B2 splice's upper bar starts at b = 8915
  assert.ok(v3.filter((r) => r.Dia === 32).every((r) => r.Pos_z === 8885));
});

test('the upper bars start with bends in the B1 slab: 40 H25, each running to the top cover, 6480 mm long', () => {
  const v4 = group(built(), 'C4 mains').rows.filter((r) => r.Bar_mark.startsWith('V4-'));
  assert.equal(v4.length, 40);
  for (const r of v4) {
    assert.equal(r.Rebar_Type, 'bent');
    assert.equal(r.Dia, 25);
    assert.equal(r.Pos_Rotation, -90);
    assert.equal(r.H, 1290);
    near(r.Pos_z, 20872.5, 0.01);          // the top end: 20900 − 40 + 12.5
    near(r['Length of Bar'], 6480, 0.01);  // from the top end down to the bend at 14392.5
  }
  // The 2400 x 800 box is centred on the base: x from 400 (+ the cover, the link and the bar radius) to 2800 less the same on the other side.
  const xs = v4.map((r) => r.Pos_x), ys = v4.map((r) => r.Pos_y);
  near(Math.min(...xs), 472.5, 0.01);
  near(Math.max(...xs), 2737.5, 0.01);
  near(Math.min(...ys), 72.5, 0.01);
  near(Math.max(...ys), 737.5, 0.01);
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

test('a level above the step that keeps its size is refused: it would be a splice in the step\'s slab', () => {
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

test('a size step needs its slab: the bars turn into it', () => {
  const b1 = { ...DRAWING[0], slab: '' };
  const res = memberGroups(MEMBER, inputs([b1, ...DRAWING.slice(1)]), { neighbours: [] });
  assert.equal(res.ok, false);
  assert.match(res.msg, /changes SIZE, so its bars turn into its slab: give it SLAB THK/);
});

test('bends in the step slab keep a clear gap of one bar diameter: two parallel H40 ends 20 mm apart clash, well-spaced ends do not', () => {
  const bent = (mark, x) => ({
    Bar_mark: mark, Rebar_Type: 'bent', Dia: 40, Plane: 'XZ', Pos_Rotation: 90, Pos_x: x, Pos_y: 80, Pos_z: 14000,
    'Length of Bar': 300, H: 2000, bent_up_down: 'up', hook_start: 'no', plan_rotation: 225,
  });
  const clash = stepClash([bent('A', 100), bent('B', 120)]);
  assert.ok(clash);
  assert.equal(clash.need, 80);   // the two radii (40) plus one bar diameter (40)
  assert.ok(clash.gap < 80);
  assert.equal(stepClash([bent('A', 100), bent('B', 500)]), null);
});
