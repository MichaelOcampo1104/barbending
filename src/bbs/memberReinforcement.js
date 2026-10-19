// Member reinforcement card: the main bars, links and starters of one box column or wall, as ordinary BBS rows grouped in ▦ sets.
// Pure functions (no React, no store) so Node tests them. Geometry and row fields follow the two reference files,
// inputs/column_sample_800_auto_bbs.json and inputs/wall_sample_auto_bbs.json, except where
// docs/superpowers/specs/2026-10-19-member-reinforcement-design.md says otherwise (sections 5 and 7).
import { barMainLength, transformBarLocalPoint } from './shapes.js';
import { lapLengthMm } from './calc.js';

// Wall distribution and links start this far from each wall end (the sample).
export const WALL_END_OFFSET = 100;
// Bend leg floor, mm (the sample).
const STARTER_BEND_MIN = 150;
// Bars longer than this get a warning: the app has no stock-length setting, so the card does not splice them.
const STOCK_MM = 12000;
// mm: an element "touches" the member's base or top within this tolerance.
const FACE_TOL = 1;

// Lengths and angles to 0.1 mm / 0.1°; positions to 0.01 mm, since ring and wall spacings are often a quarter or a half mm.
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const orDefault = (v, fb) => (v === null || v === undefined || v === '' ? fb : Number(v));
const isBlank = (v) => v === null || v === undefined || v === '';

// Form defaults: the sample's values, with the global cover. Starters' null fields are derived (see starterSpec).
export function defaultCardInputs(cover = 40) {
  return {
    kind: 'Column',
    cover,
    column: { mainDia: 25, layout: 'all', mainCount: 16, faceCount: 8, linkDia: 10, linkSpacing: 150, lap: null, levels: [] },
    wall: { mainDia: 16, mainSpacing: 150, distDia: 13, distSpacing: 150, linkDia: 13, linkSpacing: 150, linkVSpacing: 300, legA: 130 },
    starters: { base: true, top: true, dia: null, lap: null, anchorage: null, bend: null },
  };
}

// Column ring, all faces: the four corners first, then the rest share each side equally (the first sides take any remainder).
// Starts at the SW corner and runs counter-clockwise. Needs count >= 4.
export function ringPositions(box, count) {
  const { x0, y0, x1, y1 } = box;
  const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const extra = count - 4;
  const pts = [];
  corners.forEach((a, i) => {
    const b = corners[(i + 1) % 4];
    pts.push(a);
    const n = Math.floor(extra / 4) + (i < extra % 4 ? 1 : 0);
    for (let k = 1; k <= n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / (n + 1), a[1] + ((b[1] - a[1]) * k) / (n + 1)]);
  });
  return pts;
}

// Column, two faces: `count` bars on each of the two faces parallel to X (axis 'x': the bottom and top rows) or to Y (axis 'y'),
// from corner to corner. Needs count >= 2.
export function faceRowPositions(box, count, axis) {
  const { x0, y0, x1, y1 } = box;
  const along = (a, b) => Array.from({ length: count }, (_, k) => a + ((b - a) * k) / (count - 1));
  if (axis === 'y') return [...along(y0, y1).map((t) => [x0, t]), ...along(y0, y1).map((t) => [x1, t])];
  return [...along(x0, x1).map((t) => [t, y0]), ...along(x0, x1).map((t) => [t, y1])];
}

// Wall mains: equal spacing around the outline of the mains' rectangle, from its SW corner, counter-clockwise (the sample).
export function perimeterPositions(box, spacing) {
  const { x0, y0, x1, y1 } = box;
  const w = x1 - x0, h = y1 - y0;
  const perimeter = 2 * (w + h);
  const n = Math.max(1, Math.round(perimeter / spacing));
  const step = perimeter / n;
  const pts = [];
  for (let k = 0; k < n; k++) {
    const s = k * step;
    if (s < w) pts.push([x0 + s, y0]);
    else if (s < w + h) pts.push([x1, y0 + (s - w)]);
    else if (s < 2 * w + h) pts.push([x1 - (s - w - h), y1]);
    else pts.push([x0, y1 - (s - 2 * w - h)]);
  }
  return pts;
}

// Column, long and short faces: `faces` gives the count on each pair (the two long faces, the two short faces) and `longAxis` says which
// pair is long: 'x' for the bottom and top rows (the member is longer along X), 'y' for the left and right columns. Bars on the long faces
// run corner to corner, corners included; bars on the short faces sit evenly between their corners. Each side takes half its pair's count.
// Starts at the SW corner and runs counter-clockwise, as ringPositions does.
export function facePositions(box, faces, longAxis) {
  const { x0, y0, x1, y1 } = box;
  const alongX = longAxis === 'x';
  const span = (long, n, a, b) => Array.from({ length: n }, (_, k) => (long
    ? a + ((b - a) * k) / (n - 1)
    : a + ((b - a) * (k + 1)) / (n + 1)));
  const nX = (alongX ? faces.long : faces.short).count / 2;   // per side of the bottom and top rows
  const nY = (alongX ? faces.short : faces.long).count / 2;   // per side of the left and right columns
  const xs = (a, b) => span(alongX, nX, a, b);
  const ys = (a, b) => span(!alongX, nY, a, b);
  return [
    ...xs(x0, x1).map((x) => [x, y0]),
    ...ys(y0, y1).map((y) => [x1, y]),
    ...xs(x1, x0).map((x) => [x, y1]),
    ...ys(y1, y0).map((y) => [x0, y]),
  ];
}

// Column link, the drawn lapped shape (inputs/Column link shape.dxf; spec section 5). Centreline points in mm from the member's SW
// outer corner. The closing leg (outer, its surface at the cover) runs the full bottom and then up the left side past the inner
// corner by `lap`. The first leg (one link diameter inside it) starts `lap` along the bottom, runs up the left side, across the top
// and down the right side to the bottom.
export function lappedLinkPoints({ lx, ly, cover, dia, lap }) {
  const a = cover + dia / 2;
  const b = cover + (3 * dia) / 2;
  const right = lx - a, top = ly - a;
  return [[b + lap, b], [b, b], [b, top], [right, top], [right, a], [a, a], [a, b + lap]];
}

// The developed legs of a polyline as the profile row stores them: [length mm, compass degrees] (0 = +X, 90 = +Y).
export function linkLegs(points) {
  const legs = [];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0], dy = points[i][1] - points[i - 1][1];
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    legs.push([r1(Math.hypot(dx, dy)), Math.round(deg * 1000) / 1000]);
  }
  return legs;
}

