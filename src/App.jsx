import { useEffect, useRef, useState } from 'react';
import Scene from './viewer/Scene.jsx';
import { fmtLen } from './viewer/Scene.jsx';
import { useStore } from './store.js';
import { REBAR_TYPES, DIM_FIELDS_BY_TYPE, applyTypeDefaults, distCount } from './bbs/shapes.js';
import { enrichBar, downloadCsv, downloadBbsCsv, parseCsv, SHAPE_CODES } from './bbs/csv.js';
import { lapLengthMm } from './bbs/calc.js';
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

// Polyline length of app-mm measure points (mirrors MeasureView segments).
function measureTotal(points) {
  let t = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay, az] = points[i - 1];
    const [bx, by, bz] = points[i];
    t += Math.hypot(bx - ax, by - ay, bz - az);
  }
  return t;
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
  const bond = useStore((s) => s.bond);
  const setBond = useStore((s) => s.setBond);
  const lapAnchor = useStore((s) => s.lapAnchor);
  const setLapAnchor = useStore((s) => s.setLapAnchor);
  const applyLapSplice = useStore((s) => s.applyLapSplice);
  const lastLap = useStore((s) => s.lastLap);
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
      <div className="sect">Host & visibility (view only — BBS + CSV stay complete)</div>
      <div className="row2">
        <label className="fld"><span>Host member — hides with it</span>
          <select value={bar.host && concretes.some((c) => c.id === bar.host) ? bar.host : ''} onChange={(e) => set('host', e.target.value || null)}>
            <option value="">— None —</option>
            {concretes.map((c) => <option key={c.id} value={c.id}>{c.name}{c.visible === false ? ' (hidden)' : ''}</option>)}
          </select>
        </label>
        <label className="chk"><input type="checkbox" checked={!!bar.hidden} onChange={(e) => set('hidden', e.target.checked || undefined)} /> Hide this bar</label>
      </div>
      <div className="sect">Position (mm) · rotation (°) · plane · cover (mm)</div>
      <div className="grid3">
        <Field label="Pos_x" value={bar.Pos_x} onChange={(v) => set('Pos_x', v)} />
        <Field label="Pos_y" value={bar.Pos_y} onChange={(v) => set('Pos_y', v)} />
        <Field label="Pos_z" value={bar.Pos_z} onChange={(v) => set('Pos_z', v)} />
        <Field label="Rotation" value={bar.Pos_Rotation} onChange={(v) => set('Pos_Rotation', v)} />
        <label className="fld"><span>Plane</span>
          <select value={String(bar.Plane ?? 'XZ').toUpperCase()} onChange={(e) => set('Plane', e.target.value)}>
            <option value="XZ">XZ (Vertical Front / Beam)</option>
            <option value="YZ">YZ (Vertical Side / Stirrup)</option>
            <option value="XY">XY (Horizontal / Slab)</option>
          </select>
        </label>
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
              const isBeamX = host.lx >= host.ly && host.lx >= host.lz;
              const isColZ = host.lz > host.lx && host.lz > host.ly;
              if (isBeamX) {
                updateBar(idx, {
                  host: host.id,
                  Plane: 'YZ',
                  c_length_a: Math.max(dia * 2, Math.round(host.ly - 2 * cv - dia)),
                  c_length_b: Math.max(dia * 2, Math.round(host.lz - 2 * cv - dia)),
                  Pos_x: Math.round((host.x + inset) * 10) / 10,
                  Pos_y: Math.round((host.y + inset) * 10) / 10,
                  Pos_z: Math.round((host.z + inset) * 10) / 10,
                  Pos_Rotation: 0,
                  spacing_x: bar.spacing_x || 150,
                  qty_x: Math.max(1, Math.floor((host.lx - 2 * cv) / (bar.spacing_x || 150))),
                });
              } else if (isColZ) {
                updateBar(idx, {
                  host: host.id,
                  Plane: 'XY',
                  c_length_a: Math.max(dia * 2, Math.round(host.lx - 2 * cv - dia)),
                  c_length_b: Math.max(dia * 2, Math.round(host.ly - 2 * cv - dia)),
                  Pos_x: Math.round((host.x + inset) * 10) / 10,
                  Pos_y: Math.round((host.y + inset) * 10) / 10,
                  Pos_z: Math.round((host.z + inset) * 10) / 10,
                  Pos_Rotation: 0,
                });
              } else {
                updateBar(idx, {
                  host: host.id,
                  Plane: 'XZ',
                  c_length_a: Math.max(dia * 2, Math.round(host.lx - 2 * cv - dia)),
                  c_length_b: Math.max(dia * 2, Math.round(host.lz - 2 * cv - dia)),
                  Pos_x: Math.round((host.x + inset) * 10) / 10,
                  Pos_y: Math.round((host.y + inset) * 10) / 10,
                  Pos_z: Math.round((host.z + inset) * 10) / 10,
                  Pos_Rotation: 0,
                });
              }
            }}>Fit to host</button>
          </div>
        </>
      )}
      <div className="sect">🔗 Lap splice (EC2 bond table)</div>
      <div className="distnote">This bar laps onto the anchor's end or start. Supports straight, bent, crank & double-crank bars; length from the smaller Ø (least size bar). Or arm 🔗 Lap above and click anchor, then a bar.</div>
      <div className="row2">
        <label className="fld"><span>Anchor bar</span>
          <select value={lapAnchor ?? ''} onChange={(e) => setLapAnchor(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">— Pick —</option>
            {bars.map((b, i) => i !== idx && <option key={i} value={i}>{b.Bar_mark} · {b.Rebar_Type} · Ø{b.Dia}</option>)}
          </select>
        </label>
        <label className="fld"><span>Bond (default poor = safe)</span>
          <select value={bond} onChange={(e) => setBond(e.target.value)}>
            <option value="good">good</option>
            <option value="poor">poor</option>
          </select>
        </label>
      </div>
      <div className="crow">
        <span className="hint">lap {(() => {
          const diaA = Number(bar.Dia) || 0, diaB = Number(bars[lapAnchor]?.Dia) || 0;
          const dia = (diaA > 0 && diaB > 0) ? Math.min(diaA, diaB) : (diaA || diaB);
          return lapLengthMm(dia, bond).toLocaleString('en-US');
        })()} mm</span>
        <button onClick={() => {
          if (lapAnchor == null || bars[lapAnchor] === undefined) { alert('Pick an anchor bar first (dropdown or 🔗 Lap clicks).'); return; }
          const r = applyLapSplice(lapAnchor, idx);
          if (!r.ok) alert(r.msg);
        }}>Lap onto anchor</button>
      </div>
      {lastLap && lastLap.b === bar.Bar_mark && <div className="distnote">Last: {lastLap.b} → {lastLap.a} · {lastLap.len.toLocaleString('en-US')} mm ({lastLap.bond} bond, Ø{lastLap.dia})</div>}
      <div className="sect">Add bar</div>      <TypeGrid onAdd={addBar} />
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
        <div key={c.id} className={c.visible === false ? 'cbox hidden' : 'cbox'}>
          <div className="crow">
            <input className="cname" value={c.name} onChange={(e) => updateConcrete(c.id, { name: e.target.value })} />
            <button className="sm" title={c.visible === false ? 'Show (bars inside reappear)' : 'Hide (bars inside hide too)'} onClick={() => updateConcrete(c.id, { visible: c.visible === false ? true : false })}>{c.visible === false ? '🚫' : '👁'}</button>
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

function MeasureHud() {
  const measure = useStore((s) => s.measure);
  const setMeasureActive = useStore((s) => s.setMeasureActive);
  const clearMeasure = useStore((s) => s.clearMeasure);
  const bars = useStore((s) => s.bars);
  const selectedBar = useStore((s) => s.selectedBar);
  const selectBar = useStore((s) => s.selectBar);
  const adjustBarFromMeasure = useStore((s) => s.adjustBarFromMeasure);
  const cover = useStore((s) => s.cover);

  const [targetX, setTargetX] = useState('');
  const [targetY, setTargetY] = useState('');
  const [targetZ, setTargetZ] = useState('');
  const [targetVec, setTargetVec] = useState('');
  const [ctrlBarIdx, setCtrlBarIdx] = useState(selectedBar ?? 0);

  useEffect(() => {
    if (selectedBar != null && selectedBar !== ctrlBarIdx) {
      setCtrlBarIdx(selectedBar);
    }
  }, [selectedBar]);

  if (!measure?.active) return null;

  const pts = measure.points || [];
  const p1 = pts[0];
  const p2 = pts[1];

  let dx = 0, dy = 0, dz = 0, len = 0;
  if (p1 && p2) {
    dx = p2[0] - p1[0];
    dy = p2[1] - p1[1];
    dz = p2[2] - p1[2];
    len = Math.hypot(dx, dy, dz);
  }

  const activeBar = bars[ctrlBarIdx] || bars[selectedBar] || bars[0];

  const applyShiftX = (desiredDist) => {
    if (!p1 || !p2 || !activeBar) return;
    const target = Number(desiredDist);
    if (!Number.isFinite(target)) return;
    const sign = dx < 0 ? -1 : 1;
    const targetDx = sign * Math.abs(target);
    const shiftX = targetDx - dx;
    const newP2 = [p1[0] + targetDx, p2[1], p2[2]];
    adjustBarFromMeasure(ctrlBarIdx, shiftX, 0, 0, newP2);
  };

  const applyShiftY = (desiredDist) => {
    if (!p1 || !p2 || !activeBar) return;
    const target = Number(desiredDist);
    if (!Number.isFinite(target)) return;
    const sign = dy < 0 ? -1 : 1;
    const targetDy = sign * Math.abs(target);
    const shiftY = targetDy - dy;
    const newP2 = [p2[0], p1[1] + targetDy, p2[2]];
    adjustBarFromMeasure(ctrlBarIdx, 0, shiftY, 0, newP2);
  };

  const applyShiftZ = (desiredDist) => {
    if (!p1 || !p2 || !activeBar) return;
    const target = Number(desiredDist);
    if (!Number.isFinite(target)) return;
    const sign = dz < 0 ? -1 : 1;
    const targetDz = sign * Math.abs(target);
    const shiftZ = targetDz - dz;
    const newP2 = [p2[0], p2[1], p1[2] + targetDz];
    adjustBarFromMeasure(ctrlBarIdx, 0, 0, shiftZ, newP2);
  };

  const applyShiftVec = (desiredLen) => {
    if (!p1 || !p2 || !activeBar) return;
    const target = Number(desiredLen);
    if (!Number.isFinite(target) || !(len > 0.001)) return;
    const scale = target / len;
    const targetDx = dx * scale;
    const targetDy = dy * scale;
    const targetDz = dz * scale;
    const shiftX = targetDx - dx;
    const shiftY = targetDy - dy;
    const shiftZ = targetDz - dz;
    const newP2 = [p1[0] + targetDx, p1[1] + targetDy, p1[2] + targetDz];
    adjustBarFromMeasure(ctrlBarIdx, shiftX, shiftY, shiftZ, newP2);
  };

  return (
    <div className="measure-hud">
      <div className="measure-hud-header">
        <span>📏 Measure & Clearance Inspector</span>
        <span style={{ display: 'flex', gap: 4 }}>
          {pts.length > 0 && <button className="ghost sm" onClick={clearMeasure} title="Clear measured points">Clear</button>}
          <button className="ghost sm" onClick={() => setMeasureActive(false)} title="Close measure tool (Esc)">✕</button>
        </span>
      </div>

      {pts.length < 2 ? (
        <div className="distnote">
          {pts.length === 0
            ? 'Click 1st point on Concrete, Rebar, or IFC surface (magnet snapping active).'
            : `Point 1 (Ref): (${p1[0]}, ${p1[1]}, ${p1[2]}) mm. Click 2nd point on Rebar or Concrete.`}
        </div>
      ) : (
        <>
          <div className="measure-stat-box" style={{ marginBottom: 6 }}>
            <div className="measure-stat-label">3D Vector Distance</div>
            <div className="measure-stat-val vector" style={{ fontSize: 15 }}>{fmtLen(len)}</div>
          </div>
          <div className="measure-hud-grid">
            <div className="measure-stat-box">
              <div className="measure-stat-label">ΔX (Width)</div>
              <div className="measure-stat-val dx">{fmtLen(Math.abs(dx))}</div>
            </div>
            <div className="measure-stat-box">
              <div className="measure-stat-label">ΔY (Depth)</div>
              <div className="measure-stat-val dy">{fmtLen(Math.abs(dy))}</div>
            </div>
            <div className="measure-stat-box">
              <div className="measure-stat-label">ΔZ (Height)</div>
              <div className="measure-stat-val dz">{fmtLen(Math.abs(dz))}</div>
            </div>
          </div>

          {activeBar && (
            <div style={{ marginTop: 8, borderTop: '1px solid #243352', paddingTop: 6 }}>
              <div style={{ fontSize: 11, color: '#93c5fd', fontWeight: 600, marginBottom: 4 }}>
                Control Rebar Distance against Ref:
              </div>
              <label className="fld" style={{ marginBottom: 6 }}>
                <select value={ctrlBarIdx} onChange={(e) => {
                  const bi = Number(e.target.value);
                  setCtrlBarIdx(bi);
                  selectBar(bi);
                }}>
                  {bars.map((b, i) => (
                    <option key={i} value={i}>{b.Bar_mark} · {b.Rebar_Type} · Ø{b.Dia}</option>
                  ))}
                </select>
              </label>

              {/* Vector control */}
              <div className="measure-ctrl-row">
                <span style={{ width: 55, fontSize: 11, color: '#38bdf8' }}>Vector:</span>
                <input
                  type="number"
                  placeholder={`${Math.round(len)}`}
                  value={targetVec}
                  onChange={(e) => setTargetVec(e.target.value)}
                />
                <button className="sm" onClick={() => applyShiftVec(targetVec || len)}>Set</button>
                <button className="ghost sm" onClick={() => applyShiftVec(cover)} title={`Set to cover ${cover}mm`}>Cover</button>
              </div>

              {/* X control */}
              <div className="measure-ctrl-row">
                <span style={{ width: 55, fontSize: 11, color: '#f87171' }}>Dist X:</span>
                <input
                  type="number"
                  placeholder={`${Math.round(Math.abs(dx))}`}
                  value={targetX}
                  onChange={(e) => setTargetX(e.target.value)}
                />
                <button className="sm" onClick={() => applyShiftX(targetX || Math.abs(dx))}>Set X</button>
                <button className="ghost sm" onClick={() => applyShiftX(cover)} title={`Set X to cover ${cover}mm`}>{cover}</button>
                <button className="ghost sm" onClick={() => applyShiftX(0)} title="Zero ΔX">0</button>
              </div>

              {/* Y control */}
              <div className="measure-ctrl-row">
                <span style={{ width: 55, fontSize: 11, color: '#4ade80' }}>Dist Y:</span>
                <input
                  type="number"
                  placeholder={`${Math.round(Math.abs(dy))}`}
                  value={targetY}
                  onChange={(e) => setTargetY(e.target.value)}
                />
                <button className="sm" onClick={() => applyShiftY(targetY || Math.abs(dy))}>Set Y</button>
                <button className="ghost sm" onClick={() => applyShiftY(cover)} title={`Set Y to cover ${cover}mm`}>{cover}</button>
                <button className="ghost sm" onClick={() => applyShiftY(0)} title="Zero ΔY">0</button>
              </div>

              {/* Z control */}
              <div className="measure-ctrl-row">
                <span style={{ width: 55, fontSize: 11, color: '#60a5fa' }}>Dist Z:</span>
                <input
                  type="number"
                  placeholder={`${Math.round(Math.abs(dz))}`}
                  value={targetZ}
                  onChange={(e) => setTargetZ(e.target.value)}
                />
                <button className="sm" onClick={() => applyShiftZ(targetZ || Math.abs(dz))}>Set Z</button>
                <button className="ghost sm" onClick={() => applyShiftZ(cover)} title={`Set Z to cover ${cover}mm`}>{cover}</button>
                <button className="ghost sm" onClick={() => applyShiftZ(0)} title="Zero ΔZ">0</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
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
  const measure = useStore((s) => s.measure);
  const setMeasureActive = useStore((s) => s.setMeasureActive);
  const snapEnabled = useStore((s) => s.snapEnabled);
  const setSnapEnabled = useStore((s) => s.setSnapEnabled);
  const lapArmed = useStore((s) => s.lapArmed);
  const setLapArmed = useStore((s) => s.setLapArmed);
  const lapAnchor = useStore((s) => s.lapAnchor);
  const lastLap = useStore((s) => s.lastLap);
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
        <button className={measure.active ? 'on' : ''} onClick={() => setMeasureActive(!measure.active)} title="Measure: LMB clicks drop points on surfaces, RMB removes last, Esc exits (view-only)">📏 Measure</button>
        <button className={snapEnabled !== false ? 'on' : ''} onClick={() => setSnapEnabled(!(snapEnabled !== false))} title="Snap magnet: pick & measure snap to nearby bar ends/corners (pink marker shows the target)">🧲 Snap</button>
        <button className={lapArmed ? 'on' : ''} onClick={() => setLapArmed(!lapArmed)} title="Lap splice: click anchor bar, then lapping bar (EC2 table, straight/bent/crank bars)">🔗 Lap</button>
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
        {ifcPick && <b> — pick mode: click IFC / concrete to place the selected bar (cover {cover}mm + Ø/2 inside the face){snapEnabled !== false && ' · near a bar end snaps ⚓'}</b>}
        {measure.active && <b> — 📏 {measure.points.length} pts{measure.points.length > 1 && ` · total ${fmtLen(measureTotal(measure.points))}`} · click surfaces{snapEnabled !== false && ' · snaps to bar ends'} · RMB removes last · Esc done</b>}
        {lapArmed && <b> — 🔗 lap: click {lapAnchor == null ? 'anchor bar' : 'lapping bar'}{lapAnchor != null && bars[lapAnchor] ? ` (anchor ${bars[lapAnchor].Bar_mark})` : ''} · Esc cancels</b>}
        {lastLap && <b> — 🔗 {lastLap.b} → {lastLap.a} · lap {lastLap.len.toLocaleString('en-US')} mm ({lastLap.bond} bond, Ø{lastLap.dia})</b>}
        {lastPick && <b> — placed ({lastPick.Pos_x}, {lastPick.Pos_y}, {lastPick.Pos_z}){lastPick.snapped ? ' ⚓ rebar' : ''}</b>}
        {sel && <b> — {sel.Bar_mark} · {sel.Rebar_Type} · Ø{sel.Dia} · {sel._copies} bars · cut {sel._cut} mm · {sel.Weight_kg} kg</b>}
      </div>
    </>
  );
}

function BbsStrip() {
  const bars = useStore((s) => s.bars);
  const concretes = useStore((s) => s.concretes);
  const setBars = useStore((s) => s.setBars);
  const updateBar = useStore((s) => s.updateBar);
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
          <button style={{ background: '#059669', fontWeight: 600 }} onClick={() => downloadBbsCsv(bars, concretes)} title="Generate BBS Schedule CSV (FreeCAD Reinforcement benchmark / BS 8666 format with shape codes 20, 37, 38, 85, 41, 43)">⤓ BBS Schedule CSV</button>
          <button onClick={() => downloadCsv(bars)} title="Export FreeCAD parametric template CSV (rebar_scheduling.csv)">⤓ rebar_scheduling.csv</button>
          <button onClick={() => fileRef.current?.click()} title="Import CSV">⤒ Import</button>
          <input ref={fileRef} type="file" accept=".csv" hidden onChange={onImport} />
        </span>
        <span className="hint">Shape codes: 20=straight, 37=bent, 38=clink, 85=c_link_with_hook, 41=crank, 43=double_crank</span>
      </div>
      <div className="tblwrap">
        <table>
          <thead><tr><th></th><th>#</th><th>Mark</th><th>Type</th><th>Shape</th><th>Ø</th><th>Bars</th><th>Cut (mm)</th><th>Wt (kg)</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={(i === selectedBar ? 'sel' : '') + (r.hidden ? ' hidden' : '')} onClick={() => selectBar(i)}>
                <td onClick={(e) => e.stopPropagation()}><button className="ghost sm" title={r.hidden ? 'Show bar' : 'Hide bar (stays in BBS + CSV)'} onClick={() => updateBar(i, { hidden: r.hidden ? undefined : true })}>{r.hidden ? '🚫' : '👁'}</button></td>
                <td>{r.Rebar_tag}</td><td>{r.Bar_mark}</td><td>{r.Rebar_Type}</td>
                <td><span style={{ background: '#1e293b', padding: '2px 6px', borderRadius: 4, fontWeight: 600, color: '#67e8f9' }}>{SHAPE_CODES[(r.Rebar_Type || '').toLowerCase()] || 20}</span></td>
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

function FileBar() {
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const saveProject = useStore((s) => s.saveProject);
  const saveStamp = useStore((s) => s.saveStamp);
  const fileRef = useRef(null);

  const downloadFile = () => {
    const data = useStore.getState().exportProject();
    const t = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const stamp = `${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}`;
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `barbending-project-${stamp}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const onOpenFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const d = JSON.parse(String(rd.result));
        if (!useStore.getState().importProject(d)) throw new Error('not a barbending project file (v1 with bars + concretes arrays)');
        console.info(`[save] opened project file: ${f.name}`);
      } catch (err) { alert('Project open failed: ' + err.message); }
    };
    rd.readAsText(f);
    e.target.value = '';
  };

  return (
    <>
      <span className="hspacer" />
      <button className="hbtn" disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z) — bars, concrete, cover">↶</button>
      <button className="hbtn" disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Y)">↷</button>
      <button
        className="hbtn" onClick={() => {
          if (!saveProject()) alert('Save failed — browser storage unavailable or full.');
        }}
        title="Save bars + concrete in this browser (auto-restored on reload; IFC files reload by hand)"
      >💾 Save</button>
      <button
        className="hbtn" onClick={() => downloadBbsCsv(useStore.getState().bars, useStore.getState().concretes)}
        title="Generate BBS Schedule CSV (FreeCAD benchmark / BS 8666 format with shape codes 20, 37, 38, 85, 41, 43)"
      >⤓ BBS CSV</button>
      <button
        className="hbtn" onClick={downloadFile}
        title="Download a project .json file (bars + concrete + cover) — reload it on any system via ⤒ Project"
      >⤓ Project</button>
      <button
        className="hbtn" onClick={() => fileRef.current?.click()}
        title="Open a project .json file — replaces current bars + concrete"
      >⤒ Project</button>
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onOpenFile} />
      {saveStamp && <span className="saveinfo">saved {new Date(saveStamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
    </>
  );
}

export default function App() {
  const [tab, setTab] = useState('rebar');
  const ifcActive = useStore((s) => s.ifcActive);
  const leftOpen = useStore((s) => s.leftOpen);
  const setLeftOpen = useStore((s) => s.setLeftOpen);
  // Restore browser save on boot (bars + concrete + cover; IFC reloads by hand).
  useEffect(() => {
    const t = setTimeout(() => useStore.getState().loadProject(), 50);
    return () => clearTimeout(t);
  }, []);
  // App-level undo/redo. Text inputs, textareas and selects keep NATIVE
  // text undo (store-backed number fields use app undo so the controlled
  // inputs can't diverge from the store).
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = (e.key || '').toLowerCase();
      const redoKey = k === 'y' || (k === 'z' && e.shiftKey);
      if (k !== 'z' && !redoKey) return;
      const t = e.target;
      if (t && (t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' ||
        (t.tagName === 'INPUT' && (t.type === 'text' || t.type === 'search')))) return;
      e.preventDefault();
      const st = useStore.getState();
      if (redoKey) st.redo();
      else st.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
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
      <header><strong>barbending</strong><span>browser BBS · Three.js · FreeCAD-CSV compatible · {import.meta.env.DEV ? `dev-live (server ${typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : '?'})` : `build ${typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : '?'}`}</span><FileBar /></header>
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
        <section className="view"><Scene /><ViewportBar /><MeasureHud /></section>
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
