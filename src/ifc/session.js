// IFC4 loading via web-ifc-three (WASM parser, runs fully in-browser).
// Verified against web-ifc 0.0.39 / three 0.186: parse -> per-element subsets.
// Findings baked in:
//  - loader outputs three.js Y-up coords directly (no manual rotation)
//  - getItemProperties misaligns IfcSIUnit attrs -> units detected by STEP-text regex
//  - getSpatialStructure() comes back empty -> storeys mapped via
//    IFCRELCONTAINEDINSPATIALSTRUCTURE rels (RelatedElements -> RelatingStructure)
//  - COORDINATE_TO_ORIGIN recenters huge site coords for stable rendering
export const MAX_IFC_ELEMENTS = 10000; // above this: per-type subsets only

// Element types solid enough for stencil caps. Thin shells (plates, members
// like mullions, roofs, proxies, coverings) project their whole surface onto
// the cut face instead of a cut line, so their caps look like grey walls:
// they still clip (thin hollow cut = correct) but never fill.
export const SOLID_CAP_TYPES = new Set([
  'IFCBEAM', 'IFCBEAMSTANDARDCASE',
  'IFCCOLUMN', 'IFCCOLUMNSTANDARDCASE',
  'IFCSLAB', 'IFCSLABSTANDARDCASE', 'IFCSLABELEMENTEDCASE',
  'IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCWALLELEMENTEDCASE',
  'IFCFOOTING', 'IFCPILE',
  'IFCSTAIR', 'IFCSTAIRFLIGHT',
  'IFCRAMP', 'IFCRAMPFLIGHT',
]);

const val = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);

// Subset geometries SHARE the full model's position buffer and filter by
// index — so Box3.setFromObject / computeBoundingBox (which ignore the index)
// wrongly return the whole-model box. Walk the referenced verts instead.
const _sv = new THREE.Vector3();
// Tight index-aware bounding sphere in GEOMETRY-LOCAL coords, skipping
// non-finite verts. Subset geometries share the full model's position buffer,
// so three's computeBoundingSphere returns the whole-model sphere (raycast +
// frustum culling test every triangle of every subset on every click —
// seconds-long freezes on real-size models, and clicks get discarded as
// drags) — or NaN when an exporter emits degenerate verts (raycast/frustum
// early-out then misses the mesh entirely). Assigned at load; conservative
// (box sphere) so it can never wrongly exclude.
const _sbox = new THREE.Box3();
export function subsetLocalSphere(mesh) {
  const sphere = new THREE.Sphere();
  const g = mesh?.geometry;
  const pos = g?.attributes?.position;
  if (!pos) { sphere.radius = 0; return sphere; }
  _sbox.makeEmpty();
  const idx = g.index;
  const n = idx ? idx.count : pos.count;
  for (let i = 0; i < n; i++) {
    _sv.fromBufferAttribute(pos, idx ? idx.getX(i) : i);
    if (Number.isFinite(_sv.x + _sv.y + _sv.z)) _sbox.expandByPoint(_sv);
  }
  if (_sbox.isEmpty()) { sphere.radius = 0; return sphere; }
  return _sbox.getBoundingSphere(sphere);
}

const IDENT = new THREE.Matrix4();
export function subsetBox(mesh) {
  const g = mesh.geometry;
  const pos = g?.attributes?.position;
  const idx = g?.index;
  const bb = new THREE.Box3();
  mesh.updateWorldMatrix(true, false);
  if (pos && idx && idx.count > 0) {
    for (let i = 0; i < idx.count; i++) {
      _sv.fromBufferAttribute(pos, idx.getX(i));
      if (Number.isFinite(_sv.x + _sv.y + _sv.z)) {
        _sv.applyMatrix4(mesh.matrixWorld);
        bb.expandByPoint(_sv);
      }
    }
  } else if (pos && pos.count > 0) {
    for (let i = 0; i < pos.count; i++) {
      _sv.fromBufferAttribute(pos, i);
      if (Number.isFinite(_sv.x + _sv.y + _sv.z)) {
        _sv.applyMatrix4(mesh.matrixWorld);
        bb.expandByPoint(_sv);
      }
    }
  } else {
    try { bb.setFromObject(mesh); } catch { /* empty */ }
  }
  return bb;
}
import { IFCLoader } from 'web-ifc-three';
import * as WebIFC from 'web-ifc';
import * as THREE from 'three';
import { sectionPlanes } from '../viewer/sectionPlanes.js';

