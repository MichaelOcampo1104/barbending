// Shared fixtures for the barfield tests.
import { defaultBar } from '../../src/bbs/shapes.js';

// A 3 m straight bar in plan (XY), start (1000, 2000, 500) mm, bar runs along +X.
export function straightRow(over = {}) {
  return {
    ...defaultBar('straight', 1), Plane: 'XY', Dia: 16, 'Length of Bar': 3000,
    Pos_x: 1000, Pos_y: 2000, Pos_z: 500, Pos_Rotation: 0,
    qty_x: 1, spacing_x: 150, qty_y: 1, spacing_y: 150, ...over,
  };
}

// A two-leg section profile (1000 mm along +X, then 500 mm up) in the XZ plane.
export function profileRow(over = {}) {
  return {
    ...defaultBar('profile', 2), Plane: 'XZ', Dia: 20,
    legs: JSON.stringify([[1000, 0], [500, 90]]),
    Pos_x: 0, Pos_y: 0, Pos_z: 0, qty_x: 1, spacing_x: 0, qty_y: 1, spacing_y: 150, ...over,
  };
}

// Deterministic pseudo-random generator (mulberry32) so spread tests are repeatable.
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// n straight rows spread over a 100 x 50 x 20 m box, each with `copies` copies.
export function spreadRows(n, copies, seed = 1) {
  const r = rng(seed);
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push(straightRow({
      Rebar_tag: i + 1, Bar_mark: `B${i + 1}`, Dia: [10, 12, 16, 20, 25][i % 5],
      Pos_x: Math.round(r() * 100000), Pos_y: Math.round(r() * 50000), Pos_z: Math.round(r() * 20000),
      'Length of Bar': 2000 + Math.round(r() * 6000), Pos_Rotation: r() < 0.5 ? 0 : 90, qty_y: copies,
    }));
  }
  return rows;
}
