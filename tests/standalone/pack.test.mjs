import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VIEWER_FORMAT, TOKEN_TITLE, TOKEN_DATA, DEFAULT_VIEWER_TITLE, countOf, cleanViewerTitle, viewerFileName,
  packViewerHtml, extractProjectFromHtml, parseProjectFile,
} from '../../src/standalone/pack.js';
import { gzipBytes, toBase64 } from '../../src/standalone/codec.js';
import { straightRow, spreadRows } from '../barfield/helpers.mjs';

const TEMPLATE = `<!doctype html><html><head><title>${TOKEN_TITLE}</title></head><body>`
  + `<script id="model-data" type="text/plain">${TOKEN_DATA}</script><script>var viewer = 1;</script></body></html>`;

const plain = (x) => JSON.parse(JSON.stringify(x));
const project = (over = {}) => ({
  v: 1, app: 'barbending', savedAt: 1760000000000,
  bars: [straightRow({ Rebar_tag: 1, Bar_mark: 'T1' })],
  concretes: [{ id: 'c1', name: 'Beam', lx: 3500, ly: 400, lz: 600, x: 0, y: 0, z: 0 }],
  refLines: [{ id: 'ref_1', p1: [0, 0, 0], p2: [1000, 0, 0] }],
  cover: 40, bond: 'poor', selectedBar: 0, selectedBars: [0], ...over,
});
const wrap = (b64) => `<script id="model-data" type="text/plain">${b64}</script>`;
const zipped = async (obj) => toBase64(await gzipBytes(new TextEncoder().encode(JSON.stringify(obj))));

test('pack then extract returns the project with the viewer fields added', async () => {
  const p = project();
  const html = await packViewerHtml(TEMPLATE, p, { title: 'My model' });
  assert.deepEqual(await extractProjectFromHtml(html), plain({ ...p, viewerFormat: VIEWER_FORMAT, title: 'My model' }));
  assert.equal(countOf(html, TOKEN_TITLE), 0);
  assert.equal(countOf(html, TOKEN_DATA), 0);
});

test('a title with Unicode, HTML characters and replacement patterns is escaped in <title> and kept in the data', async () => {
  const title = 'Torre 塔 ñ <b>&"x" $& $1';
  const html = await packViewerHtml(TEMPLATE, project(), { title });
  assert.ok(html.includes('<title>Torre 塔 ñ &lt;b&gt;&amp;&quot;x&quot; $&amp; $1</title>'));
  assert.equal((await extractProjectFromHtml(html)).title, title);
});

test('"</script>" in a title or a bar mark cannot end the page early', async () => {
  const mark = '</script><script>alert(1)</script>';
  const html = await packViewerHtml(TEMPLATE, project({ bars: [straightRow({ Bar_mark: mark })] }), { title: '</script><img src=x>' });
  assert.equal(countOf(html, '</script'), countOf(TEMPLATE, '</script'));
  assert.equal(countOf(html, '<script'), countOf(TEMPLATE, '<script'));
  assert.equal((await extractProjectFromHtml(html)).bars[0].Bar_mark, mark);
});

test('a template without a token, or with one twice, is refused', async () => {
  await assert.rejects(packViewerHtml('<html></html>', project()), /@@BARBENDING_TITLE@@ exactly once \(found 0\)/);
  await assert.rejects(packViewerHtml(TEMPLATE + TOKEN_DATA, project()), /@@BARBENDING_DATA@@ exactly once \(found 2\)/);
});

test('a 25,000-row project round-trips and stays small', async () => {
  const rows = spreadRows(25000, 40);
  const html = await packViewerHtml(TEMPLATE, project({ bars: rows }), { title: 'big' });
  const out = await extractProjectFromHtml(html);
  assert.equal(out.bars.length, 25000);
  assert.deepEqual(out.bars[24999], plain(rows[24999]));
  assert.ok(html.length < 3_000_000, `file is ${html.length} bytes`);
});

test('files that are not barbending viewer files are refused with a plain message', async () => {
  const bad = /not a barbending viewer file/;
  await assert.rejects(extractProjectFromHtml('<html><body>hello</body></html>'), bad); // no data element
  await assert.rejects(extractProjectFromHtml(wrap('%%%%')), bad); // not base64
  await assert.rejects(extractProjectFromHtml(wrap(Buffer.from('plain text').toString('base64'))), bad); // not gzip
  await assert.rejects(extractProjectFromHtml(wrap(await zipped({ bars: [] }))), bad); // gzip of something else
});

test('a file made by a newer viewer is refused', async () => {
  await assert.rejects(
    extractProjectFromHtml(wrap(await zipped({ viewerFormat: VIEWER_FORMAT + 1, bars: [] }))),
    /made by a newer barbending viewer/,
  );
});

test('parseProjectFile reads .json as JSON and .html (or text starting with <) as a viewer file', async () => {
  const p = project();
  assert.deepEqual(await parseProjectFile('a.json', JSON.stringify(p)), plain(p));
  const html = await packViewerHtml(TEMPLATE, p, { title: 't' });
  assert.equal((await parseProjectFile('a.html', html)).bars.length, 1);
  assert.equal((await parseProjectFile('renamed.txt', html)).bars.length, 1, 'recognised by its text');
  await assert.rejects(parseProjectFile('a.json', '{not json'), SyntaxError);
  await assert.rejects(parseProjectFile('a.html', '<html></html>'), /not a barbending viewer file/);
});

test('cleanViewerTitle trims, collapses spaces, limits to 80 characters and never returns an empty title', () => {
  assert.equal(cleanViewerTitle('  Tower   A \n L3  '), 'Tower A L3');
  assert.equal(cleanViewerTitle(''), DEFAULT_VIEWER_TITLE);
  assert.equal(cleanViewerTitle('   '), DEFAULT_VIEWER_TITLE);
  assert.equal(cleanViewerTitle(null), DEFAULT_VIEWER_TITLE);
  assert.equal(Array.from(cleanViewerTitle('x'.repeat(200))).length, 80);
  assert.equal(Array.from(cleanViewerTitle('😀'.repeat(100))).length, 80, 'never cuts an emoji in half');
});

test('viewerFileName: slug from the title, omitted for the default title or when nothing is left', () => {
  const when = new Date(2026, 9, 8, 14, 5);
  assert.equal(viewerFileName(DEFAULT_VIEWER_TITLE, when), 'barbending-viewer-20261008-1405.html');
  assert.equal(viewerFileName('Tower A — L3 (final)', when), 'barbending-viewer-tower-a-l3-final-20261008-1405.html');
  assert.equal(viewerFileName('塔楼', when), 'barbending-viewer-20261008-1405.html');
});