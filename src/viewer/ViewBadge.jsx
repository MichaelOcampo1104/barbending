import { useStore } from '../store.js';
import { VIEW_LABELS } from './cameraMath.js';

// Small pill under the axis gizmo (top-right corner of the viewport): "Front · Orthographic". It shows
// which view the camera is in and which projection is drawn; clicking it switches between orthographic
// and perspective (the view direction stays). It sits away from the bottom-left, where the hint bar is
// and where clicks on empty canvas deselect.
export default function ViewBadge() {
  const viewName = useStore((s) => s.viewName);
  const ortho = useStore((s) => s.projection === 'ortho');
  const toggle = useStore((s) => s.toggleProjection);
  return (
    <button
      type="button"
      className="viewbadge"
      onClick={toggle}
      title={ortho
        ? 'Orthographic (parallel) projection: no perspective, the same scale at every depth. Click for perspective.'
        : 'Perspective projection. Click for orthographic (parallel, no foreshortening).'}
    >
      <b>{VIEW_LABELS[viewName] || 'Free'}</b> · {ortho ? 'Orthographic' : 'Perspective'}
    </button>
  );
}
