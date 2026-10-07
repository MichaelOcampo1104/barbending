// Generates a synthetic barbending project JSON for performance runs.
// usage: node scripts/perf/gen_project.mjs <rows> <avgCopiesPerRow> <name> [seed]
// Mix mirrors a real BBS: straight mats, bent bars, hooked links (2-axis grids), drawn profiles
// (cranks) and column ties over a 120 x 60 m footprint on 8 levels. Distribution grids carry the
// physical-bar count (like the DXF importer), so 25,000 rows x 40 copies ~ 1M physical bars.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [rowsS, copiesS, name, seedS = '1'] = process.argv.slice(2);
if (!rowsS || !copiesS || !name) {
  console.error('usage: node scripts/perf/gen_project.mjs <rows> <avgCopiesPerRow> <name> [seed]');
  process.exit(2);
}
const R = Number(rowsS), C = Number(copiesS);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `${name}.json`);

let s = Number(seedS) >>> 0;
const rnd = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const ur = (a, b) => a + rnd() * (b - a);
const DIAS = [10, 12, 16, 16, 20, 20, 25, 32];

const bars = [];
let physical = 0;
for (let i = 0; i < R; i++) {
  const tag = i + 1;
  const n = Math.max(1, Math.round(C * ur(0.5, 1.5)));
  const dia = pick(DIAS);
  const lvl = Math.floor(rnd() * 8) * 3000;
  const base = {
    Rebar_tag: tag, Bar_mark: `B${tag}`, Dia: dia, bond_condition: 'poor', Group: `Zone${i % 40}`,
    Pos_x: Math.round(ur(0, 120000)), Pos_y: Math.round(ur(0, 60000)), Pos_z: lvl + Math.round(ur(40, 250)),
    Pos_Rotation: 0, qty: 1, Visible: 1,
  };
  const r = rnd();
  let row, copies;
  if (r < 0.5) {
    const rot90 = rnd() < 0.5;
    row = { ...base, Rebar_Type: 'straight', Plane: 'XY', 'Length of Bar': Math.round(ur(2000, 9000) / 500) * 500,
      Pos_Rotation: rot90 ? 90 : 0, qty_x: rot90 ? n : 1, spacing_x: 150, qty_y: rot90 ? 1 : n, spacing_y: 150 };
    copies = n;
  } else if (r < 0.7) {
    row = { ...base, Rebar_Type: 'bent', Plane: 'XZ', 'Length of Bar': Math.round(ur(1500, 4000)), H: Math.round(ur(300, 900)),
      bent_up_down: 'up', hook_start: 'no', qty_x: 1, spacing_x: 0, qty_y: n, spacing_y: 200 };
    copies = n;
  } else if (r < 0.85) {
    const a = pick([2, 4, 5, 8]); const b = Math.max(1, Math.round(n / a));
    row = { ...base, Rebar_Type: 'c_link_with_hook', Plane: 'XZ', Pos_Rotation: 90, length: Math.round(ur(200, 1200)),
      c_length_a: 130, c_length_b: 130, double_hook: 'no', Dia: pick([10, 12, 13]), qty_x: a, spacing_x: 200, qty_y: b, spacing_y: 150 };
    copies = a * b;
  } else if (r < 0.95) {
    row = { ...base, Rebar_Type: 'profile', Plane: 'XZ',
      legs: JSON.stringify([[Math.round(ur(800, 2000)), 0], [Math.round(ur(300, 900)), 30], [Math.round(ur(800, 2000)), 0]]),
      qty_x: 1, spacing_x: 0, qty_y: n, spacing_y: -150 };
    copies = n;
  } else {
    row = { ...base, Rebar_Type: 'tie', Plane: 'XY', length: Math.round(ur(300, 800)), c_length_a: Math.round(ur(300, 800)), qty_z: n, spacing_z: 150 };
    copies = n;
  }
  physical += copies;
  bars.push(row);
}
const proj = { v: 1, app: 'barbending', savedAt: Date.now(), bars, concretes: [], refLines: [], cover: 40, bond: 'poor', selectedBar: 0, selectedBars: [0] };
fs.writeFileSync(out, JSON.stringify(proj));
console.log(`${out}: rows=${R} physical bars=${physical} size=${(fs.statSync(out).size / 1e6).toFixed(2)} MB`);