let loader = null;

export function getIfcLoader() {
  if (!loader) {
    loader = new IFCLoader();
    loader.ifcManager.setWasmPath('/'); // serves public/web-ifc.wasm as /web-ifc.wasm
  }
  return loader;
}

// Live three.js objects (kept outside React state); metadata lives in zustand.
export const ifcSession = { group: null, modelID: null, meshes: {}, material: null };

export const IFC_TYPES = [
  ['IFCBEAM', 'Beams'],
  ['IFCBEAMSTANDARDCASE', 'Beams (std)'],
  ['IFCCOLUMN', 'Columns'],
  ['IFCCOLUMNSTANDARDCASE', 'Columns (std)'],
  ['IFCSLAB', 'Slabs'],
  ['IFCSLABSTANDARDCASE', 'Slabs (std)'],
  ['IFCSLABELEMENTEDCASE', 'Slabs (elem)'],
  ['IFCWALL', 'Walls'],
  ['IFCWALLSTANDARDCASE', 'Walls (std)'],
  ['IFCWALLELEMENTEDCASE', 'Walls (elem)'],
  ['IFCFOOTING', 'Footings'],
  ['IFCPILE', 'Piles'],
  ['IFCPLATE', 'Plates'],
  ['IFCMEMBER', 'Members'],
  ['IFCSTAIR', 'Stairs'],
  ['IFCSTAIRFLIGHT', 'Stair Flights'],
  ['IFCRAMP', 'Ramps'],
  ['IFCRAMPFLIGHT', 'Ramp Flights'],
  ['IFCROOF', 'Roofs'],
  ['IFCBUILDINGELEMENTPROXY', 'Proxies'],
  ['IFCCOVERING', 'Coverings'],
  ['IFCRAILING', 'Railings'],
];

export const UNIT_CHOICES = [
  { label: 'metre', toMeters: 1 },
  { label: 'millimetre', toMeters: 0.001 },
  { label: 'centimetre', toMeters: 0.01 },
  { label: 'inch', toMeters: 0.0254 },
  { label: 'foot', toMeters: 0.3048 },
];

// e.g. IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.) -> prefix MILLI, name METRE
export function detectLengthUnit(headerText) {
  const re = /IFCSIUNIT\s*\(([^)]*)\)/gi;
  let m;
  while ((m = re.exec(headerText))) {
    const toks = m[1].split(',').map((s) => s.trim().replace(/^\.|\.$/g, ''));
    const li = toks.findIndex((t) => t.toUpperCase() === 'LENGTHUNIT');
    if (li < 0) continue;
    const prefix = (toks[li + 1] || '$').toUpperCase();
    const name = (toks[li + 2] || 'METRE').toUpperCase();
    const pf = { $: 1, MILLI: 1e-3, CENTI: 1e-2, DECI: 1e-1, KILO: 1e3 }[prefix] ?? 1;
    const base = {
      METRE: 1, METER: 1,
      MILLIMETRE: 0.001, MILLIMETER: 0.001,
      CENTIMETRE: 0.01, CENTIMETER: 0.01,
      INCH: 0.0254, INCHES: 0.0254,
      FOOT: 0.3048, FEET: 0.3048,
    }[name] ?? 1;
    const tag = prefix === '$' ? name.toLowerCase() : `${name.toLowerCase()} (${prefix.toLowerCase()})`;
    return { label: tag, toMeters: base * pf };
  }
  const convRe = /IFCCONVERSIONBASEDUNIT\s*\([^,]*,\s*\.LENGTHUNIT\.\s*,\s*['"]([^'"]+)['"]/gi;
  const convM = convRe.exec(headerText);
  if (convM) {
    const uName = convM[1].toUpperCase();
    if (/MILLI|MM/i.test(uName)) return { label: 'millimetre', toMeters: 0.001 };
    if (/CENTI|CM/i.test(uName)) return { label: 'centimetre', toMeters: 0.01 };
    if (/INCH/i.test(uName)) return { label: 'inch', toMeters: 0.0254 };
    if (/FOOT|FEET/i.test(uName)) return { label: 'foot', toMeters: 0.3048 };
    if (/METRE|METER/i.test(uName)) return { label: 'metre', toMeters: 1 };
  }
  return { label: 'metre (assumed)', toMeters: 1 };
}

