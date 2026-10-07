import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATE, ROW_TEX_WIDTH, SELECTION_OVERLAY_LIMIT, OVERLAY_COPY_BUDGET, rowTexDims, createRowTexelData,
  writeRowAttributes, writeRowState, computeHiddenMask, composeRowStates,
} from '../../src/viewer/barfield/rowState.js';
import { straightRow } from './helpers.mjs';

test('texture dims: 2048 wide, one texel per row, at least one row of texels', () => {
  assert.deepEqual(rowTexDims(0), { width: ROW_TEX_WIDTH, height: 1 });
  assert.deepEqual(rowTexDims(1), { width: 2048, height: 1 });
  assert.deepEqual(rowTexDims(2048), { width: 2048, height: 1 });
  assert.deepEqual(rowTexDims(2049), { width: 2048, height: 2 });
  assert.equal(createRowTexelData(2049).length, 2048 * 2 * 4);
});

test('texel packing: R state, G colour slot, B radius, A one', () => {
  const d = createRowTexelData(10);
  writeRowAttributes(d, 3, 5, 0.012);
  writeRowState(d, 3, STATE.TINT);
  assert.equal(d[3 * 4], STATE.TINT);
  assert.equal(d[3 * 4 + 1], 5);
  assert.ok(Math.abs(d[3 * 4 + 2] - 0.012) < 1e-6);
  assert.equal(d[3 * 4 + 3], 1);
  assert.equal(d[2 * 4], 0, 'untouched rows stay NORMAL');
});

test('hidden mask: bar.hidden, hidden host, and bars inside a hidden member', () => {
  const concretes = [
    { id: 'c1', visible: false, x: 0, y: 0, z: 0, lx: 1000, ly: 1000, lz: 1000 },
    { id: 'c2', visible: false, x: 50000, y: 50000, z: 0, lx: 100, ly: 100, lz: 100 },
    { id: 'c3', visible: true, x: 0, y: 0, z: 0, lx: 100000, ly: 100000, lz: 100000 },
  ];
  const bars = [
    straightRow({ Pos_x: 100, Pos_y: 100, Pos_z: 100 }),            // inside hidden member c1
    straightRow({ Pos_x: 90000, hidden: true }),                    // hidden itself
    straightRow({ Pos_x: 90000, host: 'c2' }),                      // host c2 is hidden
    straightRow({ Pos_x: 90000, Pos_y: 90000, Pos_z: 90000 }),      // visible
    straightRow({ Pos_x: 90000, Pos_y: 90000, host: 'c3' }),        // host visible
  ];
  assert.deepEqual([...computeHiddenMask({ bars, concretes })], [1, 1, 1, 0, 0]);
});

test('no hidden members and no hidden bars: nothing is hidden', () => {
  const bars = [straightRow(), straightRow({ Pos_x: 9000 })];
  assert.deepEqual([...computeHiddenMask({ bars, concretes: [] })], [0, 0]);
});

test('selection up to the limit becomes overlay; hidden wins over selection', () => {
  const hiddenMask = Uint8Array.from([0, 0, 1, 0]);
  const { states, overlay } = composeRowStates({ hiddenMask, selectedBars: [1, 2] });
  assert.deepEqual([...states], [STATE.NORMAL, STATE.OVERLAY, STATE.HIDDEN, STATE.NORMAL]);
  assert.deepEqual(overlay, [1]);
});

test('more than the limit selected rows are tinted in place, not overlaid', () => {
  const n = SELECTION_OVERLAY_LIMIT + 5;
  const hiddenMask = new Uint8Array(n);
  const selectedBars = Array.from({ length: n }, (_, i) => i);
  const { states, overlay } = composeRowStates({ hiddenMask, selectedBars });
  assert.equal(overlay.length, 0);
  assert.ok(states.every((s) => s === STATE.TINT));
  const small = composeRowStates({ hiddenMask, selectedBars: selectedBars.slice(0, SELECTION_OVERLAY_LIMIT) });
  assert.equal(small.overlay.length, SELECTION_OVERLAY_LIMIT, 'exactly the limit still overlays');
});

test('a selection within the copy budget overlays, a heavier one is tinted in place', () => {
  const hiddenMask = new Uint8Array(10);
  const weightOf = () => 40; // 40 bar copies per row
  const light = composeRowStates({ hiddenMask, selectedBars: [0, 1, 2], weightOf }); // 120 copies
  assert.deepEqual(light.overlay, [0, 1, 2]);
  assert.equal(light.states[0], STATE.OVERLAY);
  const heavy = composeRowStates({ hiddenMask, selectedBars: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], weightOf }); // 400 copies: still fits
  assert.equal(heavy.overlay.length, 10);
  assert.ok(OVERLAY_COPY_BUDGET >= 400);
  const over = composeRowStates({ hiddenMask, selectedBars: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], weightOf: () => 41 }); // 410 copies
  assert.equal(over.overlay.length, 0);
  assert.ok(over.states.every((s) => s === STATE.TINT));
});

test('one very heavy row is tinted instead of mounting thousands of meshes', () => {
  const { states, overlay } = composeRowStates({ hiddenMask: new Uint8Array(3), selectedBars: [1], weightOf: () => 4900 });
  assert.deepEqual(overlay, []);
  assert.deepEqual([...states], [STATE.NORMAL, STATE.TINT, STATE.NORMAL]);
});

test('hidden selected rows do not count towards the copy budget', () => {
  const hiddenMask = Uint8Array.from([1, 0, 0]);
  const { overlay } = composeRowStates({ hiddenMask, selectedBars: [0, 1], weightOf: (i) => (i === 0 ? 100000 : 5) });
  assert.deepEqual(overlay, [1]);
});

test('forceOverlay rows become overlay even when not selected', () => {
  const { states, overlay } = composeRowStates({ hiddenMask: new Uint8Array(4), selectedBars: [0], forceOverlay: new Set([3]) });
  assert.deepEqual([...states], [STATE.OVERLAY, STATE.NORMAL, STATE.NORMAL, STATE.OVERLAY]);
  assert.deepEqual(overlay, [0, 3]);
});

test('selected indices beyond the row count are ignored', () => {
  const { states, overlay } = composeRowStates({ hiddenMask: new Uint8Array(2), selectedBars: [7] });
  assert.deepEqual([...states], [0, 0]);
  assert.deepEqual(overlay, []);
});
