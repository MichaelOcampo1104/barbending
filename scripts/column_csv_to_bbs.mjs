// Adds a box column's reinforcement sets from a CSV in the card's own layout: one row per level, top level first, with the card's labels as
// the header (see src/bbs/columnCsv.js, and inputs/column_levels_drawing_sample.csv for an example). It runs the card's own steps, memberGroups,
// then sectionsOfRows and addMemberRows as the Generate sets button does, and writes the result as a project JSON.
//
// Without --project the column is built from the CSV: the bottom level gives its SIZE and SFL, and the height comes from --height (mm), or from
// --roof-sfl (m) less --roof-slab (mm): the roof level and the thickness of the roof slab above it. With --project the column is taken from that
// project, and --height or the roof options change its height in the output.
//
//   node scripts/column_csv_to_bbs.mjs --csv <levels.csv> --column <name> --roof-sfl <m> --roof-slab <mm> [--out <project.json>]
//   node scripts/column_csv_to_bbs.mjs --csv <levels.csv> --column <name> --height <mm> [--out <project.json>]
//   node scripts/column_csv_to_bbs.mjs --project <project.json> --csv <levels.csv> --column <name or id> [--height <mm> | --roof-sfl <m> --roof-slab <mm>]
//   other options: [--x <mm>] [--y <mm>] [--layout all|faces|x|y] [--lap <mm>] [--cover <mm>] [--loose-ties] [--dry-run]
//
// --layout is the column's Layout on the card (all, faces, x or y; default all). --lap is its Lap at corner (default: the good-bond lap).
// --cover is the cover on both faces (default: the project's cover, or 40). --x and --y are the plan position (default 0, or the project's).
// Without --out the project is written beside the CSV as <csv name>_bbs.json.
// --loose-ties lets a cross-tie group sit off the bars: where fewer bars line up across the faces than the group has ties, its ties spread
// evenly between the corners. Their quantity and length are kept, and the output warns. Without it, each tie must find a bar on both faces.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const at = (p) => pathToFileURL(join(ROOT, p)).href;

const { useStore } = await import(at('src/store.js'));
const { barsText, cardInputsOf, memberGroups, parseSize, resolveSchedule } = await import(at('src/bbs/memberReinforcement.js'));
const { columnFormFromCsv } = await import(at('src/bbs/columnCsv.js'));
const { sectionsOfRows } = await import(at('src/bbs/columnSections.js'));

const die = (msg) => {
  console.error(`column_csv_to_bbs: ${msg}`);
  process.exit(1);
};
const number = (flag, text) => {
  const n = Number(text);
  if (text === '' || !Number.isFinite(n)) die(`--${flag} ${text} is not a number`);
  return n;
};

