import { useEffect, useRef, useState } from 'react';
import Scene from './viewer/Scene.jsx';
import { useStore } from './store.js';
import { REBAR_TYPES, DIM_FIELDS_BY_TYPE, applyTypeDefaults, distCount } from './bbs/shapes.js';
import { enrichBar, downloadCsv, parseCsv } from './bbs/csv.js';
import IfcPanel, { IfcLoadButton, fitIfcLive } from './ifc/IfcPanel.jsx';
// NOTE: ./ifc/session.js (web-ifc parser) is dynamically imported on first
// IFC load so the main bundle stays light. See IfcPanel handlers.
import './App.css';

function Field({ label, value, onChange, type = 'number' }) {
  return (
    <label className="fld">
      <span>{label}</span>
      <input
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
      />
    </label>
  );
}

const FIELDS_BY_TYPE = DIM_FIELDS_BY_TYPE;

function BarEditor() {
  const bars = useStore((s) => s.bars);
  const idx = useStore((s) => s.selectedBar);
  const updateBar = useStore((s) => s.updateBar);
  const replaceBar = useStore((s) => s.replaceBar);
  const addBar = useStore((s) => s.addBar);
  const removeBar = useStore((s) => s.removeBar);
  const selectBar = useStore((s) => s.selectBar);
  const concretes = useStore((s) => s.concretes);
  const cover = useStore((s) => s.cover);
  const setCover = useStore((s) => s.setCover);
  const [hostId, setHostId] = useState(null);
  const bar = bars[idx];
  if (!bar) return <div className="panel"><p>No bars yet — pick a type below.</p><TypeGrid onAdd={addBar} /></div>;
  const set = (k, v) => updateBar(idx, { [k]: v });
  const extra = FIELDS_BY_TYPE[bar.Rebar_Type] || [];

  return (
    <div className="panel">
      <label className="fld"><span>Selected bar ({bars.length} total)</span>
        <select value={idx} onChange={(e) => selectBar(Number(e.target.value))}>
          {bars.map((b, i) => <option key={i} value={i}>{b.Bar_mark} · {b.Rebar_Type} · Ø{b.Dia}</option>)}
        </select>
      </label>
      <div className="row2">
        <label className="fld"><span>Shape type — switch anytime</span>
          <select value={bar.Rebar_Type} onChange={(e) => replaceBar(idx, applyTypeDefaults(bar, e.target.value))}>
            {REBAR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <Field label="Bar mark" type="text" value={bar.Bar_mark} onChange={(v) => set('Bar_mark', v)} />
      </div>
      <div className="grid3">
        <Field label="Dia (mm)" value={bar.Dia} onChange={(v) => set('Dia', v)} />
        <Field label="Sets ×" value={bar.qty} onChange={(v) => set('qty', v)} />
        <Field label="Group" type="text" value={bar.Group} onChange={(v) => set('Group', v)} />
      </div>
      <div className="sect">Dimensions (mm)</div>
      {extra.map((f) => f === 'bent_up_down' ? (
        <label key={f} className="fld"><span>bent_up_down</span>
          <select value={bar[f] ?? 'up'} onChange={(e) => set(f, e.target.value)}>
            <option value="up">up</option>
            <option value="down">down</option>
          </select>
        </label>
      ) : (
        <Field key={f} label={f} value={bar[f]} onChange={(v) => set(f, v)} />
      ))}
      <div className="sect">Distribution — like Reinforcement workbench (→ {distCount(bar)} bars)</div>
      <div className="distnote">Copies at Pos + (ix·spacing_x, iy·spacing_y, 0) + offset — same as FreeCAD <code>place_c_link_*</code>. Applies to every shape.</div>
      <div className="grid3">
        <Field label="Count X" value={bar.qty_x ?? 1} onChange={(v) => set('qty_x', v)} />
        <Field label="Spacing X" value={bar.spacing_x ?? 0} onChange={(v) => set('spacing_x', v)} />
        <Field label="Offset X" value={bar.offset_x ?? 0} onChange={(v) => set('offset_x', v)} />
        <Field label="Count Y" value={bar.qty_y ?? 1} onChange={(v) => set('qty_y', v)} />
        <Field label="Spacing Y" value={bar.spacing_y ?? 0} onChange={(v) => set('spacing_y', v)} />
        <Field label="Offset Y" value={bar.offset_y ?? 0} onChange={(v) => set('offset_y', v)} />
        <Field label="Offset Z" value={bar.offset_z ?? 0} onChange={(v) => set('offset_z', v)} />
      </div>
      <div className="sect">Position (mm) · rotation (°) · cover (mm)</div>
      <div className="grid3">
        <Field label="Pos_x" value={bar.Pos_x} onChange={(v) => set('Pos_x', v)} />
        <Field label="Pos_y" value={bar.Pos_y} onChange={(v) => set('Pos_y', v)} />
        <Field label="Pos_z" value={bar.Pos_z} onChange={(v) => set('Pos_z', v)} />
        <Field label="Rotation" value={bar.Pos_Rotation} onChange={(v) => set('Pos_Rotation', v)} />
        <Field label="Plane" value={bar.Plane} onChange={(v) => set('Plane', v)} />
        <Field label="Cover" value={cover} onChange={(v) => setCover(v)} />
      </div>
      {(bar.Rebar_Type === 'c_link' || bar.Rebar_Type === 'c_link_with_hook') && concretes.length > 0 && (
        <>
          <div className="sect">Snap to cover — fit stirrup inside host</div>
          <div className="distnote">Sizes the stirrup centreline to host − 2·cover − Ø and drops its corner at cover + Ø/2 inside the host. Resets rotation to 0° (fit assumes axis alignment).</div>
          <div className="crow">
            <select
              className="cname"
              value={hostId && concretes.some((c) => c.id === hostId) ? hostId : concretes[0].id}
              onChange={(e) => setHostId(e.target.value)}
            >
              {concretes.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.lx}×{c.ly}×{c.lz}</option>)}
            </select>
            <button onClick={() => {
              const host = concretes.find((c) => c.id === hostId) || concretes[0];
              const dia = Number(bar.Dia) || 16;
              const cv = Number(cover) || 0;
              const inset = cv + dia / 2;
              updateBar(idx, {
                c_length_a: Math.max(dia * 2, Math.round(host.lx - 2 * cv - dia)),
                c_length_b: Math.max(dia * 2, Math.round(host.ly - 2 * cv - dia)),
                Pos_x: Math.round((host.x + inset) * 10) / 10,
                Pos_y: Math.round((host.y + inset) * 10) / 10,
                Pos_z: Math.round((host.z + inset) * 10) / 10,
                Pos_Rotation: 0,
              });
            }}>Fit to host</button>
          </div>
        </>
      )}
      <div className="sect">Add bar</div>
      <TypeGrid onAdd={addBar} />
      <button className="danger block" onClick={() => removeBar(idx)}>Delete this bar</button>
    </div>
  );
}

