// Adds walls' reinforcement sets from a CSV: one row per wall, written as a wall schedule writes it (see src/bbs/wallCsv.js, and
// inputs/wall_template.csv for an example). It runs the card's own step, memberGroups, then addMemberRows as the Generate sets button does, and
// writes the result as a project JSON. The wall's link needs no length: its spine follows the thickness less the covers.
//
// Each wall is built from its row (length, thickness, height, SFL, X, Y), or, with --project, is the member of that name in the project (a size
// the row gives replaces the project's). A blank Y stacks a new wall 1000 mm behind the wall before it, so that walls do not overlap.
//
//   node scripts/wall_csv_to_bbs.mjs --csv <walls.csv> [--out <project.json>]
//   node scripts/wall_csv_to_bbs.mjs --project <project.json> --csv <walls.csv> [--wall <name>] [--out <project.json>]
//   other options: [--cover <mm>] [--dry-run]
//
// --wall adds only the wall of that name. --cover is the cover on both faces (default: the project's cover, or 40). Without --out the project
// is written beside the CSV as <csv name>_bbs.json. Every wall is checked before anything is written.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const at = (p) => pathToFileURL(join(ROOT, p)).href;

const { useStore } = await import(at('src/store.js'));
const { cardInputsOf, memberGroups, starterSpec } = await import(at('src/bbs/memberReinforcement.js'));
const { wallMembers, wallsFromCsv } = await import(at('src/bbs/wallCsv.js'));

const die = (msg) => {
  console.error(`wall_csv_to_bbs: ${msg}`);
  process.exit(1);
};

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    csv: { type: 'string' },
    wall: { type: 'string' },
    out: { type: 'string' },
    cover: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});
if (!values.csv) die('needs --csv (see the top of this file)');

const project = values.project ? JSON.parse(readFileSync(values.project, 'utf8')) : null;
let cover = Number(project?.cover ?? 40);
if (values.cover !== undefined) {
  cover = Number(values.cover);
  if (values.cover === '' || !Number.isFinite(cover)) die(`--cover ${values.cover} is not a number`);
}

const read = wallsFromCsv(readFileSync(values.csv, 'utf8'), { cover });
if (!read.ok) die(read.msg);
let walls = read.walls;
if (values.wall !== undefined) {
  walls = walls.filter((w) => w.name === values.wall);
  if (!walls.length) die(`no wall named "${values.wall}" in ${values.csv}. Its walls: ${read.walls.map((w) => w.name).join(', ')}`);
}

const placed = wallMembers(walls, { concretes: project?.concretes ?? [], cover });
if (!placed.ok) die(placed.msg);

// Every wall is generated and read back before anything is written.
const plans = [];
for (const { member, wall, isNew } of placed.members) {
  const inp = cardInputsOf(wall.form, cover, 'good');
  const plan = memberGroups(member, inp, { neighbours: placed.concretes });
  if (!plan.ok) die(`${member.name}: ${plan.msg}`);
  plans.push({ member, inp, plan, isNew });
}

const num = (v) => Math.round(v * 10) / 10;
for (const { member, inp, plan, isNew } of plans) {
  const w = inp.wall;
  console.log(`${member.name}: ${member.lx} x ${member.ly}, height ${member.lz} mm, base ${member.z} mm, at (${member.x}, ${member.y}), cover ${cover} (${isNew ? 'new, from the CSV' : 'from the project'})`);
  const link = plan.groups.find((g) => g.name === `${member.name} links`)?.rows[0];
  const linksText = w.noLinks
    ? 'LINKS none'
    : `LINKS H${w.linkDia}-${w.linkSpacing} x ${w.linkVSpacing}`
      + (link ? ` (spine ${link.length} across the thickness, leg A ${link.c_length_a}, leg B ${link.c_length_b})` : '');
  console.log(`  MAIN BARS H${w.mainDia}-${w.mainSpacing}, DISTRIBUTION H${w.distDia}-${w.distSpacing}, ${linksText}`);
  const d = plan.dowels;
  for (const [end, label] of [['base', 'BASE'], ['top', 'TOP']]) {
    if (d && d.ends.includes(end)) {
      console.log(`  ${label}: dowels H${d.dia} at ${d.spacing} c/c, ${num(d.length)} long (${num(d.embed)} in the wall, ${num(d.out)} out), ${d.count} of them from x ${num(d.first)} to x ${num(d.last)}`);
    } else if (inp.starters[end]) {
      const s = starterSpec(inp.starters, w.mainDia, end, 'good');
      console.log(`  ${label}: starters H${s.dia} at the main bars (lap ${num(s.lap)}, anchorage ${num(s.anchorage)}, bend leg ${num(s.bend)})`);
    } else {
      console.log(`  ${label}: nothing`);
    }
  }
  const sc = plan.second;
  if (sc) {
    console.log(`  SECOND STARTERS: H${sc.dia} L bars out of the ${sc.face === 'both' ? 'north and south faces' : `${sc.face} face`}, ${sc.count} along the wall at ${sc.spacing} (x ${num(sc.first)} to x ${num(sc.last)}) and ${sc.levels} up it at ${sc.vSpacing} (${num(sc.zFirst)} to ${num(sc.zLast)} mm above the base); leg ${num(sc.leg)} (${num(sc.embed)} in the wall, ${num(sc.out)} out), foot ${num(sc.foot)}`);
  }
  for (const msg of plan.warnings ?? []) console.log(`  WARN ${msg}`);
  console.log(`  Sets: ${plan.groups.map((g) => `${g.name} (${g.rows.length} row${g.rows.length === 1 ? '' : 's'})`).join(', ')}`);
}
if (values['dry-run']) {
  console.log('Dry run: no file written.');
  process.exit(0);
}

// The store path of the Generate sets button: the project holds the walls, each wall's sets are added in one step, and the project is exported.
const next = project
  ? { ...project, concretes: placed.concretes }
  : { v: 1, app: 'barbending', savedAt: Date.now(), bars: [], concretes: placed.concretes, refLines: [], cover, bond: 'good', selectedBar: 0, selectedBars: [] };
useStore.getState().importProject(next);
let sets = 0;
let rows = 0;
for (const { member, plan } of plans) {
  const added = useStore.getState().addMemberRows(plan.groups, { hostId: member.id, sections: null });
  if (!added.ok) die(`${member.name}: ${added.msg}`);
  sets += added.sets;
  rows += added.count;
}
const outPath = values.out ?? join(dirname(values.csv), `${basename(values.csv, '.csv')}_bbs.json`);
writeFileSync(outPath, useStore.getState().exportProject());
console.log(`Added ${sets} set(s), ${rows} rows. Wrote ${outPath}`);
