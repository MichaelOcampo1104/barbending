// Lets PickHandler / QueryHandler reach the active BarField without prop drilling. BarField sets
// `current` while mounted. current.pick(ray, { fovRad, viewportHeightPx, ev }) takes a THREE.Ray in
// scene metres and returns { row (bar index), distance, point: THREE.Vector3 } or null. Pass the
// pointer event as `ev`: the result is then computed once per event, so a second handler for the
// same click sees the same answer even after the first one changed the selection.
export const fieldRegistry = { current: null };