// A value that starts with a minus sign (a negative level, such as --roof-sfl -2.5) is read as that option's value: it becomes --roof-sfl=-2.5.
const args = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (/^--[a-z-]+$/.test(a) && /^-\d/.test(process.argv[i + 1] ?? '')) args.push(`${a}=${process.argv[++i]}`);
  else args.push(a);
}
const { values } = parseArgs({
  args,
  options: {
    project: { type: 'string' },
    column: { type: 'string' },
    csv: { type: 'string' },
    out: { type: 'string' },
    height: { type: 'string' },
    'roof-sfl': { type: 'string' },
    'roof-slab': { type: 'string' },
    x: { type: 'string' },
    y: { type: 'string' },
    layout: { type: 'string', default: 'all' },
    lap: { type: 'string', default: '' },
    cover: { type: 'string' },
    'loose-ties': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
});
if (!values.column || !values.csv) die('needs --column and --csv (see the top of this file)');
if (!['all', 'faces', 'x', 'y'].includes(values.layout)) die(`--layout ${values.layout} is not all, faces, x or y`);
const hasRoof = values['roof-sfl'] !== undefined;
if (values.height !== undefined && hasRoof) die('give --height, or --roof-sfl with --roof-slab, not both');
if (hasRoof !== (values['roof-slab'] !== undefined)) die('--roof-sfl and --roof-slab go together (use --roof-slab 0 if the roof level is the underside of the slab)');

const project = values.project ? JSON.parse(readFileSync(values.project, 'utf8')) : null;
const cover = values.cover !== undefined ? number('cover', values.cover) : Number(project?.cover ?? 40);

const built = columnFormFromCsv(readFileSync(values.csv, 'utf8'), { layout: values.layout, lap: values.lap, cover });
if (!built.ok) die(built.msg);
const schedule = built.form.column.schedule;   // top level first
const bottom = schedule[schedule.length - 1];
const baseSfl = bottom.sfl === '' ? NaN : Number(bottom.sfl);
if (!Number.isFinite(baseSfl)) die('the bottom level needs its SFL (m)');

// The column: from the project, or built from the bottom level's SIZE and SFL.
let concretes;
let member;
if (project) {
  concretes = project.concretes ?? [];
  member = concretes.find((c) => c.name === values.column || c.id === values.column);
  if (!member) die(`no member named or with id "${values.column}" in ${values.project}. Its members: ${concretes.map((c) => c.name).join(', ') || 'none'}`);
} else {
  if (values.height === undefined && !hasRoof) die('without --project give the height: --height <mm>, or --roof-sfl <m> with --roof-slab <mm>');
  const size = parseSize(bottom.size);
  if (!size) die(`the bottom level needs its own SIZE, for example 3200 x 800 (it reads "${bottom.size}")`);
  member = { id: 'c1', name: values.column, kind: 'COLUMN', lx: size.lx, ly: size.ly, lz: 0, x: 0, y: 0, z: Math.round(baseSfl * 1000), covB: cover, covT: cover, slope: 0 };
  concretes = [member];
}
const replaceMember = (next) => {
  member = next;
  concretes = concretes.map((c) => (c.id === next.id ? next : c));
};

// The height: --height, or the roof level less the roof slab, measured up from the base.
let height = null;
if (values.height !== undefined) height = number('height', values.height);
if (hasRoof) height = Math.round((number('roof-sfl', values['roof-sfl']) - number('roof-slab', values['roof-slab']) / 1000 - baseSfl) * 1000);
if (height !== null) {
  if (!(height > 0)) die(`the column height must be above zero (it comes out as ${height} mm)`);
  const topSfl = Number(schedule[0].sfl);
  if (Number.isFinite(topSfl) && !(height > Math.round((topSfl - baseSfl) * 1000))) {
    die(`the column top (${height} mm above the base) is not above the top level (${Math.round((topSfl - baseSfl) * 1000)} mm above the base)`);
  }
  replaceMember({ ...member, lz: height });
}
if (values.x !== undefined || values.y !== undefined) {
  replaceMember({ ...member, x: values.x !== undefined ? number('x', values.x) : member.x, y: values.y !== undefined ? number('y', values.y) : member.y });
}
if (!(member.lz > 0)) die(`${member.name} has no height: give --height <mm>, or --roof-sfl <m> with --roof-slab <mm>`);

const inp = cardInputsOf(built.form, cover, 'good');
const plan = memberGroups(member, inp, { neighbours: concretes, looseTies: values['loose-ties'] });
if (!plan.ok) die(plan.msg);
const res = resolveSchedule(inp.column.schedule, { lx: member.lx, ly: member.ly, layout: inp.column.layout });
if (!res.ok) die(res.msg);
const steps = sectionsOfRows(res.rows);

// The column and the levels as the card reads them, bottom level first.
const linkText = (l) => `${l.sets > 1 ? l.sets : ''}H${l.dia}-${l.spacing}${l.cross.map((c) => ` + ${c.count}H${c.dia}-${c.spacing} ${c.dir}`).join('')}`;
console.log(`${member.name}: ${member.lx} x ${member.ly}, height ${member.lz} mm, base ${member.z} mm, cover ${cover}; ${res.rows.length} level(s), ${steps.length > 1 ? `${steps.length} sections` : 'one section'}`);
for (const r of res.rows) {
  console.log(`  ${r.name}: SFL ${r.sfl} m, ${r.size.lx} x ${r.size.ly}, MAIN BARS ${barsText(r.bars)}, LINKS ${linkText(r.links)}${r.slab ? `, slab ${r.slab.mm} mm` : ''}`);
}
for (const w of plan.warnings ?? []) console.log(`WARN ${w}`);
console.log(`Sets: ${plan.groups.map((g) => `${g.name} (${g.rows.length} rows)`).join(', ')}`);
if (values['dry-run']) {
  console.log('Dry run: no file written.');
  process.exit(0);
}

// The store path of the Generate sets button: the project holds the column, the sets are added in one step, and the project is exported.
const next = project
  ? { ...project, concretes }
  : { v: 1, app: 'barbending', savedAt: Date.now(), bars: [], concretes, refLines: [], cover, bond: 'good', selectedBar: 0, selectedBars: [] };
useStore.getState().importProject(next);
const added = useStore.getState().addMemberRows(plan.groups, { hostId: member.id, sections: steps.length > 1 ? steps : null });
if (!added.ok) die(added.msg);
const outPath = values.out ?? join(dirname(values.csv), `${basename(values.csv, '.csv')}_bbs.json`);
writeFileSync(outPath, useStore.getState().exportProject());
console.log(`Added ${added.sets} set(s), ${added.count} rows. Wrote ${outPath}`);
