// Member reinforcement card: the main bars, links and starters of one box column or wall, as ordinary BBS rows grouped in ▦ sets.
// Pure functions (no React, no store) so Node tests them. Geometry and row fields follow the two reference files,
// inputs/column_sample_800_auto_bbs.json and inputs/wall_sample_auto_bbs.json, except where
// docs/superpowers/specs/2026-10-19-member-reinforcement-design.md (sections 5 and 7) and
// docs/superpowers/specs/2026-10-20-column-size-steps-design.md (sections 3 and 4) say otherwise.
import { barMainLength, genBarPoints, transformBarLocalPoint } from './shapes.js';
import { lapLengthMm } from './calc.js';

// Wall distribution and links start this far from each wall end (the sample).
export const WALL_END_OFFSET = 100;
// Bend leg floor, mm (the sample).
const STARTER_BEND_MIN = 150;
// Bars longer than this get a warning: the app has no stock-length setting, so the card does not splice them.
const STOCK_MM = 12000;
// mm: an element "touches" the member's base or top within this tolerance.
const FACE_TOL = 1;
const FACES = ['long', 'short'];
// Spec 5f (revised 2026-10-20): at a size step, the nearest outside long-face bar at each end of each long face bends in to the new section;
// the outermost ones end in the slab. Every short-face bar outside the new section bends in.
const STEP_BEND_PER_END = 1;

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
    bond: 'good',
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

// A splice (its crank and lap) starts this far above its level's SFL, which is the top of the slab below it (the drawing's rule).
const SPLICE_START_MM = 75;

// Defaults for a level between a lower bar of `dBelow` and an upper bar of `dAbove`: the lap of the larger bar at the project's bond (good
// unless the bond says otherwise, from the lap table), a crank step that puts the two bars side by side (the larger Ø, rounded up to 5 mm),
// and a 1 in 6 jog (rounded up to 10 mm). A typed lap, step or jog overrides its default.
export function levelDefaults(dBelow, dAbove, bond = 'good') {
  const dMax = Math.max(dBelow, dAbove);
  const step = Math.ceil(dMax / 5) * 5;
  return { lap: lapLengthMm(dMax, bond), step, jog: Math.ceil((6 * step) / 10) * 10 };
}

// Column levels (lap splices where the bar diameter changes), sorted by height. A splice starts SPLICE_START_MM above its level's SFL (the top
// of the slab below it): the lower bar starts to crank inward there, the crank runs over its jog to b, and the upper bar starts at b and runs
// up alongside the lower bar for the lap, to c = b + lap. So a splice spans a..c. Each splice must end before the next one starts (at its a),
// must clear the base's starters (starterTop, their top above the base) and the base, and must clear the top. `floor` and `ceiling` replace
// those limits for a section above or below a size step (spec 5f). Returns { ok, list, topDia }, or { ok: false, msg }.
export function resolveLevels(levels, { mainDia, covB, covT, lz, bond = 'good', starterTop = 0, floor = null, ceiling = null }) {
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
    const d = levelDefaults(dBelow, dia, bond);
    const lap = orDefault(l.lap, d.lap), step = orDefault(l.step, d.step), jog = orDefault(l.jog, d.jog);
    if (!(lap > 0)) return { ok: false, msg: 'A level\'s lap must be above zero.' };
    if (!(step >= 0)) return { ok: false, msg: 'A crank step must be zero or more.' };
    if (step > 0 && !(jog > 0)) return { ok: false, msg: 'A crank needs a jog above zero.' };
    const a = level + SPLICE_START_MM, b = a + jog;
    list.push({ level, dia, lap, step, jog, a, b, c: b + lap });
    dBelow = dia;
  }
  if (list.length) {
    const top = list[list.length - 1];
    const topEnd = ceiling ?? lz - covT + top.dia / 2;
    const minStart = floor ?? Math.max(covB + mainDia / 2, starterTop);
    const roomy = list[0].a - minStart >= 1
      && list.slice(1).every((l, k) => l.a - list[k].c >= 1)
      && topEnd - top.c >= 1;
    if (!roomy) return { ok: false, msg: 'Levels need room for each splice: keep each one clear of the next, the base and the top.' };
  }
  return { ok: true, list, topDia: list.length ? list[list.length - 1].dia : mainDia };
}

