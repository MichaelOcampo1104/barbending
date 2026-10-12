import test from 'node:test';
import assert from 'node:assert/strict';
import { VIEWER_FIELDS, withoutViewerFields } from '../../src/standalone/viewerFields.js';
import { packViewerHtml, extractProjectFromHtml } from '../../src/standalone/pack.js';
import { useStore } from '../../src/store.js';

const TEMPLATE = '<!doctype html><html><head><title>@@BARBENDING_TITLE@@</title></head><body><script id="model-data" type="text/plain">@@BARBENDING_DATA@@</script></body></html>';
const PROJECT = {
  v: 1, app: 'barbending', savedAt: 1, bars: [], refLines: [], cover: 25, bond: 'good', selectedBar: 0, selectedBars: [0],
  concretes: [{ id: 'c9', name: 'Test member', lx: 1000, ly: 1000, lz: 1000, x: 0, y: 0, z: 0 }],
};

test("the viewer's own fields are the format, the title and the typed volumes", () => {
  assert.deepEqual(VIEWER_FIELDS, ['viewerFormat', 'title', 'typedVolumes']);
});

test("⤓ Project from the viewer leaves those fields out and keeps the project", () => {
  const payload = { ...PROJECT, viewerFormat: 1, title: 'T', typedVolumes: { c9: 2 } };
  assert.deepEqual(withoutViewerFields(payload), PROJECT);
});

test('typed volumes travel in the viewer file beside the project; a file without them has no such key', async () => {
  const withTyped = await extractProjectFromHtml(await packViewerHtml(TEMPLATE, { ...PROJECT, typedVolumes: { c9: 2 } }, { title: 'T' }));
  assert.deepEqual(withTyped.typedVolumes, { c9: 2 });
  assert.equal(withTyped.viewerFormat, 1);
  const plain = await extractProjectFromHtml(await packViewerHtml(TEMPLATE, PROJECT, { title: 'T' }));
  assert.equal('typedVolumes' in plain, false);
});

test('opening or inserting a viewer file leaves the typed volumes out: the app takes the project only', () => {
  const file = { ...PROJECT, viewerFormat: 1, title: 'T', typedVolumes: { c9: 2 } };
  assert.equal(useStore.getState()._applyProject(file), true);
  assert.equal('typedVolumes' in useStore.getState(), false);
  assert.deepEqual(useStore.getState().concretes.map((c) => c.id), ['c9']);
  assert.deepEqual(useStore.getState().appendProject(file), { bars: 0, concretes: 1 });
  assert.equal('typedVolumes' in useStore.getState(), false);
  assert.equal(useStore.getState().concretes.length, 2);
});
