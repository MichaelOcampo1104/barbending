import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createQualityController, QUALITY_LEVELS, SLOW_FRAMES, FAST_HOLD_MS, RESTORE_MS,
} from '../../src/viewer/barfield/quality.js';

test('levels match the spec', () => {
  assert.deepEqual(QUALITY_LEVELS.map((l) => [l.dpr, l.budgetTris]), [[1.75, 5e6], [1.25, 3e6], [1.0, 1.5e6], [1.0, 0.5e6]]);
});

test('starts at full quality', () => {
  const c = createQualityController();
  assert.equal(c.level, 0);
  const r = c.update(16, false, 0);
  assert.equal(r.level, 0);
  assert.equal(r.changed, false);
});

test('slow frames while interacting step down after SLOW_FRAMES slow frames, not before', () => {
  const c = createQualityController();
  let steppedAt = -1;
  for (let i = 1; i <= 40; i++) {
    const r = c.update(100, true, i * 100);
    if (r.changed) { steppedAt = i; assert.equal(r.level, 1); break; }
  }
  assert.ok(steppedAt >= SLOW_FRAMES && steppedAt <= SLOW_FRAMES + 3, `stepped down at frame ${steppedAt}`);
});

test('keeps stepping down while slow, capped at the last level', () => {
  const c = createQualityController();
  let level = 0;
  for (let i = 1; i <= 400; i++) level = c.update(100, true, i * 100).level;
  assert.equal(level, QUALITY_LEVELS.length - 1);
});

test('slow frames while NOT interacting never step down', () => {
  const c = createQualityController();
  for (let i = 1; i <= 100; i++) assert.equal(c.update(100, false, i * 100).level, 0);
});

test('one frame spike is smoothed away (no step down)', () => {
  const c = createQualityController();
  for (let i = 1; i <= 30; i++) c.update(16, true, i * 16);
  assert.equal(c.update(120, true, 600).level, 0);
  for (let i = 1; i <= 30; i++) assert.equal(c.update(16, true, 600 + i * 16).level, 0);
});

test('fast frames for FAST_HOLD_MS while interacting step back up one level', () => {
  const c = createQualityController();
  let t = 0;
  while (c.level < 2) { t += 100; c.update(100, true, t); }
  const down = c.level;
  let up = null;
  const start = t;
  while (t - start < FAST_HOLD_MS + 4000 && up === null) {
    t += 16;
    const r = c.update(12, true, t);
    if (r.changed) up = r.level;
  }
  assert.equal(up, down - 1);
});

test('full quality is restored RESTORE_MS after interaction ends', () => {
  const c = createQualityController();
  let t = 0;
  while (c.level < 1) { t += 100; c.update(100, true, t); }
  const lastInteract = t;
  let r = c.update(16, false, lastInteract + RESTORE_MS - 10);
  assert.equal(r.level, 1, 'not yet');
  r = c.update(16, false, lastInteract + RESTORE_MS + 10);
  assert.equal(r.level, 0);
  assert.equal(r.changed, true);
  assert.equal(r.budgetTris, 5e6);
});
