import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCardInputs, linkZones, memberGroups, resolveSchedule } from '../../src/bbs/memberReinforcement.js';

// A column 3200 x 800 x 12000, cover 40, with its SFLs in metres as the card types them. Each slab sits below its SFL and has no links.
const COLUMN = { id: 'c5', name: 'C4', kind: 'COLUMN', lx: 3200, ly: 800, lz: 12000, x: 0, y: 0, z: 0, covB: 40, covT: 40 };
const row = (over = {}) => ({
  name: 'B3 platform', sfl: -18.57, size: 'same', bars: 'same', links: 'same', slab: '', lap: null, step: null, jog: null, ...over,
});
const base = (over = {}) => row({ name: 'Base', sfl: -20.87, size: '3200 x 800', bars: '16H25', links: 'H10-150', ...over });
const b2 = (over = {}) => row({ name: 'B2 concourse', sfl: -12.27, slab: '1200', ...over });
const b3 = (over = {}) => row({ name: 'B3 platform', sfl: -18.57, slab: '1500', ...over });
const inputs = (rowsTopFirst) => ({
  ...defaultCardInputs(40), kind: 'Column', cover: 40,
  column: { layout: 'all', lap: null, schedule: rowsTopFirst },
  starters: { base: true, top: true, dia: null, lap: null, anchorage: null, bend: null },
});
const zonesOf = (rowsTopFirst) => {
  const res = resolveSchedule(rowsTopFirst, { lx: 3200, ly: 800, layout: 'all' });
  assert.equal(res.ok, true, res.msg);
  return linkZones(res.rows, 40, 40, 12000);
};
const SLABS = [[800, 2300], [7400, 8600]]; // the B3 and B2 slabs, in mm above the base

test('each slab is a gap in the links: the storey below stops at its bottom face and the storey above starts at its SFL', () => {
  const zones = zonesOf([b2(), b3(), base()]);
  assert.deepEqual(zones.map((z) => [z.bottom, z.top]), [[40, 800], [800, 2300], [2300, 7400], [7400, 8600], [8600, 11960]]);
  assert.deepEqual(zones.map((z) => z.links === null), [false, true, false, true, false]);
  assert.deepEqual(zones.map((z) => z.name), [
    'Base storey', 'B3 platform slab, no links', 'B3 platform storey', 'B2 concourse slab, no links', 'B2 concourse storey',
  ]);
});

test('without a slab the storey runs straight into the one above, with no gap', () => {
  const zones = zonesOf([b3({ slab: '' }), base()]);
  assert.deepEqual(zones.map((z) => [z.bottom, z.top]), [[40, 2300], [2300, 11960]]);
  assert.ok(zones.every((z) => z.links !== null));
});

test('no link runs inside a slab: each storey is its own run, and the stacks stop at the slab faces', () => {
  // The base and B3 storeys have the same links, but the B3 slab between them is a gap, so they are separate runs.
  const rows = [b2({ links: 'H10-200' }), b3(), base()];
  const res = memberGroups(COLUMN, inputs(rows), { neighbours: [] });
  assert.equal(res.ok, true, res.msg);
  const tRows = res.groups.find((g) => g.name === 'C4 links').rows.filter((r) => /^T\d+$/.test(r.Bar_mark));
  assert.equal(tRows.length, 3);
  // A link is 10 mm across, so its outer surface is 5 mm beyond its centre.
  const spans = tRows.map((t) => [t.Pos_z - 5, t.Pos_z + (t.qty_z - 1) * t.spacing_z + 5]);
  assert.deepEqual(spans.map(([a]) => a), [40, 2300, 8600]);
  for (const [a, b] of spans) {
    for (const [s0, s1] of SLABS) assert.ok(b <= s0 || a >= s1, `links from ${a} to ${b} run into the slab ${s0} to ${s1}`);
  }
});

test('a splice starts above its own slab, so its own slab is never flagged', () => {
  // The B3 splice starts 75 mm above its SFL (2300), at 2375, so it sits in the storey above the B3 slab (800 to 2300 mm).
  const res = memberGroups(COLUMN, inputs([b3(), base()]), { neighbours: [] });
  assert.equal(res.ok, true, res.msg);
  assert.ok(!res.warnings.some((w) => /runs into the link-free slab/.test(w)), res.warnings.join(' | '));
});

test('a splice that reaches up into a higher slab is flagged for checking', () => {
  // A B3 splice at 2300 starts at 2375 and, with a 150 jog and a 1290 lap, runs to 3815 mm. A B2 slab of 1000 under a level at 4000 mm
  // is the gap from 3000 to 4000 mm, so the splice runs into it.
  const rows = [row({ name: 'B2 concourse', sfl: -16.87, slab: '1000' }), row({ name: 'B3 platform', sfl: -18.57 }), base()];
  const res = memberGroups(COLUMN, inputs(rows), { neighbours: [] });
  assert.equal(res.ok, true, res.msg);
  assert.ok(
    res.warnings.some((w) => /The splice at 2300 mm \(2375 to 3815 mm\) runs into the link-free slab of B2 concourse \(3000 to 4000 mm\)/.test(w)),
    res.warnings.join(' | '),
  );
});

test('a slab thicker than the storey below it is refused, and the message names the slab', () => {
  const res = resolveSchedule([b3({ slab: '2400' }), base()], { lx: 3200, ly: 800, layout: 'all' });
  assert.equal(res.ok, false);
  assert.match(res.msg, /The slab below B3 platform \(2400 mm\) is as thick as, or thicker than, the storey below it \(2300 mm\)/);
});

test('a slab of zero is refused, and a blank slab is no slab at all', () => {
  const zero = resolveSchedule([b3({ slab: '0' }), base()], { lx: 3200, ly: 800, layout: 'all' });
  assert.match(zero.msg, /must be above zero, or left blank/);
  const blank = resolveSchedule([b3({ slab: '' }), base()], { lx: 3200, ly: 800, layout: 'all' });
  assert.equal(blank.ok, true, blank.msg);
  assert.equal(blank.rows[1].slab, null);
});
