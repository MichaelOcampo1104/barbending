// FieldView: the GPU side of one built field (spec 6): one LineSegments per chunk, lazily created
// instanced tube meshes for chunks near the camera (most recently used 64 kept), the row-state
// texture, and optional delta chunks for edited rows (spec 5.6). All objects are static.
import * as THREE from 'three';
import { createRowTexelData, rowTexDims, writeRowAttributes } from './rowState.js';
import { createLineMaterial, createTubeMaterial } from './fieldShaders.js';
import { createChunkTubeGeometry } from './tubes.js';
import { sectionPlanes } from '../sectionPlanes.js';

const TUBE_CACHE = 64;

function makeLines(data, chunk, material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(data.seg.subarray(chunk.start * 6, (chunk.start + chunk.count) * 6), 3));
  g.setAttribute('aRow', new THREE.BufferAttribute(data.rowOfVtx.subarray(chunk.start * 2, (chunk.start + chunk.count) * 2), 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(chunk.center[0], chunk.center[1], chunk.center[2]), chunk.radius);
  const lines = new THREE.LineSegments(g, material);
  lines.matrixAutoUpdate = false;
  lines.userData.barField = 'lines';
  return lines;
}

export class FieldView {
  constructor(data, { deltaCapacity = 0 } = {}) {
    this.data = data;
    this.rowCount = data.rowCount;
    this.texelCount = data.rowCount + deltaCapacity;
    this.group = new THREE.Group();
    this.group.name = 'barfield';
    this.group.matrixAutoUpdate = false;
    this.texData = createRowTexelData(this.texelCount);
    this.states = new Uint8Array(this.texelCount);
    this.radiusM = new Float32Array(this.texelCount);
    for (let i = 0; i < data.rowCount; i++) {
      writeRowAttributes(this.texData, i, data.rows.colorIdx[i], data.rows.radiusM[i]);
      this.radiusM[i] = data.rows.radiusM[i];
    }
    const { width, height } = rowTexDims(this.texelCount);
    this.texture = new THREE.DataTexture(this.texData, width, height, THREE.RGBAFormat, THREE.FloatType);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.needsUpdate = true;
    this.lineMaterial = createLineMaterial(this.texture, sectionPlanes);
    this.tubeMaterial = createTubeMaterial(this.texture, sectionPlanes);
    this.items = [];
    this.deltaDatas = [];
    this.addChunks(data, false);
    this.staticCount = this.items.length;
    this.frame = 0;
  }

  // Colour slot + radius for a row id (used for delta rows; call touch() afterwards).
  writeRowAttrs(id, colorIdx, radiusM) {
    writeRowAttributes(this.texData, id, colorIdx, radiusM);
    this.radiusM[id] = radiusM;
  }

  touch() { this.texture.needsUpdate = true; }

  // states: Uint8Array over texels (row ids); texels beyond its length keep their value.
  setStates(states) {
    const n = Math.min(states.length, this.texelCount);
    for (let i = 0; i < n; i++) {
      this.states[i] = states[i];
      this.texData[i * 4] = states[i];
    }
    this.texture.needsUpdate = true;
  }

  addChunks(data, delta) {
    for (const chunk of data.chunks) {
      const lines = makeLines(data, chunk, this.lineMaterial);
      this.group.add(lines);
      this.items.push({
        data, chunk, lines, tubes: null, delta, lastUsed: 0,
        sphere: new THREE.Sphere(new THREE.Vector3(chunk.center[0], chunk.center[1], chunk.center[2]), chunk.radius),
      });
    }
    if (delta) this.deltaDatas.push(data);
  }

  removeDelta() {
    for (let i = this.items.length - 1; i >= this.staticCount; i--) this._disposeItem(this.items[i]);
    this.items.length = this.staticCount;
    this.deltaDatas = [];
  }

  _disposeItem(it) {
    this.group.remove(it.lines);
    it.lines.geometry.dispose();
    if (it.tubes) {
      this.group.remove(it.tubes);
      it.tubes.geometry.dispose();
      it.tubes = null;
    }
  }

  dataSets() { return [this.data, ...this.deltaDatas]; }

  // Draw exactly the items in `wanted` (a Set of item indices) as tubes and every other item as lines.
  applyTubeSet(wanted) {
    this.frame += 1;
    let cached = 0;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (wanted.has(i)) {
        if (!it.tubes) {
          it.tubes = new THREE.Mesh(createChunkTubeGeometry(it.data, it.chunk), this.tubeMaterial);
          it.tubes.matrixAutoUpdate = false;
          it.tubes.userData.barField = 'tubes';
          this.group.add(it.tubes);
        }
        it.tubes.visible = true;
        it.lines.visible = false;
        it.lastUsed = this.frame;
      } else {
        if (it.tubes) it.tubes.visible = false;
        it.lines.visible = true;
      }
      if (it.tubes) cached += 1;
    }
    if (cached > TUBE_CACHE) {
      const hidden = this.items.filter((it) => it.tubes && !it.tubes.visible).sort((a, b) => a.lastUsed - b.lastUsed);
      for (let k = 0; cached > TUBE_CACHE && k < hidden.length; k++) {
        const it = hidden[k];
        this.group.remove(it.tubes);
        it.tubes.geometry.dispose();
        it.tubes = null;
        cached -= 1;
      }
    }
  }

  dispose() {
    for (const it of this.items) this._disposeItem(it);
    this.items.length = 0;
    this.lineMaterial.dispose();
    this.tubeMaterial.dispose();
    this.texture.dispose();
  }
}
