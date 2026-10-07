import test from 'node:test';
import assert from 'node:assert/strict';
import { forcedOverlayRows } from '../../src/viewer/barfield/overlayRows.js';
import { SELECTION_OVERLAY_LIMIT } from '../../src/viewer/barfield/rowState.js';

const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);

test('edited rows waiting for their flush become overlay rows', () => {
  const out = forcedOverlayRows({ pending: new Set([3, 7]), builtRowCount: 100, barCount: 100 });
  assert.deepEqual([...out].sort((a, b) => a - b), [3, 7]);
});

test('more pending rows than the overlay limit are not overlaid (the caller flushes at once)', () => {
  const pending = new Set(range(0, SELECTION_OVERLAY_LIMIT + 1));
  assert.equal(forcedOverlayRows({ pending, builtRowCount: 5000, barCount: 5000 }).size, 0);
  const atLimit = new Set(range(0, SELECTION_OVERLAY_LIMIT));
  assert.equal(forcedOverlayRows({ pending: atLimit, builtRowCount: 5000, barCount: 5000 }).size, SELECTION_OVERLAY_LIMIT);
});

test('a few rows added since the build are overlaid at once', () => {
  const out = forcedOverlayRows({ pending: new Set(), builtRowCount: 100, barCount: 103 });
  assert.deepEqual([...out].sort((a, b) => a - b), [100, 101, 102]);
});

test('thousands of rows added since the build (an import) are not overlaid', () => {
  assert.equal(forcedOverlayRows({ pending: new Set(), builtRowCount: 1, barCount: 25000 }).size, 0);
  assert.equal(forcedOverlayRows({ pending: new Set(), builtRowCount: 100, barCount: 100 + SELECTION_OVERLAY_LIMIT + 1 }).size, 0);
  assert.equal(forcedOverlayRows({ pending: new Set(), builtRowCount: 100, barCount: 100 + SELECTION_OVERLAY_LIMIT }).size, SELECTION_OVERLAY_LIMIT);
});

test('fewer rows than the build (deleted bars) add nothing', () => {
  assert.equal(forcedOverlayRows({ pending: new Set(), builtRowCount: 100, barCount: 90 }).size, 0);
});

test('pending and added rows combine, each group judged on its own', () => {
  const out = forcedOverlayRows({ pending: new Set([1]), builtRowCount: 10, barCount: 12 });
  assert.deepEqual([...out].sort((a, b) => a - b), [1, 10, 11]);
  const flood = forcedOverlayRows({ pending: new Set(range(0, 400)), builtRowCount: 5000, barCount: 5002 });
  assert.deepEqual([...flood].sort((a, b) => a - b), [5000, 5001], 'pending flood dropped, the 2 added rows kept');
});
