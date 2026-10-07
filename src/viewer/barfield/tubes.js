// Instanced tube geometry for one chunk (spec 6.2): one shared six-sided prism (12 triangles) drawn
// once per segment. Per-instance start / end points are an interleaved view onto the chunk's slice
// of data.seg (no copy); the row id selects colour and radius in the row texture.
import * as THREE from 'three';

let base = null;
function baseTube() {
  if (base) return base;
  const pos = [];
  const idx = [];
  for (let r = 0; r < 2; r++) {
    for (let i = 0; i < 6; i++) {
      const t = (i / 6) * Math.PI * 2;
      pos.push(r, Math.cos(t), Math.sin(t)); // x along the axis (0..1), yz on the unit circle
    }
  }
  for (let i = 0; i < 6; i++) {
    const a = i, b = (i + 1) % 6, c = 6 + i, d = 6 + ((i + 1) % 6);
    idx.push(a, b, c, b, d, c);
  }
  base = { position: new THREE.Float32BufferAttribute(pos, 3), index: idx };
  return base;
}

export function createChunkTubeGeometry(data, chunk) {
  const b = baseTube();
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', b.position);
  g.setIndex(b.index);
  g.instanceCount = chunk.count;
  const inter = new THREE.InstancedInterleavedBuffer(data.seg.subarray(chunk.start * 6, (chunk.start + chunk.count) * 6), 6, 1);
  g.setAttribute('aStart', new THREE.InterleavedBufferAttribute(inter, 3, 0));
  g.setAttribute('aEnd', new THREE.InterleavedBufferAttribute(inter, 3, 3));
  const rows = new Float32Array(chunk.count);
  for (let i = 0; i < chunk.count; i++) rows[i] = data.rowOfVtx[2 * (chunk.start + i)];
  g.setAttribute('aRow', new THREE.InstancedBufferAttribute(rows, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(chunk.center[0], chunk.center[1], chunk.center[2]), chunk.radius);
  return g;
}
