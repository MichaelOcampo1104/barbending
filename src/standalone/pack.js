// The single-file viewer format (spec section 4.3): a generated HTML template with two tokens, filled in with the title and the
// gzipped, base64-encoded project. Pure: no DOM, no three.js. Used by the app (export, import) and by Node tests and checks.
// Never bundled into the viewer itself, which only needs the codec.
import { gzipBytes, gunzipBytes, toBase64, fromBase64 } from './codec.js';

export const VIEWER_FORMAT = 1;
export const TOKEN_TITLE = '@@BARBENDING_TITLE@@';
export const TOKEN_DATA = '@@BARBENDING_DATA@@';
export const TOKEN_SCRIPT = '@@BARBENDING_SCRIPT@@'; // build time only (scripts/build-viewer.mjs)
export const TOKEN_BUILD = '@@BARBENDING_BUILD@@'; // build time only
export const DEFAULT_VIEWER_TITLE = 'barbending model';
export const MAX_TITLE_LENGTH = 80;

const NOT_A_VIEWER_FILE = 'not a barbending viewer file';
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function countOf(text, token) {
  let n = 0;
  for (let i = text.indexOf(token); i >= 0; i = text.indexOf(token, i + token.length)) n += 1;
  return n;
}

// Trimmed, single-spaced, at most 80 characters (never half an emoji), never empty.
export function cleanViewerTitle(raw) {
  const t = Array.from(String(raw ?? '').replace(/\s+/g, ' ').trim()).slice(0, MAX_TITLE_LENGTH).join('').trim();
  return t || DEFAULT_VIEWER_TITLE;
}

// barbending-viewer-<slug>-<YYYYMMDD-HHMM>.html; the slug is left out for the default title or when no letter or digit is left.
export function viewerFileName(title, when = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${when.getFullYear()}${p(when.getMonth() + 1)}${p(when.getDate())}-${p(when.getHours())}${p(when.getMinutes())}`;
  const slug = title === DEFAULT_VIEWER_TITLE ? '' : title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `barbending-viewer-${slug ? slug + '-' : ''}${stamp}.html`;
}

export async function packViewerHtml(template, project, { title = DEFAULT_VIEWER_TITLE } = {}) {
  for (const token of [TOKEN_TITLE, TOKEN_DATA]) {
    const n = countOf(template, token);
    if (n !== 1) throw new Error(`The viewer template must contain ${token} exactly once (found ${n}).`);
  }
  const clean = cleanViewerTitle(title);
  const payload = { ...project, viewerFormat: VIEWER_FORMAT, title: clean };
  const data = toBase64(await gzipBytes(new TextEncoder().encode(JSON.stringify(payload))));
  // Function replacers: a title or data containing "$&" or "$1" must not be read as a replacement pattern.
  return template.replace(TOKEN_TITLE, () => escapeHtml(clean)).replace(TOKEN_DATA, () => data);
}

const DATA_ELEMENT = /<script id="model-data" type="text\/plain">([^<]*)<\/script>/;

export async function extractProjectFromHtml(html) {
  const m = DATA_ELEMENT.exec(String(html));
  if (!m) throw new Error(NOT_A_VIEWER_FILE);
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(await gunzipBytes(fromBase64(m[1].trim()))));
  } catch {
    throw new Error(NOT_A_VIEWER_FILE);
  }
  if (!payload || typeof payload !== 'object' || !Number.isInteger(payload.viewerFormat)) throw new Error(NOT_A_VIEWER_FILE);
  if (payload.viewerFormat > VIEWER_FORMAT) throw new Error('made by a newer barbending viewer');
  return payload;
}

// A project file chosen in the app: the .json that "⤓ Project" writes, or the .html that "⤓ Viewer" writes.
export async function parseProjectFile(name, text) {
  const isHtml = /\.html$/i.test(String(name)) || /^\s*</.test(text);
  return isHtml ? extractProjectFromHtml(text) : JSON.parse(text);
}