// element id -> level name. Containment rels first, then spatial aggregation
// (some exporters nest elements under storeys via IfcRelAggregates instead).
// Anything unmapped falls back to an elevation band at render time.
export async function collectStoreys(mgr, modelID) {
  const map = {};
  const nameCache = {};
  const structName = async (sid) => {
    if (nameCache[sid] === undefined) {
      try {
        const p = await mgr.getItemProperties(modelID, sid);
        nameCache[sid] = val(p.Name) || val(p.ObjectType) || `Level ${sid}`;
      } catch { nameCache[sid] = `Level ${sid}`; }
    }
    return nameCache[sid];
  };
  try {
    const rels = await mgr.getAllItemsOfType(modelID, WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE, true);
    for (const r of rels || []) {
      const sname = await structName(val(r.RelatingStructure));
      for (const el of r.RelatedElements || []) map[val(el)] = sname;
    }
  } catch { /* best-effort */ }
  try {
    const aggs = await mgr.getAllItemsOfType(modelID, WebIFC.IFCRELAGGREGATES, true);
    for (const r of aggs || []) {
      const rid = val(r.RelatingObject);
      let t = '';
      try { t = String(await mgr.getIfcType(modelID, rid)).toUpperCase(); } catch { /* skip */ }
      if (!/STOREY|SPACE/.test(t)) continue;
      const sname = await structName(rid);
      for (const el of r.RelatedObjects || []) {
        const id = val(el);
        if (map[id] === undefined) map[id] = sname;
      }
    }
  } catch { /* best-effort */ }
  return map;
}

