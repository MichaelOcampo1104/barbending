// Flat end caps for the classic rebar tube. THREE.TubeGeometry is open at both ends, so a bar seen exactly
// end-on (a starter bar in the Front view, a vertical bar in the Top view) has only edge-on sides and would
// project to nothing; capped, it shows as the disc it really is. Pure geometry, so Node tests can run it.
import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';

// Returns a new geometry: the tube's own triangles followed by a fan of `radialSegments` triangles at the start
// and one at the end, each wound so its geometric normal points away from the bar, with shading normals along
// the axis. `tubularSegments` / `radialSegments` are the values the TubeGeometry was built with (its rings have
// radialSegments + 1 vertices, the last repeating the first).
export function capTubeGeometry(tube, curve, tubularSegments, radialSegments) {
  const pos = tube.attributes.position;
  const positions = Array.from(pos.array);
  const normals = Array.from(tube.attributes.normal.array);
  const uvs = Array.from(tube.attributes.uv.array);
  const index = Array.from(tube.index.array);
  const ringSize = radialSegments + 1;
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3();

  const addCap = (firstRingVertex, centre, outward) => {
    const centreIndex = positions.length / 3;
    positions.push(centre.x, centre.y, centre.z);
    normals.push(outward.x, outward.y, outward.z);
    uvs.push(0.5, 0.5);
    for (let j = 0; j < ringSize; j++) {
      const k = (firstRingVertex + j) * 3;
      positions.push(pos.array[k], pos.array[k + 1], pos.array[k + 2]);
      normals.push(outward.x, outward.y, outward.z);
      uvs.push(0.5, 0.5);
    }
    // Wind the fan so the first triangle's geometric normal points along `outward`; the rest follow it.
    a.set(centre.x, centre.y, centre.z);
    b.set(positions[(centreIndex + 1) * 3], positions[(centreIndex + 1) * 3 + 1], positions[(centreIndex + 1) * 3 + 2]);
    c.set(positions[(centreIndex + 2) * 3], positions[(centreIndex + 2) * 3 + 1], positions[(centreIndex + 2) * 3 + 2]);
    n.subVectors(b, a).cross(c.sub(a));
    const flip = n.dot(outward) < 0;
    for (let j = 0; j < radialSegments; j++) {
      const r0 = centreIndex + 1 + j, r1 = centreIndex + 2 + j;
      if (flip) index.push(centreIndex, r1, r0); else index.push(centreIndex, r0, r1);
    }
  };

  const t0 = curve.getTangentAt(0).normalize();
  const t1 = curve.getTangentAt(1).normalize();
  addCap(0, curve.getPointAt(0), t0.clone().negate());
  addCap(tubularSegments * ringSize, curve.getPointAt(1), t1);

  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  // Still a tube to the tools that count the classic rebar meshes by geometry type (autotest dump, rig checks).
  g.type = 'TubeGeometry';
  return g;
}
