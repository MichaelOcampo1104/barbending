// CSV import/export compatible with FreeCAD macros and FreeCAD Reinforcement BBS benchmark.
// rebar_detailing.py reads rebar_scheduling.csv with a Rebar_Type column
// and dispatches to place_*_from_csv. We export the union header so the
// file can be consumed directly, and accept any of the gen_* templates.

import { genBarPoints, distCount } from './shapes.js';
import { barWeightKg } from './calc.js';

export const SHAPE_CODES = {
  straight: 20,
  bent: 37,
  c_link: 38,
  clink: 38,
  c_link_with_hook: 85,
  crank: 41,
  double_crank: 43,
};

export function getShapeParameters(bar) {
  const dia = Number(bar.Dia || 16);
  const type = (bar.Rebar_Type || 'straight').toLowerCase();
  const shapeCode = SHAPE_CODES[type] || 20;

  let A = '', B = '', C = '', D = '', E = '';

  switch (type) {
    case 'straight':
      A = Number(bar['Length of Bar'] || bar.length || 3000);
      break;
    case 'bent':
      A = Number(bar['Length of Bar'] || bar.length || 3000);
      B = Number(bar.H || 800);
      break;
    case 'c_link':
    case 'clink':
      A = Number(bar.c_length_a || 600);
      B = Number(bar.c_length_b || 400);
      C = Number(bar.c_length_a || 600);
      break;
    case 'c_link_with_hook':
      A = Number(bar.c_length_a || 600);
      B = Number(bar.c_length_b || 400);
      C = Number(bar.c_length_a || 600);
      D = Math.round(Number(bar.double_hook || 10) * dia);
      break;
    case 'crank':
      A = Math.round(Number(bar.Long_length || 4000) * 0.4);
      B = Number(bar.Crank_step || 300);
      C = Math.round(Number(bar.Long_length || 4000) * 0.4);
      D = Number(bar['Length of Lap'] || 500);
      break;
    case 'double_crank':
      A = Number(bar.DC_Lap_Start || 1000);
      B = Number(bar.Crank_step || 300);
      C = Number(bar.DC_Lap_Mid || 2000);
      D = Number(bar.Crank_step || 300);
      E = Number(bar.DC_Tail_Length || 1000);
      break;
    default:
      A = Number(bar['Length of Bar'] || bar.length || 3000);
      break;
  }

  return { shapeCode, A, B, C, D, E };
}

export const MASTER_HEADERS = [
  'Rebar_tag', 'Bar_mark', 'Rebar_Type', 'Shape_Code', 'Dia',
  'Pos_x', 'Pos_y', 'Pos_z', 'Group', 'Pos_Rotation', 'Plane',
  'Length of Bar', 'H', 'bent_up_down',
  'Long_length', 'Crank_step', 'Length of Lap',
  'DC_Lap_Start', 'DC_Lap_Mid', 'DC_Tail_Length',
  'c_length_a', 'c_length_b', 'length', 'double_hook',
  'qty_x', 'spacing_x', 'qty_y', 'spacing_y',
  'offset_x', 'offset_y', 'offset_z', 'plan_rotation', 'feature',
  'qty', 'Total Length', 'Weight_kg',
  // Browser-only view flag (extra column ignored by FreeCAD's DictReader).
  // Host membership is a live-session concern and is NOT exported.
  'Visible',
];