// Default lap at the closing corner: a third of the link's centreline width, nearest 10 mm (the drawing's proportion).
export function defaultLinkLap(legW) {
  return Math.round(legW / 3 / 10) * 10;
}

// Defaults for a level between a lower bar of `dBelow` and an upper bar of `dAbove`: the lap of the larger bar (good bond), a crank
// step that puts the two bars side by side (the larger Ø, rounded up to 5 mm), and a 1 in 6 jog (rounded up to 10 mm).
export function levelDefaults(dBelow, dAbove) {
  const dMax = Math.max(dBelow, dAbove);
  const step = Math.ceil(dMax / 5) * 5;
  return { lap: lapLengthMm(dMax, 'good'), step, jog: Math.ceil((6 * step) / 10) * 10 };
}

// Column levels (lap splices where the bar diameter changes), sorted by height. A level centres its splice. The upper bar (the new Ø)
// starts at b = level − lap/2 and runs up. The lower bar cranks inward by `step` over a jog of length `jog` that ends at b, then runs
// alongside the upper bar to c = level + lap/2. So a splice spans a..c, and each splice must end before the next one starts (at its a),
// and must clear the base and the top. Returns { ok, list, topDia } with the values filled in, or { ok: false, msg }.
export function resolveLevels(levels, { mainDia, covB, covT, lz }) {
  const sorted = [...(levels || [])].sort((p, q) => num(p.level) - num(q.level));
  const list = [];
  let dBelow = mainDia;
  for (const l of sorted) {
    const level = num(l.level), dia = num(l.dia);
    const name = l.name || 'A level';
    if (!(level > 0)) return { ok: false, msg: `${name} is not above the base.` };
    if (!(level < lz)) {
      return {
        ok: false,
        msg: `${name} is ${Math.round(level)} mm above the base, but this member is only ${Math.round(lz)} mm high, so the level is not below its top. Make the member taller, or take this level and the ones above it out of this member's schedule.`,
      };
    }
    if (!(dia > 0)) return { ok: false, msg: `${name} needs a bar Ø above it.` };
    const d = levelDefaults(dBelow, dia);
    const lap = orDefault(l.lap, d.lap), step = orDefault(l.step, d.step), jog = orDefault(l.jog, d.jog);
    if (!(lap > 0)) return { ok: false, msg: 'A level\'s lap must be above zero.' };
    if (!(step >= 0)) return { ok: false, msg: 'A crank step must be zero or more.' };
    if (step > 0 && !(jog > 0)) return { ok: false, msg: 'A crank needs a jog above zero.' };
    const b = level - lap / 2;
    list.push({ level, dia, lap, step, jog, a: b - jog, b, c: level + lap / 2 });
    dBelow = dia;
  }
  if (list.length) {
    const top = list[list.length - 1];
    const topEnd = lz - covT + top.dia / 2;
    const roomy = list[0].a - (covB + mainDia / 2) >= 1
      && list.slice(1).every((l, k) => l.a - list[k].c >= 1)
      && topEnd - top.c >= 1;
    if (!roomy) return { ok: false, msg: 'Levels need room for each splice: keep each one clear of the next, the base and the top.' };
  }
  return { ok: true, list, topDia: list.length ? list[list.length - 1].dia : mainDia };
}

// Starter sizes: Ø defaults to the main Ø (for the top end, the top bar's Ø, unless a starter Ø is typed, which then applies to both
// ends), the lap to the good-bond table, the anchorage to the lap, the bend leg to the larger of 10 × Ø and 150 mm (the sample).
// Anchorage includes the bend, so the straight part is anchorage − bend.
export function starterSpec(starters, mainDia, end = 'base') {
  const dia = end === 'top'
    ? orDefault(starters.topDia, orDefault(starters.dia, mainDia))
    : orDefault(starters.dia, mainDia);
  const lap = orDefault(starters.lap, lapLengthMm(dia, 'good'));
  const anchorage = orDefault(starters.anchorage, lap);
  const bend = orDefault(starters.bend, Math.max(10 * dia, STARTER_BEND_MIN));
  return { dia, lap, anchorage, bend };
}

// Room for a starter's straight part in the element below the base (end 'base') or above the top (end 'top') at (x, y): the
// distance from the member's face to that element's far face, less the cover. Null when no element touches the face there.
export function elementDepth(member, neighbours, x, y, end, cover) {
  const baseZ = member.z, topZ = member.z + member.lz;
  for (const c of neighbours || []) {
    if (!c || c.id === member.id) continue;
    if (x < c.x || x > c.x + c.lx || y < c.y || y > c.y + c.ly) continue;
    if (end === 'base' && Math.abs(c.z + c.lz - baseZ) <= FACE_TOL) return baseZ - c.z - cover;
    if (end === 'top' && Math.abs(c.z - topZ) <= FACE_TOL) return c.z + c.lz - topZ - cover;
  }
  return null;
}

// Plan rotation (deg, 0..360) that turns the bar's local direction `from` → `to` to point along `target` (a plan vector). Measured on
// the transformed bar, so it holds for every Pos_Rotation and Plane the card uses.
function planRotationToward(row, from, to, target) {
  const probe = { ...row, plan_rotation: 0 };
  const a = transformBarLocalPoint(probe, from);
  const b = transformBarLocalPoint(probe, to);
  const have = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const want = Math.atan2(target[1], target[0]);
  const deg = (((want - have) * 180) / Math.PI) % 360;
  return r1(((deg + 360) % 360)) % 360;
}

// The bend leg of a starter (local +Y at its far end) points along `outward`: the vector from the member's centre to the bar.
function bendPlanRotation(row, outward) {
  const L = row['Length of Bar'];
  return planRotationToward(row, [L, 0, 0], [L, row.H, 0], outward);
}

// Every row gets its host, its member's group name, and one-bar distribution (qty 1), as the sample rows do.
const tagRow = (member, row) => ({
  qty: 1, qty_x: 1, spacing_x: 0, qty_y: 1, spacing_y: 0, qty_z: 1, spacing_z: 0,
  ...row,
  host: member.id,
  Group: member.name,
  Visible: 1,
});