function TypeGrid({ onAdd }) {
  return (
    <div className="typegrid">
      {REBAR_TYPES.map((t) => <button key={t} onClick={() => onAdd(t)} title={`Add ${t}`}>+ {t}</button>)}
    </div>
  );
}

function ConcreteEditor() {
  const concretes = useStore((s) => s.concretes);
  const addConcrete = useStore((s) => s.addConcrete);
  const updateConcrete = useStore((s) => s.updateConcrete);
  const removeConcrete = useStore((s) => s.removeConcrete);
  const drawMode = useStore((s) => s.drawMode);
  const setDrawMode = useStore((s) => s.setDrawMode);
  const setShading = useStore((s) => s.setShading);

  return (
    <>
    <IfcLoadButton />
    <div className="panel">
      <div className="sect flush">Trace & Draw from IFC / Snapping</div>
      <div className="btnrow inline">
        <button className={drawMode === 'beam' ? 'on' : ''} onClick={() => { setDrawMode(drawMode === 'beam' ? null : 'beam'); setShading('wireframe'); }}>✏️ Draw Beam</button>
        <button className={drawMode === 'column' ? 'on' : ''} onClick={() => { setDrawMode(drawMode === 'column' ? null : 'column'); setShading('wireframe'); }}>✏️ Draw Column</button>
        <button className={drawMode === 'slab' ? 'on' : ''} onClick={() => { setDrawMode(drawMode === 'slab' ? null : 'slab'); setShading('wireframe'); }}>✏️ Draw Slab</button>
        <button className={drawMode === 'trace_ifc' ? 'on' : ''} onClick={() => { setDrawMode(drawMode === 'trace_ifc' ? null : 'trace_ifc'); setShading('wireframe'); }}>⚡ Auto-Trace IFC</button>
      </div>
      <div className="distnote" style={{ marginTop: 6 }}>
        {drawMode
          ? '🎯 Snap to nodes/joints on the IFC wireframe and click to trace.'
          : 'Tip: Switch to Wireframe mode to see internal joints, nodes, and frames clearly.'}
      </div>

      <div className="sect">Concrete Elements ({concretes.length})</div>
      {concretes.map((c) => (
        <div key={c.id} className="cbox">
          <div className="crow">
            <input className="cname" value={c.name} onChange={(e) => updateConcrete(c.id, { name: e.target.value })} />
            <button className="danger sm" onClick={() => removeConcrete(c.id)}>×</button>
          </div>
          <div className="grid3">
            {[['lx', 'Lx'], ['ly', 'Ly'], ['lz', 'Hz']].map(([k, l]) => (
              <label key={k} className="fld"><span>{l}</span>
                <input type="number" value={c[k]} onChange={(e) => updateConcrete(c.id, { [k]: Number(e.target.value) })} />
              </label>
            ))}
          </div>
          <div className="grid3">
            {[['x', 'X'], ['y', 'Y'], ['z', 'Z']].map(([k, l]) => (
              <label key={k} className="fld"><span>{l}</span>
                <input type="number" value={c[k]} onChange={(e) => updateConcrete(c.id, { [k]: Number(e.target.value) })} />
              </label>
            ))}
          </div>
        </div>
      ))}
      <div className="btnrow">
        <button onClick={() => addConcrete({ name: 'Beam', lx: 6000, ly: 400, lz: 600, x: 0, y: 0, z: 0 })}>+ Preset Beam</button>
        <button onClick={() => addConcrete({ name: 'Slab', lx: 6000, ly: 4000, lz: 200, x: 0, y: 0, z: 0 })}>+ Preset Slab</button>
        <button onClick={() => addConcrete({ name: 'Column', lx: 400, ly: 400, lz: 3000, x: 0, y: 0, z: 0 })}>+ Preset Column</button>
      </div>
    </div>
    </>
  );
}