export function enrichBar(bar) {
  const g = genBarPoints(bar);
  const copies = distCount(bar); // qty (sets) × qty_x × qty_y
  const { shapeCode } = getShapeParameters(bar);
  return {
    ...bar,
    Shape_Code: shapeCode,
    Visible: bar.hidden ? 0 : 1,
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

export const BBS_BENCHMARK_HEADERS = [
  'Member',
  'Bar Mark',
  'Type',
  'Diameter (mm)',
  'No. of Members',
  'No. of Bars in each',
  'Total No. of Bars',
  'Length of each bar (mm)',
  'Shape Code',
  'A (mm)',
  'B (mm)',
  'C (mm)',
  'D (mm)',
  'E (mm)',
  'Total Length (m)',
  'Total Weight (kg)',
];

export function toBbsBenchmarkCsv(bars, concretes = []) {
  const concMap = new Map((concretes || []).map((c) => [c.id, c.name || c.type || c.id]));
  const rows = bars.map(enrichBar);

  const esc = (v) => {
    if (v === undefined || v === null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = ['Bar Bending Schedule', BBS_BENCHMARK_HEADERS.join(',')];
  const diaTotals = {};

  for (const r of rows) {
    const member = (r.host && concMap.get(r.host)) || r.Group || 'Free';
    const mark = r.Bar_mark || `B${r.Rebar_tag || 1}`;
    const type = r.Rebar_Type || 'straight';
    const dia = Number(r.Dia || 16);
    const sets = Math.max(1, Math.floor(Number(r.qty) || 1));
    const each = Math.max(1, Math.floor(Number(r.qty_x || 1) * Number(r.qty_y || 1)));
    const totalBars = r._copies || (sets * each);
    const cutLenMm = r._cut || 0;
    const totalLenM = +( (totalBars * cutLenMm) / 1000 ).toFixed(3);
    const weightKg = r.Weight_kg || 0;

    const { shapeCode, A, B, C, D, E } = getShapeParameters(r);

    if (!diaTotals[dia]) {
      diaTotals[dia] = { lengthM: 0, weightKg: 0 };
    }
    diaTotals[dia].lengthM += totalLenM;
    diaTotals[dia].weightKg += weightKg;

    const rowData = [
      member,
      mark,
      type,
      dia,
      sets,
      each,
      totalBars,
      cutLenMm,
      shapeCode,
      A,
      B,
      C,
      D,
      E,
      totalLenM,
      weightKg,
    ];
    lines.push(rowData.map(esc).join(','));
  }

  // Summary breakdown per diameter (matching FreeCAD BBSfunc_csv.py / Reinforcement benchmark)
  lines.push('');
  lines.push('Diameter (mm),Total Length (m),Total Weight (kg)');
  let grandLenM = 0;
  let grandWeightKg = 0;

  const sortedDias = Object.keys(diaTotals).map(Number).sort((a, b) => a - b);
  for (const d of sortedDias) {
    const slot = diaTotals[d];
    grandLenM += slot.lengthM;
    grandWeightKg += slot.weightKg;
    lines.push([d, slot.lengthM.toFixed(3), slot.weightKg.toFixed(2)].map(esc).join(','));
  }

  lines.push(['Total', grandLenM.toFixed(3), grandWeightKg.toFixed(2)].map(esc).join(','));

  return lines.join('\n');
}

export function downloadBbsCsv(bars, concretes = [], filename = 'bar_bending_schedule.csv') {
  const csvContent = toBbsBenchmarkCsv(bars, concretes);
  // Prepend UTF-8 BOM so Excel opens special characters and formatting reliably
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8' });
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
    for (const k of ['Rebar_tag', 'Shape_Code', 'Dia', 'Pos_x', 'Pos_y', 'Pos_z', 'Pos_Rotation', 'Plane', 'qty',
      'qty_x', 'spacing_x', 'qty_y', 'spacing_y', 'offset_x', 'offset_y', 'offset_z',
      'Length of Bar', 'H', 'Long_length', 'Crank_step', 'Length of Lap',
      'DC_Lap_Start', 'DC_Lap_Mid', 'DC_Tail_Length', 'c_length_a', 'c_length_b', 'length', 'double_hook',
      'Visible']) {
      if (o[k] !== '' && o[k] !== undefined && !isNaN(Number(o[k]))) o[k] = Number(o[k]);
    }
    if (Number(o.Visible) === 0) o.hidden = true;
    delete o.Visible;
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