// Starters at each main position: base (top of the bar one lap above the base, straight part and bend below) and/or top
// (bottom one lap below the top, straight part and bend above). The bend points radially outward from the member's centre.
function starterRows({ member, positions, faceOf, starters, specFor, cover, neighbours, mark, warnings }) {
  const rows = [];
  const centre = [member.lx / 2, member.ly / 2];
  for (const end of ['base', 'top']) {
    if (end === 'base' ? !starters.base : !starters.top) continue;
    let missing = false;
    positions.forEach(([x, y], i) => {
      const spec = specFor(end, faceOf[i]);
      const ax = member.x + x, ay = member.y + y;
      const room = elementDepth(member, neighbours, ax, ay, end, cover);
      let straight = spec.anchorage - spec.bend;
      let bend = spec.bend;
      if (room === null) missing = true;
      else if (straight > room) {
        straight = Math.max(0, room);
        bend = spec.anchorage - straight;
      }
      const L = spec.lap + straight;
      const z = end === 'base' ? member.z + spec.lap : member.z + member.lz - spec.lap;
      const row = tagRow(member, {
        Bar_mark: `${mark}${end === 'base' ? 1 : 2}-${i + 1}`,
        Rebar_Type: 'bent',
        Dia: spec.dia,
        Plane: 'XZ',
        Pos_Rotation: end === 'base' ? -90 : 90,
        Pos_x: r2(ax), Pos_y: r2(ay), Pos_z: r2(z),
        'Length of Bar': r1(L),
        H: r1(bend),
        bent_up_down: 'up',
        hook_start: 'no',
        bond_condition: 'good',
      });
      row.plan_rotation = bendPlanRotation(row, [x - centre[0], y - centre[1]]);
      rows.push(row);
    });
    if (missing) {
      warnings.push(end === 'base'
        ? 'Nothing below the base holds the starters: the full anchorage is kept, as in the sample.'
        : 'Nothing above the top holds the starters: the full anchorage is kept, as in the sample.');
    }
  }
  return rows;
}

// ---- The column schedule, in the drawing's own notation ----
// The drawing lists its levels top first. Each level has SIZE, MAIN BARS and LINKS, and a cell that reads "same as below" takes the
// value of the level under it. The bottom level is the member's base. Each level runs from its SFL up to the next level's SFL; the
// top level runs to the top of the member. Heights are SFL differences, so the SFL datum itself does not matter.
const SAME_RE = /^\s*same(\s+as\s+below)?\s*$/i;
const SIZE_RE = /^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/;
const BARS_RE = /^\s*(\d+)\s*[Hh]\s*(\d+)\s*$/;
// The outer link, H10-150 (or 3H10-100: more than one closed set), then up to two cross-tie groups: + 4H10-100 X and + 6H10-100 Y.
// A group with no letter runs along Y, as in H10-150 + 6H10-150.
const LINK_OUTER_RE = /^\s*(?:(\d+)\s*)?[Hh]\s*(\d+)\s*-\s*(\d+)\s*$/;
const LINK_CROSS_RE = /^\s*(\d+)\s*[Hh]\s*(\d+)\s*-\s*(\d+)\s*([XxYy])?\s*$/;
const EXAMPLE = { size: '2500 x 1000', bars: '44H25', links: 'H10-100 + 4H10-100 X + 6H10-100 Y' };

export const isSameBelow = (v) => SAME_RE.test(String(v ?? ''));

// "2500 x 1000" (mm, Lx x Ly) → { lx, ly }, or null.
export function parseSize(text) {
  const m = SIZE_RE.exec(String(text ?? ''));
  return m ? { lx: Number(m[1]), ly: Number(m[2]) } : null;
}

// "44H25" (bars and Ø) → { count, dia }, or null.
export function parseMainBars(text) {
  const m = BARS_RE.exec(String(text ?? ''));
  return m ? { count: Number(m[1]), dia: Number(m[2]) } : null;
}

// The bar Ø on the long and the short faces of a resolved row (one size gives the same Ø on both).
export function faceDias(row) {
  const f = row.bars.faces;
  return f ? { long: f.long.dia, short: f.short.dia } : { long: row.bars.dia, short: row.bars.dia };
}

// A row's bars as the card reads them back: "44 × H25", or "44 × H40 long + 8 × H32 short".
export function barsText(bars) {
  if (!bars.faces) return `${bars.count} × H${bars.dia}`;
  const { long, short } = bars.faces;
  return `${long.count} × H${long.dia} long + ${short.count} × H${short.dia} short`;
}

// "H10-150 + 6H10-150" → { sets, dia, spacing, cross: [{ count, dia, spacing, dir }] }, or null. `sets` is the number in front of the outer
// link (1 when there is none); more than one is refused when the schedule is resolved. `dir` is 'X' or 'Y' (Y when no letter is given).
export function parseLinks(text) {
  const parts = String(text ?? '').split('+');
  const outer = LINK_OUTER_RE.exec(parts[0]);
  if (!outer) return null;
  const cross = [];
  for (const part of parts.slice(1)) {
    const m = LINK_CROSS_RE.exec(part);
    if (!m) return null;
    cross.push({ count: Number(m[1]), dia: Number(m[2]), spacing: Number(m[3]), dir: (m[4] || 'Y').toUpperCase() });
  }
  return {
    sets: outer[1] ? Number(outer[1]) : 1,
    dia: Number(outer[2]),
    spacing: Number(outer[3]),
    cross,
  };
}

// The LINKS of each level from its three cells: the outer link, then the cross links along X and along Y. A cross-link cell reads its
// count, size and spacing ("2H10-150"), and a blank cell means none. A cell that reads "same as below" takes the level under it, cell by
// cell. Returns the LINKS notation that resolveSchedule reads, top level first (for example "H10-100 + 2H10-150 X + 6H10-150 Y").
export function linksNotation(rowsTopFirst) {
  const bottomUp = [...(rowsTopFirst || [])].reverse();
  const cells = [];
  bottomUp.forEach((r, k) => {
    const row = {};
    for (const [key, field] of [['outer', 'linksOuter'], ['x', 'linksX'], ['y', 'linksY']]) {
      const raw = String(r[field] ?? '').trim();
      row[key] = SAME_RE.test(raw) ? (k === 0 ? 'same' : cells[k - 1][key]) : raw;
    }
    cells.push(row);
  });
  return cells.reverse().map((row) => {
    // A level that has nothing to copy from keeps "same", which resolveSchedule refuses with its own message.
    if (Object.values(row).includes('same')) return 'same';
    const parts = [row.outer];
    if (row.x) parts.push(`${row.x} X`);
    if (row.y) parts.push(`${row.y} Y`);
    return parts.join(' + ');
  });
}

// The links in the slab below each level, from its three cells (outer, X, Y), top level first. A level with its cells all blank has no slab
// links of its own, so its slab takes the links of the storey it sits in. Returns the notation for each level ("" when blank).
export function slabLinksNotation(rowsTopFirst) {
  return (rowsTopFirst || []).map((r) => {
    const outer = String(r.linksBotOuter ?? '').trim();
    const x = String(r.linksBotX ?? '').trim();
    const y = String(r.linksBotY ?? '').trim();
    if (!outer && !x && !y) return '';
    const parts = [outer];
    if (x) parts.push(`${x} X`);
    if (y) parts.push(`${y} Y`);
    return parts.join(' + ');
  });
}

