// A wall schedule as a CSV: one row per wall, with the labels below as the header row. Each cell is written as a wall schedule writes it: the bars
// as H16-150 (Ø and spacing), the links as H13-150 x 300 (Ø, the spacing along the wall, the spacing up it), and what stands at each end of the wall
// (starters, dowels or none). A row builds the card's own form (wallFormFromRow), so the card's rules, defaults and messages apply unchanged.
//
// The link needs no length: its spine follows the thickness less the covers, and its hook is the usual one (see wallGroups). A wall with no links
// (only main bars and distribution bars) leaves "Links" blank, or writes none, or has no "Links" column at all. A wall end can have
// dowels instead of starters: single straight bars in the middle of the thickness, with the Ø and spacing of "Dowel bars" (H16-1000 or H16-1000 c/c),
// the "Dowel length (mm)", and how far they stand out of the wall ("Dowel projection (mm)", blank: half the length). The wall's own bars end inside
// the wall either way (see dowelPlan in memberReinforcement.js).
// Second starters (the "PB1 H13" of a wall drawing): horizontal L bars in plan that stand out of a face of the wall. "Second starter bars" is
// H13-150 x 300 (Ø, spacing along the wall, spacing up it), "Second starter face" north, south or both, "Second starter leg (mm)" the long
// leg across the thickness, and optionally the foot, the projection (how far the bend stands out of the face) and the first level (see secondPlan).
import { csvRows, norm } from './columnCsv.js';
import { CARD_STARTERS, defaultCardInputs } from './memberReinforcement.js';

// The labels in the order the template gives them, and the field each one fills. A number cell must read as a number.
export const WALL_CSV_COLUMNS = [
  { label: 'Wall', key: 'name' },
  { label: 'Thickness (mm)', key: 'ly', number: true },
  { label: 'Length (mm)', key: 'lx', number: true },
  { label: 'Height (mm)', key: 'lz', number: true },
  { label: 'SFL (m)', key: 'sfl', number: true },
  { label: 'X (mm)', key: 'x', number: true },
  { label: 'Y (mm)', key: 'y', number: true },
  { label: 'Main bars', key: 'mains' },
  { label: 'Distribution bars', key: 'dist' },
  { label: 'Links', key: 'links' },
  { label: 'Link leg A (mm)', key: 'legA', number: true },
  { label: 'Base', key: 'base' },
  { label: 'Top', key: 'top' },
  { label: 'Starter bars', key: 'starterDia' },
  { label: 'Starter lap (mm)', key: 'lap', number: true },
  { label: 'Starter anchorage (mm)', key: 'anchorage', number: true },
  { label: 'Starter bend leg (mm)', key: 'bend', number: true },
  { label: 'Dowel bars', key: 'dowels' },
  { label: 'Dowel length (mm)', key: 'dowelLength', number: true },
  { label: 'Dowel projection (mm)', key: 'dowelOut', number: true },
  { label: 'Second starter bars', key: 'second' },
  { label: 'Second starter face', key: 'secondFace' },
  { label: 'Second starter leg (mm)', key: 'secondLeg', number: true },
  { label: 'Second starter foot (mm)', key: 'secondFoot', number: true },
  { label: 'Second starter projection (mm)', key: 'secondOut', number: true },
  { label: 'Second starter first level (mm)', key: 'secondZ', number: true },
];
const REQUIRED = ['Wall', 'Main bars', 'Distribution bars'];

const NUMBER_CELL = /^-?\d+(\.\d+)?$/;
const BARS_RE = /^H\s*(\d+)\s*-\s*(\d+)$/i;                       // H16-150: Ø and spacing
const LINKS_RE = /^H\s*(\d+)\s*-\s*(\d+)\s*[x×]\s*(\d+)$/i;       // H13-150 x 300: Ø, spacing along the wall, spacing up it
const DOWELS_RE = /^H\s*(\d+)\s*-\s*(\d+)(?:\s*c\s*\/\s*c)?$/i;   // H16-1000 or H16-1000 c/c
const DIA_RE = /^H?\s*(\d+)$/i;                                    // H13 or 13
const END_WORDS = new Map([
  ['', 'starters'], ['starters', 'starters'], ['starter', 'starters'],
  ['dowels', 'dowels'], ['dowel', 'dowels'],
  ['none', 'none'], ['no', 'none'],
]);
const NO_LINKS_WORDS = new Set(['', 'none', 'no']);                   // a Links cell that says the wall has no links
const FACE_WORDS = new Map([['north', 'north'], ['south', 'south'], ['both', 'both']]);