function ViewportBar() {
  const showConcrete = useStore((s) => s.showConcrete);
  const toggleConcrete = useStore((s) => s.toggleConcrete);
  const bars = useStore((s) => s.bars);
  const idx = useStore((s) => s.selectedBar);
  const rows = bars.map(enrichBar);
  const totalW = rows.reduce((a, r) => a + (r.Weight_kg || 0), 0);
  const totalBars = rows.reduce((a, r) => a + (r._copies || 1), 0);
  const sel = rows[idx];
  const ifc = useStore((s) => s.ifc);
  const ifcPick = useStore((s) => s.ifcPick);
  const setIfcPick = useStore((s) => s.setIfcPick);
  const cover = useStore((s) => s.cover);
  const setCover = useStore((s) => s.setCover);
  const lastPick = useStore((s) => s.lastPick);
  const shading = useStore((s) => s.shading);
  const setShading = useStore((s) => s.setShading);
  const navMode = useStore((s) => s.navMode);
  const setNavMode = useStore((s) => s.setNavMode);
  const section = useStore((s) => s.section);
  const toggleSection = useStore((s) => s.toggleSection);
  const fitSectionToIfc = useStore((s) => s.fitSectionToIfc);
  const thirdSection = useStore((s) => s.thirdSection);
  const setSection = useStore((s) => s.setSection);
  const showBox = section?.showBox ?? true;

  const drawMode = useStore((s) => s.drawMode);
  const setDrawMode = useStore((s) => s.setDrawMode);
  const drawStart = useStore((s) => s.drawStart);
  const snapNode = useStore((s) => s.snapNode);

  return (
    <>
      <div className="vptools">
        <button className={showConcrete ? 'on' : ''} onClick={toggleConcrete}>◧ Concrete</button>
        <span className="seg" title="Shading modes">
          <button className={shading === 'solid' ? 'on' : ''} onClick={() => setShading('solid')} title="Solid shading">Solid</button>
          <button className={shading === 'xray' ? 'on' : ''} onClick={() => setShading('xray')} title="X-ray: see-through concrete">X-ray</button>
          <button className={shading === 'wireframe' ? 'on' : ''} onClick={() => setShading('wireframe')} title="Wireframe mode (snap nodes & joints)">Wireframe</button>
        </span>
        <span className="seg" title="Trace & draw concrete members from IFC or scene">
          <button className={drawMode === 'beam' ? 'on' : ''} onClick={() => setDrawMode(drawMode === 'beam' ? null : 'beam')} title="Draw Beam: snap two corner/joint nodes">✏️ Beam</button>
          <button className={drawMode === 'column' ? 'on' : ''} onClick={() => setDrawMode(drawMode === 'column' ? null : 'column')} title="Draw Column: snap two corner/joint nodes">✏️ Column</button>
          <button className={drawMode === 'slab' ? 'on' : ''} onClick={() => setDrawMode(drawMode === 'slab' ? null : 'slab')} title="Draw Slab: snap two corner/joint nodes">✏️ Slab</button>
          <button className={drawMode === 'trace_ifc' ? 'on' : ''} onClick={() => setDrawMode(drawMode === 'trace_ifc' ? null : 'trace_ifc')} title="1-Click Auto-Trace: click any IFC beam/column/slab to convert it">⚡ Auto-Trace</button>
        </span>
        <span className="seg" title="Left-mouse behavior (middle-drag always orbits)">
          <button className={navMode === 'select' ? 'on' : ''} onClick={() => setNavMode('select')} title="LMB selects bars/IFC (orbit with MMB)">Select</button>
          <button className={navMode === 'orbit' ? 'on' : ''} onClick={() => setNavMode('orbit')} title="LMB orbits the view">Orbit</button>
        </span>
        <button className={section?.enabled ? 'on' : ''} onClick={toggleSection} title="Revit-style section box: push/pull faces, move or rotate gizmo">◫ Section</button>
        {section?.enabled && (
          <span className="seg">
            {[['faces', 'Faces'], ['translate', 'Move'], ['rotate', 'Rotate']].map(([m, label]) => (
              <button key={m} className={(section?.mode ?? 'faces') === m ? 'on' : ''} onClick={() => setSection({ mode: m })}>{label}</button>
            ))}
          </span>
        )}
        {section?.enabled && ifc && <button onClick={fitSectionToIfc} title="Reset section box to model bounds">Fit box</button>}
        {section?.enabled && (
          <button className={showBox ? 'on' : ''} onClick={() => setSection({ showBox: !showBox })} title="Hide the box visuals — the cut stays active">👁 Box</button>
        )}
        {section?.enabled && <button onClick={thirdSection} title="Shrink to middle third — proves the cut with no dragging">Test cut</button>}
        {section?.enabled && (
          <button className={(section?.solidCut ?? true) ? 'on' : ''} onClick={() => setSection({ solidCut: !(section?.solidCut ?? true) })} title="Fill cut faces solid (stencil caps) or leave hollow">Solid cut</button>
        )}
        <button className={ifcPick ? 'on' : ''} onClick={() => setIfcPick(!ifcPick)} title="Click IFC / concrete / bar surfaces to move the selected bar there">🎯 Pick pos</button>
        <label className="cover" title="Concrete cover (mm) — pick-to-place sinks the bar centreline this far + Ø/2 inside the clicked face">
          cover
          <input type="number" value={cover} min={0} onChange={(e) => setCover(Number(e.target.value))} />
        </label>
        {ifc && <button onClick={fitIfcLive}>Fit IFC</button>}
        <span className="vstat">{totalBars} bars · {totalW.toFixed(1)} kg</span>
      </div>
      <div className="overlay">
        drag = orbit · wheel = zoom · right-drag = pan · click bar = select
        {drawMode && !drawStart && <b> — 📐 [{drawMode.toUpperCase()} TOOL] Click 1st corner/node (snapping active) · Esc to cancel</b>}
        {drawMode && drawStart && <b> — 📐 [{drawMode.toUpperCase()} TOOL] Click opposite corner/node to complete member · Esc to cancel</b>}
        {snapNode && <b> — 📍 Snapped: ({snapNode.x}, {snapNode.y}, {snapNode.z}) [{snapNode.type}]</b>}
        {section?.enabled && <b> — drag ◼ face cubes to push/pull the section</b>}
        {ifcPick && <b> — pick mode: click IFC / concrete to place the selected bar (cover {cover}mm + Ø/2 inside the face)</b>}
        {lastPick && <b> — placed ({lastPick.Pos_x}, {lastPick.Pos_y}, {lastPick.Pos_z})</b>}
        {sel && <b> — {sel.Bar_mark} · {sel.Rebar_Type} · Ø{sel.Dia} · {sel._copies} bars · cut {sel._cut} mm · {sel.Weight_kg} kg</b>}
      </div>
    </>
  );
}