// The schedule as the drawing gives it: `rowsTopFirst` lists the levels top first, each with a name, its SFL (metres) and the cells
// SIZE, MAIN BARS and LINKS. Returns { ok, rows (bottom first), count, linkDia } or { ok: false, msg }. Each resolved row has h (mm above
// the bottom row), bars { count, dia }, links { sets, dia, spacing, cross }, size { lx, ly } and the optional lap, step and jog.
export function resolveSchedule(rowsTopFirst, { lx, ly, layout = 'all' }) {
  const bottomUp = [...(rowsTopFirst || [])].reverse();
  if (!bottomUp.length) return { ok: false, msg: 'Add at least one level to the schedule.' };
  const twoFaces = layout === 'x' || layout === 'y';   // bars on two faces only, one size
  const faces = layout === 'faces';                    // long and short faces, one MAIN BARS cell each
  const out = [];
  for (let k = 0; k < bottomUp.length; k++) {
    const r = bottomUp[k];
    const name = (r.name || '').trim() || `Level ${k + 1} (from the bottom)`;
    const cell = (key, label, parse) => {
      const raw = String(r[key] ?? '').trim();
      if (SAME_RE.test(raw)) return k === 0 ? { error: `The bottom row needs its own ${label}.` } : { value: out[k - 1][key] };
      const value = parse(raw);
      const hint = key === 'bars' && !faces ? ' For long and short faces, choose that layout and give each face its own cell.' : '';
      return value ? { value } : { error: `Could not read ${label} "${raw}" on ${name}. Write it as in the drawing, for example ${EXAMPLE[key]}.${hint}` };
    };
    // Long and short faces: one MAIN BARS cell per face, as "44H40" and "8H32". "same as below" takes that face's bars from the level under it.
    const faceCell = (key, label, face) => {
      const raw = String(r[key] ?? '').trim();
      if (SAME_RE.test(raw)) return k === 0 ? { error: `The bottom row needs its own ${label}.` } : { value: out[k - 1].bars.faces[face] };
      const value = parseMainBars(raw);
      return value ? { value } : { error: `Could not read ${label} "${raw}" on ${name}. Write it as in the drawing, for example 44H40.` };
    };
    const size = cell('size', 'SIZE', parseSize);
    if (size.error) return { ok: false, msg: size.error };
    let bars;
    if (faces) {
      const long = faceCell('barsLong', 'MAIN BARS on the long faces', 'long');
      const short = faceCell('barsShort', 'MAIN BARS on the short faces', 'short');
      if (long.error || short.error) return { ok: false, msg: long.error || short.error };
      bars = { value: { count: long.value.count + short.value.count, dia: long.value.dia, faces: { long: long.value, short: short.value } } };
    } else {
      bars = cell('bars', 'MAIN BARS', parseMainBars);
    }
    if (bars.error) return { ok: false, msg: bars.error };
    const links = cell('links', 'LINKS', parseLinks);
    if (links.error) return { ok: false, msg: links.error };
    // The slab below this level (SLAB THK; its SFL is the slab's top) and the links in it. The base's slab is below the member, so it is not read.
    const slabMm = k > 0 && !isBlank(r.slab) ? Number(r.slab) : null;
    if (slabMm !== null && !(slabMm > 0)) return { ok: false, msg: `The slab below ${name} must be above zero, or left blank.` };
    const slabLinkText = k > 0 ? String(r.linksBottom ?? '').trim() : '';
    const slabLinks = slabLinkText ? parseLinks(slabLinkText) : null;
    if (slabLinkText && !slabLinks) {
      return { ok: false, msg: `Could not read the links in the slab below ${name}: "${slabLinkText}". Write them as in LINKS, for example H10-150 + 2H10-150 X.` };
    }
    if (slabLinks && slabMm === null) return { ok: false, msg: `Give the slab below ${name} its thickness, or clear its links.` };
    const sfl = Number(r.sfl);
    if (isBlank(r.sfl) || !Number.isFinite(sfl)) return { ok: false, msg: `Give ${name} its SFL (m).` };
    // SFL is in metres. A millimetre value (-20870) would put every level thousands of metres from the base, so it is refused by name.
    if (Math.abs(sfl) >= 1000) return { ok: false, msg: `${name}: SFL ${sfl} is over 1000 m. SFL is in metres, so type the drawing's value (for example -20.870, not -20870).` };
    if (k > 0 && !(sfl > out[k - 1].sfl)) return { ok: false, msg: `${name}: SFL ${sfl} m must be above the level below (${out[k - 1].sfl} m).` };
    out.push({
      name,
      sfl,
      h: k === 0 ? 0 : Math.round((sfl - out[0].sfl) * 1e6) / 1e3,
      size: size.value,
      bars: bars.value,
      links: links.value,
      slab: slabMm === null ? null : { mm: slabMm, links: slabLinks },
      lap: r.lap ?? null,
      step: r.step ?? null,
      jog: r.jog ?? null,
    });
  }
  const first = out[0];
  const need = twoFaces ? 2 : 4;
  if (!(Number.isInteger(first.bars.count) && first.bars.count >= need)) {
    return { ok: false, msg: twoFaces ? 'Two faces needs at least 2 bars per face.' : 'All faces needs at least 4 bars.' };
  }
  if (faces && Math.round(lx) === Math.round(ly)) {
    return { ok: false, msg: 'Long and short faces need a member longer one way than the other.' };
  }
  for (const r of out) {
    if (Math.round(lx) !== r.size.lx || Math.round(ly) !== r.size.ly) {
      return { ok: false, msg: `SIZE ${r.size.lx} x ${r.size.ly} on ${r.name} does not match this member (${Math.round(lx)} x ${Math.round(ly)}).` };
    }
    if (r.bars.faces) {
      const { long, short } = r.bars.faces;
      if (!(long.count >= 4 && long.count % 2 === 0 && short.count >= 2 && short.count % 2 === 0)) {
        return { ok: false, msg: `MAIN BARS on ${r.name}: each pair of faces needs an even count, at least 4 on the long faces and 2 on the short.` };
      }
      if (long.count !== first.bars.faces.long.count || short.count !== first.bars.faces.short.count) {
        return { ok: false, msg: `The bar counts on each pair of faces must stay the same up the column: ${r.name} differs from the bottom row.` };
      }
      if (!(long.dia > 0 && short.dia > 0)) return { ok: false, msg: `MAIN BARS on ${r.name} needs a bar Ø above zero on each face.` };
    } else {
      if (r.bars.count !== first.bars.count) {
        return { ok: false, msg: `MAIN BARS on ${r.name} is ${r.bars.count}, but the bottom row has ${first.bars.count}. The bar count must stay the same up the column.` };
      }
      if (!(r.bars.dia > 0)) return { ok: false, msg: `MAIN BARS on ${r.name} needs a bar Ø above zero.` };
    }
    if (r.links.dia !== first.links.dia) {
      return { ok: false, msg: `The outer link on ${r.name} is H${r.links.dia}, but the bottom row's is H${first.links.dia}. Keep one outer link size up the column.` };
    }
    if (r.links.sets !== 1) {
      return { ok: false, msg: `${r.name} has ${r.links.sets} closed link sets. More than one closed set per level is not modelled yet.` };
    }
    if (!(r.links.spacing > 0)) return { ok: false, msg: `The link spacing on ${r.name} must be above zero.` };
    for (const g of r.links.cross) {
      if (!(g.count >= 1 && g.dia > 0 && g.spacing > 0)) {
        return { ok: false, msg: `The cross-ties on ${r.name} need a count, a size and a spacing above zero.` };
      }
    }
    const dirs = r.links.cross.map((g) => g.dir);
    if (new Set(dirs).size !== dirs.length) {
      return { ok: false, msg: `${r.name} has two cross-tie groups along the same direction: give one along X and one along Y.` };
    }
  }
  // A slab must fit inside the storey below it, leaving room for that storey's own links. Its links follow the rules of LINKS: one closed
  // set, the bottom row's outer size, and cross links with a count, a size and a spacing.
  for (let k = 1; k < out.length; k++) {
    const r = out[k];
    if (!r.slab) continue;
    const storey = r.h - out[k - 1].h;
    if (!(r.slab.mm < storey)) {
      return { ok: false, msg: `The slab below ${r.name} (${r.slab.mm} mm) is as thick as, or thicker than, the storey below it (${Math.round(storey)} mm).` };
    }
    const sl = r.slab.links;
    if (!sl) continue;
    if (sl.dia !== first.links.dia) {
      return { ok: false, msg: `The outer link in the slab below ${r.name} is H${sl.dia}, but the bottom row's is H${first.links.dia}. Keep one outer link size up the column.` };
    }
    if (sl.sets !== 1) return { ok: false, msg: `The slab below ${r.name} has ${sl.sets} closed link sets. More than one closed set per level is not modelled yet.` };
    if (!(sl.spacing > 0)) return { ok: false, msg: `The link spacing in the slab below ${r.name} must be above zero.` };
    for (const g of sl.cross) {
      if (!(g.count >= 1 && g.dia > 0 && g.spacing > 0)) {
        return { ok: false, msg: `The cross links in the slab below ${r.name} need a count, a size and a spacing above zero.` };
      }
    }
    const dirs = sl.cross.map((g) => g.dir);
    if (new Set(dirs).size !== dirs.length) {
      return { ok: false, msg: `The slab below ${r.name} has two cross-link groups along the same direction.` };
    }
  }
  return { ok: true, rows: out, count: first.bars.count, linkDia: first.links.dia };
}

