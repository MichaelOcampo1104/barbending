import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVolumeInput, readVolumeInputs } from '../../src/bbs/volumeOverride.js';

test('a blank box keeps the computed volume', () => {
  assert.deepEqual(parseVolumeInput(''), { ok: true, value: null });
  assert.deepEqual(parseVolumeInput('   '), { ok: true, value: null });
  assert.deepEqual(parseVolumeInput(undefined), { ok: true, value: null });
});

test('a number typed with a dot or a comma is a volume in m³', () => {
  assert.deepEqual(parseVolumeInput('12.5'), { ok: true, value: 12.5 });
  assert.deepEqual(parseVolumeInput('12,5'), { ok: true, value: 12.5 });
  assert.deepEqual(parseVolumeInput(' 7 '), { ok: true, value: 7 });
  assert.deepEqual(parseVolumeInput('.5'), { ok: true, value: 0.5 });
});

test('zero, a negative, text and a thousands-style number are refused, each with a reason', () => {
  for (const bad of ['0', '0.0', '-1', 'abc', '1e3', '12 m3', '12.', '1,234.5']) {
    const r = parseVolumeInput(bad);
    assert.equal(r.ok, false, `"${bad}" is refused`);
    assert.equal(typeof r.msg, 'string', `"${bad}" says why`);
  }
});

test('the panel reads its boxes: the valid typed values are used and each refused box gives its reason', () => {
  const r = readVolumeInputs(['c1', 'c2', 'c3'], { c1: '5', c2: 'x', c3: '' });
  assert.equal(r.ok, false);
  assert.deepEqual([...r.volumesM3], [['c1', 5]]);
  assert.deepEqual(Object.keys(r.errors), ['c2']);
});

test('only the members listed are read', () => {
  const r = readVolumeInputs(['c1'], { c1: '2', c9: 'x' });
  assert.equal(r.ok, true);
  assert.deepEqual([...r.volumesM3], [['c1', 2]]);
});

test('all boxes blank: nothing is typed and the export can go ahead', () => {
  const r = readVolumeInputs(['c1', 'c2'], {});
  assert.equal(r.ok, true);
  assert.equal(r.volumesM3.size, 0);
});
