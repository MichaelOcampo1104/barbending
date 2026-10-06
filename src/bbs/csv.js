// CSV import/export compatible with FreeCAD macros and FreeCAD Reinforcement BBS benchmark.
// rebar_detailing.py reads rebar_scheduling.csv with a Rebar_Type column
// and dispatches to place_*_from_csv. We export the union header so the
// file can be consumed directly, and accept any of the gen_* templates.

import { genBarPoints, distCount, getBentDefaults, resolveBarHost, meshVolumeM3 } from './shapes.js';
import { barWeightKg, normalizeBond, inferBondFromMark } from './calc.js';

export const SHAPE_CODES = {
  straight: 20,
  bent: 37,
  c_link: 38,
  clink: 38,
  c_link_with_hook: 85,
  crank: 41,
  double_crank: 43,
  tie: 51,
  // Custom drawn profile (stair landing starters): no BS8666 equivalent —
  // 99 = special/bar-bent-to-sketch, cut length in A.
  stair_starter: 99,
  // General per-leg section profile (DXF PROFILE tags): same special class.
  profile: 99,
};

// Concrete volume in m³. Precedence: exact retraced mesh geometry (auto-traced
// complex profiles, openings and chamfers included) guarded against degenerate
// meshes — a closed solid can never exceed its own bbox — else Lx·Ly·Lz box.
export function concreteVolumeM3(c) {
  if (!c) return 0;
  const box = (Math.max(0, Number(c.lx) || 0) * Math.max(0, Number(c.ly) || 0) * Math.max(0, Number(c.lz) || 0)) / 1e9;
  const mesh = meshVolumeM3(c.meshData);
  if (mesh > 0 && (box <= 0 || mesh <= box * 1.001)) return mesh;
  return box;
}

// Where a member's BBS volume comes from: 'mesh' (exact retraced geometry)
// or 'box' (Lx·Ly·Lz). Shown in the Concrete tab so the take-off is auditable.
export function concreteVolumeSource(c) {
  if (!c) return 'box';
  const box = (Math.max(0, Number(c.lx) || 0) * Math.max(0, Number(c.ly) || 0) * Math.max(0, Number(c.lz) || 0)) / 1e9;
  const mesh = meshVolumeM3(c.meshData);
  return (mesh > 0 && (box <= 0 || mesh <= box * 1.001)) ? 'mesh' : 'box';
}

// Rebar ratio in kg/m³, or null when there is no concrete volume.
export function rebarRatioKgM3(steelKg, concM3) {
  return concM3 > 0 ? steelKg / concM3 : null;
}

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
    case 'clink': {      const defs = getBentDefaults(dia);
      A = Number(bar.c_length_a || defs.H);
      B = Number(bar.length || bar['Length of Bar'] || 1000);
      C = Number(bar.c_length_b || defs.H);
      break;
    }
    case 'c_link_with_hook': {
      const isDouble = String(bar.double_hook || 'no').toLowerCase() === 'yes';
      const defs = getBentDefaults(dia);
      const hookReturn = Math.round(10 * dia);
      const defaultC = (dia === 16 ? 130 : dia === 13 ? 130 : (defs.U || 130));
      const hookC = Number(bar.c_length_b) || defaultC;
      const lenA = Number(bar.c_length_a || defs.H);
      const L = Number(bar.length || bar['Length of Bar'] || 1000);
      const hook6d = Math.round(6 * dia);

      A = isDouble ? hook6d : lenA;
      B = L;
      C = hookC;
      D = hookReturn;
      break;
    }
    case 'tie': {
      // Closed rectangular tie: A = X-side (length), B = Y-side (c_length_a)
      const tL = Number(bar.length || 400);
      const tW = Number(bar.c_length_a ?? 400);
      A = tL;
      B = tW;
      break;
    }
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
    case 'stair_starter': {
      // Explicit profile: A carries the net cut length (profile minus bend
      // deductions); the full vertex list rides the `polyline` column.
      A = genBarPoints(bar).cutLengthMm;
      break;
    }
    case 'profile': {
      // Per-leg profile: A carries the net cut length; the leg table rides
      // the `legs` column ([[len, compassDeg]...] JSON).
      A = genBarPoints(bar).cutLengthMm;
      break;
    }
    default:
      A = Number(bar['Length of Bar'] || bar.length || 3000);
      break;
  }

  return { shapeCode, A, B, C, D, E };
}