// The simple inputs (main Ø, bar count, link Ø and spacing, levels) read as a schedule: the base level, then one level per entry in
// `levels`, which keeps the links as the level below. Returned top first, like the drawing.
function scheduleOfSimple(member, c) {
  const count = c.layout === 'x' || c.layout === 'y' ? num(c.faceCount) : num(c.mainCount);
  const rows = [{
    name: 'Base',
    sfl: 0,
    size: `${Math.round(member.lx)} x ${Math.round(member.ly)}`,
    bars: `${count}H${num(c.mainDia)}`,
    links: `H${num(c.linkDia)}-${num(c.linkSpacing)}`,
  }];
  for (const l of c.levels || []) {
    rows.push({
      name: 'Level', sfl: num(l.level) / 1000, size: 'same', bars: `${count}H${num(l.dia)}`, links: 'same', lap: l.lap, step: l.step, jog: l.jog,
    });
  }
  return rows.reverse();
}

// Link zones from the bottom of the member up (resolved rows, bottom first). A storey's links run from its SFL up to the slab of the level
// above. That slab sits below the level's SFL, so it is the top of this storey: its zone runs from the slab's bottom up to the SFL. The zone
// takes the links given on its own level, or the storey's links when none are given. Each zone carries the bar sizes of the storey it lies
// in, for the hooks of its cross links. The first zone starts at the member's bottom cover, and the last ends at its top cover.
export function linkZones(rows, covB, covT, lz) {
  const zones = [];
  rows.forEach((r, j) => {
    const dias = faceDias(r);
    const next = rows[j + 1];
    const slab = next && next.slab ? next.slab : null;
    const top = slab ? next.h - slab.mm : next ? next.h : lz - covT;
    zones.push({ bottom: j === 0 ? covB : r.h, top, links: r.links, longDia: dias.long, shortDia: dias.short, name: `${r.name} storey` });
    if (slab) zones.push({ bottom: top, top: next.h, links: slab.links || r.links, longDia: dias.long, shortDia: dias.short, name: `${next.name} slab` });
  });
  return zones;
}

// Link runs: neighbouring zones with the same link spacing and cross links share one stack of links, so a level that only changes the bars
// does not restart the links. Cross links add the bar sizes to the key, because their hooks depend on them. A run starts at its first
// zone's bottom and ends where the next run starts (the top run ends at the member's top cover).
function linkRuns(zones) {
  const runs = [];
  for (const z of zones) {
    const key = `${z.links.spacing}|${z.links.cross.length ? `${JSON.stringify(z.links.cross)}|${z.longDia}|${z.shortDia}` : 'none'}`;
    const last = runs[runs.length - 1];
    if (last && last.key === key) continue;
    runs.push({ key, bottom: z.bottom, spacing: z.links.spacing, cross: z.links.cross, longDia: z.longDia, shortDia: z.shortDia });
  }
  return runs.map((run, i) => ({ ...run, top: i < runs.length - 1 ? runs[i + 1].bottom : zones[zones.length - 1].top }));
}

