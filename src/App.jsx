import { useEffect, useRef, useState, useMemo, Fragment } from 'react';
import Scene from './viewer/Scene.jsx';
import { fmtLen } from './viewer/Scene.jsx';
import { useStore } from './store.js';
import { REBAR_TYPES, DIM_FIELDS_BY_TYPE, applyTypeDefaults, distCount, resolveBarHost, memberKind, slabLinkSpine, getBentDefaults } from './bbs/shapes.js';
import { enrichBar, downloadCsv, downloadBbsCsv, parseCsv, SHAPE_CODES, autoAssignBarMarks, concreteVolumeM3, rebarRatioKgM3, concreteVolumeSource } from './bbs/csv.js';
import { lapLengthMm, barBond, lapBondFor } from './bbs/calc.js';
import IfcPanel, { IfcLoadButton, fitIfcLive } from './ifc/IfcPanel.jsx';
// NOTE: ./ifc/session.js (web-ifc parser) is dynamically imported on first
// IFC load so the main bundle stays light. See IfcPanel handlers.
import './App.css';

function Field({ label, value, onChange, type = 'number' }) {
  // Hooks run unconditionally (never after an early return).
  // Number branch uses draft-text so intermediate states ("-", "", "-12.",
  // ".5") stay typable. Previous direct Number(e.target.value) coercion turned
  // a lone "-" into NaN and "" into 0, making negative positions untypable.
  // Commits only finite numbers; text input (not type=number) is required so
  // the browser doesn't swallow the lone "-" sign.
  const [text, setText] = useState(value ?? '');
  const focused = useRef(false);
  useEffect(() => {
    if (type === 'number' && !focused.current) setText(value ?? '');
  }, [value, type]);
  if (type !== 'number') {
    return (
      <label className="fld">
        <span>{label}</span>
        <input
          type={type}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    );
  }
  const commitRaw = (raw) => {
    const t = String(raw).trim();
    if (t === '' || t === '-' || t === '+' || t === '.' || t === '-.' || t === '+.') return;
    const n = Number(t);
    if (Number.isFinite(n)) onChange(n);
  };
  return (
    <label className="fld">
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onFocus={() => { focused.current = true; }}
        onChange={(e) => { setText(e.target.value); commitRaw(e.target.value); }}
        onBlur={() => { focused.current = false; setText(value ?? ''); }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
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
  const requestFit = useStore((s) => s.requestFit);
  const duplicateBar = useStore((s) => s.duplicateBar);
  const selectedBars = useStore((s) => s.selectedBars);
  const setSelectedBars = useStore((s) => s.setSelectedBars);
  const removeBars = useStore((s) => s.removeBars);
  const duplicateBars = useStore((s) => s.duplicateBars);
  const hideBars = useStore((s) => s.hideBars);
  const moveBars = useStore((s) => s.moveBars);
  const setBoxSelect = useStore((s) => s.setBoxSelect);
  const clearBarSelection = useStore((s) => s.clearBarSelection);
  const [hostId, setHostId] = useState(null);
  const [mvX, setMvX] = useState('');
  const [mvY, setMvY] = useState('');
  const [mvZ, setMvZ] = useState('');
  const bar = bars[idx];
  if (!bar) return <div className="panel"><p>No bars yet — pick a type below.</p><TypeGrid onAdd={addBar} /></div>;
  const set = (k, v) => updateBar(idx, { [k]: v });
  const extra = FIELDS_BY_TYPE[bar.Rebar_Type] || [];
  const multi = (selectedBars || []).filter((i) => i >= 0 && i < bars.length);
  const multiOn = multi.length > 1;

  return (
    <div className="panel">
      {multiOn && (
        <div className="cbox sel" style={{ borderColor: '#38bdf8', marginBottom: 8 }}>
          <div className="crow">
            <strong>⊞ {multi.length} bars selected</strong>
            <span style={{ display: 'inline-flex', gap: 4 }}>
              <button className="ghost sm" onClick={() => setSelectedBars([idx])} title="Keep only the active bar">Keep 1</button>
              <button className="ghost sm" onClick={() => setSelectedBars(bars.map((_, i) => i))} title="Select all bars">All</button>
            </span>
          </div>
          <div className="distnote" style={{ margin: '4px 0' }}>
            {multi.map((i) => bars[i]?.Bar_mark).filter(Boolean).slice(0, 12).join(', ')}
            {multi.length > 12 ? ` … +${multi.length - 12} more` : ''} · edits below apply to the active bar ({bar.Bar_mark})
          </div>
          <div className="btnrow inline" style={{ marginBottom: 6 }}>
            <button className="sm" onClick={() => duplicateBars(multi)} title="Duplicate every selected bar">📋 Duplicate {multi.length}</button>
            <button className="sm" onClick={() => hideBars(multi, true)} title="Hide selected bars (stay in BBS + CSV)">👁 Hide</button>
            <button className="sm" onClick={() => hideBars(multi, false)} title="Unhide selected bars">☀ Show</button>
            <button className="danger sm" onClick={() => { if (window.confirm(`Delete ${multi.length} selected bars? (Ctrl+Z undoes)`)) removeBars(multi); }} title="Delete every selected bar (undoable)">🗑 Delete {multi.length}</button>
          </div>
          <div className="crow">
            <input type="number" placeholder="dX mm" value={mvX} onChange={(e) => setMvX(e.target.value)} style={{ width: 72 }} title="Shift all selected bars in X (mm)" />
            <input type="number" placeholder="dY mm" value={mvY} onChange={(e) => setMvY(e.target.value)} style={{ width: 72 }} title="Shift all selected bars in Y (mm)" />
            <input type="number" placeholder="dZ mm" value={mvZ} onChange={(e) => setMvZ(e.target.value)} style={{ width: 72 }} title="Shift all selected bars in Z (mm)" />
            <button className="sm" onClick={() => {
              const dx = Number(mvX) || 0, dy = Number(mvY) || 0, dz = Number(mvZ) || 0;
              if (!dx && !dy && !dz) return;
              moveBars(multi, dx, dy, dz);
              setMvX(''); setMvY(''); setMvZ('');
            }} title="Move every selected bar by dX/dY/dZ (mm)">Move ⭢</button>
          </div>
        </div>
      )}
      {!multiOn && (
        <div className="crow" style={{ marginBottom: 6 }}>
          <span className="hint">Tip: Shift+B then drag a window — or Ctrl-click bars / BBS rows — to multi-select for bulk delete, copy or move.</span>
          <button className="ghost sm" onClick={() => setBoxSelect(true)} title="Arm window select (Shift+B)">⊞ Box select</button>
        </div>
      )}
      <div className="row2" style={{ alignItems: 'center', marginBottom: 4 }}>
        <label className="fld" style={{ flex: 1 }}><span>Selected bar ({bars.length} total)</span>
          <select value={idx} onChange={(e) => selectBar(Number(e.target.value))}>
            {bars.map((b, i) => (
              <option key={i} value={i}>
                {b.Bar_mark} · {b.Rebar_Type === 'c_link_with_hook' && String(b.double_hook || 'no').toLowerCase() === 'yes' ? 'c_link (double hook)' : b.Rebar_Type} · Ø{b.Dia}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: 'flex', gap: 4, marginTop: 16 }}>
          <button className="sm" onClick={() => requestFit('bar', idx)} title="Zoom camera directly to this rebar (Hotkey: F)">🎯 Zoom [F]</button>
          <button className="sm" onClick={() => duplicateBar(idx)} title="Duplicate / Copy this rebar (Hotkey: Ctrl+D or C)">📋 Copy [Ctrl+D]</button>
          <button className="sm" onClick={clearBarSelection} title="Deselect all bars (also: Esc or click empty space)">✕</button>
        </div>
      </div>
      {bar.host && (
        <div style={{ marginBottom: 6 }}>
          <button className="ghost sm" onClick={() => requestFit('concrete', bar.host)} title={`Zoom camera to ${concretes.find((c) => c.id === bar.host)?.name || 'Host Member'}`}>
            🔍 Zoom to {concretes.find((c) => c.id === bar.host)?.name || 'Host Member'}
          </button>
        </div>
      )}
      <div className="row2">
        <label className="fld"><span>Shape type — switch anytime</span>
          <select value={bar.Rebar_Type} onChange={(e) => {
            const hostObj = concretes.find((c) => c.id === resolveBarHost(bar, concretes)) || null;
            replaceBar(idx, applyTypeDefaults(bar, e.target.value, hostObj, cover));
          }}>
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
      ) : f === 'double_hook' ? (
        <label key={f} className="fld"><span>double_hook</span>
          <select value={bar[f] ?? 'no'} onChange={(e) => set(f, e.target.value)}>
            <option value="no">no (single hook)</option>
            <option value="yes">yes (double hook)</option>
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
          <select value={resolveBarHost(bar, concretes) || ''} onChange={(e) => set('host', e.target.value || null)}>
            <option value="">— None (Unhosted) —</option>
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
              } else if (host.lz <= host.lx && host.lz <= host.ly) {
                // Through-slab link: spine = thickness − covers (same rule as
                // the DXF importer). Rotation 90 stands the spine up to App Z.
                const spine = slabLinkSpine(host, dia, cover);
                const legA = Math.max(dia * 2, getBentDefaults(dia).H);
                const legB = Math.max(dia * 2, getBentDefaults(dia).U || getBentDefaults(dia).H);
                const covB = Number(host.covB ?? cover) || 0;
                updateBar(idx, {
                  host: host.id,
                  Plane: 'XZ',
                  c_length_a: legA,
                  c_length_b: legB,
                  length: spine,
                  Pos_x: Math.round((host.x + inset + Math.max(legA, legB)) * 10) / 10,
                  Pos_y: Math.round((host.y + inset) * 10) / 10,
                  Pos_z: Math.round((host.z + covB + dia / 2) * 10) / 10,
                  Pos_Rotation: 90,
                  spacing_x: bar.spacing_x || 150,
                  qty_x: Math.max(1, Math.floor((host.lx - 2 * cv) / (bar.spacing_x || 150))),
                  qty_y: 1,
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
      <div className="distnote">This bar laps onto the anchor's end or start. Supports straight, bent, crank & double-crank bars; length from the smaller Ø (least size bar). Per-bar bond wins (poor wins a mixed pair) — the default below is only the fallback. Or arm 🔗 Lap above and click anchor, then a bar.</div>
      <div className="row2">
        <label className="fld"><span>Anchor bar</span>
          <select value={lapAnchor ?? ''} onChange={(e) => setLapAnchor(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">— Pick —</option>
            {bars.map((b, i) => i !== idx && <option key={i} value={i}>{b.Bar_mark} · {b.Rebar_Type} · Ø{b.Dia}</option>)}
          </select>
        </label>
        <label className="fld"><span>This bar bond (auto B→good/T→poor)</span>
          <select value={bar.bond_condition || ''} onChange={(e) => set('bond_condition', e.target.value)}>
            <option value="">auto ({barBond(bar, bond) || '—'})</option>
            <option value="good">good</option>
            <option value="poor">poor</option>
          </select>
        </label>
      </div>
      <div className="row2">
        <label className="fld"><span>Default bond (fallback, poor = safe)</span>
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
          const bondEff = lapAnchor == null ? barBond(bar, bond) : lapBondFor(bars[lapAnchor], bar, bond);
          return `${lapLengthMm(dia, bondEff).toLocaleString('en-US')} mm (${bondEff})`;
        })()}</span>
        <button onClick={() => {
          if (lapAnchor == null || bars[lapAnchor] === undefined) { alert('Pick an anchor bar first (dropdown or 🔗 Lap clicks).'); return; }
          const r = applyLapSplice(lapAnchor, idx);
          if (!r.ok) alert(r.msg);
        }}>Lap onto anchor</button>
      </div>
      {lastLap && lastLap.b === bar.Bar_mark && <div className="distnote">Last: {lastLap.b} → {lastLap.a} · {lastLap.len.toLocaleString('en-US')} mm ({lastLap.bond} bond, Ø{lastLap.dia})</div>}
      <div className="sect">Add bar</div>      <TypeGrid onAdd={addBar} />
      <button className="block sm" onClick={() => duplicateBar(idx)} style={{ marginBottom: 6 }} title="Duplicate / Copy this rebar (Ctrl+D)">📋 Duplicate this bar (Ctrl+D)</button>
      <button className="danger block sm" onClick={() => removeBar(idx)}>Delete this bar</button>
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
  const selectedConcrete = useStore((s) => s.selectedConcrete);
  const selectConcrete = useStore((s) => s.selectConcrete);
  const addConcrete = useStore((s) => s.addConcrete);
  const updateConcrete = useStore((s) => s.updateConcrete);
  const removeConcrete = useStore((s) => s.removeConcrete);
  const requestFit = useStore((s) => s.requestFit);
  const drawMode = useStore((s) => s.drawMode);
  const setDrawMode = useStore((s) => s.setDrawMode);
  const setShading = useStore((s) => s.setShading);
  const refLines = useStore((s) => s.refLines || []);
  const selectedRefLine = useStore((s) => s.selectedRefLine);
  const selectRefLine = useStore((s) => s.selectRefLine);
  const addRefLine = useStore((s) => s.addRefLine);
  const updateRefLine = useStore((s) => s.updateRefLine);
  const removeRefLine = useStore((s) => s.removeRefLine);
  const cover = useStore((s) => s.cover);

  const addCenterline = (c) => {
    const isColZ = c.lz > c.lx && c.lz > c.ly;
    let p1, p2;
    if (isColZ) {
      p1 = [c.x + c.lx / 2, c.y + c.ly / 2, c.z];
      p2 = [c.x + c.lx / 2, c.y + c.ly / 2, c.z + c.lz];
    } else {
      p1 = [c.x, c.y + c.ly / 2, c.z + c.lz / 2];
      p2 = [c.x + c.lx, c.y + c.ly / 2, c.z + c.lz / 2];
    }
    addRefLine({
      host: c.id,
      name: `${c.name} Centerline`,
      p1,
      p2,
      color: '#38bdf8',
    });
  };

  const addCoverLine = (c) => {
    const cv = Number(cover) || 40;
    const isColZ = c.lz > c.lx && c.lz > c.ly;
    let p1, p2;
    if (isColZ) {
      p1 = [c.x + cv, c.y + cv, c.z + cv];
      p2 = [c.x + cv, c.y + cv, c.z + c.lz - cv];
    } else {
      p1 = [c.x + cv, c.y + cv, c.z + c.lz - cv];
      p2 = [c.x + c.lx - cv, c.y + cv, c.z + c.lz - cv];
    }
    addRefLine({
      host: c.id,
      name: `${c.name} Top Cover (${cv}mm)`,
      p1,
      p2,
      color: '#f59e0b',
    });
  };

  const concreteStyle = useStore((s) => s.concreteStyle || 'ghost');
  const setConcreteStyle = useStore((s) => s.setConcreteStyle);
  const concreteOpacity = useStore((s) => s.concreteOpacity ?? 0.25);
  const setConcreteOpacity = useStore((s) => s.setConcreteOpacity);
  const concreteColor = useStore((s) => s.concreteColor || '#94a3b8');
  const setConcreteColor = useStore((s) => s.setConcreteColor);
  const concreteEdges = useStore((s) => s.concreteEdges !== false);
  const setConcreteEdges = useStore((s) => s.setConcreteEdges);

  return (
    <>
    <IfcLoadButton />
    <div className="panel">
      <div className="sect flush">Trace & Draw / Reference Lines</div>
      <div className="btnrow inline">
        <button className={drawMode === 'ref_line' ? 'on' : ''} onClick={() => setDrawMode(drawMode === 'ref_line' ? null : 'ref_line')} title="Click two points on concrete to draw a parented reference line">📏 Draw Ref Line</button>
        <button className={drawMode === 'beam' ? 'on' : ''} onClick={() => { setDrawMode(drawMode === 'beam' ? null : 'beam'); setShading('wireframe'); }}>✏️ Draw Beam</button>
        <button className={drawMode === 'column' ? 'on' : ''} onClick={() => { setDrawMode(drawMode === 'column' ? null : 'column'); setShading('wireframe'); }}>✏️ Draw Column</button>
        <button className={drawMode === 'slab' ? 'on' : ''} onClick={() => { setDrawMode(drawMode === 'slab' ? null : 'slab'); setShading('wireframe'); }}>✏️ Draw Slab</button>
        <button className={drawMode === 'trace_ifc' ? 'on' : ''} onClick={() => { setDrawMode(drawMode === 'trace_ifc' ? null : 'trace_ifc'); setShading('wireframe'); }}>⚡ Auto-Trace IFC</button>
      </div>
      <div className="distnote" style={{ marginTop: 6 }}>
        {drawMode === 'ref_line'
          ? '📏 Click Start & End points on concrete to draw a reference line. Ref lines parent to the concrete member and hide with it.'
          : drawMode
            ? '🎯 Snap to nodes/joints on the IFC wireframe and click to trace.'
            : 'Tip: Reference lines attach to concrete members and provide snap guides for rebar alignment & checking clearance.'}
      </div>

      <div className="sect">Concrete Appearance & Render Style</div>
      <div className="segrow" style={{ marginBottom: 6 }}>
        <button className={concreteStyle === 'ghost' ? 'on' : ''} onClick={() => setConcreteStyle('ghost')} title="Engineering transparent preview">◧ Ghost</button>
        <button className={concreteStyle === 'solid' ? 'on' : ''} onClick={() => setConcreteStyle('solid')} title="Opaque architectural solid concrete">◼ Solid</button>
        <button className={concreteStyle === 'blueprint' ? 'on' : ''} onClick={() => setConcreteStyle('blueprint')} title="Holographic blueprint mode">📐 Blueprint</button>
        <button className={concreteStyle === 'textured' ? 'on' : ''} onClick={() => setConcreteStyle('textured')} title="Textured matte cast concrete">🧱 Textured</button>
      </div>
      <div className="grid3" style={{ alignItems: 'center' }}>
        <label className="fld"><span>Opacity ({Math.round(concreteOpacity * 100)}%)</span>
          <input type="range" min="0.05" max="1" step="0.05" value={concreteOpacity} onChange={(e) => setConcreteOpacity(Number(e.target.value))} />
        </label>
        <label className="fld"><span>Color Tint</span>
          <input type="color" value={concreteColor} onChange={(e) => setConcreteColor(e.target.value)} style={{ height: 28, padding: 1 }} />
        </label>
        <label className="chk" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={concreteEdges} onChange={(e) => setConcreteEdges(e.target.checked)} />
          Edges
        </label>
      </div>

      <div className="sect">Concrete Elements ({concretes.length})</div>
      {concretes.map((c) => {
        const memberRefLines = refLines.filter((l) => l.host === c.id);
        const isCustom = !!(c.meshData && c.meshData.positions?.length);
        return (
          <div
            key={c.id}
            className={(c.visible === false ? 'cbox hidden' : 'cbox') + (c.id === selectedConcrete ? ' sel' : '')}
            onClick={() => selectConcrete(c.id)}
            style={{ borderColor: c.id === selectedConcrete ? '#38bdf8' : undefined }}
          >
            <div className="crow">
              <input className="cname" value={c.name} onChange={(e) => updateConcrete(c.id, { name: e.target.value })} />
              <button className="sm ghost" title="Zoom to element" onClick={(e) => { e.stopPropagation(); selectConcrete(c.id); requestFit('concrete', c.id); }}>🎯</button>
              <button className="sm" title={c.visible === false ? 'Show (bars and ref lines inside reappear)' : 'Hide (bars and ref lines inside hide too)'} onClick={(e) => { e.stopPropagation(); updateConcrete(c.id, { visible: c.visible === false ? true : false }); }}>{c.visible === false ? '🚫' : '👁'}</button>
              <button className="danger sm" onClick={(e) => { e.stopPropagation(); removeConcrete(c.id); }}>×</button>
            </div>
            {isCustom && (
              <div style={{ fontSize: 11, color: '#38bdf8', fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span>✨ Exact IFC Profile</span>
                <span className="hint">({c.meshData.indices.length / 3} tris · openings/chamfers)</span>
              </div>
            )}
            <div className="grid3">
              {[['lx', 'Lx'], ['ly', 'Ly'], ['lz', 'Hz']].map(([k, l]) => (
                <Field key={k} label={l} value={c[k]} onChange={(v) => updateConcrete(c.id, { [k]: v })} />
              ))}
            </div>
            <div className="grid3">
              {[['x', 'X'], ['y', 'Y'], ['z', 'Z']].map(([k, l]) => (
                <Field key={k} label={l} value={c[k]} onChange={(v) => updateConcrete(c.id, { [k]: v })} />
              ))}
            </div>
            <div className="distnote" style={{ marginTop: 2 }} title={concreteVolumeSource(c) === 'mesh' ? 'Exact mesh volume: retraced IFC profile incl. openings/chamfers — this is the BBS take-off' : 'Lx·Ly·Lz box volume — this is the BBS take-off'}>
              Volume {concreteVolumeM3(c).toFixed(3)} m³ {concreteVolumeSource(c) === 'mesh' ? '(✨ exact mesh)' : '(box)'}
            </div>

            {/* Quick Ref Line Helpers & Attached Ref Lines */}
            <div className="refline-section" onClick={(e) => e.stopPropagation()}>
              <div className="refline-header">
                <span>📏 Reference Lines ({memberRefLines.length})</span>
                <span style={{ display: 'flex', gap: 4 }}>
                  <button className="ghost sm" onClick={() => addCenterline(c)} title="Add centerline guide along this member">+ Centerline</button>
                  <button className="ghost sm" onClick={() => addCoverLine(c)} title={`Add ${cover}mm cover offset guide`}>+ Cover Line</button>
                </span>
              </div>
              {memberRefLines.map((l) => {
                const len = Math.round(Math.hypot((l.p2?.[0] || 0) - (l.p1?.[0] || 0), (l.p2?.[1] || 0) - (l.p1?.[1] || 0), (l.p2?.[2] || 0) - (l.p1?.[2] || 0)));
                const isSel = l.id === selectedRefLine;
                return (
                  <div
                    key={l.id}
                    className={`refline-row ${isSel ? 'sel' : ''}`}
                    onClick={() => selectRefLine(l.id)}
                  >
                    <input
                      type="color"
                      className="refline-color-picker"
                      value={l.color || '#f59e0b'}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => updateRefLine(l.id, { color: e.target.value })}
                      title="Line color"
                    />
                    <input
                      className="refline-name-input"
                      value={l.name || ''}
                      placeholder="Line name"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => updateRefLine(l.id, { name: e.target.value })}
                    />
                    <span className="refline-len-badge">{fmtLen(len)}</span>
                    <button
                      className="ghost sm"
                      title={l.visible === false ? 'Show reference line' : 'Hide reference line'}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateRefLine(l.id, { visible: l.visible === false ? true : false });
                      }}
                    >
                      {l.visible === false ? '🚫' : '👁'}
                    </button>
                    <button
                      className="danger sm"
                      title="Delete reference line (or press Delete in 3D)"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeRefLine(l.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
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
  const setMeasureBarPoint = useStore((s) => s.setMeasureBarPoint);
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
  // Auto-detected bar under the clicked point wins: the Set buttons move the
  // bar you actually measured, whichever click order you used.
  const detectedBarIdx = measure?.measureBarIdx;
  const pointCount = measure?.points?.length ?? 0;
  useEffect(() => {
    if (detectedBarIdx != null && detectedBarIdx !== ctrlBarIdx) {
      setCtrlBarIdx(detectedBarIdx);
      selectBar(detectedBarIdx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectedBarIdx, pointCount]);

  if (!measure?.active) return null;

  const pts = measure.points || [];
  // Roles: the point on the rebar moves with the bar; the other stays as ref.
  const barPointIdx = pts.length > 1 ? (measure.barPointIdx === 0 ? 0 : 1) : 1;
  const refIdx = 1 - barPointIdx;
  const ref = pts[refIdx];
  const barPt = pts[barPointIdx];

  let dx = 0, dy = 0, dz = 0, len = 0;
  if (ref && barPt) {
    dx = barPt[0] - ref[0];
    dy = barPt[1] - ref[1];
    dz = barPt[2] - ref[2];
    len = Math.hypot(dx, dy, dz);
  }

  const activeBar = bars[ctrlBarIdx] || bars[selectedBar] || bars[0];

  const applyShiftX = (desiredDist) => {
    if (!ref || !barPt || !activeBar) return;
    const target = Number(desiredDist);
    if (!Number.isFinite(target)) return;
    const sign = dx < 0 ? -1 : 1;
    const targetDx = sign * Math.abs(target);
    const shiftX = targetDx - dx;
    const newBarPt = [ref[0] + targetDx, barPt[1], barPt[2]];
    adjustBarFromMeasure(ctrlBarIdx, shiftX, 0, 0, newBarPt, barPointIdx);
  };

  const applyShiftY = (desiredDist) => {
    if (!ref || !barPt || !activeBar) return;
    const target = Number(desiredDist);
    if (!Number.isFinite(target)) return;
    const sign = dy < 0 ? -1 : 1;
    const targetDy = sign * Math.abs(target);
    const shiftY = targetDy - dy;
    const newBarPt = [barPt[0], ref[1] + targetDy, barPt[2]];
    adjustBarFromMeasure(ctrlBarIdx, 0, shiftY, 0, newBarPt, barPointIdx);
  };

  const applyShiftZ = (desiredDist) => {
    if (!ref || !barPt || !activeBar) return;
    const target = Number(desiredDist);
    if (!Number.isFinite(target)) return;
    const sign = dz < 0 ? -1 : 1;
    const targetDz = sign * Math.abs(target);
    const shiftZ = targetDz - dz;
    const newBarPt = [barPt[0], barPt[1], ref[2] + targetDz];
    adjustBarFromMeasure(ctrlBarIdx, 0, 0, shiftZ, newBarPt, barPointIdx);
  };

  const applyShiftVec = (desiredLen) => {
    if (!ref || !barPt || !activeBar) return;
    const target = Number(desiredLen);
    if (!Number.isFinite(target) || !(len > 0.001)) return;
    const scale = target / len;
    const targetDx = dx * scale;
    const targetDy = dy * scale;
    const targetDz = dz * scale;
    const shiftX = targetDx - dx;
    const shiftY = targetDy - dy;
    const shiftZ = targetDz - dz;
    const newBarPt = [ref[0] + targetDx, ref[1] + targetDy, ref[2] + targetDz];
    adjustBarFromMeasure(ctrlBarIdx, shiftX, shiftY, shiftZ, newBarPt, barPointIdx);
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
            : `Point 1: (${pts[0][0]}, ${pts[0][1]}, ${pts[0][2]}) mm. Click 2nd point — the point on the rebar auto-selects that bar.`}
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
                Move bar to set distance — ref P{refIdx + 1} stays, bar P{barPointIdx + 1} rides:
              </div>
              <div className="measure-ctrl-row">
                <button
                  className="ghost sm"
                  onClick={() => setMeasureBarPoint(refIdx)}
                  title="Swap: the other point becomes the one that moves with the bar"
                >⇄ Swap</button>
                <span className="hint">P{barPointIdx + 1} on bar · P{refIdx + 1} fixed ref</span>
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

function QueryHud() {
  const query = useStore((s) => s.query);
  const setQueryActive = useStore((s) => s.setQueryActive);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(t);
  }, [copied]);
  if (!query?.active) return null;
  const r = query?.result;
  const copyText = () => {
    if (!r) return;
    const txt = [`${r.title}${r.sub ? ` · ${r.sub}` : ''}`,
      ...(r.rows || []).map(([k, v]) => `${k}: ${v}`)].join('\n');
    const done = () => setCopied(true);
    try {
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(txt).then(done).catch(done);
      else done();
    } catch { done(); }
  };
  return (
    <div className="measure-hud">
      <div className="measure-hud-header">
        <span>ⓘ Object Query</span>
        <span style={{ display: 'flex', gap: 4 }}>
          {r && <button className="ghost sm" onClick={copyText} title="Copy all coordinates as text">{copied ? 'Copied ✓' : 'Copy'}</button>}
          <button className="ghost sm" onClick={() => setQueryActive(false)} title="Close query tool (Esc)">✕</button>
        </span>
      </div>
      {!r ? (
        <div className="distnote">Click any rebar, concrete member, or IFC object — exact surface point, no snap. Misses keep the last result.</div>
      ) : (
        <>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{r.title}</div>
          {r.sub && <div className="hint" style={{ marginBottom: 4 }}>{r.sub}</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {(r.rows || []).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11 }}>
                <span style={{ color: '#93c5fd' }}>{k}</span>
                <span style={{ color: '#e2e8f0', fontFamily: 'monospace', textAlign: 'right' }}>{v}</span>
              </div>
            ))}
          </div>
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
  const query = useStore((s) => s.query);
  const setQueryActive = useStore((s) => s.setQueryActive);
  const snapEnabled = useStore((s) => s.snapEnabled);
  const setSnapEnabled = useStore((s) => s.setSnapEnabled);
  const snapOpts = useStore((s) => s.snapOpts);
  const setSnapOpt = useStore((s) => s.setSnapOpt);
  const [snapMenu, setSnapMenu] = useState(false);
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
  const nav = useStore((s) => s.nav);
  const setNav = useStore((s) => s.setNav);
  const resetNav = useStore((s) => s.resetNav);
  const [navMenu, setNavMenu] = useState(false);
  const requestView = useStore((s) => s.requestView);
  const requestFit = useStore((s) => s.requestFit);
  const duplicateBar = useStore((s) => s.duplicateBar);
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
  const boxSelect = useStore((s) => s.boxSelect);
  const setBoxSelect = useStore((s) => s.setBoxSelect);
  const selectedBars = useStore((s) => s.selectedBars);

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
        <span style={{ position: 'relative', display: 'inline-flex', gap: 0 }}>
          <button onClick={() => setNavMenu((v) => !v)} title="Navigation tuning: orbit / pan / zoom speeds, smoothing, zoom-to-cursor, keyboard map" style={{ borderRadius: 6 }}>⚙ Nav{(nav.rotateSpeed !== 1 || nav.panSpeed !== 1 || nav.zoomSpeed !== 1 || nav.damping === false || nav.zoomToCursor === false) ? ' ●' : ''}</button>
          {navMenu && (
            <div className="snap-pop" onClick={(e) => e.stopPropagation()} style={{ left: 0, right: 'auto', minWidth: 210 }}>
              {[['rotateSpeed', 'Orbit speed', 'Left/Middle-drag rotation + Shift+arrows'], ['panSpeed', 'Pan speed', 'Right-drag pan + arrow keys'], ['zoomSpeed', 'Zoom speed', 'Wheel / pinch glide + +/− keys']].map(([k, label, tip]) => (
                <label key={k} title={tip} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 74 }}>{label}</span>
                  <input type="range" min="0.2" max="2.5" step="0.1" value={nav[k]} onChange={(e) => setNav({ [k]: Number(e.target.value) })} style={{ flex: 1 }} />
                  <span style={{ width: 30, textAlign: 'right' }}>{Number(nav[k]).toFixed(1)}×</span>
                </label>
              ))}
              <label title="Smooth gliding camera (damping). Off = immediate 1:1 control">
                <input type="checkbox" checked={nav.damping !== false} onChange={(e) => setNav({ damping: e.target.checked })} />
                Smooth glide
              </label>
              <label title="Wheel zooms toward the cursor point. Off = classic dolly straight at the orbit pivot">
                <input type="checkbox" checked={nav.zoomToCursor !== false} onChange={(e) => setNav({ zoomToCursor: e.target.checked })} />
                Zoom to cursor
              </label>
              <button className="ghost sm" onClick={resetNav} title="Restore default navigation feel">Reset defaults</button>
              <div className="snap-note">Arrows pan · Shift+arrows orbit · +/− zoom · Home fits all · zoom range guarded (flings stop at 400 m)</div>
            </div>
          )}
        </span>
        <label className="cover" title="Blender-style preset view — jumps the camera, keeps the orbit focus. The axis gizmo top-right does the same on click.">
          view
          <select defaultValue="" onChange={(e) => { if (e.target.value) requestView(e.target.value); e.target.value = ''; }}>
            <option value="" disabled>Iso ▾</option>
            <option value="top">Top (Z↓)</option>
            <option value="bottom">Bottom (Z↑)</option>
            <option value="front">Front (Y→)</option>
            <option value="back">Back (Y←)</option>
            <option value="left">Left (X→)</option>
            <option value="right">Right (X←)</option>
            <option value="iso">Iso</option>
          </select>
        </label>
        <button onClick={() => requestFit('auto')} title="Zoom camera to selected rebar or beam (Hotkey: F)">🎯 Zoom Sel [F]</button>
        <button className={boxSelect ? 'on' : ''} onClick={() => setBoxSelect(!boxSelect)} title="Window select rebars: arm (or press Shift+B), then drag a rectangle in the viewport. Ctrl-drag adds to the selection · Esc cancels">⊞ Box{(selectedBars?.length || 0) > 1 ? ` (${selectedBars.length})` : ''} [Shift+B]</button>
        <button onClick={() => duplicateBar()} title="Duplicate / Copy selected rebar (Hotkey: Ctrl+D or C)">📋 Copy [Ctrl+D]</button>
        <button onClick={() => requestFit('all')} title="Fit entire model in view">⛶ Fit All</button>
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
        <button className={query.active ? 'on' : ''} onClick={() => setQueryActive(!query.active)} title="Query: click any rebar, concrete, or IFC object to read its coordinates (Esc exits)">ⓘ Query</button>
        <span style={{ position: 'relative', display: 'inline-flex', gap: 0 }}>
          <button className={snapEnabled !== false ? 'on' : ''} onClick={() => setSnapEnabled(!(snapEnabled !== false))} title={`Snap magnet (${['end', 'mid', 'center', 'nearest', 'perp'].filter((k) => snapOpts?.[k]).join(' · ') || 'nothing enabled'}): pick & measure snap to nearby targets`} style={{ borderRadius: '6px 0 0 6px' }}>🧲 Snap</button>
          <button onClick={() => setSnapMenu((v) => !v)} title="Snap options: endpoint / midpoint / center / nearest / perpendicular" style={{ borderRadius: '0 6px 6px 0', borderLeft: '1px solid #0f172a' }}>▾</button>
          {snapMenu && (
            <div className="snap-pop" onClick={(e) => e.stopPropagation()}>
              {[
                ['end', 'Endpoint', 'Bar vertices, concrete corners, ref-line ends'],
                ['mid', 'Midpoint', 'Bar-leg and concrete-edge midpoints'],
                ['center', 'Center', 'Concrete face centers'],
                ['nearest', 'Nearest', 'Any point along an edge / bar leg (violet marker)'],
                ['perp', 'Perpendicular', 'Foot of perpendicular from the last measure point (green marker)'],
              ].map(([k, label, tip]) => (
                <label key={k} title={tip}>
                  <input type="checkbox" checked={!!snapOpts?.[k]} onChange={(e) => setSnapOpt(k, e.target.checked)} />
                  {label}
                </label>
              ))}
              <div className="snap-note">Closest enabled target to the cursor wins. Perpendicular needs a placed measure point.</div>
            </div>
          )}
        </span>
        <button className={lapArmed ? 'on' : ''} onClick={() => setLapArmed(!lapArmed)} title="Lap splice: click anchor bar, then lapping bar (EC2 table, straight/bent/crank bars)">🔗 Lap</button>
        <label className="cover" title="Concrete cover (mm) — pick-to-place sinks the bar centreline this far + Ø/2 inside the clicked face">
          cover
          <input type="number" value={cover} min={0} onChange={(e) => setCover(Number(e.target.value))} />
        </label>
        {ifc && <button onClick={fitIfcLive}>Fit IFC</button>}
        <span className="vstat">{totalBars} bars · {totalW.toFixed(1)} kg</span>
      </div>
      <div className="overlay">
        drag = orbit · wheel = zoom · right-drag = pan · click bar = select · click empty/Esc = deselect · Ctrl-click = multi · Shift+B = box select · F = zoom · Ctrl+D/C = copy rebar
        {boxSelect && <b> — ⊞ BOX SELECT armed: drag a rectangle to select rebars · Ctrl-drag adds · Esc cancels</b>}
        {drawMode && !drawStart && <b> — 📐 [{drawMode.toUpperCase()} TOOL] Click 1st corner/node (snapping active) · Esc to cancel</b>}
        {drawMode && drawStart && <b> — 📐 [{drawMode.toUpperCase()} TOOL] Click opposite corner/node to complete member · Esc to cancel</b>}
        {snapNode && <b> — 📍 Snapped: ({snapNode.x}, {snapNode.y}, {snapNode.z}) [{snapNode.type}]</b>}
        {section?.enabled && <b> — drag ◼ face cubes to push/pull the section</b>}
        {ifcPick && <b> — pick mode: click IFC / concrete to place the selected bar (cover {cover}mm + Ø/2 inside the face){snapEnabled !== false && ' · snap ⚓ (▾ options)'}</b>}
        {measure.active && <b> — 📏 {measure.points.length} pts{measure.points.length > 1 && ` · total ${fmtLen(measureTotal(measure.points))}`} · click surfaces{snapEnabled !== false && ' · snap ⚓ (▾ options)'} · RMB removes last · Esc done</b>}
        {query.active && <b> — ⓘ query: click a rebar / concrete / IFC object for its coordinates · Esc done</b>}
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
  const appendBars = useStore((s) => s.appendBars);
  const updateBar = useStore((s) => s.updateBar);
  const selectBar = useStore((s) => s.selectBar);
  const selectedBars = useStore((s) => s.selectedBars);
  const toggleBarSelected = useStore((s) => s.toggleBarSelected);
  const duplicateBar = useStore((s) => s.duplicateBar);
  const removeBar = useStore((s) => s.removeBar);
  const requestFit = useStore((s) => s.requestFit);
  const fileRef = useRef(null);
  const insertFileRef = useRef(null);

  const [elemFilter, setElemFilter] = useState('all');
  const [groupByElem, setGroupByElem] = useState(true);
  const [collapsed, setCollapsed] = useState({});
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [joinMode, setJoinMode] = useState(false);
  const [joinedIds, setJoinedIds] = useState([]);
  const [memberSearch, setMemberSearch] = useState('');

  const concMap = useMemo(() => new Map((concretes || []).map((c) => [c.id, c])), [concretes]);
  const allRows = useMemo(() => bars.map((b, idx) => ({ ...enrichBar(b, concretes), _origIdx: idx })), [bars, concretes]);
  const joinedSet = useMemo(() => new Set(joinedIds), [joinedIds]);

  // Marks per member, computed once (the picker renders this per option —
  // filtering allRows per member per render would be O(members × rows)).
  const marksByHost = useMemo(() => {
    const m = new Map();
    for (const r of allRows) {
      const k = r.host && concMap.has(r.host) ? r.host : 'unhosted';
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }, [allRows, concMap]);

  // Member search narrows both the Element dropdown and the join picker.
  const searchLower = memberSearch.trim().toLowerCase();
  const visibleConcretes = useMemo(() => (
    !searchLower ? (concretes || []) : (concretes || []).filter((c) => String(c.name || '').toLowerCase().includes(searchLower))
  ), [concretes, searchLower]);

  // Join picker grouped by structural kind (scales to hundreds of members).
  const joinGroups = useMemo(() => {
    const map = new Map();
    for (const c of visibleConcretes) {
      const k = memberKind(c);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(c);
    }
    return ['Beam', 'Column', 'Slab', 'Wall', 'Footing', 'Member'].filter((k) => map.has(k)).map((k) => ({ kind: k, members: map.get(k) }));
  }, [visibleConcretes]);
  const toggleKind = (members) => {
    const ids = members.map((c) => c.id);
    const allIn = ids.every((id) => joinedSet.has(id));
    setJoinedIds((prev) => allIn ? prev.filter((id) => !ids.includes(id)) : [...new Set([...prev, ...ids])]);
  };

  // Rows matching current element filter (or the joined member set)
  const filteredRows = useMemo(() => {
    if (joinMode) return allRows.filter((r) => r.host && joinedSet.has(r.host));
    if (elemFilter === 'all') return allRows;
    if (elemFilter === 'unhosted') return allRows.filter((r) => !r.host || !concMap.has(r.host));
    return allRows.filter((r) => r.host === elemFilter);
  }, [allRows, elemFilter, concMap, joinMode, joinedSet]);

  const totalW = filteredRows.reduce((a, r) => a + (r.Weight_kg || 0), 0);
  const totalBars = filteredRows.reduce((a, r) => a + (r._copies || 1), 0);

  // Concrete members in scope (joined set / single / all) → volume + ratio.
  const includedConcretes = useMemo(() => {
    if (joinMode) return (concretes || []).filter((c) => joinedSet.has(c.id));
    if (elemFilter === 'all') return concretes || [];
    if (elemFilter === 'unhosted') return [];
    const c = concMap.get(elemFilter);
    return c ? [c] : [];
  }, [concretes, elemFilter, joinMode, joinedSet, concMap]);
  const totalVolM3 = includedConcretes.reduce((a, c) => a + concreteVolumeM3(c), 0);
  const ratio = rebarRatioKgM3(totalW, totalVolM3);
  const volStr = `${totalVolM3.toFixed(3)} m³`;
  const ratioStr = ratio == null ? 'n/a' : `${ratio.toFixed(1)} kg/m³`;

  // Grouping structure for all or filtered
  const groups = useMemo(() => {
    const map = new Map();
    for (const c of concretes) {
      if (joinMode ? joinedSet.has(c.id) : (elemFilter === 'all' || elemFilter === c.id)) {
        map.set(c.id, { id: c.id, concrete: c, name: c.name || `Member ${c.id}`, rows: [] });
      }
    }
    if (!joinMode && (elemFilter === 'all' || elemFilter === 'unhosted')) {
      map.set('unhosted', { id: 'unhosted', concrete: null, name: 'Free / Unassigned', rows: [] });
    }

    for (const r of filteredRows) {
      const hostKey = r.host && concMap.has(r.host) ? r.host : 'unhosted';
      if (!map.has(hostKey)) {
        map.set(hostKey, { id: hostKey, concrete: null, name: 'Free / Unassigned', rows: [] });
      }
      map.get(hostKey).rows.push(r);
    }

    return Array.from(map.values())
      .map((g) => {
        const w = g.rows.reduce((a, r) => a + (r.Weight_kg || 0), 0);
        const v = g.concrete ? concreteVolumeM3(g.concrete) : 0;
        return {
          ...g,
          totalW: w,
          totalBars: g.rows.reduce((a, r) => a + (r._copies || 1), 0),
          volM3: v,
          ratio: rebarRatioKgM3(w, v),
        };
      })
      .filter((g) => g.rows.length > 0 || (!joinMode && elemFilter !== 'all' && g.id === elemFilter));
  }, [concretes, filteredRows, elemFilter, concMap, joinMode, joinedSet]);

  const toggleCollapse = (gid) => setCollapsed((c) => ({ ...c, [gid]: !c[gid] }));

  // Delete mode: Esc disarms (skipped while typing in a field).
  useEffect(() => {
    if (!deleteArmed) return;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      setDeleteArmed(false);
      e.preventDefault(); // consumed — App's Esc cascade must not clear the selection too
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteArmed]);

  const activeConcrete = !joinMode && elemFilter !== 'all' && elemFilter !== 'unhosted' ? concMap.get(elemFilter) : null;
  const filterLabel = joinMode
    ? (joinedIds.length ? `Joined ${joinedIds.length} members` : 'Joined (none selected)')
    : (activeConcrete ? activeConcrete.name : elemFilter === 'unhosted' ? 'Unhosted Rebars' : 'All Elements');
  const exportBars = filteredRows.map((r) => bars[r._origIdx]);
  // Concrete ids scoping the volume/ratio block in the BBS CSV export.
  const exportMemberIds = joinMode ? [...joinedIds]
    : (elemFilter === 'all' ? null : elemFilter === 'unhosted' ? [] : [elemFilter]);
  const safeFilterName = filterLabel.replace(/[\s\W]+/g, '_');
  const bbsFilename = joinMode ? `BBS_Joined_${joinedIds.length}members.csv`
    : elemFilter === 'all' ? 'bar_bending_schedule.csv' : `BBS_${safeFilterName}.csv`;
  const rebarFilename = joinMode ? 'rebar_scheduling_joined.csv'
    : elemFilter === 'all' ? 'rebar_scheduling.csv' : `rebar_scheduling_${safeFilterName}.csv`;

  const onImport = (e, append = false) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const parsed = parseCsv(String(rd.result), append ? bars : [], concretes);
        if (!parsed.length) { alert(`No rebar rows found in ${f.name}.`); return; }
        if (append) {
          appendBars(parsed);
        } else {
          setBars(parsed);
        }
        // Imported bars often sit at site coordinates far from the current
        // view — zoom out to them so the import is visible immediately.
        requestFit('all');
      }
      catch (err) { alert('CSV parse failed: ' + err.message); }
    };
    rd.readAsText(f);
    e.target.value = '';
  };

  const renderRow = (r) => {
    const i = r._origIdx;
    return (
      <tr
        key={i}
        className={((selectedBars || []).includes(i) ? 'sel' : '') + (r.hidden ? ' hidden' : '') + (deleteArmed ? ' del' : '')}
        onClick={(e) => {
          if (deleteArmed) { removeBar(i); return; }
          if (e.ctrlKey || e.metaKey || e.shiftKey) toggleBarSelected(i);
          else selectBar(i);
        }}
        onDoubleClick={() => {
          if (deleteArmed) return;
          selectBar(i);
          requestFit('bar', i);
        }}
        title={deleteArmed ? 'Delete mode: click to delete this bar (Ctrl+Z undoes)' : 'Click to select · Ctrl-click to multi-select · Double-click to zoom directly to this bar'}
        style={{ cursor: 'pointer' }}
      >
        <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
          <button className="ghost sm" title={r.hidden ? 'Show bar' : 'Hide bar (stays in BBS + CSV)'} onClick={() => updateBar(i, { hidden: r.hidden ? undefined : true })}>{r.hidden ? '🚫' : '👁'}</button>
          <button className="ghost sm" title="Duplicate / Copy this bar (Ctrl+D)" onClick={() => duplicateBar(i)}>📋</button>
        </td>
        <td>{r.Rebar_tag}</td><td>{r.Bar_mark}</td>
        <td>{r.Rebar_Type === 'c_link_with_hook' ? (String(r.double_hook || 'no').toLowerCase() === 'yes' ? 'c_link_with_hook (double)' : 'c_link_with_hook (single)') : r.Rebar_Type}</td>
        <td><span style={{ background: '#1e293b', padding: '2px 6px', borderRadius: 4, fontWeight: 600, color: '#67e8f9' }}>{SHAPE_CODES[(r.Rebar_Type || '').toLowerCase()] || 20}</span></td>
        <td>{r.Dia}</td><td>{r._copies}</td><td>{r._cut}</td><td>{r.Weight_kg}</td>
        <td title={r.bond_condition ? `bond_condition: ${r.bond_condition}` : 'auto (no lap bond — link)'}>{r.bond_condition || '—'}</td>
      </tr>
    );
  };

  return (
    <footer className="bbs">
      <div className="bbstool">
        <strong>
          {joinMode || elemFilter !== 'all'
            ? `BBS for ${filterLabel} · ${filteredRows.length} rows · ${totalBars} bars · ${totalW.toFixed(1)} kg · ${volStr} concrete · ${ratioStr}`
            : `BBS · ${filteredRows.length} rows · ${totalBars} bars · ${totalW.toFixed(1)} kg · ${volStr} concrete · ${ratioStr}`}
        </strong>

        <label className="bbs-filter" title="Filter table & BBS CSV exports to a specific concrete member">
          <span>Element:</span>
          <select value={joinMode ? '__joined' : elemFilter} onChange={(e) => {
            if (e.target.value === '__joined') {
              setJoinMode(true);
              if (!joinedIds.length) setJoinedIds((concretes || []).map((c) => c.id));
            } else {
              setJoinMode(false);
              setElemFilter(e.target.value);
            }
          }}>
            <option value="all">All Elements ({allRows.length} marks)</option>
            {visibleConcretes.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({marksByHost.get(c.id) || 0} marks)</option>
            ))}
            {activeConcrete && !visibleConcretes.some((c) => c.id === activeConcrete.id) && (
              <option value={activeConcrete.id}>{activeConcrete.name} ({marksByHost.get(activeConcrete.id) || 0} marks)</option>
            )}
            {(marksByHost.get('unhosted') || 0) > 0 && (
              <option value="unhosted">Free / Unassigned ({marksByHost.get('unhosted')} marks)</option>
            )}
            {concretes.length > 1 && <option value="__joined">🔗 Joined members…</option>}
          </select>
        </label>
        <input
          className="member-search"
          placeholder="Filter members…"
          title="Narrow the Element dropdown and the join picker (scales to hundreds of members)"
          value={memberSearch}
          onChange={(e) => setMemberSearch(e.target.value)}
        />

        {joinMode && (
          <div className="join-list" title="Tick members to join into one BBS (volumes + ratio combine)">
            <div className="join-head">
              <span>{joinedIds.length} members · {filteredRows.length} marks · {totalW.toFixed(1)} kg · {volStr} · {ratioStr}</span>
              <span style={{ display: 'inline-flex', gap: 4 }}>
                <button className="ghost sm" onClick={() => setJoinedIds((concretes || []).map((c) => c.id))}>All</button>
                <button className="ghost sm" onClick={() => setJoinedIds([])}>None</button>
                <button className="ghost sm" onClick={() => setJoinedIds((prev) => (concretes || []).filter((c) => !prev.includes(c.id)).map((c) => c.id))} title="Invert selection">Invert</button>
              </span>
            </div>
            {joinGroups.map((g) => {
              const ids = g.members.map((c) => c.id);
              const allIn = ids.every((id) => joinedSet.has(id));
              const kindVol = g.members.filter((c) => joinedSet.has(c.id)).reduce((a, c) => a + concreteVolumeM3(c), 0);
              return (
                <div key={g.kind} className="join-group">
                  <button className="ghost sm" onClick={() => toggleKind(g.members)} title={allIn ? `Untick all ${g.kind}s` : `Tick all ${g.kind}s`}>
                    {allIn ? '☑' : '☐'} {g.kind}s ({g.members.length}{kindVol > 0 ? ` · ${kindVol.toFixed(2)} m³ sel` : ''})
                  </button>
                  {g.members.map((c) => (
                    <label key={c.id} className="chk" style={{ margin: 0, fontSize: 11 }}>
                      <input
                        type="checkbox"
                        checked={joinedSet.has(c.id)}
                        onChange={(e) => setJoinedIds((prev) => e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id))}
                      />
                      {c.name} ({marksByHost.get(c.id) || 0} · {concreteVolumeM3(c).toFixed(2)} m³)
                    </label>
                  ))}
                </div>
              );
            })}
            {!joinGroups.length && <span className="hint">No members match “{memberSearch}”.</span>}
          </div>
        )}

        {!joinMode && elemFilter === 'all' && (
          <label className="chk" style={{ margin: 0, fontSize: 11 }} title="Group rebar rows under concrete element headers">
            <input type="checkbox" checked={groupByElem} onChange={(e) => setGroupByElem(e.target.checked)} />
            Group by Element
          </label>
        )}

        {activeConcrete && (
          <button className="ghost sm" onClick={() => requestFit('concrete', activeConcrete.id)} title={`Zoom camera to ${activeConcrete.name}`}>
            🎯 Zoom {activeConcrete.name}
          </button>
        )}

        <span className="btnrow inline">
          <button
            className={deleteArmed ? 'danger sm' : 'ghost sm'}
            style={deleteArmed ? { background: '#dc2626', fontWeight: 700 } : undefined}
            onClick={() => setDeleteArmed((v) => !v)}
            title={deleteArmed ? 'Delete mode ON: click any row to delete it · Esc to exit · Ctrl+Z undoes' : 'Delete mode: arm, then click rows to delete them (undoable)'}
          >
            {deleteArmed ? '🗑 Delete ON' : '🗑 Delete'}
          </button>
          <button className="ghost sm" onClick={() => setBars(autoAssignBarMarks(bars, { scopeByHost: joinMode || elemFilter !== 'all' }))} title="Detect and unify bar marks for all bars with identical shape, diameter, and length">
            🏷️ Match Marks
          </button>
          <button style={{ background: '#059669', fontWeight: 600 }} onClick={() => downloadBbsCsv(exportBars, concretes, bbsFilename, { memberIds: exportMemberIds })} title={`Generate BBS Schedule CSV with concrete volumes + rebar ratio (${joinMode || elemFilter !== 'all' ? filterLabel : 'Entire Model'})`}>
            ⤓ BBS Schedule CSV {(joinMode || elemFilter !== 'all') ? `(${filterLabel})` : ''}
          </button>
          <button onClick={() => downloadCsv(exportBars, rebarFilename)} title={`Export FreeCAD parametric template CSV (${elemFilter === 'all' ? 'Entire Model' : filterLabel})`}>
            ⤓ rebar_scheduling.csv
          </button>
          <button onClick={() => insertFileRef.current?.click()} title="Insert / Append rebars from CSV into existing concrete elements (Defaults to XY plane)">+ Insert CSV</button>
          <input ref={insertFileRef} type="file" accept=".csv" hidden onChange={(e) => onImport(e, true)} />
          <button onClick={() => fileRef.current?.click()} title="Import and replace all bars in model (Defaults to XY plane)">⤒ Replace CSV</button>
          <input ref={fileRef} type="file" accept=".csv" hidden onChange={(e) => onImport(e, false)} />
        </span>
        <span className="hint">{deleteArmed ? '🗑 Delete mode: click a row to delete · Esc to exit · Ctrl+Z undoes' : 'Tip: Double-click any row to zoom · Ctrl-click rows to multi-select · Press F to center'}</span>
      </div>
      <div className="tblwrap">
        <table>
          <thead><tr><th></th><th>#</th><th>Mark</th><th>Type</th><th>Shape</th><th>Ø</th><th>Bars</th><th>Cut (mm)</th><th>Wt (kg)</th><th>Bond</th></tr></thead>
          <tbody>
            {(joinMode || (elemFilter === 'all' && groupByElem)) ? (
              groups.map((g) => {
                const isCollapsed = !!collapsed[g.id];
                return (
                  <Fragment key={`gwrap-${g.id}`}>
                    <tr className="bbs-group-row" onClick={() => toggleCollapse(g.id)}>
                      <td colSpan={10}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <span>{isCollapsed ? '▶' : '▼'}</span>
                            <strong>📦 {g.name}</strong>
                            <span className="bbs-group-badge">{g.rows.length} rows · {g.totalBars} bars · {g.totalW.toFixed(1)} kg{g.concrete ? ' · ' + g.volM3.toFixed(3) + ' m³ · ' + (g.ratio == null ? 'n/a' : g.ratio.toFixed(1) + ' kg/m³') : ''}</span>
                          </span>
                          <span className="btnrow inline" onClick={(e) => e.stopPropagation()} style={{ gap: 4 }}>
                            {g.concrete && (
                              <button className="ghost sm" onClick={() => requestFit('concrete', g.id)} title={`Zoom 3D view to ${g.name}`}>🎯 Zoom</button>
                            )}
                            <button className="ghost sm" onClick={() => { setJoinMode(false); setElemFilter(g.id); }} title={`Filter table and BBS to ${g.name}`}>🔍 Pick only</button>
                            <button className="ghost sm" onClick={() => downloadBbsCsv(g.rows.map((r) => bars[r._origIdx]), concretes, `BBS_${g.name.replace(/[\s\W]+/g, '_')}.csv`, { memberIds: g.concrete ? [g.id] : [] })} title={`Export BBS CSV with volume + ratio for ${g.name}`}>⤓ BBS CSV</button>
                          </span>
                        </div>
                      </td>
                    </tr>
                    {!isCollapsed && g.rows.map(renderRow)}
                  </Fragment>
                );
              })
            ) : (
              filteredRows.map(renderRow)
            )}
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
      <span>{navMode === 'orbit' ? 'LMB orbit' : 'LMB select'} · MMB orbit · RMB pan · wheel zoom-to-cursor · Esc deselect</span>
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

  // Draggable resizable left panel width
  const [sideWidth, setSideWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('barbending.sideWidth');
      return saved ? Math.max(260, Math.min(800, Number(saved))) : 360;
    } catch {
      return 360;
    }
  });
  const [isResizing, setIsResizing] = useState(false);

  const startResize = (e) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startW = sideWidth;

    const onMouseMove = (ev) => {
      const newW = Math.max(260, Math.min(window.innerWidth * 0.65, startW + (ev.clientX - startX)));
      setSideWidth(Math.round(newW));
      try {
        localStorage.setItem('barbending.sideWidth', String(Math.round(newW)));
      } catch {}
    };

    const onMouseUp = () => {
      setIsResizing(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

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
      if (e.altKey) return;
      const k = (e.key || '').toLowerCase();
      const t = e.target;
      const isInput = t && (t.isContentEditable || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' ||
        (t.tagName === 'INPUT' && (t.type === 'text' || t.type === 'search' || t.type === 'number')));

      if (isInput) return;

      const st = useStore.getState();

      // Esc cascade (last resort — tool handlers run first and preventDefault
      // when they consume it: measure / draw / lap / box / delete-mode all
      // exit themselves without touching the selection).
      if (e.key === 'Escape') {
        if (e.defaultPrevented) return;
        if (st.boxSelect) { st.setBoxSelect(false); return; } // fallback (BoxSelect owns it)
        if ((st.selectedBars?.length || 0) > 0) st.clearBarSelection();
        return;
      }
      // FreeCAD-style Shift+B arms the window select (rebar only). Ignored
      // while typing, measuring, or drawing so the drag goes to that tool.
      if (e.shiftKey && (k === 'b' || e.code === 'KeyB') && !e.ctrlKey && !e.metaKey) {
        if (st.measure?.active || st.drawMode) return;
        e.preventDefault();
        st.setBoxSelect(!st.boxSelect);
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        const redoKey = k === 'y' || (k === 'z' && e.shiftKey);
        if (k === 'z' || redoKey) {
          e.preventDefault();
          if (redoKey) st.redo();
          else st.undo();
          return;
        }
        if (k === 'd') {
          e.preventDefault();
          st.duplicateBar();
          return;
        }
        if (k === 'c') {
          e.preventDefault();
          st.copyBar();
          return;
        }
        if (k === 'v') {
          e.preventDefault();
          st.pasteBar();
          return;
        }
      } else {
        if (k === 'c') {
          e.preventDefault();
          st.duplicateBar();
          return;
        }
      }
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
          <>
            <aside className="side" style={{ width: sideWidth, flex: `0 0 ${sideWidth}px` }}>
              <div className="tabs">
                <button className={tab === 'rebar' ? 'on' : ''} onClick={() => setTab('rebar')}>Rebar</button>
                <button className={tab === 'concrete' ? 'on' : ''} onClick={() => setTab('concrete')}>Concrete</button>
                <button className="collapse" onClick={() => setLeftOpen(false)} title="Collapse panel">«</button>
              </div>
              <div className="sidebody">{tab === 'rebar' ? <BarEditor /> : <ConcreteEditor />}</div>
            </aside>
            <div
              className={`resizer-bar ${isResizing ? 'active' : ''}`}
              onMouseDown={startResize}
              onDoubleClick={() => {
                setSideWidth(360);
                try { localStorage.setItem('barbending.sideWidth', '360'); } catch {}
              }}
              title="Drag to resize panel width · Double-click to reset"
            >
              <div className="resizer-handle" />
            </div>
          </>
        ) : (
          <div className="rail"><button onClick={() => setLeftOpen(true)} title="Expand panel">»</button></div>
        )}
        <section className="view"><Scene /><ViewportBar /><MeasureHud /><QueryHud /></section>
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
