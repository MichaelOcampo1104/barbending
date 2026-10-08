// Builds the standalone viewer template: public/viewer-template.html (git-ignored; copied to dist/ by `vite build`).
// usage: node scripts/build-viewer.mjs        (npm run build:viewer; `predev` and `prebuild` run it)
// src/standalone/viewer.js (with three.js and the app's own pure modules) is bundled to one IIFE with Vite's library mode and written
// inline into src/standalone/template.html. What is left to fill in at export time are the two tokens the app replaces: the title and
// the data (see src/standalone/pack.js). A failing build exits 1, which aborts `npm run dev` / `npm run build`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { TOKEN_TITLE, TOKEN_DATA, TOKEN_SCRIPT, TOKEN_BUILD, countOf } from '../src/standalone/pack.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const fail = (msg) => { console.error(`build-viewer: ${msg}`); process.exit(1); };
const MAX_SCRIPT_BYTES = 800 * 1024; // the spec's budget for the minified viewer script

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'barbending-viewer-'));
try {
  await build({
    configFile: false,
    root,
    logLevel: 'warn',
    build: {
      lib: { entry: path.join(root, 'src', 'standalone', 'viewer.js'), formats: ['iife'], name: 'BarbendingViewer', fileName: () => 'viewer.js' },
      outDir: tmp,
      emptyOutDir: true,
      copyPublicDir: false,
      minify: true,
      target: 'es2020',
      sourcemap: false,
    },
  });
  // Nothing in the inline script may end it early: "</script" and the comment opener "<!--" are escaped (both are valid inside JS strings).
  const js = fs.readFileSync(path.join(tmp, 'viewer.js'), 'utf8').replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  if (Buffer.byteLength(js) > MAX_SCRIPT_BYTES) fail(`the viewer script is ${kb(Buffer.byteLength(js))}, over the ${kb(MAX_SCRIPT_BYTES)} budget`);

  let html = fs.readFileSync(path.join(root, 'src', 'standalone', 'template.html'), 'utf8');
  for (const token of [TOKEN_TITLE, TOKEN_DATA, TOKEN_SCRIPT, TOKEN_BUILD]) {
    if (countOf(html, token) !== 1) fail(`src/standalone/template.html must contain ${token} exactly once`);
  }
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  html = html.replace(TOKEN_BUILD, () => stamp).replace(TOKEN_SCRIPT, () => js);
  for (const token of [TOKEN_TITLE, TOKEN_DATA]) {
    const n = countOf(html, token);
    if (n !== 1) fail(`${token} appears ${n} times in the built template (the viewer script must not contain it)`);
  }
  if (countOf(html, '<script') !== 2 || countOf(html, '</script') !== 2) fail('the built template must have exactly two script elements');

  const outFile = path.join(root, 'public', 'viewer-template.html');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, html);
  const size = Buffer.byteLength(html);
  console.log(`build-viewer: public/viewer-template.html  script ${kb(Buffer.byteLength(js))} (${kb(zlib.gzipSync(js).length)} gzipped), template ${kb(size)} (${kb(zlib.gzipSync(html).length)} gzipped)`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}