// The bars a cross-tie can hook, by direction. Along Y: the interior bars of the bottom row that have a bar at the same x on the top row.
// Along X: the interior bars of the left column that have a bar at the same y on the right column. Corners are never used.
function crossCandidates(positions, box, dir) {
  const along = dir === 'Y' ? ([x]) => x : ([, y]) => y;   // where a bar sits along its line
  const across = dir === 'Y' ? ([, y]) => y : ([x]) => x;  // which line a bar is on
  const [a, b] = dir === 'Y' ? [box.y0, box.y1] : [box.x0, box.x1];
  const [lo, hi] = dir === 'Y' ? [box.x0, box.x1] : [box.y0, box.y1];
  const interior = (line) => positions
    .filter((p) => Math.abs(across(p) - line) < 0.01 && Math.abs(along(p) - lo) > 0.01 && Math.abs(along(p) - hi) > 0.01)
    .map(along);
  const second = interior(b);
  return interior(a).filter((v) => second.some((t) => Math.abs(t - v) < 0.5)).sort((p, q) => p - q);
}

// The face a bar sits on, 'long' or 'short': the bottom and top rows are the long faces when the member is longer along X, and a corner
// bar belongs to the long faces. A uniform layout has one size, so this only matters for long and short faces.
function faceOfBar([x, y], box, longAxis) {
  const onRow = Math.abs(y - box.y0) < 0.01 || Math.abs(y - box.y1) < 0.01;
  const onCol = Math.abs(x - box.x0) < 0.01 || Math.abs(x - box.x1) < 0.01;
  return (longAxis === 'x' ? onRow : onCol) ? 'long' : 'short';
}

// The column's bars, links and levels, from its schedule (or from the simple inputs, read as one). Returns { ok: true, ... } or
// { ok: false, msg }.
function columnPlan(member, inp, cover, covB, covT) {
  const c = inp.column;
  const rows = Array.isArray(c.schedule) ? c.schedule : scheduleOfSimple(member, c);
  const sch = resolveSchedule(rows, { lx: member.lx, ly: member.ly, layout: c.layout });
  if (!sch.ok) return sch;
  const bottom = sch.rows[0];
  const dL = sch.linkDia;
  const legW = member.lx - 2 * cover - dL;
  if (!(legW > 0)) return { ok: false, msg: 'The column is too small for its link (Lx − 2 × cover − Ø must be positive).' };
  const linkLap = isBlank(c.lap) ? defaultLinkLap(legW) : num(c.lap);
  if (!(linkLap > 0)) return { ok: false, msg: 'The link lap must be positive.' };
  // Each face has its own bar Ø up the column (one size on every face, or the long and short faces of MAIN BARS), so the splices are worked
  // out face by face: a bar laps the bar of its own face.
  const splices = {};
  for (const face of ['long', 'short']) {
    const levels = sch.rows.slice(1).map((r) => ({ name: r.name, level: r.h, dia: faceDias(r)[face], lap: r.lap, step: r.step, jog: r.jog }));
    splices[face] = resolveLevels(levels, { mainDia: faceDias(bottom)[face], covB, covT, lz: member.lz });
    if (!splices[face].ok) return splices[face];
  }
  const runs = linkRuns(linkZones(sch.rows, covB, covT, member.lz));
  if (runs.some((run) => !(run.top - run.bottom - dL > 0))) {
    return { ok: false, msg: 'A stretch of the schedule is too short for its links: keep each level clear of the next and of the top.' };
  }
  // The bar rows and the bars on them, for the mains and the cross-ties. The long faces are the bottom and top rows when the member is
  // longer along X. Each row sits one bar radius inside its face, at the largest Ø that face takes up the column.
  const longAxis = member.lx > member.ly ? 'x' : 'y';
  const xFace = longAxis === 'x' ? 'short' : 'long';   // the left and right faces set x0 and x1
  const yFace = longAxis === 'x' ? 'long' : 'short';   // the bottom and top faces set y0 and y1
  const maxDia = (face) => Math.max(...sch.rows.map((r) => faceDias(r)[face]));
  const box = {
    x0: cover + 2 * dL + maxDia(xFace) / 2,
    y0: cover + 2 * dL + maxDia(yFace) / 2,
    x1: member.lx - (cover + dL + maxDia(xFace) / 2),
    y1: member.ly - (cover + dL + maxDia(yFace) / 2),
  };
  const positions = c.layout === 'x' || c.layout === 'y'
    ? faceRowPositions(box, sch.count, c.layout)
    : (bottom.bars.faces ? facePositions(box, bottom.bars.faces, longAxis) : ringPositions(box, sch.count));
  const faceOf = positions.map((p) => faceOfBar(p, box, longAxis));
  const candidates = { X: crossCandidates(positions, box, 'X'), Y: crossCandidates(positions, box, 'Y') };
  for (const run of runs) {
    for (const g of run.cross) {
      const have = candidates[g.dir];
      if (!have.length) {
        return { ok: false, msg: g.dir === 'Y'
          ? 'Cross-ties along Y hook the bars of the top and bottom rows: use all faces, or two faces along X.'
          : 'Cross-ties along X hook the bars of the left and right faces: use all faces, or two faces along Y.' };
      }
      if (g.count > have.length) {
        return { ok: false, msg: `Only ${have.length} bars can take a cross-tie along ${g.dir}, so ${g.count} do not fit.` };
      }
      if (g.dir === 'X' && !(run.top - run.bottom - dL - g.dia >= 0)) {
        return { ok: false, msg: 'A stretch of the schedule is too short for its cross-ties along X: keep each level clear of the next and of the top.' };
      }
    }
  }
  return {
    ok: true,
    count: sch.count,
    layout: c.layout,
    longAxis,
    mainDia: faceDias(bottom),
    topDia: { long: splices.long.topDia, short: splices.short.topDia },
    splices,
    linkDia: dL,
    linkLap,
    runs,
    box,
    positions,
    faceOf,
    candidates,
  };
}

