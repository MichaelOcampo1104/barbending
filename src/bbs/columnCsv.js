// A box column's schedule as a CSV in the card's own layout: one row per level, top level first, with the card's labels as the header row.
// Each cell is what the card's cell holds. A blank cell is blank, and "same", "same as below" or "= below" takes the level under it (the card's
// "= below" button). The column's Layout and its Lap at corner are not in the file: the command gives them (see columnFormFromCsv).
import { CARD_STARTERS, defaultCardInputs } from './memberReinforcement.js';

// The card's labels in the card's order, and the level field each one fills. A number cell must read as a number.
export const COLUMN_CSV_COLUMNS = [
  { label: 'Level', key: 'name' },
  { label: 'SFL (m)', key: 'sfl', number: true },
  { label: 'SIZE', key: 'size' },
  { label: 'MAIN BARS layout', key: 'layout' },
  { label: 'MAIN BARS', key: 'bars' },
  { label: 'MAIN BARS long face', key: 'barsLong' },
  { label: 'MAIN BARS short face', key: 'barsShort' },
  { label: 'Outer link', key: 'linksOuter' },
  { label: 'Cross links X', key: 'linksX' },
  { label: 'Cross links Y', key: 'linksY' },
  { label: 'Slab thk (mm)', key: 'slab', number: true },
  { label: 'Longest crank (mm)', key: 'crankMax', number: true },
  { label: 'Lap (good bond)', key: 'lap', number: true },
  { label: 'Crank step', key: 'step', number: true },
  { label: 'Jog', key: 'jog', number: true },
];

// The MAIN BARS layout cell, by the card's option labels or their codes. Blank is "same as below", as the card's default.
const LAYOUT_WORDS = new Map([
  ['', 'same'],
  ['same', 'same'],
  ['same as below', 'same'],
  ['= below', 'same'],
  ['all', 'all'],
  ['one size on every face', 'all'],
  ['faces', 'faces'],
  ['long and short faces', 'faces'],
]);
const SAME_CELL = /^(=\s*below|same(\s+as\s+below)?)$/i;
const NUMBER_CELL = /^-?\d+(\.\d+)?$/;
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();

// Splits CSV text into rows of trimmed cells. A cell in double quotes may hold commas, and "" is one quote. Blank rows are dropped.
function csvRows(text) {
  const s = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell.trim());
  rows.push(row);
  return rows.filter((r) => r.some((c) => c !== ''));
}

// The levels of a column schedule, top level first, as the card's form holds them (each cell as text). Returns { ok, schedule } or { ok: false, msg }.
export function parseColumnCsv(text) {
  const [header = [], ...body] = csvRows(text);
  const byLabel = new Map(COLUMN_CSV_COLUMNS.map((c) => [norm(c.label), c]));
  const cols = [];
  for (const h of header) {
    if (norm(h) === '') { cols.push(null); continue; }
    const c = byLabel.get(norm(h));
    if (!c) return { ok: false, msg: `Unknown column "${h}". The card's columns are: ${COLUMN_CSV_COLUMNS.map((x) => x.label).join(', ')}.` };
    if (cols.includes(c)) return { ok: false, msg: `Column "${h}" is in the header twice.` };
    cols.push(c);
  }
  const has = (label) => cols.some((c) => c && c.label === label);
  for (const need of ['SFL (m)', 'SIZE', 'Outer link']) {
    if (!has(need)) return { ok: false, msg: `The header needs "${need}".` };
  }
  if (!has('MAIN BARS') && !(has('MAIN BARS long face') && has('MAIN BARS short face'))) {
    return { ok: false, msg: 'The header needs "MAIN BARS", or both "MAIN BARS long face" and "MAIN BARS short face".' };
  }
  if (!body.length) return { ok: false, msg: 'The file has a header but no levels under it.' };

  const schedule = [];
  for (let r = 0; r < body.length; r++) {
    const line = body[r];
    const row = { name: '', sfl: '', size: '', layout: '', bars: '', barsLong: '', barsShort: '', linksOuter: '', linksX: '', linksY: '', slab: '', crankMax: '', lap: '', step: '', jog: '' };
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (!c) continue;
      const v = String(line[i] ?? '').trim();
      const where = `level ${r + 1} (counting from the top), ${c.label}`;
      if (c.key === 'name') {
        row.name = v;
      } else if (c.key === 'layout') {
        if (!LAYOUT_WORDS.has(norm(v))) return { ok: false, msg: `${where}: "${v}" is not a MAIN BARS layout. Write "same as below", "one size on every face" or "long and short faces".` };
        row.layout = LAYOUT_WORDS.get(norm(v));
      } else if (c.number && v !== '' && !NUMBER_CELL.test(v)) {
        return { ok: false, msg: `${where}: "${v}" is not a number.` };
      } else {
        row[c.key] = !c.number && SAME_CELL.test(v) ? 'same' : v;
      }
    }
    schedule.push(row);
  }
  return { ok: true, schedule };
}

// The card's form for a column, built from the CSV: its schedule, and the column's Layout and Lap at corner (which the file does not hold). The
// wall and the starters take the card's defaults. Returns { ok, form } or { ok: false, msg }.
export function columnFormFromCsv(text, { layout = 'all', lap = '', cover = 40 } = {}) {
  const parsed = parseColumnCsv(text);
  if (!parsed.ok) return parsed;
  const wall = Object.fromEntries(Object.entries(defaultCardInputs(cover).wall).map(([k, v]) => [k, String(v)]));
  return {
    ok: true,
    form: { kind: 'Column', column: { layout, lap: String(lap ?? ''), schedule: parsed.schedule }, wall, starters: { ...CARD_STARTERS } },
  };
}