export const MASTER_HEADERS = [
  'Rebar_tag', 'Bar_mark', 'Rebar_Type', 'Shape_Code', 'Dia',
  'Pos_x', 'Pos_y', 'Pos_z', 'Group', 'Pos_Rotation', 'Plane',
  'Length of Bar', 'H', 'bent_up_down', 'hook_start',
  'Long_length', 'Crank_step', 'Length of Lap', 'bond_condition',
  'DC_Lap_Start', 'DC_Lap_Mid', 'DC_Tail_Length',
  'c_length_a', 'c_length_b', 'length', 'double_hook',
  'qty_x', 'spacing_x', 'qty_y', 'spacing_y', 'qty_z', 'spacing_z',
  'offset_x', 'offset_y', 'offset_z', 'plan_rotation', 'feature',
  // Explicit section-profile vertices for `stair_starter` ([[run,up]...]
  // local mm JSON). Extra column, ignored by FreeCAD's DictReader.
  'polyline',
  // Per-leg section profile for `profile` ([[len,compassDeg]...] JSON).
  // Extra column, ignored by FreeCAD's DictReader.
  'legs',
  // Face-sketch bar-set membership (setId shared by stepped rows) + the
  // sketch spec JSON that re-spreads them. Browser-side grouping data.
  'setId',
  'setSpec',
  'qty', 'Total Length', 'Weight_kg',
  // Browser-only view flag (extra column ignored by FreeCAD's DictReader).
  // Host membership is a live-session concern and is NOT exported.
  'Visible',
];