// Checks the card's inputs for one member. Returns an error message or null.
export function cardInputError(member, inp) {
  const cover = num(inp.cover);
  if (![member.lx, member.ly, member.lz].every((v) => Number(v) > 0)) return 'The member needs positive Lx, Ly and Hz.';
  if (!(cover >= 0)) return 'Cover must be zero or more.';
  const covB = Number(member.covB ?? cover), covT = Number(member.covT ?? cover);
  if (!(member.lz - covB - covT > 0)) return 'The covers leave no height for the bars.';
  let mainDia, topDia;
  if (inp.kind === 'Wall') {
    const w = inp.wall;
    if (!(member.lx > member.ly)) return 'A wall card needs the wall to run along X (Lx longer than Ly).';
    if (!(num(w.mainDia) > 0) || !(num(w.distDia) > 0) || !(num(w.linkDia) > 0)) return 'Wall bar diameters must be positive.';
    if (!(num(w.mainSpacing) > 0) || !(num(w.distSpacing) > 0) || !(num(w.linkSpacing) > 0) || !(num(w.linkVSpacing) > 0)) {
      return 'Wall spacings must be positive.';
    }
    if (!(num(w.legA) >= 0)) return 'Leg A must be zero or more.';
    if (!(member.ly - 2 * cover - num(w.linkDia) > 0)) return 'The wall is too thin for its link (thickness − 2 × cover − Ø must be positive).';
    mainDia = { long: num(w.mainDia), short: num(w.mainDia) };
    topDia = mainDia;
  } else {
    const plan = columnPlan(member, inp, cover, covB, covT);
    if (!plan.ok) return plan.msg;
    mainDia = plan.mainDia;
    topDia = plan.topDia;
  }
  for (const [end, dias] of [['base', mainDia], ['top', topDia]]) {
    for (const dia of [dias.long, dias.short]) {
      const spec = starterSpec(inp.starters, dia, end);
      if (!(spec.dia > 0)) return 'Starter Ø must be positive.';
      if (!(spec.lap > 0)) return 'Starter lap must be positive.';
      if (!(spec.bend >= 0)) return 'Starter bend leg must be zero or more.';
      if (!(spec.anchorage > spec.bend)) return 'Starter anchorage must be longer than its bend leg.';
    }
  }
  return null;
}

function columnGroups(member, inp, cover, covB, covT, plan, neighbours, warnings) {
  const dL = plan.linkDia;
  // The bar rows (rule H, planned in columnPlan: the lapped faces sit one link diameter further in) and the bars on them.
  const { box, positions, faceOf } = plan;

  // Bars up the height, face by face: the bottom bar, then one more above each level. A level's lower bar is a double crank (Z) that
  // cranks inward over its jog and laps the upper bar; the top bar runs straight to the top. Marks: V1 is the bottom bar, V2 the next, and so on.
  const segsOf = (face) => {
    const segs = [];
    let bottom = covB + plan.mainDia[face] / 2, segDia = plan.mainDia[face];
    for (const splice of plan.splices[face].list) {
      segs.push({ dia: segDia, bottom, splice });
      bottom = splice.b;
      segDia = splice.dia;
    }
    segs.push({ dia: segDia, bottom, splice: null });
    return segs;
  };
  const segs = { long: segsOf('long'), short: segsOf('short') };
  const topEnd = (face) => member.lz - covT + segs[face][segs[face].length - 1].dia / 2;
  // Unit vector from a main bar towards the column centre: a crank steps that way, into the section and away from the links.
  const inward = (px, py) => {
    const ux = member.x + member.lx / 2 - px, uy = member.y + member.ly / 2 - py;
    const d = Math.hypot(ux, uy);
    return d > 0 ? [ux / d, uy / d] : [1, 0];
  };
  const mains = [];
  segs.long.forEach((_, k) => {
    positions.forEach(([x, y], i) => {
      const seg = segs[faceOf[i]][k];
      const px = member.x + x, py = member.y + y;
      const bar = {
        Bar_mark: `V${k + 1}-${i + 1}`,
        Dia: seg.dia,
        Plane: 'XZ',
        Pos_Rotation: 90,
        Pos_x: r2(px), Pos_y: r2(py), Pos_z: r2(member.z + seg.bottom),
        bond_condition: 'good',
      };
      if (!seg.splice) {
        mains.push(tagRow(member, { ...bar, Rebar_Type: 'straight', 'Length of Bar': r1(topEnd(faceOf[i]) - seg.bottom) }));
      } else if (seg.splice.step > 0) {
        const row = tagRow(member, {
          ...bar,
          Rebar_Type: 'double_crank',
          DC_Lap_Start: r1(seg.splice.a - seg.bottom),
          DC_Lap_Mid: r1(seg.splice.jog),
          DC_Tail_Length: r1(seg.splice.c - seg.splice.b),
          Crank_step: seg.splice.step,
        });
        row.plan_rotation = planRotationToward(row, [0, 0, 0], [0, 1, 0], inward(px, py));
        mains.push(row);
      } else {
        mains.push(tagRow(member, { ...bar, Rebar_Type: 'straight', 'Length of Bar': r1(seg.splice.c - seg.bottom) }));
      }
    });
  });
  if ([...plan.splices.long.list, ...plan.splices.short.list].some((l) => !(l.step > 0))) {
    warnings.push('A level has no crank step, so its lapped bars share a position and overlap in the lap.');
  }

  // Links: one stack per run of levels (its first link sits Ø/2 above the run's bottom, its last Ø/2 below the run's top). The cross-ties of
  // a run are c_link_with_hook rows: Y ties in the link layers, from the bottom bar row to the top bar row; X ties one tie diameter higher,
  // from the left column to the right column. Each end is a double hook that holds a bar (spec 5c).
  const pts = lappedLinkPoints({ lx: member.lx, ly: member.ly, cover, dia: dL, lap: plan.linkLap });
  const links = [];
  plan.runs.forEach((run, k) => {
    const firstZ = run.bottom + dL / 2;
    const limit = run.top - dL / 2;
    links.push(tagRow(member, {
      Bar_mark: `T${k + 1}`,
      Rebar_Type: 'profile',
      Dia: dL,
      Plane: 'XY',
      Pos_Rotation: 0,
      Pos_x: r1(member.x + pts[0][0]), Pos_y: r1(member.y + pts[0][1]), Pos_z: r1(member.z + firstZ),
      legs: JSON.stringify(linkLegs(pts)),
      qty_z: Math.floor((limit - firstZ) / run.spacing) + 1,
      spacing_z: run.spacing,
    }));
    for (const g of run.cross) {
      const { count: m, dia: dC, spacing: sC, dir } = g;
      // The hook is as wide as the bar it holds and the tie together, so the bar sits in it: the spine on one side of the bar, the return on
      // the other. Y ties hold the bars of the faces along X, X ties those of the faces along Y.
      const alongXDia = plan.longAxis === 'x' ? run.longDia : run.shortDia;
      const alongYDia = plan.longAxis === 'x' ? run.shortDia : run.longDia;
      const hW = (dir === 'Y' ? alongXDia : alongYDia) + dC;
      const cands = plan.candidates[dir];
      // X ties sit one tie diameter above the layer of the link, so they never cross the Y ties in the same plane.
      const z0 = dir === 'X' ? firstZ + dC : firstZ;
      const nC = Math.floor((limit - z0) / sC) + 1;
      for (let j = 0; j < m; j++) {
        const at = cands[Math.round(((j + 1) * (cands.length + 1)) / (m + 1)) - 1];
        if (dir === 'Y') {
          links.push(tagRow(member, {
            Bar_mark: `CT${k + 1}-${j + 1}`,
            Rebar_Type: 'c_link_with_hook',
            Dia: dC,
            Plane: 'XY',
            Pos_Rotation: 90,
            length: r1(box.y1 - box.y0 + hW),
            c_length_a: r1(hW + dC),
            c_length_b: r1(hW + dC),
            double_hook: 'yes',
            Pos_x: r2(member.x + at + hW / 2), Pos_y: r2(member.y + box.y0 - hW / 2), Pos_z: r2(member.z + z0),
            qty_z: nC,
            spacing_z: sC,
          }));
        } else {
          links.push(tagRow(member, {
            Bar_mark: `CX${k + 1}-${j + 1}`,
            Rebar_Type: 'c_link_with_hook',
            Dia: dC,
            Plane: 'XY',
            Pos_Rotation: 0,
            length: r1(box.x1 - box.x0 + hW),
            c_length_a: r1(hW + dC),
            c_length_b: r1(hW + dC),
            double_hook: 'yes',
            Pos_x: r2(member.x + box.x0 - hW / 2), Pos_y: r2(member.y + at - hW / 2), Pos_z: r2(member.z + z0),
            qty_z: nC,
            spacing_z: sC,
          }));
        }
      }
    }
  });
  if (plan.runs.some((run) => run.cross.length)) {
    warnings.push('Cross-ties hook the bars: Y ties the top and bottom rows, X ties the left and right faces. Their hook closures sit on the outer links, because the bars touch the links, so they clash there (spec item L). X ties sit one tie diameter above the link layer (spec item M).');
  }

  const specFor = (end, face) => starterSpec(inp.starters, end === 'top' ? plan.topDia[face] : plan.mainDia[face], end);
  const starters = starterRows({ member, positions, faceOf, starters: inp.starters, specFor, cover, neighbours, mark: 'ST', warnings });
  return [
    { name: `${member.name} mains`, rows: mains },
    { name: `${member.name} links`, rows: links },
    { name: `${member.name} starters`, rows: starters },
  ];
}

