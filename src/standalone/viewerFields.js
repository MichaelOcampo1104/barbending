// The fields a viewer file adds to the project data: its format, its title, and the volumes typed for that file in ⤓ Viewer's panel. The
// viewer's own ⤓ Project leaves them out, so the .json it writes is the project and nothing else. (Pure, so the viewer and the tests share it.)
export const VIEWER_FIELDS = ['viewerFormat', 'title', 'typedVolumes'];

export function withoutViewerFields(payload) {
  return Object.fromEntries(Object.entries(payload).filter(([k]) => !VIEWER_FIELDS.includes(k)));
}
