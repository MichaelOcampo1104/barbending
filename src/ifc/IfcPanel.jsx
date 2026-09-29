import { useRef, useState } from 'react';
import * as THREE from 'three';
import { useStore } from '../store.js';
import { UNIT_CHOICES } from './units.js';

// ---- helpers ---------------------------------------------------------------
const mm = (modelVal, u) => `${Math.round(modelVal * u * 1000).toLocaleString('en-US')}`;
const mm3 = (sizeModel, u) => sizeModel ? `${mm(sizeModel[0], u)} × ${mm(sizeModel[1], u)} × ${mm(sizeModel[2], u)}` : '—';
// Stable level key: real storey name, else elevation band from base height.
const levelKeyOf = (e) => e.storey || `z:${Math.round(e.baseModel * 10000) / 10000}`;
const levelLabelOf = (e, u) => e.storey || `Z ${mm(e.baseModel, u)}`;

// View-only annotations (rename / level moves) persisted per file.
const annKey = (fileName) => `bb.ifcann.${fileName}`;
function readAnn(fileName) {
  try { return JSON.parse(localStorage.getItem(annKey(fileName))) || {}; } catch { return {}; }
}
function applyAnn(meta) {
  const a = readAnn(meta.fileName);
  if (!a || (!a.names && !a.storeys)) return meta;
  return {
    ...meta,
    elements: meta.elements.map((e) => ({
      ...e,
      name: (a.names && a.names[e.key]) || e.name,
      storey: (a.storeys && a.storeys[e.key] !== undefined) ? a.storeys[e.key] : e.storey,
    })),
  };
}
function saveAnn(fileName, field, key, value) {
  const a = readAnn(fileName);
  a[field] = a[field] || {};
  a[field][key] = value;
  try { localStorage.setItem(annKey(fileName), JSON.stringify(a)); } catch { /* private mode */ }
}

// Compact entry point for the Concrete tab when no model is loaded.
export function IfcLoadButton() {
  const ifc = useStore((s) => s.ifc);
  const setIfc = useStore((s) => s.setIfc);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const fileRef = useRef(null);
  if (ifc) return null;
  return (
    <div className="panel ifc">
      <div className="sect flush">IFC reference (optional)</div>
      <p className="distnote">Draw boxes below — or load an IFC4 model instead.</p>
      <button onClick={() => fileRef.current?.click()} disabled={!!busy}>{busy || 'Load IFC4 file…'}</button>
      <input ref={fileRef} type="file" accept=".ifc,.IFC" hidden onChange={(e) => loadFile(e, setIfc, setBusy, setErr)} />
      {err && <p className="err">{err}</p>}
    </div>
  );
}

export async function loadFile(e, setIfc, setBusy, setErr) {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  setErr('');
  setBusy(`Parsing ${f.name}…`);
  try {
    const { loadIfc } = await import('./session.js');
    setIfc(applyAnn(await loadIfc(f)));
  } catch (ex) {
    const { unloadIfc } = await import('./session.js');
    unloadIfc();
    setErr(ex.message || String(ex));
  }
  setBusy('');
}

// Fit the camera to the model's LIVE bounding box (follows unit changes,
// placement offsets and visibility toggles).
export async function fitIfcLive() {
  const { ifcSession } = await import('./session.js');
  const g = ifcSession.group;
  if (!g) return;
  const bb = new THREE.Box3().setFromObject(g);
  const size = bb.getSize(new THREE.Vector3());
  if (size.length() === 0) return;
  useStore.getState().setIfcFitBox(bb.getCenter(new THREE.Vector3()).toArray(), size.length() / 2);
}

