import test from 'node:test';
import assert from 'node:assert/strict';
import { useStore } from '../../src/store.js';

test('barDetail defaults to auto and accepts lines / tubes / auto only', () => {
  assert.equal(useStore.getState().barDetail, 'auto');
  useStore.getState().setBarDetail('lines');
  assert.equal(useStore.getState().barDetail, 'lines');
  useStore.getState().setBarDetail('tubes');
  assert.equal(useStore.getState().barDetail, 'tubes');
  useStore.getState().setBarDetail('bogus');
  assert.equal(useStore.getState().barDetail, 'auto');
});