export async function loadIfc(file) {
  unloadIfc();
  const ld = getIfcLoader();
  await ld.ifcManager.applyWebIfcConfig({ COORDINATE_TO_ORIGIN: true });
  const buf = await file.arrayBuffer();
  const head = new TextDecoder().decode(buf.slice(0, 2000000));
  if (!/FILE_SCHEMA\s*\(\s*\('IFC/i.test(head) && !/ISO-10303-21/i.test(head)) {
    throw new Error('Not a valid IFC file (ISO-10303-21 / STEP format not found).');
  }
  const detected = detectLengthUnit(head);
  const model = await ld.parse(buf);
  const modelID = model.modelID;
  const storeyOf = await collectStoreys(ld.ifcManager, modelID);

  // gather elements per type first (for counts + large-model fallback)
  const byType = [];
  let total = 0;
  for (const [key, label] of IFC_TYPES) {
    const typeId = WebIFC[key];
    if (typeId === undefined) continue;
    const ids = await ld.ifcManager.getAllItemsOfType(modelID, typeId, false);
    if (ids && ids.length) { byType.push({ key, label, ids }); total += ids.length; }
  }
  if (!total) {
    ld.ifcManager.close(modelID);
    throw new Error('No structural elements (beam/column/slab/wall/…) found in this file.');
  }

  const group = new THREE.Group();
  group.name = `IFC:${file.name}`;
  group.userData.pickRoot = 'ifc';
  const mat = new THREE.MeshStandardMaterial({
    color: '#8fa3c8', transparent: true, opacity: 1,
    roughness: 0.9, metalness: 0, depthWrite: true, side: THREE.DoubleSide,
    clippingPlanes: sectionPlanes, // assigned at birth: compiled WITH clipping
  });
  const types = [];
  const elements = [];
  const meshes = {};
  const level = total > MAX_IFC_ELEMENTS ? 'type' : 'element';

  if (level === 'type') {
    for (const { key, label, ids } of byType) {
      const mesh = await ld.ifcManager.createSubset({
        scene: group, modelID, ids, removePrevious: false,
        customID: `ifc_type_${key}`, material: mat,
      });
      mesh.userData.ifcKey = `type:${key}`;
      meshes[`type:${key}`] = mesh;
      types.push({ key, label, count: ids.length, visible: true });
    }
  } else {
    for (const { key, label, ids } of byType) {
      types.push({ key, label, count: ids.length, visible: true });
      for (const id of ids) {
        let name = '', gid = '';
        try {
          const p = await ld.ifcManager.getItemProperties(modelID, id);
          name = val(p.Name) || '';
          gid = val(p.GlobalId) || `e${id}`;
        } catch { gid = `e${id}`; }
        const mesh = await ld.ifcManager.createSubset({
          scene: group, modelID, ids: [id], removePrevious: false,
          customID: `ifc_${gid}`, material: mat,
        });
        mesh.userData.ifcKey = gid;
        // model-unit global bbox (index-aware; see subsetBox)
        const ebb = subsetBox(mesh);
        const esz = ebb.getSize(new THREE.Vector3());
        const storey = storeyOf[id] || null; // null -> Z-band fallback label at render
        meshes[gid] = mesh;
        elements.push({
          key: gid, expressID: id,
          name: name || `${label} ${gid.slice(0, 6)}`,
          type: key, typeLabel: label, storey,
          baseModel: ebb.min.y,
          sizeModel: [esz.x, esz.y, esz.z],
          visible: true,
        });
      }
    }
  }

  // raw model-unit bbox (kept unscaled; fit + mm readouts scale at render time
  // so unit overrides stay consistent). Union of index-aware subset boxes.
  group.updateMatrixWorld(true);
  const bb = new THREE.Box3();
  group.traverse((o) => { if (o.isMesh) bb.union(subsetBox(o)); });
  // Tight per-subset bounding spheres (see subsetLocalSphere): subset meshes
  // carry identity transforms, so geometry-local verts are mesh-local.
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.matrix.equals(IDENT)) return;
    o.geometry.boundingSphere = subsetLocalSphere(o);
  });
  const center = bb.getCenter(new THREE.Vector3());
  const bsz = bb.getSize(new THREE.Vector3());
  const radius = bsz.length() / 2;
  group.scale.setScalar(detected.toMeters);
  group.updateMatrixWorld(true);
  ifcSession.group = group;
  ifcSession.modelID = modelID;
  ifcSession.meshes = meshes;
  ifcSession.material = mat;
  return {
    fileName: file.name,
    unitLabel: detected.label,
    unitToMeters: detected.toMeters,
    autoLabel: detected.label,
    autoToMeters: detected.toMeters,
    level,
    types,
    elements,
    opacity: 1,
    bbox: { center: center.toArray(), radius, size: [bsz.x, bsz.y, bsz.z] },
  };
}

export function unloadIfc() {
  const { group, modelID, material } = ifcSession;
  if (group) {
    group.traverse((o) => { if (o.isMesh) o.geometry?.dispose?.(); });
    group.removeFromParent();
    group.clear();
  }
  if ((modelID === 0 || modelID) && loader) {
    try { loader.ifcManager.close(modelID); } catch { /* already closed */ }
  }
  material?.dispose?.();
  ifcSession.group = null;
  ifcSession.modelID = null;
  ifcSession.meshes = {};
  ifcSession.material = null;
}