// Full control panel — rendered in the right sidebar when a model is loaded.
export default function IfcPanel() {
  const ifc = useStore((s) => s.ifc);
  const setIfc = useStore((s) => s.setIfc);
  const clearIfc = useStore((s) => s.clearIfc);
  const toggleIfcType = useStore((s) => s.toggleIfcType);
  const toggleIfcElement = useStore((s) => s.toggleIfcElement);
  const setIfcElements = useStore((s) => s.setIfcElements);
  const setIfcOpacity = useStore((s) => s.setIfcOpacity);
  const setIfcUnit = useStore((s) => s.setIfcUnit);
  const setIfcXform = useStore((s) => s.setIfcXform);
  const resetIfcXform = useStore((s) => s.resetIfcXform);
  const setIfcFitBox = useStore((s) => s.setIfcFitBox);
  const selected = useStore((s) => s.ifcSelected);
  const setSelected = useStore((s) => s.setIfcSelected);
  const renameEl = useStore((s) => s.renameIfcElement);
  const moveEl = useStore((s) => s.moveIfcElement);
  const xform = useStore((s) => s.ifcXform) || { pos: [0, 0, 0], rot: [0, 0, 0] };
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [query, setQuery] = useState('');
  const fileRef = useRef(null);
  if (!ifc) return null;

  const u = ifc.unitToMeters;
  const isAuto = ifc.unitToMeters === ifc.autoToMeters && ifc.unitLabel === ifc.autoLabel;
  const solid = (ifc.opacity ?? 0.3) >= 0.999;
  const showAll = () => setIfcElements((e) => ({ ...e, visible: true }));
  const hideAll = () => setIfcElements((e) => ({ ...e, visible: false }));
  const solo = (key) => { setIfcElements((e) => ({ ...e, visible: e.key === key })); setSelected(key); };
  const remove = async () => {
    const { unloadIfc } = await import('./session.js');
    unloadIfc();
    clearIfc();
  };
  const changeUnit = (toMeters, label) => { setIfcUnit(toMeters, label); fitIfcLive(); };
  const zoomTo = async (key) => {
    const { ifcSession, subsetBox } = await import('./session.js');
    const mesh = ifcSession.meshes[key];
    if (!mesh) return;
    // group is scaled: subsetBox yields scene units directly
    const bb = subsetBox(mesh);
    setIfcFitBox(bb.getCenter(new THREE.Vector3()).toArray(), bb.getSize(new THREE.Vector3()).length() / 2 || 0.5);
  };

  const q = query.trim().toLowerCase();
  const match = (e) => !q || e.name.toLowerCase().includes(q) || e.typeLabel.toLowerCase().includes(q) || levelLabelOf(e, u).toLowerCase().includes(q);

  // levels derived: containment storey, else elevation band (always works)
  const levels = [];
  if (ifc.level === 'element') {
    for (const e of ifc.elements) {
      const k = levelKeyOf(e);
      let L = levels.find((l) => l.key === k);
      if (!L) { L = { key: k, label: levelLabelOf(e, u), keys: [] }; levels.push(L); }
      L.keys.push(e.key);
    }
  }
  const explicitStoreys = [...new Set(ifc.elements ? ifc.elements.map((e) => e.storey).filter(Boolean) : [])];
  const sel = ifc.level === 'element' ? ifc.elements.find((e) => e.key === selected) : null;

  return (
    <div className="panel ifc">
      <div className="crow">
        <span className="cnameellipsis" title={ifc.fileName}>⛁ {ifc.fileName}</span>
        <button className="danger sm" onClick={remove} title="Unload IFC model">×</button>
      </div>
      <div className="distnote">
        {ifc.level === 'element' ? ifc.elements.length : ifc.types.reduce((a, t) => a + t.count, 0)} elements
        {ifc.level === 'element' && ` · ${levels.length} levels`}
        {ifc.level === 'type' && ' · large model: type-level control'}
      </div>
      <div className="distnote">Extents X/Y/Z: {mm3(ifc.bbox.size, u)} mm · {ifc.autoLabel}</div>

      <label className="fld"><span>Length unit (model rescales + refits)</span>
        <select
          value={isAuto ? '__auto' : String(ifc.unitToMeters)}
          onChange={(e) => {
            if (e.target.value === '__auto') changeUnit(ifc.autoToMeters, ifc.autoLabel);
            else {
              const c = UNIT_CHOICES.find((c) => String(c.toMeters) === e.target.value);
              if (c) changeUnit(c.toMeters, c.label);
            }
          }}
        >
          <option value="__auto">auto ({ifc.autoLabel})</option>
          {UNIT_CHOICES.map((c) => <option key={c.label} value={String(c.toMeters)}>{c.label}</option>)}
        </select>
      </label>

      <div className="segrow">
        <button className={solid ? '' : 'on'} onClick={() => setIfcOpacity(0.3)}>◧ Ghost</button>
        <button className={solid ? 'on' : ''} onClick={() => setIfcOpacity(1)}>◼ Solid</button>
      </div>
      <label className="fld"><span>Opacity ({Math.round((ifc.opacity ?? 0.3) * 100)}%)</span>
        <input type="range" min="0.05" max="1" step="0.05"
          value={ifc.opacity ?? 0.3} onChange={(e) => setIfcOpacity(Number(e.target.value))} />
      </label>

      <div className="btnrow">
        <button onClick={showAll}>All on</button>
        <button onClick={hideAll}>All off</button>
        <button onClick={fitIfcLive}>Fit view</button>
        <button onClick={() => fileRef.current?.click()}>Swap file…</button>
        <input ref={fileRef} type="file" accept=".ifc,.IFC" hidden onChange={(e) => loadFile(e, setIfc, setBusy, setErr)} />
      </div>
      {busy && <p className="distnote">{busy}</p>}
      {err && <p className="err">{err}</p>}

      <div className="sect">Placement (model mm / deg, Y up)</div>
      <div className="grid3">
        {[['X', 0], ['Y', 1], ['Z', 2]].map(([l, i]) => (
          <label key={l} className="fld"><span>{l} mm</span>
            <input type="number" value={xform.pos[i]} onChange={(e) => {
              const v = [...xform.pos]; v[i] = Number(e.target.value); setIfcXform({ pos: v });
            }} />
          </label>
        ))}
      </div>
      <div className="grid3">
        {[['Rx°', 0], ['Ry°', 1], ['Rz°', 2]].map(([l, i]) => (
          <label key={l} className="fld"><span>{l}</span>
            <input type="number" value={xform.rot[i]} onChange={(e) => {
              const v = [...xform.rot]; v[i] = Number(e.target.value); setIfcXform({ rot: v });
            }} />
          </label>
        ))}
      </div>
      <div className="btnrow">
        <button onClick={() => { resetIfcXform(); fitIfcLive(); }}>Reset to 0,0,0 + 0°</button>
      </div>

      {sel && (
        <div className="props">
          <div className="sect">Properties — click model or list to query</div>
          <label className="fld"><span>Name (view label)</span>
            <input value={sel.name} onChange={(e) => { renameEl(sel.key, e.target.value); saveAnn(ifc.fileName, 'names', sel.key, e.target.value); }} />
          </label>
          <div className="kv"><span>Type</span><b>{sel.typeLabel}</b></div>
          <div className="kv"><span>GlobalId</span><code>{sel.key}</code></div>
          <div className="kv"><span>Express #</span><code>{sel.expressID}</code></div>
          <div className="kv"><span>Size X·Y·Z</span><b>{mm3(sel.sizeModel, u)} mm</b></div>
          <div className="kv"><span>Base elev</span><b>{mm(sel.baseModel, u)} mm</b></div>
          <label className="fld"><span>Level</span>
            <select value={sel.storey || ''} onChange={(e) => {
              const v = e.target.value || null;
              moveEl(sel.key, v);
              saveAnn(ifc.fileName, 'storeys', sel.key, v);
            }}>
              <option value="">Auto (by elevation)</option>
              {explicitStoreys.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <div className="btnrow">
            <button onClick={() => zoomTo(sel.key)}>Zoom to</button>
            <button onClick={async () => {
              const { ifcSession, subsetBox } = await import('./session.js');
              const mesh = ifcSession.meshes[sel.key];
              if (!mesh) return;
              const bb = subsetBox(mesh);
              if (bb.isEmpty() || !Number.isFinite(bb.min.x + bb.max.x)) return;
              const x = Math.round(bb.min.x * 1000);
              const y = Math.round(-bb.max.z * 1000);
              const z = Math.round(bb.min.y * 1000);
              const lx = Math.max(Math.round((bb.max.x - bb.min.x) * 1000), 50);
              const ly = Math.max(Math.round((bb.max.z - bb.min.z) * 1000), 50);
              const lz = Math.max(Math.round((bb.max.y - bb.min.y) * 1000), 50);
              const name = sel.name || `${sel.typeLabel || 'Concrete'} ${concretes.length + 1}`;
              useStore.getState().addConcrete({ name, lx, ly, lz, x, y, z });
            }} title="Convert this IFC element into a concrete member with exact dimensions">⚡ Trace Concrete</button>
            <button onClick={() => solo(sel.key)}>Isolate</button>
            <button onClick={() => toggleIfcElement(sel.key)}>{sel.visible ? 'Hide' : 'Show'}</button>
            <button className="danger" onClick={() => setSelected(null)}>Clear</button>
          </div>
        </div>
      )}

      {ifc.level !== 'element' ? (
        <>
          <div className="sect">Types</div>
          {ifc.types.map((t) => (
            <label key={t.key} className="chk">
              <input type="checkbox" checked={t.visible} onChange={() => toggleIfcType(t.key)} />
              {t.label} ({t.count})
            </label>
          ))}
        </>
      ) : (
        <>
          <div className="sect">Levels ({levels.length})</div>
          {levels.map((L) => {
            const on = ifc.elements.filter((e) => levelKeyOf(e) === L.key && e.visible).length;
            return (
              <label key={L.key} className="chk">
                <input type="checkbox" checked={on === L.keys.length && on > 0}
                  ref={(el) => { if (el) el.indeterminate = on > 0 && on < L.keys.length; }}
                  onChange={() => {
                    const target = !(on === L.keys.length);
                    setIfcElements((e) => (levelKeyOf(e) === L.key ? { ...e, visible: target } : e));
                  }} />
                {L.label} ({on}/{L.keys.length})
              </label>
            );
          })}
          <div className="sect">Elements</div>
          <input className="cname search" placeholder="filter name / type / level…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {ifc.types.map((t) => {
            const rows = ifc.elements.filter((e) => e.type === t.key && match(e));
            if (!rows.length) return null;
            const on = rows.filter((e) => e.visible).length;
            return (
              <details key={t.key} open={!!q} className="ifcgroup">
                <summary>
                  <input type="checkbox" checked={on === rows.length && on > 0}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => {
                      const target = !(on === rows.length);
                      setIfcElements((e) => (e.type === t.key ? { ...e, visible: target } : e));
                    }} />
                  {t.label} ({on}/{rows.length})
                </summary>
                {rows.map((e) => (
                  <div key={e.key} className={`ifcrow${e.key === selected ? ' sel' : ''}`}>
                    <label className="chk grow">
                      <input type="checkbox" checked={e.visible} onChange={() => toggleIfcElement(e.key)} onClick={(ev) => ev.stopPropagation()} />
                      <span className="ename" title={`${e.name} · ${levelLabelOf(e, u)}`} onClick={() => setSelected(e.key)}>{e.name}</span>
                    </label>
                    <span className="lvl">{levelLabelOf(e, u)}</span>
                    <button className="sm ghost" title={`Isolate ${e.name}`} onClick={() => solo(e.key)}>◎</button>
                  </div>
                ))}
              </details>
            );
          })}
        </>
      )}
    </div>
  );
}