// Starter sizes: Ø defaults to the main Ø (for the top end, the top bar's Ø, unless a starter Ø is typed, which then applies to both
// ends), the lap to the lap table at the project's bond, the anchorage to the lap, the bend leg to the larger of 10 × Ø and 150 mm (the
// sample). Anchorage includes the bend, so the straight part is anchorage − bend.
export function starterSpec(starters, mainDia, end = 'base', bond = 'good') {
  const dia = end === 'top'
    ? orDefault(starters.topDia, orDefault(starters.dia, mainDia))
    : orDefault(starters.dia, mainDia);
  const lap = orDefault(starters.lap, lapLengthMm(dia, bond));
  const anchorage = orDefault(starters.anchorage, lap);
  const bend = orDefault(starters.bend, Math.max(10 * dia, STARTER_BEND_MIN));
  return { dia, lap, anchorage, bend, bond };
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
        bond_condition: spec.bond,
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

// The schedule as the drawing gives it: `rowsTopFirst` lists the levels top first, each with a name, its SFL (metres) and the cells
// SIZE, MAIN BARS and LINKS. Returns { ok, rows (bottom first), count, linkDia, sections } or { ok: false, msg }. Each resolved row has h
// (mm above the bottom row), size { lx, ly }, bars { count, dia }, links { sets, dia, spacing, cross }, layout ('all', 'faces' or 'two'),
// section (0 for the base's section, one more after each size step) and the optional lap, step and jog. A level whose SIZE differs from
// the level below starts a new section (spec 5f), and may change its bar count and layout. A level that keeps its size keeps both.
export function resolveSchedule(rowsTopFirst, { lx, ly, layout = 'all' }) {
  const bottomUp = [...(rowsTopFirst || [])].reverse();
  if (!bottomUp.length) return { ok: false, msg: 'Add at least one level to the schedule.' };
  const twoFaces = layout === 'x' || layout === 'y';   // bars on two faces only, one size, on every level
  const out = [];
  for (let k = 0; k < bottomUp.length; k++) {
    const r = bottomUp[k];
    const name = (r.name || '').trim() || `Level ${k + 1} (from the bottom)`;
    // MAIN BARS is one cell (one size on every face) or two (the long and the short faces). "same as below" takes the level under it, and
    // the bottom level takes the column's choice. Two faces ('x' or 'y') apply to every level.
    const own = String(r.layout ?? 'same').trim().toLowerCase();
    let rowLayout;
    if (twoFaces) rowLayout = 'two';
    else if (own === 'faces' || own === 'all') rowLayout = own;
    else rowLayout = k === 0 ? (layout === 'faces' ? 'faces' : 'all') : out[k - 1].layout;
    const cell = (key, label, parse, extra = '') => {
      const raw = String(r[key] ?? '').trim();
      if (SAME_RE.test(raw)) {
        if (k === 0) return { error: `The bottom row needs its own ${label}.` };
        const below = out[k - 1][key];
        // A single MAIN BARS cell cannot copy a level that has long and short faces.
        if (key === 'bars' && below.faces) return { error: `${label} on ${name} is "same as below", but the level below has long and short faces. Give ${name} its own cell.` };
        return { value: below };
      }
      const value = parse(raw);
      return value ? { value } : { error: `Could not read ${label} "${raw}" on ${name}. Write it as in the drawing, for example ${EXAMPLE[key]}.${extra}` };
    };
    // Long and short faces: one MAIN BARS cell per face, as "44H40" and "8H32". "same as below" takes that face's bars from the level under it.
    const faceCell = (key, label, face) => {
      const raw = String(r[key] ?? '').trim();
      if (SAME_RE.test(raw)) {
        if (k === 0) return { error: `The bottom row needs its own ${label}.` };
        const below = out[k - 1].bars.faces;
        return below ? { value: below[face] } : { error: `${label} on ${name} is "same as below", but the level below has one size. Give ${name} its own cells.` };
      }
      const value = parseMainBars(raw);
      return value ? { value } : { error: `Could not read ${label} "${raw}" on ${name}. Write it as in the drawing, for example 44H40.` };
    };
    const size = cell('size', 'SIZE', parseSize);
    if (size.error) return { ok: false, msg: size.error };
    let bars;
    if (rowLayout === 'faces') {
      const long = faceCell('barsLong', 'MAIN BARS on the long faces', 'long');
      const short = faceCell('barsShort', 'MAIN BARS on the short faces', 'short');
      if (long.error || short.error) return { ok: false, msg: long.error || short.error };
      bars = { value: { count: long.value.count + short.value.count, dia: long.value.dia, faces: { long: long.value, short: short.value } } };
    } else {
      bars = cell('bars', 'MAIN BARS', parseMainBars, rowLayout === 'all'
        ? ' For long and short faces, choose that layout and give each face its own cell.'
        : '');
    }
    if (bars.error) return { ok: false, msg: bars.error };
    const links = cell('links', 'LINKS', parseLinks);
    if (links.error) return { ok: false, msg: links.error };
    // The slab below this level (SLAB THK; its SFL is the slab's top) and the links in it. The base's slab is below the member, so it is not read.
    const slabMm = k > 0 && !isBlank(r.slab) ? Number(r.slab) : null;
    if (slabMm !== null && !(slabMm > 0)) return { ok: false, msg: `The slab below ${name} must be above zero, or left blank.` };
    const sfl = Number(r.sfl);
    if (isBlank(r.sfl) || !Number.isFinite(sfl)) return { ok: false, msg: `Give ${name} its SFL (m).` };
    // SFL is in metres. A millimetre value (-20870) would put every level thousands of metres from the base, so it is refused by name.
    if (Math.abs(sfl) >= 1000) return { ok: false, msg: `${name}: SFL ${sfl} is over 1000 m. SFL is in metres, so type the drawing's value (for example -20.870, not -20870).` };
    if (k > 0 && !(sfl > out[k - 1].sfl)) return { ok: false, msg: `${name}: SFL ${sfl} m must be above the level below (${out[k - 1].sfl} m).` };
    const stepHere = k > 0 && (size.value.lx !== out[k - 1].size.lx || size.value.ly !== out[k - 1].size.ly);
    // Some bars of a size step end in that level's slab, so the step needs its thickness (spec 5f, R2).
    if (stepHere && slabMm === null) {
      return { ok: false, msg: `${name} changes SIZE, so some of its bars end in its slab: give it SLAB THK (its SFL is the slab's top).` };
    }
    out.push({
      name,
      sfl,
      h: k === 0 ? 0 : Math.round((sfl - out[0].sfl) * 1e6) / 1e3,
      size: size.value,
      layout: rowLayout,
      section: k === 0 ? 0 : out[k - 1].section + (stepHere ? 1 : 0),
      bars: bars.value,
      links: links.value,
      slab: slabMm === null ? null : { mm: slabMm },
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
  if (out[out.length - 1].section > 1) {
    return { ok: false, msg: 'Only one size step is modelled for now: the schedule can change SIZE once, above the base.' };
  }
  const mLx = Math.round(lx), mLy = Math.round(ly);
  for (let k = 0; k < out.length; k++) {
    const r = out[k];
    const below = k > 0 ? out[k - 1] : null;
    const sameSection = below !== null && r.section === below.section;
    if (k === 0 && (mLx !== r.size.lx || mLy !== r.size.ly)) {
      return { ok: false, msg: `SIZE ${r.size.lx} x ${r.size.ly} on ${r.name} does not match this member (${mLx} x ${mLy}).` };
    }
    if (k > 0 && (r.size.lx > mLx || r.size.ly > mLy)) {
      return { ok: false, msg: `SIZE ${r.size.lx} x ${r.size.ly} on ${r.name} is bigger than this member (${mLx} x ${mLy}).` };
    }
    // planStep sorts the bars by their x alone, so a size step must keep the depth: a change of depth would place bars outside the section.
    if (k > 0 && !sameSection && r.size.ly !== mLy) {
      return { ok: false, msg: `SIZE ${r.size.lx} x ${r.size.ly} on ${r.name} changes the depth: a size step keeps the depth (${mLy}) and narrows the width.` };
    }
    if (r.layout === 'faces' && r.size.lx === r.size.ly) {
      return { ok: false, msg: 'Long and short faces need a member longer one way than the other.' };
    }
    if (sameSection && r.layout !== below.layout) {
      return { ok: false, msg: `The MAIN BARS layout on ${r.name} must stay the same as the level below, unless its SIZE changes.` };
    }
    if (r.bars.faces) {
      const { long, short } = r.bars.faces;
      if (!(long.count >= 4 && long.count % 2 === 0 && short.count >= 2 && short.count % 2 === 0)) {
        return { ok: false, msg: `MAIN BARS on ${r.name}: each pair of faces needs an even count, at least 4 on the long faces and 2 on the short.` };
      }
      if (sameSection && (long.count !== below.bars.faces.long.count || short.count !== below.bars.faces.short.count)) {
        return { ok: false, msg: `The bar counts on each pair of faces must stay the same up the column: ${r.name} differs from the level below.` };
      }
      if (!(long.dia > 0 && short.dia > 0)) return { ok: false, msg: `MAIN BARS on ${r.name} needs a bar Ø above zero on each face.` };
    } else {
      if (sameSection && r.bars.count !== below.bars.count) {
        return { ok: false, msg: `MAIN BARS on ${r.name} is ${r.bars.count}, but the level below has ${below.bars.count}. The bar count must stay the same up the column, unless the SIZE changes.` };
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
  // A slab must be thinner than the storey below it, so that storey keeps a stretch of links.
  for (let k = 1; k < out.length; k++) {
    const r = out[k];
    if (!r.slab) continue;
    const storey = r.h - out[k - 1].h;
    if (!(r.slab.mm < storey)) {
      return { ok: false, msg: `The slab below ${r.name} (${r.slab.mm} mm) is as thick as, or thicker than, the storey below it (${Math.round(storey)} mm).` };
    }
  }
  return { ok: true, rows: out, count: first.bars.count, linkDia: first.links.dia, sections: out[out.length - 1].section + 1 };
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
// above, which sits below that level's SFL. No links run inside a slab: its zone is a gap (links: null), so the storey below stops at the
// slab's bottom face and the storey above starts at its SFL. A size step (spec 5f) is a gap too, with or without a slab. Each zone carries
// the bar sizes and the section of the storey it lies in. The first zone starts at the member's bottom cover, and the last ends at its top cover.
export function linkZones(rows, covB, covT, lz) {
  const zones = [];
  rows.forEach((r, j) => {
    const dias = faceDias(r);
    const next = rows[j + 1];
    const slab = next && next.slab ? next.slab : null;
    const step = next !== undefined && next.section !== r.section;
    const top = slab ? next.h - slab.mm : next ? next.h : lz - covT;
    zones.push({ bottom: j === 0 ? covB : r.h, top, links: r.links, longDia: dias.long, shortDia: dias.short, name: `${r.name} storey`, section: r.section });
    if (slab || step) {
      zones.push({
        bottom: top, top: next.h, links: null, longDia: dias.long, shortDia: dias.short,
        name: slab ? `${next.name} slab, no links` : `${next.name} size step, no links`,
        section: next.section,
      });
    }
  });
  return zones;
}

// Link runs: consecutive storey zones with the same link spacing, cross links and section share one stack of links, so a level that only
// changes the bars does not restart the links. Cross links add the bar sizes to the key, because their hooks depend on them. A zone with no
// links (a slab or a size step) ends the stack, so the storey above it starts a new run. A run stops at the top of its last zone.
function linkRuns(zones) {
  const runs = [];
  let open = false;
  for (const z of zones) {
    if (!z.links) {
      open = false;
      continue;
    }
    const key = `${z.section}|${z.links.spacing}|${z.links.cross.length ? `${JSON.stringify(z.links.cross)}|${z.longDia}|${z.shortDia}` : 'none'}`;
    const last = runs[runs.length - 1];
    if (open && last.key === key) last.top = z.top;
    else runs.push({ key, bottom: z.bottom, top: z.top, spacing: z.links.spacing, cross: z.links.cross, longDia: z.longDia, shortDia: z.shortDia, section: z.section });
    open = true;
  }
  return runs;
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

// The unit vector out of the face a bar sits on: across that face, away from the column. A corner bar points diagonally outward.
function faceNormal([x, y], box) {
  const nx = Math.abs(x - box.x0) < 0.01 ? -1 : Math.abs(x - box.x1) < 0.01 ? 1 : 0;
  const ny = Math.abs(y - box.y0) < 0.01 ? -1 : Math.abs(y - box.y1) < 0.01 ? 1 : 0;
  const d = Math.hypot(nx, ny);
  return d > 0 ? [nx / d, ny / d] : [0, 0];
}

// The column's bars, links and levels, from its schedule (or from the simple inputs, read as one). Each section (the levels that share a
// SIZE) has its own box, centred on the base, with its own bar positions, cross-tie candidates and link profile. At a size step the bars
// change as spec 5f says (planStep). Returns { ok: true, ... } or { ok: false, msg }.
function columnPlan(member, inp, cover, covB, covT) {
  const c = inp.column;
  const rows = Array.isArray(c.schedule) ? c.schedule : scheduleOfSimple(member, c);
  const sch = resolveSchedule(rows, { lx: member.lx, ly: member.ly, layout: c.layout });
  if (!sch.ok) return sch;
  const lv = sch.rows;
  const dL = sch.linkDia;
  const bond = inp.bond || 'good';
  const twoFaces = c.layout === 'x' || c.layout === 'y';
  const bottom = lv[0], topRow = lv[lv.length - 1];
  const sectionRows = [];   // the rows of each section, by their index in lv
  lv.forEach((r, i) => {
    sectionRows[r.section] = [...(sectionRows[r.section] || []), i];
  });
  const sections = [];
  for (let s = 0; s < sectionRows.length; s++) {
    const idx = sectionRows[s];
    const first = lv[idx[0]];
    const { lx, ly } = first.size;
    const ox = (member.lx - lx) / 2, oy = (member.ly - ly) / 2;   // centred on the base (spec 5f, R1)
    const longAxis = lx > ly ? 'x' : 'y';
    const xFace = longAxis === 'x' ? 'short' : 'long';   // the left and right faces set x0 and x1
    const yFace = longAxis === 'x' ? 'long' : 'short';   // the bottom and top faces set y0 and y1
    const maxDia = (face) => Math.max(...idx.map((i) => faceDias(lv[i])[face]));
    // Each row sits one bar radius inside its face, at the largest Ø that face takes up the section (rule H: the lapped faces one link further in).
    const box = {
      x0: ox + cover + 2 * dL + maxDia(xFace) / 2,
      y0: oy + cover + 2 * dL + maxDia(yFace) / 2,
      x1: ox + lx - (cover + dL + maxDia(xFace) / 2),
      y1: oy + ly - (cover + dL + maxDia(yFace) / 2),
    };
    const count = first.bars.count;
    const positions = twoFaces ? faceRowPositions(box, count, c.layout)
      : (first.bars.faces ? facePositions(box, first.bars.faces, longAxis) : ringPositions(box, count));
    const legW = lx - 2 * cover - dL;
    if (!(legW > 0)) return { ok: false, msg: 'The column is too small for its link (Lx − 2 × cover − Ø must be positive).' };
    const linkLap = isBlank(c.lap) ? defaultLinkLap(legW) : num(c.lap);
    if (!(linkLap > 0)) return { ok: false, msg: 'The link lap must be positive.' };
    sections.push({
      idx,
      lx,
      ly,
      ox,
      oy,
      longAxis,
      box,
      count,
      positions,
      faceOf: positions.map((p) => faceOfBar(p, box, longAxis)),
      candidates: { X: crossCandidates(positions, box, 'X'), Y: crossCandidates(positions, box, 'Y') },
      linkLap,
      linkPts: lappedLinkPoints({ lx, ly, cover, dia: dL, lap: linkLap }).map(([x, y]) => [x + ox, y + oy]),
    });
  }
  // A level above a size step that keeps its size would be a splice starting in the step's slab, which is not modelled.
  const stepIdx = sections.length > 1 ? sections[1].idx[0] : null;
  if (stepIdx !== null && sections[1].idx.length > 1) {
    return {
      ok: false,
      msg: `${lv[sections[1].idx[1]].name} keeps the size of ${lv[stepIdx].name}, so it would be a splice starting in the step's slab, which the card does not model yet. Give it its own SIZE, or take it out of the schedule.`,
    };
  }
  // The splices of each section (the levels above its first row), face by face: a bar laps the bar of its own face. The section below a step
  // ends its splices below the step's bends (the ceiling).
  const stepZL = stepIdx === null ? null : lv[stepIdx].h - (lv[stepIdx].slab ? lv[stepIdx].slab.mm : 0) + cover;
  const splices = {};
  for (const face of FACES) {
    const list = [];
    for (let s = 0; s < sections.length; s++) {
      const sec = sections[s];
      const levels = sec.idx.slice(1).map((i) => ({ name: lv[i].name, level: lv[i].h, dia: faceDias(lv[i])[face], lap: lv[i].lap, step: lv[i].step, jog: lv[i].jog }));
      const mainDia = faceDias(lv[sec.idx[0]])[face];
      const res = resolveLevels(levels, {
        mainDia,
        covB,
        covT,
        lz: member.lz,
        bond,
        starterTop: starterSpec(inp.starters, mainDia, 'base', bond).lap,
        ceiling: s === 0 ? stepZL : null,
      });
      if (!res.ok) return res;
      list.push(...res.list.map((l) => ({ ...l, section: s })));
    }
    splices[face] = { ok: true, list };
  }
  // The size step (spec 5f): the bars at it lap as usual, bend in, or end in the slab (planStep). The section above takes the bars it leaves.
  let step = null;
  if (stepIdx !== null) {
    const lastC = {};
    for (const face of FACES) {
      const below = splices[face].list.filter((l) => l.section === 0);
      lastC[face] = below.length ? below[below.length - 1].c : covB + faceDias(bottom)[face] / 2;
    }
    const res = planStep({
      lowerSec: sections[0],
      upperSec: sections[1],
      lv,
      stepIdx,
      cover,
      bond,
      lastC,
      centre: [sections[0].lx / 2, sections[0].ly / 2],
    });
    if (!res.ok) return res;
    step = res;
    sections[1] = {
      ...sections[1],
      box: res.upperBox,
      positions: res.upperPositions,
      faceOf: res.upperFaceOf,
      count: res.upperPositions.length,
      candidates: {
        X: crossCandidates(res.upperPositions, res.upperBox, 'X'),
        Y: crossCandidates(res.upperPositions, res.upperBox, 'Y'),
      },
      bottoms: res.upperBottoms,
    };
  }
  const runs = linkRuns(linkZones(lv, covB, covT, member.lz));
  if (runs.some((run) => !(run.top - run.bottom - dL > 0))) {
    return { ok: false, msg: 'A stretch of the schedule is too short for its links: keep each level clear of the next and of the top.' };
  }
  for (const run of runs) {
    const sec = sections[run.section];
    for (const g of run.cross) {
      const have = sec.candidates[g.dir];
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
    bond,
    rows: lv,
    mainDia: faceDias(bottom),
    topDia: faceDias(topRow),
    splices,
    linkDia: dL,
    runs,
    slabs: lv.filter((r) => r.slab).map((r) => ({ name: r.name, bottom: r.h - r.slab.mm, top: r.h })),
    sections,
    step,
    steps: step ? [{ name: lv[stepIdx].name, soffit: step.soffit, zL: step.zL, zSFL: step.zSFL, counts: step.counts }] : [],
  };
}

// The bars at a size step (spec 5f, as revised on 2026-10-20). `lowerSec` is the section below the step, `upperSec` the one above it. A lower
// bar inside the new section's envelope laps as usual: its crank and lap sit at the step. A bar outside the envelope bends in to it: each
// short-face bar, and the nearest outside bar at each end of each long face (STEP_BEND_PER_END of them). The other outside long-face bars end
// in the slab, bent in there. A bend's crank is its move to the envelope plus the usual crank, so its tail lies beside its upper bar. `lastC`
// gives, per face, where the splice below the step ends: every bar must start above it. Returns the bars, their counts, and the upper section's
// positions, bottoms and envelope, or { ok: false, msg }.
function planStep({ lowerSec, upperSec, lv, stepIdx, cover, bond, lastC, centre }) {
  const stepRow = lv[stepIdx];
  const below = lv[stepIdx - 1];
  const soffit = stepRow.h - (stepRow.slab ? stepRow.slab.mm : 0);
  const zL = soffit + cover;   // the bars that end in the slab turn one cover above the soffit
  const zSFL = stepRow.h;      // the bends end at the SFL, where the upper bars start
  const X0 = upperSec.box.x0, X1 = upperSec.box.x1;
  const Ylo = lowerSec.box.y0, Yhi = lowerSec.box.y1;
  const EPS = 0.01;
  const upperBox = { x0: X0, x1: X1, y0: Ylo, y1: Yhi };
  const lowerDia = faceDias(below), upperDia = faceDias(stepRow);
  const inside = ([x]) => x >= X0 - EPS && x <= X1 + EPS;
  // The outside long-face bars, grouped by row and end: each group keeps its STEP_BEND_PER_END nearest bars to bend in.
  const groups = new Map();
  lowerSec.positions.forEach((p, i) => {
    if (lowerSec.faceOf[i] !== 'long' || inside(p)) return;
    const end = p[0] < X0 ? 'left' : 'right';
    const row = Math.abs(p[1] - Ylo) < EPS ? 'bottom' : 'top';
    const key = `${row}|${end}`;
    const gap = end === 'left' ? X0 - p[0] : p[0] - X1;
    groups.set(key, [...(groups.get(key) || []), { i, gap }]);
  });
  const bendLong = new Set();
  for (const list of groups.values()) {
    list.sort((a, b) => a.gap - b.gap).slice(0, STEP_BEND_PER_END).forEach((e) => bendLong.add(e.i));
  }
  const bars = lowerSec.positions.map((p, i) => {
    const face = lowerSec.faceOf[i];
    const d = levelDefaults(lowerDia[face], upperDia[face], bond);   // the usual crank, jog and lap of the larger bar
    if (inside(p)) {
      const ux = centre[0] - p[0], uy = centre[1] - p[1];
      const len = Math.hypot(ux, uy) || 1;
      const a = zSFL + SPLICE_START_MM, b = a + d.jog;
      return { i, face, kind: 'inside', p, q: p, a, b, c: b + d.lap, crank: d.step, jog: d.jog, lap: d.lap, dir: [ux / len, uy / len], bottom: b };
    }
    if (face === 'short' || bendLong.has(i)) {
      const q = [p[0] < X0 ? X0 : X1, p[1]];
      const dx = q[0] - p[0];
      const crank = Math.abs(dx) + d.step;
      const jog = Math.ceil((6 * crank) / 10) * 10;
      const b = zSFL;
      return { i, face, kind: 'bend', p, q, a: b - jog, b, c: b + d.lap, crank, jog, lap: d.lap, dir: [dx < 0 ? -1 : 1, 0], bottom: b };
    }
    return { i, face, kind: 'terminate', p, zL, lap: d.lap, outward: faceNormal(p, lowerSec.box) };
  });
  // Room: every bar starts above the splice below the step, and the bars that end in the slab end above it.
  for (const st of bars) {
    const top = st.kind === 'terminate' ? st.zL : st.a;
    if (!(top - lastC[st.face] >= 1)) {
      return { ok: false, msg: `${stepRow.name} needs room: the bars that move or end at the step would start inside the splice below. Keep the levels clear of each other.` };
    }
  }
  const counts = { inside: 0, bend: 0, terminate: 0 };
  for (const st of bars) counts[st.kind] += 1;
  const placed = bars.filter((st) => st.kind !== 'terminate');
  const upperPositions = placed.map((st) => st.q);
  const upperFaceOf = upperPositions.map((q) => faceOfBar(q, upperBox, upperSec.longAxis));
  if (placed.length !== stepRow.bars.count) {
    return {
      ok: false,
      msg: `${stepRow.name} is ${stepRow.bars.count} bars, but the section above it takes ${placed.length}: ${counts.inside} lap as usual, ${counts.bend} bend in, and ${counts.terminate} end in the slab. Change MAIN BARS to ${placed.length}, or change how many bars end.`,
    };
  }
  if (stepRow.bars.faces) {
    const longs = upperFaceOf.filter((f) => f === 'long').length;
    if (longs !== stepRow.bars.faces.long.count || placed.length - longs !== stepRow.bars.faces.short.count) {
      return {
        ok: false,
        msg: `${stepRow.name}: the section above takes ${longs} bars on the long faces and ${placed.length - longs} on the short faces. Change MAIN BARS so each pair of faces matches.`,
      };
    }
  }
  return {
    ok: true,
    soffit,
    zL,
    zSFL,
    bars,
    counts,
    upperPositions,
    upperFaceOf,
    upperBottoms: placed.map((st) => st.bottom),
    upperBox,
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
      const spec = starterSpec(inp.starters, dia, end, inp.bond || 'good');
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
  const { sections, step } = plan;
  const centre = [member.x + member.lx / 2, member.y + member.ly / 2];
  // Unit vector from a main bar towards the column centre: a crank steps that way, into the section and away from the links.
  const inward = (px, py) => {
    const ux = centre[0] - px, uy = centre[1] - py;
    const d = Math.hypot(ux, uy);
    return d > 0 ? [ux / d, uy / d] : [1, 0];
  };
  // A bar that ends in a step's slab turns out of the face it sits on (a corner bar turns diagonally outward), as the starters do.
  const bendOutward = (row, normal) => bendPlanRotation(row, normal);

  // Bars up the height, face by face: the bottom bar, then one more above each level. A level's lower bar is a double crank (Z) that
  // cranks inward over its jog and laps the upper bar; the top bar runs straight to the top. At a size step (spec 5f) each lower bar laps,
  // bends in, or ends in the slab, and the upper section's bars start where those leave them. Marks: V1 is the bottom bar, V2 the next, and
  // so on, up through the sections.
  const mains = [];
  const stepRows = [];   // the bars at the step, for the clash check: the row, the lower bar it is (or null), and whether it ends in the slab
  let made = 0;          // the bar segments numbered so far, in the sections below
  sections.forEach((sec, s) => {
    if (s === 0) {
      const segsOf = (face) => {
        const segs = [];
        let bottom = covB + plan.mainDia[face] / 2;
        let segDia = plan.mainDia[face];
        for (const splice of plan.splices[face].list.filter((l) => l.section === 0)) {
          segs.push({ dia: segDia, bottom, splice });
          bottom = splice.b;
          segDia = splice.dia;
        }
        segs.push({ dia: segDia, bottom, splice: null });
        return segs;
      };
      const segs = { long: segsOf('long'), short: segsOf('short') };
      const nSeg = segs.long.length;
      for (let j = 0; j < nSeg; j++) {
        sec.positions.forEach(([x, y], i) => {
          const face = sec.faceOf[i];
          const px = member.x + x, py = member.y + y;
          const seg = segs[face][j];
          const bar = {
            Bar_mark: `V${made + j + 1}-${i + 1}`,
            Dia: seg.dia,
            Plane: 'XZ',
            Pos_Rotation: 90,
            Pos_x: r2(px), Pos_y: r2(py), Pos_z: r2(member.z + seg.bottom),
            bond_condition: plan.bond,
          };
          let row;
          if (seg.splice && seg.splice.step > 0) {
            row = tagRow(member, {
              ...bar,
              Rebar_Type: 'double_crank',
              DC_Lap_Start: r1(seg.splice.a - seg.bottom),
              DC_Lap_Mid: r1(seg.splice.jog),
              DC_Tail_Length: r1(seg.splice.c - seg.splice.b),
              Crank_step: seg.splice.step,
            });
            row.plan_rotation = planRotationToward(row, [0, 0, 0], [0, 1, 0], inward(px, py));
          } else if (seg.splice) {
            row = tagRow(member, { ...bar, Rebar_Type: 'straight', 'Length of Bar': r1(seg.splice.c - seg.bottom) });
          } else if (step) {
            const st = step.bars[i];
            if (st.kind === 'terminate') {
              row = tagRow(member, {
                ...bar,
                Rebar_Type: 'bent',
                'Length of Bar': r1(st.zL - seg.bottom),
                H: r1(st.lap),
                bent_up_down: 'up',
                hook_start: 'no',
              });
              row.plan_rotation = bendOutward(row, st.outward);
            } else {
              row = tagRow(member, {
                ...bar,
                Rebar_Type: 'double_crank',
                DC_Lap_Start: r1(st.a - seg.bottom),
                DC_Lap_Mid: r1(st.jog),
                DC_Tail_Length: r1(st.c - st.b),
                Crank_step: r1(st.crank),
              });
              row.plan_rotation = planRotationToward(row, [0, 0, 0], [0, 1, 0], st.kind === 'inside' ? inward(px, py) : st.dir);
            }
          } else {
            row = tagRow(member, { ...bar, Rebar_Type: 'straight', 'Length of Bar': r1(member.lz - covT + seg.dia / 2 - seg.bottom) });
          }
          mains.push(row);
          if (step && j === nSeg - 1) stepRows.push({ row, lower: i, bent: step.bars[i].kind === 'terminate' });
        });
      }
      made += nSeg;
    } else {
      // The upper section: one bar per position, from its bottom (where its lap or bend starts at the step) up to the top cover.
      sec.positions.forEach(([x, y], j) => {
        const face = sec.faceOf[j];
        const dia = faceDias(plan.rows[sec.idx[0]])[face];
        const row = tagRow(member, {
          Bar_mark: `V${made + 1}-${j + 1}`,
          Rebar_Type: 'straight',
          Dia: dia,
          Plane: 'XZ',
          Pos_Rotation: 90,
          Pos_x: r2(member.x + x), Pos_y: r2(member.y + y), Pos_z: r2(member.z + sec.bottoms[j]),
          'Length of Bar': r1(member.lz - covT + dia / 2 - sec.bottoms[j]),
          bond_condition: plan.bond,
        });
        mains.push(row);
        stepRows.push({ row, lower: null, bent: false });
      });
      made += 1;
    }
  });
  if ([...plan.splices.long.list, ...plan.splices.short.list].some((l) => !(l.step > 0))) {
    warnings.push('A level has no crank step, so its lapped bars share a position and overlap in the lap.');
  }
  if (step) {
    const k = step.counts;
    warnings.push(`At ${plan.steps[0].name} (${Math.round(step.zSFL)} mm above the base) the bars change: ${k.inside} lap as usual, ${k.bend} bend in to the new section, and ${k.terminate} end in the slab, bent in at ${Math.round(step.zL)} mm. Each bend's leg is the bar's lap length: check the slab can hold it.`);
  }

  // Links: one stack per run of levels (its first link sits Ø/2 above the run's bottom, its last Ø/2 below the run's top). The cross-ties of
  // a run are c_link_with_hook rows: Y ties in the link layers, from the bottom bar row to the top bar row; X ties one tie diameter higher,
  // from the left column to the right column. Each end is a double hook that holds a bar (spec 5c). A run takes its section's box.
  const links = [];
  let crossings = 0;   // X ties in the storey below the step that pass through a bar bending in there
  plan.runs.forEach((run, k) => {
    const sec = sections[run.section];
    const { box, candidates, linkPts: pts, longAxis } = sec;
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
      const alongXDia = longAxis === 'x' ? run.longDia : run.shortDia;
      const alongYDia = longAxis === 'x' ? run.shortDia : run.longDia;
      const hW = (dir === 'Y' ? alongXDia : alongYDia) + dC;
      const cands = candidates[dir];
      // X ties sit one tie diameter above the layer of the link, so they never cross the Y ties in the same plane.
      const z0 = dir === 'X' ? firstZ + dC : firstZ;
      const nC = Math.floor((limit - z0) / sC) + 1;
      for (let j = 0; j < m; j++) {
        const at = cands[Math.round(((j + 1) * (cands.length + 1)) / (m + 1)) - 1];
        if (step && dir === 'X' && run.section === 0) {
          for (let layer = 0; layer < nC; layer += 1) {
            const z = z0 + layer * sC;
            if (step.bars.some((st) => st.kind === 'bend' && Math.abs(st.p[1] - at) < 0.5 && z >= st.a && z <= st.b)) crossings += 1;
          }
        }
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
  if (crossings > 0) {
    const bends = step.bars.filter((st) => st.kind === 'bend');
    warnings.push(`${crossings} cross-tie crossing${crossings === 1 ? '' : 's'} along X in the storey below ${plan.steps[0].name}: those ties pass through bars that bend in there, between ${Math.round(Math.min(...bends.map((st) => st.a)))} and ${Math.round(Math.max(...bends.map((st) => st.b)))} mm. Check those ties at the bends (spec 9, O6).`);
  }

  // A splice starts 75 mm above its level's SFL, so it sits in the storey above the slab below it. A splice that reaches up into a higher
  // slab would have no links around its bars there, so each such overlap is flagged for checking.
  const spliceList = [...plan.splices.long.list, ...plan.splices.short.list];
  for (const s of plan.slabs) {
    const hit = spliceList.find((l) => l.a < s.top && l.c > s.bottom);
    if (hit) {
      warnings.push(`The splice at ${Math.round(hit.level)} mm (${Math.round(hit.a)} to ${Math.round(hit.c)} mm) runs into the link-free slab of ${s.name} (${Math.round(s.bottom)} to ${Math.round(s.top)} mm). Check how the bars there are confined.`);
    }
  }
  // Starters: the base's bars below the base, and the top section's bars above the top (each with its own positions).
  const specFor = (end, face) => starterSpec(inp.starters, end === 'top' ? plan.topDia[face] : plan.mainDia[face], end, plan.bond);
  const baseSec = sections[0], topSec = sections[sections.length - 1];
  const baseStarters = starterRows({
    member, positions: baseSec.positions, faceOf: baseSec.faceOf, starters: { base: inp.starters.base, top: false }, specFor, cover, neighbours, mark: 'ST', warnings,
  });
  const topStarters = starterRows({
    member, positions: topSec.positions, faceOf: topSec.faceOf, starters: { base: false, top: inp.starters.top }, specFor, cover, neighbours, mark: 'ST', warnings,
  });
  return {
    groups: [
      { name: `${member.name} mains`, rows: mains },
      { name: `${member.name} links`, rows: links },
      { name: `${member.name} starters`, rows: [...baseStarters, ...topStarters] },
    ],
    clash: stepClash(stepRows),
  };
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
    bond_condition: inp.bond || 'good',
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

  const specFor = (end) => starterSpec(inp.starters, dM, end, inp.bond || 'good');
  const faceOf = positions.map(() => 'long');
  const starters = starterRows({ member, positions, faceOf, starters: inp.starters, specFor, cover, neighbours, mark: 'ST', warnings });
  return [
    { name: `${member.name} mains`, rows: mains },
    { name: `${member.name} distribution`, rows: distribution },
    { name: `${member.name} links`, rows: link },
    { name: `${member.name} starters`, rows: starters },
  ];
}

// The world points of a bar: its local polyline (genBarPoints) placed by Pos and turned by its rotation.
function polylineOf(row) {
  return genBarPoints(row).points.map((p) => {
    const t = transformBarLocalPoint(row, p);
    return [row.Pos_x + t[0], row.Pos_y + t[1], row.Pos_z + t[2]];
  });
}

// The shortest distance between two 3D segments, p1–q1 and p2–q2 (the closest-points method).
function segmentDistance(p1, q1, p2, q2) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  const EPS = 1e-9;
  let s = 0, t = 0;
  if (a <= EPS && e <= EPS) {
    // both segments are points
  } else if (a <= EPS) {
    t = clamp(f / e);
  } else {
    const c = dot(d1, r);
    if (e <= EPS) {
      s = clamp(-c / a);
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom > EPS ? clamp((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a);
      }
    }
  }
  const c1 = [p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s];
  const c2 = [p2[0] + d2[0] * t, p2[1] + d2[1] * t, p2[2] + d2[2] * t];
  return Math.hypot(c1[0] - c2[0], c1[1] - c2[1], c1[2] - c2[2]);
}

// Spec 5f, R7: a bar that ends in a size step's slab keeps one bar diameter clear of every other bar at the step, counting the larger of the
// two bars. `stepRows` lists the bars at the step, each as { row, lower, bent }: `lower` is the lower bar it belongs to (null for an upper
// bar) and `bent` says whether it ends in the slab. A lower bar is not checked against its own partner. Returns the first clash as
// { a, b, gap, need }, or null.
export function stepClash(stepRows) {
  const sets = stepRows.map((s) => ({ ...s, pts: polylineOf(s.row) }));
  for (const A of sets.filter((s) => s.bent)) {
    for (const B of sets) {
      if (B === A) continue;
      if (A.lower !== null && B.lower === A.lower) continue;
      const need = (A.row.Dia + B.row.Dia) / 2 + Math.max(A.row.Dia, B.row.Dia);
      let gap = Infinity;
      for (let p = 0; p < A.pts.length - 1; p++) {
        for (let q = 0; q < B.pts.length - 1; q++) {
          gap = Math.min(gap, segmentDistance(A.pts[p], A.pts[p + 1], B.pts[q], B.pts[q + 1]));
        }
      }
      if (gap < need - 1e-6) return { a: A.row.Bar_mark, b: B.row.Bar_mark, gap: r1(gap), need };
    }
  }
  return null;
}

// The card's rows for one member: { ok: true, groups: [{ name, rows }], warnings, splices, steps } or { ok: false, msg }. Empty groups are
// dropped. Rows carry no Rebar_tag or setId: the store numbers them and names their set when they are added (one undo step).
export function memberGroups(member, inp, { neighbours = [] } = {}) {
  const msg = cardInputError(member, inp);
  if (msg) return { ok: false, msg };
  const cover = num(inp.cover);
  const covB = Number(member.covB ?? cover), covT = Number(member.covT ?? cover);
  const intH = member.lz - covB - covT;
  const warnings = [];
  const plan = inp.kind === 'Wall' ? null : columnPlan(member, inp, cover, covB, covT);
  const built = inp.kind === 'Wall'
    ? { groups: wallGroups(member, inp, cover, covB, intH, neighbours, warnings), clash: null }
    : columnGroups(member, inp, cover, covB, covT, plan, neighbours, warnings);
  if (built.clash) {
    return {
      ok: false,
      msg: `The bars that end in the slab at ${plan.steps[0].name} clash: ${built.clash.a} and ${built.clash.b} are ${built.clash.gap} mm apart, and need ${built.clash.need} mm.`,
    };
  }
  const kept = built.groups.filter((g) => g.rows.length);
  const long = kept.flatMap((g) => g.rows).filter((r) => barMainLength(r) > STOCK_MM).length;
  if (long) warnings.push(`${long} bar${long === 1 ? '' : 's'} longer than ${STOCK_MM / 1000} m: a splice is not modelled.`);
  // The splices (per face, bottom level first, each with its level's height) and the size step let the card show where each lap and step sits.
  return {
    ok: true,
    groups: kept,
    warnings,
    splices: plan ? plan.splices : null,
    steps: plan ? plan.steps : [],
  };
}