// The rows of a wall CSV as text cells keyed by field, or { ok: false, msg }. Checks the header, that number cells are numbers, and the names.
export function parseWallCsv(text) {
  const [header = [], ...body] = csvRows(text);
  const byLabel = new Map(WALL_CSV_COLUMNS.map((c) => [norm(c.label), c]));
  const cols = [];
  for (const h of header) {
    if (norm(h) === '') { cols.push(null); continue; }
    const c = byLabel.get(norm(h));
    if (!c) return { ok: false, msg: `Unknown column "${h}". The wall columns are: ${WALL_CSV_COLUMNS.map((x) => x.label).join(', ')}.` };
    if (cols.includes(c)) return { ok: false, msg: `Column "${h}" is in the header twice.` };
    cols.push(c);
  }
  for (const need of REQUIRED) {
    if (!cols.some((c) => c && c.label === need)) return { ok: false, msg: `The header needs "${need}".` };
  }
  if (!body.length) return { ok: false, msg: 'The file has a header but no walls under it.' };

  const rows = [];
  const seen = new Set();
  const nameAt = cols.findIndex((c) => c && c.key === 'name');
  for (let r = 0; r < body.length; r++) {
    const line = body[r];
    const name = String(line[nameAt] ?? '').trim();
    if (name === '') return { ok: false, msg: `Row ${r + 1} has no name: "Wall" must say which wall it is.` };
    if (seen.has(name)) return { ok: false, msg: `The wall "${name}" is on two rows.` };
    seen.add(name);
    const row = Object.fromEntries(WALL_CSV_COLUMNS.map((c) => [c.key, '']));
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (!c) continue;
      const v = String(line[i] ?? '').trim();
      if (c.number && v !== '' && !NUMBER_CELL.test(v)) return { ok: false, msg: `Wall ${name}, ${c.label}: "${v}" is not a number.` };
      row[c.key] = v;
    }
    rows.push(row);
  }
  return { ok: true, rows };
}

// The card's form for one row (each cell as text, as the card's form holds them), or { ok: false, msg }. `cover` is the project's cover, for the
// card's own defaults (the link's leg A is the card's 130 unless the row gives it).
export function wallFormFromRow(row, cover = 40) {
  const fail = (label, v, how) => ({ ok: false, msg: `Wall ${row.name}, ${label}: "${v}" is not written as the schedule writes it. ${how}` });
  const mains = BARS_RE.exec(row.mains);
  if (!mains) return fail('Main bars', row.mains, 'Write the Ø and the spacing, for example H16-150.');
  const dist = BARS_RE.exec(row.dist);
  if (!dist) return fail('Distribution bars', row.dist, 'Write the Ø and the spacing, for example H13-150.');
  // A wall with no links leaves the cell blank (or writes none); a link leg A with no links is a stray cell, which is refused.
  const noLinks = NO_LINKS_WORDS.has(norm(row.links));
  const links = noLinks ? null : LINKS_RE.exec(row.links);
  if (!noLinks && !links) {
    return fail('Links', row.links, 'Write the Ø, the spacing along the wall and the spacing up the wall, for example H13-150 x 300, or leave it blank for a wall with no links.');
  }
  if (noLinks && row.legA !== '') return { ok: false, msg: `Wall ${row.name} has a link leg A, but no Links. Write the links, or clear "Link leg A (mm)".` };
  let starterDia = '';
  if (row.starterDia !== '') {
    const m = DIA_RE.exec(row.starterDia);
    if (!m) return fail('Starter bars', row.starterDia, 'Write the Ø, for example H13: the starters stand at the main bars, so they take no spacing.');
    starterDia = m[1];
  }
  const ends = {};
  for (const [key, label] of [['base', 'Base'], ['top', 'Top']]) {
    const word = END_WORDS.get(norm(row[key]));
    if (!word) return { ok: false, msg: `Wall ${row.name}, ${label}: "${row[key]}" is not starters, dowels or none.` };
    ends[key] = word;
  }
  const dowelEnds = ['Base', 'Top'].filter((label, i) => ends[i === 0 ? 'base' : 'top'] === 'dowels');
  let dowelDia = '', dowelSpacing = '';
  if (row.dowels !== '') {
    const m = DOWELS_RE.exec(row.dowels);
    if (!m) return fail('Dowel bars', row.dowels, 'Write the Ø and the spacing, for example H16-1000.');
    [, dowelDia, dowelSpacing] = m;
  }
  if (dowelEnds.length) {
    if (row.dowels === '') return { ok: false, msg: `Wall ${row.name}, ${dowelEnds[0]} is dowels, so the row needs "Dowel bars" (the Ø and the spacing, for example H16-1000).` };
    if (row.dowelLength === '') return { ok: false, msg: `Wall ${row.name}, ${dowelEnds[0]} is dowels, so the row needs "Dowel length (mm)".` };
  } else if (row.dowels !== '' || row.dowelLength !== '' || row.dowelOut !== '') {
    return { ok: false, msg: `Wall ${row.name} has dowel cells, but neither Base nor Top says dowels. Set the end to dowels, or clear the dowel cells.` };
  }
  // Second starters: the bars (Ø, spacing along, spacing up), the face and the leg are needed; the foot, projection and first level are optional.
  let second = null;
  let face = '';
  if (row.second !== '') {
    second = LINKS_RE.exec(row.second);
    if (!second) return fail('Second starter bars', row.second, 'Write the Ø, the spacing along the wall and the spacing up the wall, for example H13-150 x 300.');
    if (row.secondFace === '') return { ok: false, msg: `Wall ${row.name} has Second starter bars, so the row needs "Second starter face" (north, south or both).` };
    face = FACE_WORDS.get(norm(row.secondFace));
    if (!face) return { ok: false, msg: `Wall ${row.name}, Second starter face: "${row.secondFace}" is not north, south or both.` };
    if (row.secondLeg === '') return { ok: false, msg: `Wall ${row.name} has Second starter bars, so the row needs "Second starter leg (mm)" (the long leg across the thickness).` };
  } else if (row.secondFace !== '' || row.secondLeg !== '' || row.secondFoot !== '' || row.secondOut !== '' || row.secondZ !== '') {
    return { ok: false, msg: `Wall ${row.name} has second starter cells, but no "Second starter bars". Write them, or clear those cells.` };
  }

  // The card's defaults as text (a yes/no setting stays as it is), then the row's bars.
  const wall = Object.fromEntries(Object.entries(defaultCardInputs(cover).wall).map(([k, v]) => [k, typeof v === 'boolean' ? v : String(v)]));
  Object.assign(wall, {
    mainDia: mains[1], mainSpacing: mains[2],
    distDia: dist[1], distSpacing: dist[2],
    noLinks,
  });
  if (links) Object.assign(wall, { linkDia: links[1], linkSpacing: links[2], linkVSpacing: links[3] });
  if (row.legA !== '') wall.legA = row.legA;
  return {
    ok: true,
    form: {
      kind: 'Wall',
      column: { layout: 'all', lap: '', schedule: [] },
      wall,
      starters: {
        ...CARD_STARTERS,
        base: ends.base === 'starters',
        top: ends.top === 'starters',
        dia: starterDia,
        lap: row.lap,
        anchorage: row.anchorage,
        bend: row.bend,
        dowelBase: ends.base === 'dowels',
        dowelTop: ends.top === 'dowels',
        dowelDia,
        dowelSpacing,
        dowelLength: row.dowelLength,
        dowelOut: row.dowelOut,
        second: face,
        secondDia: second ? second[1] : '',
        secondSpacing: second ? second[2] : '',
        secondVSpacing: second ? second[3] : '',
        secondLeg: row.secondLeg,
        secondFoot: row.secondFoot,
        secondOut: row.secondOut,
        secondZ: row.secondZ,
      },
    },
  };
}