function wallGroups(member, inp, cover, covB, intH, neighbours, warnings) {
  const w = inp.wall;
  const L = member.lx, t = member.ly;
  const dM = num(w.mainDia), dD = num(w.distDia), dL = num(w.linkDia);
  // Verticals on the outer layer (cover + Ø/2 from each face, the sample); distribution inside them.
  const dOuter = cover + dM / 2;
  const positions = perimeterPositions({ x0: dOuter, y0: dOuter, x1: L - dOuter, y1: t - dOuter }, num(w.mainSpacing));
  const mains = positions.map(([x, y], i) => tagRow(member, {
    Bar_mark: `WV1-${i + 1}`,
    Rebar_Type: 'straight',
    Dia: dM,
    Plane: 'XZ',
    Pos_Rotation: 90,
    Pos_x: r2(member.x + x), Pos_y: r2(member.y + y), Pos_z: r2(member.z + covB + dM / 2),
    'Length of Bar': r1(intH),
    bond_condition: 'good',
  }));

  const sD = num(w.distSpacing);
  const yFront = cover + dM + dD / 2;
  const distribution = [['WH1', yFront], ['WH2', t - yFront]].map(([mark, y]) => tagRow(member, {
    Bar_mark: mark,
    Rebar_Type: 'straight',
    Dia: dD,
    Plane: 'XY',
    Pos_Rotation: 0,
    Pos_x: r1(member.x + WALL_END_OFFSET), Pos_y: r1(member.y + y), Pos_z: r1(member.z + covB + dD / 2),
    'Length of Bar': r1(L - 2 * WALL_END_OFFSET),
    qty_z: Math.floor((intH - dD) / sD) + 1,
    spacing_z: sD,
    bond_condition: 'poor',
  }));

  // The link's spine runs across the thickness, centred between the covers; its legs run along the wall.
  const legB = t - 2 * cover;
  const link = [tagRow(member, {
    Bar_mark: 'WL1',
    Rebar_Type: 'c_link_with_hook',
    Dia: dL,
    Plane: 'XY',
    Pos_Rotation: 90,
    length: r1(legB - dL),
    c_length_a: num(w.legA),
    c_length_b: r1(legB),
    double_hook: 'no',
    Pos_x: r1(member.x + WALL_END_OFFSET), Pos_y: r1(member.y + cover + dL / 2), Pos_z: r1(member.z + covB + dL / 2),
    qty_x: Math.floor((L - 2 * WALL_END_OFFSET) / num(w.linkSpacing)) + 1,
    spacing_x: num(w.linkSpacing),
    qty_z: Math.floor((intH - dL) / num(w.linkVSpacing)) + 1,
    spacing_z: num(w.linkVSpacing),
  })];

  const specFor = (end) => starterSpec(inp.starters, dM, end);
  const faceOf = positions.map(() => 'long');
  const starters = starterRows({ member, positions, faceOf, starters: inp.starters, specFor, cover, neighbours, mark: 'ST', warnings });
  return [
    { name: `${member.name} mains`, rows: mains },
    { name: `${member.name} distribution`, rows: distribution },
    { name: `${member.name} links`, rows: link },
    { name: `${member.name} starters`, rows: starters },
  ];
}

// The card's rows for one member: { ok: true, groups: [{ name, rows }], warnings } or { ok: false, msg }. Empty groups are dropped.
// Rows carry no Rebar_tag or setId: the store numbers them and names their set when they are added (one undo step).
export function memberGroups(member, inp, { neighbours = [] } = {}) {
  const msg = cardInputError(member, inp);
  if (msg) return { ok: false, msg };
  const cover = num(inp.cover);
  const covB = Number(member.covB ?? cover), covT = Number(member.covT ?? cover);
  const intH = member.lz - covB - covT;
  const warnings = [];
  const groups = inp.kind === 'Wall'
    ? wallGroups(member, inp, cover, covB, intH, neighbours, warnings)
    : columnGroups(member, inp, cover, covB, covT, columnPlan(member, inp, cover, covB, covT), neighbours, warnings);
  const kept = groups.filter((g) => g.rows.length);
  const long = kept.flatMap((g) => g.rows).filter((r) => barMainLength(r) > STOCK_MM).length;
  if (long) warnings.push(`${long} bar${long === 1 ? '' : 's'} longer than ${STOCK_MM / 1000} m: a splice is not modelled.`);
  return { ok: true, groups: kept, warnings };
}
