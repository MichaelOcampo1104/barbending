// CSV import/export compatible with FreeCAD macros.
// rebar_detailing.py reads rebar_scheduling.csv with a Rebar_Type column
// and dispatches to place_*_from_csv. We export the union header so the
// file can be consumed directly, and accept any of the gen_* templates.

import { genBarPoints, distCount } from './shapes.js';
import { barWeightKg } from './calc.js';

export const MASTER_HEADERS = [
  'Rebar_tag', 'Bar_mark', 'Rebar_Type', 'Dia',
  'Pos_x', 'Pos_y', 'Pos_z', 'Group', 'Pos_Rotation', 'Plane',
  'Length of Bar', 'H', 'bent_up_down',
  'Long_length', 'Crank_step', 'Length of Lap',
  'DC_Lap_Start', 'DC_Lap_Mid', 'DC_Tail_Length',
  'c_length_a', 'c_length_b', 'length', 'double_hook',
  'qty_x', 'spacing_x', 'qty_y', 'spacing_y',
  'offset_x', 'offset_y', 'offset_z', 'plan_rotation', 'feature',
  'qty', 'Total Length', 'Weight_kg',
];

export function enrichBar(bar) {
  const g = genBarPoints(bar);
  const copies = distCount(bar); // qty (sets) × qty_x × qty_y
  return {
    ...bar,
    'Total Length': bar['Total Length'] || g.cutLengthMm,
    Weight_kg: +barWeightKg(Number(bar.Dia || 16), g.cutLengthMm, copies).toFixed(2),
    _cut: g.cutLengthMm,
    _copies: copies,
  };
}

export function toCsv(bars) {
  const rows = bars.map(enrichBar);
  const esc = (v) => {
    if (v === undefined || v === null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [MASTER_HEADERS.join(',')];
  for (const r of rows) lines.push(MASTER_HEADERS.map((h) => esc(r[h] ?? '')).join(','));
  return lines.join('\n');
}

export function downloadCsv(bars, filename = 'rebar_scheduling.csv') {
  const blob = new Blob([toCsv(bars)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// Minimal CSV parser (handles quotes) -> array of objects
export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return [];
  const headers = splitLine(lines[0]);
  return lines.slice(1).filter(Boolean).map((ln) => {
    const cells = splitLine(ln);
    const o = {};
    headers.forEach((h, i) => { o[h.trim()] = (cells[i] ?? '').trim(); });
    // numeric coercion for known fields
    for (const k of ['Rebar_tag', 'Dia', 'Pos_x', 'Pos_y', 'Pos_z', 'Pos_Rotation', 'Plane', 'qty',
      'qty_x', 'spacing_x', 'qty_y', 'spacing_y', 'offset_x', 'offset_y', 'offset_z',
      'Length of Bar', 'H', 'Long_length', 'Crank_step', 'Length of Lap',
      'DC_Lap_Start', 'DC_Lap_Mid', 'DC_Tail_Length', 'c_length_a', 'c_length_b', 'length', 'double_hook']) {
      if (o[k] !== '' && o[k] !== undefined && !isNaN(Number(o[k]))) o[k] = Number(o[k]);
    }
    if (!o.Rebar_Type) o.Rebar_Type = 'straight';
    if (!o.qty) o.qty = 1;
    return o;
  });
}

function splitLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
