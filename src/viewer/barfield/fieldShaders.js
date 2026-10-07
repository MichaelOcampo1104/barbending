// Line and tube materials for the bar field (spec 6.1, 6.2). Both are ShaderMaterials that read
// per-row state / colour / radius from the row texture, and both come in two variants: one that uses
// three's clipping chunks so the shared section-box planes cut them exactly like every other material,
// and one without. While the section box is off the planes are a giant box and cut nothing, yet their
// six per-fragment tests cost about 20% of the frame at 3M bars (measured), so FieldView uses the
// unclipped variants then and swaps to the clipped ones when a section is switched on.
import * as THREE from 'three';
import { ROW_TEX_WIDTH } from './rowState.js';

// Slot order = DIA_PALETTE (10, 12, 16, 20, 25, 32, 40) + default; same colours as Scene.jsx DIA_COLORS.
export const PALETTE_HEX = ['#22c55e', '#84cc16', '#f59e0b', '#ef4444', '#a855f7', '#3b82f6', '#e11d48', '#f59e0b'];
// Tubes use simple lighting calibrated against the classic RebarMesh (MeshStandardMaterial under the
// scene's ambient + hemisphere + directional lights): mean tube colour within a few percent in a close-up.
export const LIGHT = Object.freeze({ ambient: 0.33, hemi: 0.18, key: 0.33 });

// Raw sRGB components: the shaders write them straight to the sRGB framebuffer.
const hexToVec3 = (hex) => new THREE.Vector3(
  parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255,
);

const ROW_FETCH = `
  uniform sampler2D uRowTex;
  vec4 rowTexel(float row) {
    int r = int(row + 0.5);
    return texelFetch(uRowTex, ivec2(r % ${ROW_TEX_WIDTH}, r / ${ROW_TEX_WIDTH}), 0);
  }
`;

const LINE_VS = `
${ROW_FETCH}
  uniform vec3 uPalette[8];
  uniform vec3 uTint;
  attribute float aRow;
  varying vec3 vColor;
  #include <clipping_planes_pars_vertex>
  void main() {
    vec4 t = rowTexel(aRow);
    int state = int(t.r + 0.5);
    vColor = state == 3 ? uTint : uPalette[int(t.g + 0.5)];
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    if (state == 1 || state == 2) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // hidden / overlay: outside clip space
    #include <clipping_planes_vertex>
  }
`;

const LINE_FS = `
  varying vec3 vColor;
  #include <clipping_planes_pars_fragment>
  void main() {
    #include <clipping_planes_fragment>
    gl_FragColor = vec4(vColor, 1.0);
  }
`;

const TUBE_VS = `
${ROW_FETCH}
  uniform vec3 uPalette[8];
  uniform vec3 uTint;
  attribute vec3 aStart;
  attribute vec3 aEnd;
  attribute float aRow;
  varying vec3 vN;
  varying vec3 vColor;
  #include <clipping_planes_pars_vertex>
  void main() {
    vec4 t = rowTexel(aRow);
    int state = int(t.r + 0.5);
    float rad = t.b;
    vec3 d = aEnd - aStart;
    float len = length(d);
    vec3 ax = d / max(len, 1e-6);
    vec3 ref = abs(ax.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 u = normalize(cross(ref, ax));
    vec3 v = cross(ax, u);
    vec3 radial = u * position.y + v * position.z;
    vec3 p = aStart + ax * (position.x * len) + radial * rad;
    vN = radial; // world space: field objects have an identity model matrix
    vColor = state == 3 ? uTint : uPalette[int(t.g + 0.5)];
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    if (state == 1 || state == 2) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    #include <clipping_planes_vertex>
  }
`;

const TUBE_FS = `
  uniform vec3 uLight; // x ambient, y hemisphere, z key
  varying vec3 vN;
  varying vec3 vColor;
  #include <clipping_planes_pars_fragment>
  void main() {
    #include <clipping_planes_fragment>
    vec3 n = normalize(vN);
    float hemi = 0.5 + 0.5 * n.y;
    float key = max(dot(n, normalize(vec3(8.0, 10.0, 6.0))), 0.0);
    float lit = uLight.x + uLight.y * hemi + uLight.z * key;
    gl_FragColor = vec4(vColor * lit, 1.0);
  }
`;

// The same shader without the clipping chunks.
const unclipped = (src) => src.replace(/^\s*#include <clipping_planes[a-z_]*>[ \t]*\n/gm, '');

function baseUniforms(rowTex) {
  return {
    uRowTex: { value: rowTex },
    uPalette: { value: PALETTE_HEX.map(hexToVec3) },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
  };
}

export function createLineMaterial(rowTex, planes, clipped = true) {
  if (!clipped) {
    return new THREE.ShaderMaterial({ uniforms: baseUniforms(rowTex), vertexShader: unclipped(LINE_VS), fragmentShader: unclipped(LINE_FS) });
  }
  const m = new THREE.ShaderMaterial({ uniforms: baseUniforms(rowTex), vertexShader: LINE_VS, fragmentShader: LINE_FS, clipping: true });
  m.clippingPlanes = planes;
  return m;
}

export function createTubeMaterial(rowTex, planes, clipped = true) {
  const uniforms = { ...baseUniforms(rowTex), uLight: { value: new THREE.Vector3(LIGHT.ambient, LIGHT.hemi, LIGHT.key) } };
  if (!clipped) {
    return new THREE.ShaderMaterial({ uniforms, vertexShader: unclipped(TUBE_VS), fragmentShader: unclipped(TUBE_FS) });
  }
  const m = new THREE.ShaderMaterial({ uniforms, vertexShader: TUBE_VS, fragmentShader: TUBE_FS, clipping: true });
  m.clippingPlanes = planes;
  return m;
}
