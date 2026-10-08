// The app's side of "⤓ Viewer": fetch the generated viewer template (public/viewer-template.html, built by `npm run build:viewer`).
// `url` and `fetchFn` are parameters so this module touches no browser global at import time and Node tests can drive it.
import { TOKEN_TITLE, TOKEN_DATA } from './pack.js';

export const MISSING_TEMPLATE = 'The viewer template is missing: run "npm run build:viewer", then reload.';

export async function loadViewerTemplate({ url, fetchFn = (...args) => fetch(...args) }) {
  let text = '';
  try {
    const res = await fetchFn(url, { cache: 'no-cache' });
    if (res && res.ok) text = await res.text();
  } catch {
    // offline, or nothing is served there: handled as a missing template below
  }
  // A dev server answers an unknown path with index.html and status 200, so look for the template's own two tokens.
  if (!text.includes(TOKEN_TITLE) || !text.includes(TOKEN_DATA)) throw new Error(MISSING_TEMPLATE);
  return text;
}