// The wall CSV command, run as a program: what it prints and writes, and that a wall that cannot be built stops the run before anything is written.
// The tests write their own CSVs: inputs/wall_template.csv is the user's working file, so it only has to parse and run (the last test).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'wall_csv_to_bbs.mjs');
const dir = mkdtempSync(join(tmpdir(), 'wall-csv-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const HEAD = 'Wall,Thickness (mm),Length (mm),Height (mm),SFL (m),X (mm),Y (mm),Main bars,Distribution bars,Links,Link leg A (mm),Base,Top,Starter bars,Starter lap (mm),Starter anchorage (mm),Starter bend leg (mm),Dowel bars,Dowel length (mm),Dowel projection (mm),Second starter bars,Second starter face,Second starter leg (mm),Second starter foot (mm),Second starter projection (mm),Second starter first level (mm)';
// W1 is the wall sample (starters at both ends); W2 the same size with H10 bars, starters at the base and H16 dowels at 1000 c/c at the top.
const W1 = 'W1,200,5000,3000,,,,H16-150,H13-150,H13-150 x 300,,starters,starters,H13,,,,,,,,,,,,';
const W2 = 'W2,200,5000,3000,,,,H10-150,H10-150,H10-150 x 300,,starters,dowels,H10,,,,H16-1000,600,250,,,,,,';
const csvFile = (name, ...rows) => {
  const file = join(dir, name);
  writeFileSync(file, [HEAD, ...rows].join('\n'));
  return file;
};

const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: ROOT });
const project = (file) => JSON.parse(readFileSync(file, 'utf8'));
const setsOf = (p) => {
  const n = {};
  for (const b of p.bars) n[b.setId] = (n[b.setId] || 0) + 1;
  return n;
};

test('two walls: W1 with starters, W2 with a top dowel, stacked behind it', () => {
  const csv = csvFile('two.csv', W1, W2);
  const out = join(dir, 'two.json');
  const r = run('--csv', csv, '--out', out);
  assert.equal(r.status, 0, r.stderr);
  const p = project(out);
  assert.equal(p.bars.length, 342);
  assert.deepEqual(setsOf(p), {
    'W1 mains': 67, 'W1 distribution': 2, 'W1 links': 1, 'W1 starters': 134,
    'W2 mains': 67, 'W2 distribution': 2, 'W2 links': 1, 'W2 starters': 67, 'W2 dowels': 1,
  });
  assert.deepEqual(p.concretes.map((c) => [c.name, c.kind, c.x, c.y, c.z]), [['W1', 'WALL', 0, 0, 0], ['W2', 'WALL', 0, 1200, 0]]);
  assert.match(r.stdout, /TOP: dowels H16 at 1000 c\/c, 600 long \(350 in the wall, 250 out\), 5 of them from x 500 to x 4500/);
  assert.match(r.stdout, /spine 107 across the thickness, leg A 130, leg B 120/);
  assert.match(r.stdout, /Added 9 set\(s\), 342 rows/);
  const dowel = p.bars.find((b) => b.Bar_mark === 'WD2');
  assert.deepEqual([dowel.Pos_x, dowel.Pos_y, dowel.Pos_z, dowel['Length of Bar'], dowel.qty_x, dowel.spacing_x, dowel.host], [500, 1300, 2650, 600, 5, 1000, 'c2']);
});

test('--wall builds only that wall, and --dry-run writes nothing', () => {
  const csv = csvFile('two_b.csv', W1, W2);
  const out = join(dir, 'w2.json');
  const only = run('--csv', csv, '--wall', 'W2', '--out', out);
  assert.equal(only.status, 0, only.stderr);
  assert.equal(project(out).bars.length, 138);
  assert.deepEqual(project(out).concretes.map((c) => c.name), ['W2']);
  const dry = join(dir, 'dry.json');
  const r = run('--csv', csv, '--out', dry, '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Dry run: no file written/);
  assert.equal(existsSync(dry), false);
  const none = run('--csv', csv, '--wall', 'W9');
  assert.equal(none.status, 1);
  assert.match(none.stderr, /no wall named "W9".*W1, W2/);
});

test('a wall that cannot be built stops the run by name, and nothing is written, not even for the walls before it', () => {
  const csv = csvFile('bad.csv', W1, 'W2,200,5000,3000,,,,H16-150,H13-150,H13-150 x 300,,starters,dowels,H13,,,,H16-1000,3500,100,,,,,,');
  const out = join(dir, 'bad.json');
  const r = run('--csv', csv, '--out', out);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /W2: .*height between its covers/);
  assert.equal(existsSync(out), false);
});