function BbsStrip() {
  const bars = useStore((s) => s.bars);
  const setBars = useStore((s) => s.setBars);
  const selectBar = useStore((s) => s.selectBar);
  const selectedBar = useStore((s) => s.selectedBar);
  const fileRef = useRef(null);
  const rows = bars.map(enrichBar);
  const totalW = rows.reduce((a, r) => a + (r.Weight_kg || 0), 0);
  const totalBars = rows.reduce((a, r) => a + (r._copies || 1), 0);

  const onImport = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try { setBars(parseCsv(String(rd.result))); }
      catch (err) { alert('CSV parse failed: ' + err.message); }
    };
    rd.readAsText(f);
    e.target.value = '';
  };

  return (
    <footer className="bbs">
      <div className="bbstool">
        <strong>BBS · {rows.length} rows · {totalBars} bars · {totalW.toFixed(1)} kg</strong>
        <span className="btnrow inline">
          <button onClick={() => downloadCsv(bars)}>⤓ rebar_scheduling.csv</button>
          <button onClick={() => fileRef.current?.click()}>⤒ Import</button>
          <input ref={fileRef} type="file" accept=".csv" hidden onChange={onImport} />
        </span>
        <span className="hint">CSV loads straight into FreeCAD <code>rebar_detailing.py</code></span>
      </div>
      <div className="tblwrap">
        <table>
          <thead><tr><th>#</th><th>Mark</th><th>Type</th><th>Ø</th><th>Bars</th><th>Cut (mm)</th><th>Wt (kg)</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={i === selectedBar ? 'sel' : ''} onClick={() => selectBar(i)}>
                <td>{r.Rebar_tag}</td><td>{r.Bar_mark}</td><td>{r.Rebar_Type}</td>
                <td>{r.Dia}</td><td>{r._copies}</td><td>{r._cut}</td><td>{r.Weight_kg}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </footer>
  );
}

