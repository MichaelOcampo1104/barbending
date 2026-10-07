// Pure LOD policy (spec 6.3): which chunks draw as tubes. No three.js.
export const TRIS_PER_SEGMENT = 12;
export const ON_PX = 3;
export const OFF_PX = 2;

// Apparent width in pixels of a bar of radius maxRadiusM at `distance` metres
// (perspective camera, vertical field of view fovRad).
export function apparentPx(maxRadiusM, distance, fovRad, viewportHeightPx) {
  return ((2 * maxRadiusM) / Math.max(distance, 1e-6)) * (viewportHeightPx / (2 * Math.tan(fovRad / 2)));
}

// Returns the Set of chunk indices to draw as tubes; every other chunk draws as lines.
//  - 'lines' never draws tubes, 'tubes' draws every chunk as tubes (no budget cap).
//  - 'auto': a chunk is a candidate at >= onPx, or stays one while >= offPx (hysteresis, via prevTubes);
//    candidates are promoted closest-first until the triangle budget is spent. The closest chunk is
//    always promoted so zooming in always shows tubes. isVisible(i) skips chunks outside the view.
export function chooseTubeChunks({
  chunks, cameraPos, fovRad, viewportHeightPx, budgetTris,
  prevTubes = new Set(), detail = 'auto', isVisible = null, onPx = ON_PX, offPx = OFF_PX,
}) {
  const out = new Set();
  if (detail === 'lines') return out;
  if (detail === 'tubes') {
    for (let i = 0; i < chunks.length; i++) out.add(i);
    return out;
  }
  const candidates = [];
  for (let i = 0; i < chunks.length; i++) {
    if (isVisible && !isVisible(i)) continue;
    const ch = chunks[i];
    const dist = Math.hypot(cameraPos[0] - ch.center[0], cameraPos[1] - ch.center[1], cameraPos[2] - ch.center[2]);
    const px = apparentPx(ch.maxRadiusM, dist, fovRad, viewportHeightPx);
    if (px >= (prevTubes.has(i) ? offPx : onPx)) candidates.push({ i, dist, cost: TRIS_PER_SEGMENT * ch.count });
  }
  candidates.sort((a, b) => a.dist - b.dist);
  let used = 0;
  for (const c of candidates) {
    if (out.size === 0 || used + c.cost <= budgetTris) {
      out.add(c.i);
      used += c.cost;
    }
  }
  return out;
}
