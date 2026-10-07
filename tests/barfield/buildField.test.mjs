import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildField, buildFieldSteps, colorIndexForDia, radiusMForDia, DIA_PALETTE, DEFAULT_COLOR_IDX,
} from '../../src/viewer/barfield/buildField.js';
import { straightRow, profileRow, spreadRows } from './helpers.mjs';

const near = (a, b, eps = 1e-5) => Math.abs(a - b) <= eps;
const assertNear = (actual, expected, label) => {
  assert.equal(actual.length, expected.length, `${label}: length`);
  for (let i = 0; i < expected.length; i++) assert.ok(near(actual[i], expected[i]), `${label}[${i}] ${actual[i]} vs ${expected[i]}`);
};

test('palette: known diameters map to their slot, others to the default', () => {
  assert.deepEqual([...DIA_PALETTE], [10, 12, 16, 20, 25, 32, 40]);
  assert.equal(colorIndexForDia(16), 2);
  assert.equal(colorIndexForDia(40), 6);
  assert.equal(colorIndexForDia(13), DEFAULT_COLOR_IDX);
  assert.equal(colorIndexForDia(undefined), DEFAULT_COLOR_IDX);
});

test('radius: dia/2 in metres with an 8 mm floor, like RebarMesh', () => {
  assert.equal(radiusMForDia(10), 0.008);
  assert.equal(radiusMForDia(16), 0.008);
  assert.equal(radiusMForDia(32), 0.016);
  assert.equal(radiusMForDia(undefined), 0.008);
});

test('one straight bar becomes one segment in scene space (x, z, -y) / 1000', () => {
  const f = buildField([straightRow()]);
  assert.equal(f.rowCount, 1);
  assert.equal(f.segCount, 1);
  assert.equal(f.skippedRows, 0);
  assertNear(f.seg, [1, 0.5, -2, 4, 0.5, -2], 'seg');
  assert.deepEqual([...f.rowOfVtx], [0, 0]);
  assert.equal(f.chunks.length, 1);
  assert.equal(f.chunks[0].start, 0);
  assert.equal(f.chunks[0].count, 1);
});

test('distribution copies become separate segments', () => {
  const f = buildField([straightRow({ qty_y: 3, spacing_y: 150 })]);
  assert.equal(f.segCount, 3);
  const zs = [];
  for (let i = 0; i < 3; i++) zs.push(f.seg[i * 6 + 2]);
  zs.sort((a, b) => a - b);
  assertNear(zs, [-2.3, -2.15, -2.0], 'z of copies');
});

test('a 3-point profile with 2 copies yields 4 segments and per-row ids', () => {
  const f = buildField([straightRow(), profileRow({ qty_y: 2 })]);
  assert.equal(f.segCount, 1 + 4);
  const perRow = [0, 0];
  for (let i = 0; i < f.segCount; i++) perRow[f.rowOfVtx[2 * i]] += 1;
  assert.deepEqual(perRow, [1, 4]);
  for (let i = 0; i < f.segCount; i++) assert.equal(f.rowOfVtx[2 * i], f.rowOfVtx[2 * i + 1]);
  assert.deepEqual([...f.rows.colorIdx], [2, 3]);
  assertNear(f.rows.radiusM, [0.008, 0.01], 'radiusM');
});

test('rows with non-finite geometry are skipped and counted', () => {
  const f = buildField([straightRow(), straightRow({ 'Length of Bar': Infinity }), straightRow({ Pos_x: 5000 })]);
  assert.equal(f.rowCount, 3);
  assert.equal(f.skippedRows, 1);
  assert.equal(f.segCount, 2);
  const ids = new Set();
  for (let i = 0; i < f.segCount; i++) ids.add(f.rowOfVtx[2 * i]);
  assert.deepEqual([...ids].sort(), [0, 2]);
});

test('chunks and pick blocks partition the segments and bound them', () => {
  const rows = spreadRows(300, 50, 7); // 15,000 segments
  const f = buildField(rows, { maxSegmentsPerChunk: 1000, blockSegments: 64 });
  assert.equal(f.segCount, 15000);
  assert.ok(f.chunks.length > 4, `expected several chunks, got ${f.chunks.length}`);
  let expectStart = 0;
  for (const ch of f.chunks) {
    assert.equal(ch.start, expectStart, 'chunks are contiguous');
    expectStart += ch.count;
    for (let i = ch.start; i < ch.start + ch.count; i++) {
      for (let k = 0; k < 6; k++) {
        const axis = k % 3;
        const v = f.seg[i * 6 + k];
        assert.ok(v >= ch.min[axis] - 1e-4 && v <= ch.max[axis] + 1e-4, 'endpoint inside its chunk box');
      }
    }
  }
  assert.equal(expectStart, f.segCount, 'chunks cover every segment');
  let blockTotal = 0;
  for (const ch of f.chunks) {
    let p = ch.start;
    for (let b = ch.blockStart; b < ch.blockStart + ch.blockCount; b++) {
      assert.equal(f.blocks.start[b], p, 'blocks are contiguous inside their chunk');
      assert.ok(f.blocks.size[b] <= 64, `block of ${f.blocks.size[b]} segments exceeds 64`);
      for (let i = p; i < p + f.blocks.size[b]; i++) {
        for (let k = 0; k < 6; k++) {
          const axis = k % 3;
          const v = f.seg[i * 6 + k];
          assert.ok(v >= f.blocks.bounds[b * 6 + axis] - 1e-4 && v <= f.blocks.bounds[b * 6 + 3 + axis] + 1e-4, 'endpoint inside its block box');
        }
      }
      p += f.blocks.size[b];
      blockTotal += 1;
    }
    assert.equal(p, ch.start + ch.count, 'blocks cover their chunk');
  }
  assert.equal(blockTotal, f.blocks.start.length);
  for (const ch of f.chunks) assert.ok(ch.maxRadiusM >= 0.008);
});

test('rowIds maps local rows to the ids written in rowOfVtx (delta builds)', () => {
  const f = buildField([straightRow(), straightRow({ Pos_x: 9000 })], { rowIds: [40, 77] });
  const ids = new Set();
  for (let i = 0; i < f.segCount; i++) ids.add(f.rowOfVtx[2 * i]);
  assert.deepEqual([...ids].sort((a, b) => a - b), [40, 77]);
});

test('buildFieldSteps reports monotonic progress and matches buildField', () => {
  const rows = spreadRows(1200, 3, 3);
  const it = buildFieldSteps(rows, { rowsPerYield: 100 });
  let r = it.next();
  const fractions = [];
  while (!r.done) { fractions.push(r.value.fraction); r = it.next(); }
  assert.ok(fractions.length > 5, 'several progress reports');
  for (let i = 1; i < fractions.length; i++) assert.ok(fractions[i] >= fractions[i - 1], 'monotonic');
  assert.ok(fractions[0] >= 0 && fractions[fractions.length - 1] <= 1);
  const g = buildField(rows, { rowsPerYield: 100 });
  assert.equal(r.value.segCount, g.segCount);
  assert.equal(r.value.chunks.length, g.chunks.length);
});

test('an empty row list builds an empty field', () => {
  const f = buildField([]);
  assert.equal(f.segCount, 0);
  assert.equal(f.chunks.length, 0);
  assert.equal(f.blocks.start.length, 0);
  assert.deepEqual(f.bounds, { min: [0, 0, 0], max: [0, 0, 0] });
});