function StatusBar() {
  const perf = useStore((s) => s.perf);
  const navMode = useStore((s) => s.navMode);
  const bars = useStore((s) => s.bars);
  const rows = bars.map(enrichBar);
  const totalW = rows.reduce((a, r) => a + (r.Weight_kg || 0), 0);
  const totalBars = rows.reduce((a, r) => a + (r._copies || 1), 0);
  const dist = perf.dist >= 1
    ? `${perf.dist.toFixed(1)} m`
    : `${Math.round(perf.dist * 1000).toLocaleString('en-US')} mm`;
  return (
    <footer className="statusbar">
      <span>{navMode === 'orbit' ? 'LMB orbit' : 'LMB select'} · MMB orbit · RMB pan · wheel zoom-to-cursor · Esc deselect IFC</span>
      <span>{perf.fps} fps · cam {dist} · {totalBars} bars · {totalW.toFixed(1)} kg</span>
    </footer>
  );
}

export default function App() {
  const [tab, setTab] = useState('rebar');
  const ifcActive = useStore((s) => s.ifcActive);
  const leftOpen = useStore((s) => s.leftOpen);
  const setLeftOpen = useStore((s) => s.setLeftOpen);
  // Headless/smoke hook: ?autotest=section drops the section box and cuts it.
  // &sample=1 also loads public/sample-concrete.ifc first (same path as upload).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('autotest') === 'section') {
      const t = setTimeout(async () => {
        const st = useStore.getState();
        if (q.get('sample') === '1' && !st.ifc) {
          try {
            const { loadIfc } = await import('./ifc/session.js');
            const res = await fetch('sample-concrete.ifc');
            const buf = await res.arrayBuffer();
            st.setIfc(await loadIfc(new File([buf], 'sample-concrete.ifc')));
            st.fitSectionToIfc();
          } catch (err) { console.warn('[autotest] sample load failed:', err); }
        }
        if (!useStore.getState().section) useStore.getState().toggleSection();
        useStore.getState().thirdSection();
      }, 1500);
      return () => clearTimeout(t);
    }
  }, []);
  return (
    <div className="app">
      <header><strong>barbending</strong><span>browser BBS · Three.js · FreeCAD-CSV compatible · {import.meta.env.DEV ? `dev-live (server ${typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : '?'})` : `build ${typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : '?'}`}</span></header>
      <div className="work">
        {leftOpen ? (
        <aside className="side">
          <div className="tabs">
            <button className={tab === 'rebar' ? 'on' : ''} onClick={() => setTab('rebar')}>Rebar</button>
            <button className={tab === 'concrete' ? 'on' : ''} onClick={() => setTab('concrete')}>Concrete</button>
            <button className="collapse" onClick={() => setLeftOpen(false)} title="Collapse panel">«</button>
          </div>
          <div className="sidebody">{tab === 'rebar' ? <BarEditor /> : <ConcreteEditor />}</div>
        </aside>
        ) : (
        <div className="rail"><button onClick={() => setLeftOpen(true)} title="Expand panel">»</button></div>
        )}
        <section className="view"><Scene /><ViewportBar /></section>
        {ifcActive && (
          <aside className="rside">
            <div className="rsidehead">IFC control</div>
            <div className="sidebody"><IfcPanel /></div>
          </aside>
        )}
      </div>
      <BbsStrip />
      <StatusBar />
    </div>
  );
}
