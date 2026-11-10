// A wall with no links (some walls have only main bars and distribution bars): the card makes no link row and does not check the link inputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCardInputs, memberGroups } from '../../src/bbs/memberReinforcement.js';

// The 5000 x 200 x 3000 wall of inputs/wall_sample_auto_bbs.json (origin 0,0,0; cover 40).
const WALL = { id: 'c1', name: 'W1', kind: 'WALL', lx: 5000, ly: 200, lz: 3000, x: 0, y: 0, z: 0, covB: 40, covT: 40 };
const group = (res, name) => res.groups.find((g) => g.name === name);
const wallInputs = (wall = {}) => ({
  ...defaultCardInputs(40),
  kind: 'Wall',
  wall: { mainDia: 16, mainSpacing: 150, distDia: 13, distSpacing: 150, linkDia: 13, linkSpacing: 150, linkVSpacing: 300, legA: 130, ...wall },
  starters: { base: true, top: true, dia: 13, lap: null, anchorage: null, bend: null },
});
const build = (wall, member = WALL) => memberGroups(member, wallInputs(wall), { neighbours: [] });

test('a wall with no links has its mains, distribution and starters only: 203 rows', () => {
  const res = build({ noLinks: true });
  assert.equal(res.ok, true, res.msg);
  assert.deepEqual(res.groups.map((g) => g.name), ['W1 mains', 'W1 distribution', 'W1 starters']);
  assert.equal(res.groups.flatMap((g) => g.rows).length, 203);
  assert.equal(res.groups.flatMap((g) => g.rows).some((r) => r.Bar_mark === 'WL1' || r.Rebar_Type === 'c_link_with_hook'), false);
});

test('the other bars are the same with and without the links', () => {
  const withLinks = build({});
  const without = build({ noLinks: true });
  for (const name of ['W1 mains', 'W1 distribution', 'W1 starters']) {
    assert.deepEqual(group(without, name).rows, group(withLinks, name).rows, name);
  }
});

test('a wall with links, or with the setting absent or off, is the card as it was: 204 rows', () => {
  assert.equal(build({}).groups.flatMap((g) => g.rows).length, 204);
  assert.equal(build({ noLinks: false }).groups.flatMap((g) => g.rows).length, 204);
  assert.equal(group(build({}), 'W1 links').rows.length, 1);
});

test('the link inputs are not checked when there are no links', () => {
  const res = build({ noLinks: true, linkDia: 0, linkSpacing: 0, linkVSpacing: null, legA: -5 });
  assert.equal(res.ok, true, res.msg);
  assert.equal(build({ noLinks: false, linkDia: 0 }).ok, false);
});

test('the main and distribution inputs are still checked, and the mains must fit between the covers', () => {
  assert.match(build({ noLinks: true, mainDia: 0 }).msg, /diameters/);
  assert.match(build({ noLinks: true, distSpacing: 0 }).msg, /spacings/);
  const thin = { ...WALL, ly: 90 };
  assert.match(build({ noLinks: true }, thin).msg, /main bars/);
  assert.equal(build({ noLinks: true, mainDia: 8 }, { ...WALL, ly: 150 }).ok, true);
});
