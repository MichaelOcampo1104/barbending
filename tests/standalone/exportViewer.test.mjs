import test from 'node:test';
import assert from 'node:assert/strict';
import { loadViewerTemplate, MISSING_TEMPLATE } from '../../src/standalone/exportViewer.js';
import { TOKEN_TITLE, TOKEN_DATA } from '../../src/standalone/pack.js';

const TEMPLATE = `<title>${TOKEN_TITLE}</title><script id="model-data" type="text/plain">${TOKEN_DATA}</script>`;
const url = '/viewer-template.html';

test('the message is the one the spec gives', () => {
  assert.equal(MISSING_TEMPLATE, 'The viewer template is missing: run "npm run build:viewer", then reload.');
});

test('a served template is returned as it is', async () => {
  const seen = [];
  const fetchFn = async (u, opts) => { seen.push([u, opts]); return new Response(TEMPLATE); };
  assert.equal(await loadViewerTemplate({ url, fetchFn }), TEMPLATE);
  assert.equal(seen[0][0], url);
  assert.equal(seen[0][1].cache, 'no-cache', 'a rebuilt template is picked up without clearing the cache');
});

test('a 404, a failed request, and an index.html answered with status 200 all mean "template missing"', async () => {
  const answers = [
    async () => new Response('not found', { status: 404 }),
    async () => { throw new TypeError('Failed to fetch'); },
    async () => new Response('<!doctype html><html><body><div id="root"></div></body></html>', { status: 200 }), // a dev server's fallback
    async () => new Response(`<title>${TOKEN_TITLE}</title>`, { status: 200 }), // only one of the two tokens
  ];
  for (const fetchFn of answers) {
    await assert.rejects(loadViewerTemplate({ url, fetchFn }), (err) => err.message === MISSING_TEMPLATE);
  }
});