export function enrichBar(bar, concretes = []) {
  const g = genBarPoints(bar);
  const copies = distCount(bar); // qty (sets) × qty_x × qty_y
  const { shapeCode } = getShapeParameters(bar);
  const resolvedHost = resolveBarHost(bar, concretes);
  // Normalize stored bond so exports round-trip; '' = auto (B→good/T→poor at use).
  // Links carry no lap bond and stay '' even when the mark starts with B.
  const isLinkBar = /^(c_link|clink|c_link_with_hook)$/i.test(String(bar.Rebar_Type || ''));
  const bondStored = normalizeBond(bar.bond_condition ?? bar.bond)
    || (isLinkBar ? '' : inferBondFromMark(bar.Bar_mark));
  return {
    ...bar,
    bond_condition: bondStored,
    host: resolvedHost || bar.host || null,
    Shape_Code: shapeCode,
    Visible: bar.hidden ? 0 : 1,
    'Total Length': bar['Total Length'] || g.cutLengthMm,
    Weight_kg: +barWeightKg(Number(bar.Dia || 16), g.cutLengthMm, copies).toFixed(2),
    _cut: g.cutLengthMm,
    _copies: copies,
    _resolvedHost: resolvedHost,
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

export function toBbsBenchmarkCsv(bars, concretes = [], opts = {}) {
  const concMap = new Map((concretes || []).map((c) => [c.id, c.name || c.type || c.id]));
  const rows = bars.map((b) => enrichBar(b, concretes));

  const esc = (v) => {
    if (v === undefined || v === null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = ['Bar Bending Schedule', BBS_BENCHMARK_HEADERS.join(',')];
  const diaTotals = {};

  // Group by Member + Bar Mark to accumulate identical bar marks
  const grouped = new Map();

  for (const r of rows) {
    const member = (r.host && concMap.get(r.host)) || r.Group || 'Free';
    const mark = r.Bar_mark || `B${r.Rebar_tag || 1}`;
    const isDoubleHook = (r.Rebar_Type || '').toLowerCase() === 'c_link_with_hook' && String(r.double_hook || 'no').toLowerCase() === 'yes';
    const type = isDoubleHook ? 'c_link_with_hook (double hook)' : (r.Rebar_Type || 'straight');
    const dia = Number(r.Dia || 16);
    const sets = Math.max(1, Math.floor(Number(r.qty) || 1));
    const each = Math.max(1, Math.floor(Number(r.qty_x || 1) * Number(r.qty_y || 1)));
    const totalBars = r._copies || (sets * each);
    const cutLenMm = r._cut || 0;
    const weightKg = r.Weight_kg || 0;

    const { shapeCode, A, B, C, D, E } = getShapeParameters(r);

    // Grouping key by Member and Bar Mark (and Dia/Cut to guarantee identical fabrication profile)
    const key = `${member}:::${mark}:::${dia}:::${cutLenMm}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        member,
        mark,
        type,
        dia,
        noOfMembers: sets,
        barsInEach: each * sets,
        totalBars,
        cutLenMm,
        shapeCode,
        A,
        B,
        C,
        D,
        E,
        totalWeightKg: weightKg,
      });
    } else {
      const g = grouped.get(key);
      g.barsInEach += each * sets;
      g.totalBars += totalBars;
      g.totalWeightKg += weightKg;
      g.noOfMembers = 1;
    }
  }

  for (const g of grouped.values()) {
    const totalLenM = +( (g.totalBars * g.cutLenMm) / 1000 ).toFixed(3);
    const weightKg = +g.totalWeightKg.toFixed(2);

    if (!diaTotals[g.dia]) {
      diaTotals[g.dia] = { lengthM: 0, weightKg: 0 };
    }
    diaTotals[g.dia].lengthM += totalLenM;
    diaTotals[g.dia].weightKg += weightKg;

    const rowData = [
      g.member,
      g.mark,
      g.type,
      g.dia,
      g.noOfMembers,
      g.barsInEach,
      g.totalBars,
      g.cutLenMm,
      g.shapeCode,
      g.A,
      g.B,
      g.C,
      g.D,
      g.E,
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

  // Concrete volumes + rebar ratio (kg/m³). opts.memberIds scopes the block
  // to the joined/filtered members; null = every concrete passed in.
  const volMembers = (opts.memberIds
    ? (concretes || []).filter((c) => opts.memberIds.includes(c.id))
    : (concretes || []));
  let totalVolM3 = 0;
  lines.push('');
  lines.push('Concrete volumes (Lx*Ly*Lz)');
  lines.push(['Member', 'Volume (m3)'].map(esc).join(','));
  for (const c of volMembers) {
    const v = concreteVolumeM3(c);
    totalVolM3 += v;
    lines.push([(c.name || c.type || c.id), v.toFixed(3)].map(esc).join(','));
  }
  lines.push(['Total concrete (m3)', totalVolM3.toFixed(3)].map(esc).join(','));
  lines.push(['Total steel (kg)', grandWeightKg.toFixed(2)].map(esc).join(','));
  const ratio = rebarRatioKgM3(grandWeightKg, totalVolM3);
  lines.push(['Rebar ratio (kg/m3)', ratio == null ? 'n/a' : ratio.toFixed(2)].map(esc).join(','));

  return lines.join('\n');
}

export function downloadBbsCsv(bars, concretes = [], filename = 'bar_bending_schedule.csv', opts = {}) {
  const csvContent = toBbsBenchmarkCsv(bars, concretes, opts);
  // Prepend UTF-8 BOM so Excel opens special characters and formatting reliably
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// Generate a unique signature for a bar based on its diameter, type, shape dimensions, and cut length.
export function getBarShapeKey(bar, matchHost = false) {
  const dia = Number(bar.Dia || 16);
  const type = (bar.Rebar_Type || 'straight').toLowerCase();
  const { shapeCode, A, B, C, D, E } = getShapeParameters(bar);
  const pts = genBarPoints(bar);
  const cut = pts?.cutLengthMm || 0;
  const extra = [];
  if (type === 'bent') extra.push(String(bar.bent_up_down || 'up').toLowerCase());
  if (type === 'bent') extra.push('hook:' + String(bar.hook_start || 'no').toLowerCase());
  if (type === 'profile') extra.push('legs:' + JSON.stringify(bar.legs ?? ''));
  if (type === 'c_link_with_hook') extra.push(String(bar.double_hook || 'no').toLowerCase());

  const hostPart = matchHost && bar.host ? `host:${bar.host}|` : '';
  return `${hostPart}type:${type}|dia:${dia}|sc:${shapeCode}|A:${A}|B:${B}|C:${C}|D:${D}|E:${E}|cut:${cut}|${extra.join('|')}`;
}

// Auto-assign / consolidate bar marks across a list of bars based on identical shape, diameter, and length
export function autoAssignBarMarks(bars, { scopeByHost = false } = {}) {
  const sigMap = new Map();
  let globalSeq = 1;
  const hostSeqMap = new Map();

  return bars.map((b) => {
    const hostKey = scopeByHost && b.host ? b.host : 'all';
    const sig = getBarShapeKey(b, scopeByHost);

    if (sigMap.has(sig)) {
      return { ...b, Bar_mark: sigMap.get(sig) };
    }

    let mark = b.Bar_mark;
    if (!mark) {
      if (scopeByHost && b.host) {
        let seq = hostSeqMap.get(hostKey) || 1;
        hostSeqMap.set(hostKey, seq + 1);
        mark = `B${seq}`;
      } else {
        mark = `B${globalSeq++}`;
      }
    }
    sigMap.set(sig, mark);
    return { ...b, Bar_mark: mark };
  });
}

// Minimal CSV parser (handles quotes) -> array of objects
export function parseCsv(text, existingBars = [], concretes = []) {
  const lines = String(text ?? '').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (!lines.length) return [];
  const headers = splitLine(lines[0]);

  // Track max tag for auto-tagging
  let currentMaxTag = (existingBars || []).reduce((max, b) => Math.max(max, Number(b.Rebar_tag) || 0), 0);

  // Track mark numbering sequence per host concrete element
  const markSeqByHost = new Map();
  // Map identical bar signatures to known Bar_marks
  const signatureToMarkMap = new Map();

  for (const b of existingBars || []) {
    if (b.Bar_mark) {
      const sigHost = getBarShapeKey(b, true);
      const sigGlobal = getBarShapeKey(b, false);
      if (b.host) signatureToMarkMap.set(sigHost, b.Bar_mark);
      if (!signatureToMarkMap.has(sigGlobal)) signatureToMarkMap.set(sigGlobal, b.Bar_mark);

      if (b.host) {
        const m = String(b.Bar_mark).match(/^([A-Za-z_-]+)(\d+)$/);
        if (m) {
          const prefix = m[1];
          const num = parseInt(m[2], 10);
          const numLen = m[2].length;
          const cur = markSeqByHost.get(b.host);
          if (!cur || num > cur.num) {
            markSeqByHost.set(b.host, { prefix, num, numLen });
          }
        }
      }
    }
  }

  const result = [];

  for (const ln of lines.slice(1).filter(Boolean)) {
    const cells = splitLine(ln);
    const o = {};
    headers.forEach((h, i) => { o[h.trim()] = (cells[i] ?? '').trim(); });

    // Numeric coercion for known fields
    for (const k of ['Rebar_tag', 'Shape_Code', 'Dia', 'Pos_x', 'Pos_y', 'Pos_z', 'Pos_Rotation', 'plan_rotation', 'qty',
      'qty_x', 'spacing_x', 'qty_y', 'spacing_y', 'qty_z', 'spacing_z', 'offset_x', 'offset_y', 'offset_z',
      'Length of Bar', 'H', 'Long_length', 'Crank_step', 'Length of Lap',
      'DC_Lap_Start', 'DC_Lap_Mid', 'DC_Tail_Length', 'c_length_a', 'c_length_b', 'length',
      'Visible']) {
      if (o[k] !== '' && o[k] !== undefined && !isNaN(Number(o[k]))) o[k] = Number(o[k]);
    }

    // Match Concrete_element / Member / host to model concrete members
    const elemName = o.Concrete_element || o.Concrete || o.Member || o.host;
    if (elemName && concretes && concretes.length) {
      const str = String(elemName).trim().toLowerCase();
      const matched = concretes.find(
        (c) => c.id?.toLowerCase() === str || c.name?.toLowerCase() === str
      );
      if (matched) {
        o.host = matched.id;
      }
    }

    // Default Plane to 'XY' (horizontal plane) when inserting from CSV
    const planeRaw = String(o.Plane ?? '').toUpperCase().trim();
    if (planeRaw === '0' || planeRaw === 'XY' || planeRaw === 'TOP' || planeRaw === 'HORIZONTAL' || planeRaw === 'SLAB') {
      o.Plane = 'XY';
    } else if (planeRaw === '1' || planeRaw === 'XZ' || planeRaw === 'FRONT' || planeRaw === 'VERTICAL') {
      o.Plane = 'XZ';
    } else if (planeRaw === '2' || planeRaw === 'YZ' || planeRaw === 'SIDE' || planeRaw === 'CROSS') {
      o.Plane = 'YZ';
    } else {
      // Default plane is XY
      o.Plane = 'XY';
    }

    // Bond: accept legacy aliases, normalize, drop junk; '' = auto
    // (B-mark → good, T-mark → poor at use). Links carry no lap bond.
    if (o.bond_condition === undefined || o.bond_condition === null) {
      o.bond_condition = o.Bond ?? o.bond ?? '';
    }
    o.bond_condition = normalizeBond(o.bond_condition);
    // Links carry no lap bond and stay '' even when the mark starts with B.
    const isLinkRow = /^(c_link|clink|c_link_with_hook)$/i.test(String(o.Rebar_Type || ''));
    if (!o.bond_condition && !isLinkRow) {
      o.bond_condition = inferBondFromMark(o.Bar_mark) || '';
    }
    delete o.Bond;
    delete o.bond;
    if (o.bent_up_down) {
      o.bent_up_down = String(o.bent_up_down).toLowerCase();
    }
    if (o.double_hook) {
      o.double_hook = String(o.double_hook).toLowerCase();
    }
    if (o.hook_start) {
      o.hook_start = String(o.hook_start).toLowerCase();
    }

    if (Number(o.Visible) === 0) o.hidden = true;
    delete o.Visible;
    if (!o.Rebar_Type) o.Rebar_Type = 'straight';
    if (!o.qty) o.qty = 1;

    // Auto-generate Rebar_tag if blank or 0
    if (!o.Rebar_tag || isNaN(Number(o.Rebar_tag))) {
      currentMaxTag += 1;
      o.Rebar_tag = currentMaxTag;
    } else {
      currentMaxTag = Math.max(currentMaxTag, Number(o.Rebar_tag));
    }

    // Detect identical bar shape & length to assign identical Bar_mark
    const shapeKeyWithHost = getBarShapeKey(o, true);
    const shapeKeyGlobal = getBarShapeKey(o, false);

    if (o.Bar_mark) {
      // Record explicit Bar_mark for subsequent identical bars
      if (o.host) signatureToMarkMap.set(shapeKeyWithHost, o.Bar_mark);
      if (!signatureToMarkMap.has(shapeKeyGlobal)) signatureToMarkMap.set(shapeKeyGlobal, o.Bar_mark);

      if (o.host) {
        const m = String(o.Bar_mark).match(/^([A-Za-z_-]+)(\d+)$/);
        if (m) {
          const prefix = m[1];
          const num = parseInt(m[2], 10);
          const numLen = m[2].length;
          const cur = markSeqByHost.get(o.host);
          if (!cur || num > cur.num) {
            markSeqByHost.set(o.host, { prefix, num, numLen });
          }
        }
      }
    } else {
      // Look up if an identical bar already has an assigned Bar_mark
      const existingMark = (o.host && signatureToMarkMap.get(shapeKeyWithHost)) || signatureToMarkMap.get(shapeKeyGlobal);
      if (existingMark) {
        o.Bar_mark = existingMark;
      } else {
        // Generate new sequential Bar_mark
        if (o.host && markSeqByHost.has(o.host)) {
          const entry = markSeqByHost.get(o.host);
          entry.num += 1;
          o.Bar_mark = `${entry.prefix}${String(entry.num).padStart(entry.numLen, '0')}`;
        } else {
          o.Bar_mark = `B${o.Rebar_tag}`;
        }
        // Register newly generated mark for any subsequent identical bars
        if (o.host) signatureToMarkMap.set(shapeKeyWithHost, o.Bar_mark);
        signatureToMarkMap.set(shapeKeyGlobal, o.Bar_mark);
      }
    }

    result.push(o);
  }

  return result;
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
