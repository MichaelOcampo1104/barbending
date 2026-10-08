import test from 'node:test';
import assert from 'node:assert/strict';
import { useStore } from '../../src/store.js';

const st = () => useStore.getState();

test('no selection tool is armed to begin with', () => {
  assert.equal(st().selectTool, null);
});

test('Box and Lasso arm one at a time, and anything else disarms', () => {
  st().setSelectTool('box');
  assert.equal(st().selectTool, 'box');
  st().setSelectTool('lasso');
  assert.equal(st().selectTool, 'lasso', 'picking the other shape switches to it');
  st().setSelectTool('banana');
  assert.equal(st().selectTool, null, 'an unknown tool is off');
  st().setSelectTool('box');
  st().setSelectTool(null);
  assert.equal(st().selectTool, null);
});

test('toggling the armed tool turns it off, toggling the other one switches', () => {
  st().setSelectTool(null);
  st().toggleSelectTool('lasso');
  assert.equal(st().selectTool, 'lasso');
  st().toggleSelectTool('lasso');
  assert.equal(st().selectTool, null, 'the same button again disarms');
  st().toggleSelectTool('box');
  st().toggleSelectTool('lasso');
  assert.equal(st().selectTool, 'lasso', 'the other button switches the shape');
  st().toggleSelectTool('nonsense');
  assert.equal(st().selectTool, null);
});

test('arming a tool does not touch the selection', () => {
  st().setBars([]);
  st().setSelectedBars([]);
  const before = st().selectedBars;
  st().setSelectTool('box');
  st().setSelectTool(null);
  assert.equal(st().selectedBars, before);
});
