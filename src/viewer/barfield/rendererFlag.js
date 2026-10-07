// Which bar renderer is active: ?renderer=field | legacy. 'field' is the default; ?renderer=legacy
// forces the classic per-bar meshes. The field renderer needs WebGL2 (otherwise legacy is used).
export const DEFAULT_RENDERER = 'field';

export function getRendererMode() {
  try {
    const v = new URLSearchParams(window.location.search).get('renderer');
    if (v === 'field' || v === 'legacy') return v;
  } catch { /* no window (tests) */ }
  return DEFAULT_RENDERER;
}

let supported = null;
export function fieldSupported() {
  if (supported === null) supported = typeof WebGL2RenderingContext !== 'undefined';
  return supported;
}

export function isFieldRendererActive() {
  return getRendererMode() === 'field' && fieldSupported();
}