// The walls of a wall CSV: { ok, walls: [{ name, lx, ly, lz, sfl, x, y, form }] } (a size, level or position the row leaves blank is null), or
// { ok: false, msg }.
export function wallsFromCsv(text, { cover = 40 } = {}) {
  const parsed = parseWallCsv(text);
  if (!parsed.ok) return parsed;
  const num = (v) => (v === '' ? null : Number(v));
  const walls = [];
  for (const row of parsed.rows) {
    const built = wallFormFromRow(row, cover);
    if (!built.ok) return built;
    walls.push({ name: row.name, lx: num(row.lx), ly: num(row.ly), lz: num(row.lz), sfl: num(row.sfl), x: num(row.x), y: num(row.y), form: built.form });
  }
  return { ok: true, walls };
}

// The member each wall is, and the project's concretes with the new ones added. A wall named like a member of `concretes` is that member (a size,
// level or position the row gives replaces the project's); any other wall is new, from its row: it needs its length, thickness and height, sits at
// its X, Y and SFL (blank: 0), and a blank Y stacks it `gap` mm behind the new wall before it, so that walls do not overlap in the model.
// Returns { ok, members: [{ member, wall, isNew }], concretes } or { ok: false, msg }.
export function wallMembers(walls, { concretes = [], cover = 40, gap = 1000 } = {}) {
  const list = [...concretes];
  const used = new Set(list.map((c) => c.id));
  let seq = 0;
  const nextId = () => {
    do { seq += 1; } while (used.has(`c${seq}`));
    used.add(`c${seq}`);
    return `c${seq}`;
  };
  const members = [];
  let stackY = 0;   // where the next new wall with no Y goes
  for (const wall of walls) {
    const found = concretes.find((c) => c.name === wall.name);
    if (found) {
      const member = { ...found };
      for (const k of ['lx', 'ly', 'lz', 'x', 'y']) if (wall[k] !== null) member[k] = wall[k];
      if (wall.sfl !== null) member.z = Math.round(wall.sfl * 1000);
      list[list.findIndex((c) => c.id === found.id)] = member;
      members.push({ member, wall, isNew: false });
      continue;
    }
    for (const [k, label] of [['ly', 'Thickness'], ['lx', 'Length'], ['lz', 'Height']]) {
      if (wall[k] === null) return { ok: false, msg: `Wall ${wall.name} is not in the project, so its row needs its "${label} (mm)".` };
    }
    const y = wall.y !== null ? wall.y : stackY;
    const member = {
      id: nextId(), name: wall.name, kind: 'WALL', lx: wall.lx, ly: wall.ly, lz: wall.lz,
      x: wall.x !== null ? wall.x : 0, y, z: wall.sfl !== null ? Math.round(wall.sfl * 1000) : 0,
      covB: cover, covT: cover, slope: 0,
    };
    stackY = y + wall.ly + gap;
    list.push(member);
    members.push({ member, wall, isNew: true });
  }
  return { ok: true, members, concretes: list };
}
