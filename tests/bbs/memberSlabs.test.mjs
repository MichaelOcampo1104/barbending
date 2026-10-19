import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCardInputs, linkZones, memberGroups, resolveSchedule, slabLinksNotation } from '../../src/bbs/memberReinforcement.js';

// A column 3200 x 800 x 12000, cover 40, with its SFLs in metres as the card types them. The slabs sit below their SFLs.
const COLUMN = { id: 'c5', name: 'C4', kind: 'COLUMN', lx: 3200, ly: 800, lz: 12000, x: 0, y: 0, z: 0, covB: 40, covT: 40 };
const row = (over = {}) => ({
  name: 'B3 platform', sfl: -18.57, size: 'same', bars: 'same', links: 'same', slab: '', linksBottom: '', lap: null, step: null, jog: null, ...over,
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

test('the B3 slab (1500) and the B2 slab (1200) each sit below their SFL, in the storey beneath', () => {
  const zones = zonesOf([b2(), b3(), base()]);
  assert.deepEqual(zones.map((z) => [z.bottom, z.top]), [[40, 800], [800, 2300], [2300, 7400], [7400, 8600], [8600, 11960]]);
  assert.deepEqual(zones.map((z) => z.name), [
    'Base storey', 'B3 platform slab', 'B3 platform storey', 'B2 concourse slab', 'B2 concourse storey',
  ]);
});

test('a slab with no links of its own takes the links of the storey it sits in', () => {
  const zones = zonesOf([b3({ slab: '' }), base()]);
  assert.deepEqual(zones.map((z) => [z.bottom, z.top]), [[40, 2300], [2300, 11960]]);
});

test('a slab thicker than the storey below it is refused, and the message names the slab', () => {
  const res = resolveSchedule([b3({ slab: '2400' }), base()], { lx: 3200, ly: 800, layout: 'all' });
  assert.equal(res.ok, false);
  assert.match(res.msg, /The slab below B3 platform \(2400 mm\) is as thick as, or thicker than, the storey below it \(2300 mm\)/);
});

test('slab links without a thickness are refused, and so is a slab of zero', () => {
  const noThickness = resolveSchedule([b3({ slab: '', linksBottom: 'H10-100' }), base()], { lx: 3200, ly: 800, layout: 'all' });
  assert.match(noThickness.msg, /Give the slab below B3 platform its thickness, or clear its links/);
  const zero = resolveSchedule([b3({ slab: '0' }), base()], { lx: 3200, ly: 800, layout: 'all' });
  assert.match(zero.msg, /must be above zero, or left blank/);
});

test('the slab links are read from their three cells, and blank cells give no slab links', () => {
  const notes = slabLinksNotation([
    b3({ linksBotOuter: 'H10-100', linksBotX: '2H10-100', linksBotY: '' }),
    base({ linksBotOuter: '', linksBotX: '', linksBotY: '' }),
  ]);
  assert.deepEqual(notes, ['H10-100 + 2H10-100 X', '']);
});

test('a slab with its own links splits the stack: four link runs, and the slab cross links sit in the slab zone', () => {
  // B3 slab links: outer H10-100 with 2 cross links along X. B2 links are H10-200, so the B2 storey and the B2 slab differ from their neighbours.
  const rows = [
    b2({ links: 'H10-200' }),
    b3({ linksBottom: 'H10-100 + 2H10-100 X' }),
    base(),
  ];
  const res = memberGroups(COLUMN, inputs(rows), { neighbours: [] });
  assert.equal(res.ok, true, res.msg);
  const links = res.groups.find((g) => g.name === 'C4 links').rows;
  const tRows = links.filter((r) => /^T\d+$/.test(r.Bar_mark));
  assert.equal(tRows.length, 4);
  const t2 = tRows[1];
  assert.equal(t2.spacing_z, 100); // the slab's outer link
  assert.equal(t2.qty_z, 15); // from the slab's bottom (800 + 5) to its top less 5: 1500 mm at 100
  const cx2 = links.filter((r) => r.Bar_mark.startsWith('CX2-'));
  assert.equal(cx2.length, 2);
  for (const r of cx2) {
    assert.ok(Math.abs(r.Pos_z - 815) < 0.01); // one tie diameter above the slab zone's first link (805)
    assert.equal(r.qty_z, 15);
  }
});