test('a cell that is not written as the schedule writes it is refused with the wall and the cell', () => {
  const csv = csvFile('cell.csv', 'W1,200,5000,3000,,,,H16,H13-150,H13-150 x 300,,,,,,,,,,,,,,,,');
  const r = run('--csv', csv, '--out', join(dir, 'cell.json'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Wall W1, Main bars: "H16".*H16-150/);
});

test('with --project a wall of that name is the project\'s member, and its sets are added to the project', () => {
  const csv = csvFile('sample.csv', 'W1,,,,,,,H16-150,H13-150,H13-150 x 300,,starters,starters,H13,,,,,,,,,,,,');
  const out = join(dir, 'sample_out.json');
  const base = project(join(ROOT, 'inputs', 'wall_sample_auto_bbs.json'));
  const r = run('--project', join(ROOT, 'inputs', 'wall_sample_auto_bbs.json'), '--csv', csv, '--out', out);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /from the project/);
  const p = project(out);
  assert.equal(p.bars.length, base.bars.length + 204);
  assert.deepEqual(p.concretes.map((c) => [c.id, c.name, c.lx, c.ly, c.lz]), base.concretes.map((c) => [c.id, c.name, c.lx, c.ly, c.lz]));
  assert.equal(p.bars.filter((b) => b.setId === 'W1 mains').length, 67);
});

test('a wall with no links writes no link row and says so', () => {
  const csv = csvFile('nolinks.csv', 'W1,200,5000,3000,,,,H16-150,H13-150,,,starters,starters,H13,,,,,,,,,,,,');
  const out = join(dir, 'nolinks.json');
  const r = run('--csv', csv, '--out', out);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /LINKS none/);
  const p = project(out);
  assert.equal(p.bars.length, 203);
  assert.deepEqual(setsOf(p), { 'W1 mains': 67, 'W1 distribution': 2, 'W1 starters': 134 });
});

test('the r1 wall sample: the drawing\'s wall with its PB1 H13 as second starters, and a wall with no links beside it', () => {
  const out = join(dir, 'r1.json');
  const r = run('--csv', join(ROOT, 'inputs', 'wall_r1_schedule.csv'), '--out', out);
  assert.equal(r.status, 0, r.stderr);
  const p = project(out);
  assert.equal(p.bars.length, 411);
  assert.deepEqual(setsOf(p), {
    'W1 mains': 68, 'W1 distribution': 2, 'W1 links': 1, 'W1 starters': 136, 'W1 second starters': 1,
    'W2 mains': 67, 'W2 distribution': 2, 'W2 starters': 134,
  });
  assert.match(r.stdout, /SECOND STARTERS: H13 L bars out of the north face, 33 along the wall at 150 \(x 100 to x 4900\) and 10 up it at 300 \(233\.8 to 2933\.8 mm above the base\); leg 301 \(214\.3 in the wall, 86\.7 out\), foot 49\.7/);
  assert.match(r.stdout, /LINKS none/);
  const ws = p.bars.find((b) => b.Bar_mark === 'WS1');
  assert.deepEqual(JSON.parse(ws.legs), [[49.7, 0], [301, 270]]);
  assert.deepEqual([ws.Pos_x, ws.Pos_y, ws.Pos_z, ws.qty_x, ws.qty_z, ws.spacing_z], [100, 400.4, 233.8, 33, 10, 300]);
});

test('the template runs, whatever walls the user keeps in it', () => {
  const r = run('--csv', join(ROOT, 'inputs', 'wall_template.csv'), '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Dry run: no file written/);
});
