import { useState } from 'react';
import { useStore } from '../store.js';
import { memberKind } from './shapes.js';
import {
  barsText, defaultCardInputs, defaultLinkLap, faceDias, levelDefaults, linkZones, linksNotation, memberGroups, resolveSchedule,
  slabLinksNotation, starterSpec,
} from './memberReinforcement.js';

// Member reinforcement card (Concrete tab, under the selected box member). The form holds raw text, so partial input stays typable.
// A blank auto field is null here, and the card derives it (the placeholder shows the value). The form lives in this component only:
// it lasts while the member stays selected and is never saved in the project.
// A column is entered as a schedule laid out like the drawing: one block per level, top level first, with SIZE, MAIN BARS and LINKS.

const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
// A placeholder for a value that differs between the long and the short faces ("1650 / 1290"), or the one value when they match.
const pair = (long, short) => (long === short ? String(long) : `${long} / ${short}`);
let rowSeq = 0;
const newRow = (over = {}) => ({
  id: ++rowSeq, name: '', sfl: '', size: 'same', bars: 'same', barsLong: 'same', barsShort: 'same',
  linksOuter: 'same', linksX: 'same', linksY: 'same', slab: '', linksBotOuter: '', linksBotX: '', linksBotY: '', lap: '', step: '', jog: '', ...over,
});

function formOf(member, cover) {
  const d = defaultCardInputs(cover);
  const text = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? String(v) : v]));
  return {
    kind: memberKind(member) === 'Wall' ? 'Wall' : 'Column',
    column: {
      layout: 'all',
      lap: '',
      schedule: [newRow({
        name: 'Base',
        sfl: '0',
        size: `${Math.round(member.lx)} x ${Math.round(member.ly)}`,
        bars: `${d.column.mainCount}H${d.column.mainDia}`,
        barsLong: `${d.column.mainCount}H${d.column.mainDia}`,
        barsShort: `${d.column.mainCount}H${d.column.mainDia}`,
        linksOuter: `H${d.column.linkDia}-${d.column.linkSpacing}`,
        linksX: '',
        linksY: '',
      })],
    },
    wall: text(d.wall),
    starters: { base: true, top: true, dia: '', topDia: '', lap: '', anchorage: '', bend: '' },
  };
}

function inputsOf(f, cover) {
  const nums = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' && k !== 'layout' ? Number(v) : v]));
  // The LINKS notation of each level, from its outer link and cross-link cells (see linksNotation), and the links in its slab.
  const links = linksNotation(f.column.schedule);
  const slabLinks = slabLinksNotation(f.column.schedule);
  return {
    kind: f.kind,
    cover,
    column: {
      layout: f.column.layout,
      lap: numOrNull(f.column.lap),
      schedule: f.column.schedule.map((r, i) => ({
        name: r.name, sfl: numOrNull(r.sfl), size: r.size, bars: r.bars, barsLong: r.barsLong, barsShort: r.barsShort, links: links[i],
        slab: numOrNull(r.slab), linksBottom: slabLinks[i],
        lap: numOrNull(r.lap), step: numOrNull(r.step), jog: numOrNull(r.jog),
      })),
    },
    wall: nums(f.wall),
    starters: {
      base: f.starters.base,
      top: f.starters.top,
      dia: numOrNull(f.starters.dia),
      topDia: numOrNull(f.starters.topDia),
      lap: numOrNull(f.starters.lap),
      anchorage: numOrNull(f.starters.anchorage),
      bend: numOrNull(f.starters.bend),
    },
  };
}

function NumField({ label, field, value, onChange, placeholder }) {
  return (
    <label className="fld">
      <span>{label}</span>
      <input type="text" inputMode="decimal" data-field={field} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function TextField({ label, value, placeholder, onChange }) {
  return (
    <label className="fld">
      <span>{label}</span>
      <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

// One drawing cell: the value as the drawing writes it, and "= below" to take the level under it.
function CellField({ label, field, value, placeholder, canSame, onChange, labelWidth = 124, showSame = true }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0' }}>
      <span style={{ width: labelWidth, fontSize: 11, color: '#9fb0cc' }}>{label}</span>
      <div className="fld" style={{ flex: 1, margin: 0 }}>
        <input type="text" data-field={field} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      </div>
      {showSame && (
        <button className="sm ghost" disabled={!canSame} title="Take the value of the level below" onClick={() => onChange('same')}>= below</button>
      )}
    </div>
  );
}

export default function MemberCard({ member }) {
  const cover = useStore((s) => s.cover);
  const concretes = useStore((s) => s.concretes);
  const addMemberRows = useStore((s) => s.addMemberRows);
  const [form, setForm] = useState(() => formOf(member, cover));
  const [note, setNote] = useState(null);

  const inp = inputsOf(form, cover);
  const plan = memberGroups(member, inp, { neighbours: concretes });
  const patch = (section, key, value) => setForm((f) => ({ ...f, [section]: { ...f[section], [key]: value } }));
  const setKind = (kind) => setForm((f) => ({ ...f, kind }));
  const patchRow = (id, key, value) => setForm((f) => ({
    ...f, column: { ...f.column, schedule: f.column.schedule.map((r) => (r.id === id ? { ...r, [key]: value } : r)) },
  }));
  const addRowAbove = () => setForm((f) => ({ ...f, column: { ...f.column, schedule: [newRow(), ...f.column.schedule] } }));
  const removeRow = (id) => setForm((f) => ({ ...f, column: { ...f.column, schedule: f.column.schedule.filter((r) => r.id !== id) } }));

  // The schedule as the card reads it (bottom first), for the placeholders and the read-back line.
  const isWall = form.kind === 'Wall';
  const res = isWall ? null : resolveSchedule(inp.column.schedule, { lx: member.lx, ly: member.ly, layout: form.column.layout });
  const rowsRes = res && res.ok ? res.rows : null;
  // The link zones from the bottom of the member up: each storey, and each slab between two storeys (see linkZones).
  const zones = rowsRes ? linkZones(rowsRes, Number(member.covB ?? cover), Number(member.covT ?? cover), member.lz) : null;
  // The bar Ø on the long and the short faces, at the base and at the top (the same on both unless MAIN BARS gives long and short faces).
  const wallDia = Number(form.wall.mainDia) || 0;
  const baseDias = isWall ? { long: wallDia, short: wallDia } : rowsRes ? faceDias(rowsRes[0]) : null;
  const topDias = isWall ? baseDias : rowsRes ? faceDias(rowsRes[rowsRes.length - 1]) : null;
  const linkDia = rowsRes ? rowsRes[0].links.dia : 10;
  const legW = member.lx - 2 * cover - linkDia;
  const lapAuto = legW > 0 ? defaultLinkLap(legW) : '';
  const startBase = baseDias && { long: starterSpec(inp.starters, baseDias.long), short: starterSpec(inp.starters, baseDias.short) };

  const generate = () => {
    if (!plan.ok) {
      setNote({ ok: false, text: plan.msg });
      return;
    }
    const r = addMemberRows(plan.groups);
    setNote(r.ok
      ? { ok: true, text: `Added ${r.sets} set${r.sets === 1 ? '' : 's'}, ${r.count} rows. Undo removes them all.` }
      : { ok: false, text: r.msg });
  };

  const rows = form.column.schedule;
  const S = form.starters, W = form.wall;
  return (
    <div className="memberCard" onClick={(e) => e.stopPropagation()}>
      <div className="sect">▦ Reinforcement card</div>
      <div className="segrow" style={{ marginBottom: 6 }}>
        <button className={form.kind === 'Column' ? 'on' : ''} onClick={() => setKind('Column')}>Column</button>
        <button className={form.kind === 'Wall' ? 'on' : ''} onClick={() => setKind('Wall')}>Wall</button>
      </div>

      {form.kind === 'Column' ? (
        <>
          <div className="grid3">
            <label className="fld" style={{ gridColumn: '1 / -1' }}>
              <span>Layout</span>
              <select value={form.column.layout} onChange={(e) => patch('column', 'layout', e.target.value)}>
                <option value="all">All faces, one size</option>
                <option value="faces">All faces, long and short faces</option>
                <option value="x">Two faces (bars along X)</option>
                <option value="y">Two faces (bars along Y)</option>
              </select>
            </label>
            <NumField label="Lap at corner" value={form.column.lap} placeholder={String(lapAuto)} onChange={(v) => patch('column', 'lap', v)} />
          </div>

          <div className="sect">Schedule: top level first, as in the drawing</div>
          <div className="distnote">SFL is in metres: -20.870, not -20870. Each level is a height above the base, so it must lie between the base and the top of this member. “= below” takes the level under it.</div>
          <div className="distnote">MAIN BARS: one size on every face (44H25), or with “All faces, long and short faces”, the long faces (44H40) and the short faces (8H32) in their own cells. Each count is for a pair of faces, and the long faces take the corners.</div>
          <div className="distnote">LINKS: above each SFL, the outer link and cross links run up to the slab of the level above. SLAB THK is the slab below an SFL (the SFL is its top), and its links go on that level. Blank slab links mean the links of the storey it sits in. The base's slab is below the member, so it is not modelled.</div>
          {rows.map((row, i) => {
            const idx = rowsRes ? rowsRes.length - 1 - i : -1;
            const rr = idx >= 0 ? rowsRes[idx] : null;
            const below = idx >= 1 ? rowsRes[idx - 1] : null;
            const auto = rr && below
              ? { long: levelDefaults(faceDias(below).long, faceDias(rr).long), short: levelDefaults(faceDias(below).short, faceDias(rr).short) }
              : null;
            const isBottom = i === rows.length - 1;
            return (
              <div className="levelRow" key={row.id}>
                <div className="grid3">
                  <TextField label="Level" value={row.name} placeholder={isBottom ? 'Base' : 'Name'} onChange={(v) => patchRow(row.id, 'name', v)} />
                  <NumField label="SFL (m)" field="sfl" value={row.sfl} onChange={(v) => patchRow(row.id, 'sfl', v)} />
                  <div className="btnrow" style={{ marginTop: 14 }}>
                    <button className="sm danger" disabled={rows.length === 1} onClick={() => removeRow(row.id)}>× Remove</button>
                  </div>
                </div>
                <CellField label="SIZE" field="size" value={row.size} placeholder="2500 x 1000" canSame={!isBottom}
                  onChange={(v) => patchRow(row.id, 'size', v)} />
                {form.column.layout === 'faces' ? (
                  <>
                    <CellField label="MAIN BARS long face" field="barslong" value={row.barsLong} placeholder="44H40" canSame={!isBottom}
                      onChange={(v) => patchRow(row.id, 'barsLong', v)} />
                    <CellField label="MAIN BARS short face" field="barsshort" value={row.barsShort} placeholder="8H32" canSame={!isBottom}
                      onChange={(v) => patchRow(row.id, 'barsShort', v)} />
                  </>
                ) : (
                  <CellField label="MAIN BARS" field="bars" value={row.bars} placeholder="44H25" canSame={!isBottom}
                    onChange={(v) => patchRow(row.id, 'bars', v)} />
                )}
                <div className="distnote" style={{ marginTop: 2 }}>Links above this SFL, up to the slab of the level above:</div>
                <CellField label="Outer link" field="linksouter" value={row.linksOuter} placeholder="H10-100" canSame={!isBottom}
                  onChange={(v) => patchRow(row.id, 'linksOuter', v)} />
                <CellField label="Cross links X" field="linksx" value={row.linksX} placeholder="e.g. 2H10-150" canSame={!isBottom}
                  onChange={(v) => patchRow(row.id, 'linksX', v)} />
                <CellField label="Cross links Y" field="linksy" value={row.linksY} placeholder="e.g. 6H10-150" canSame={!isBottom}
                  onChange={(v) => patchRow(row.id, 'linksY', v)} />
                {!isBottom && (
                  <>
                    <NumField label="Slab thk (mm)" field="slab" value={row.slab} placeholder="e.g. 1500" onChange={(v) => patchRow(row.id, 'slab', v)} />
                    <div className="distnote" style={{ marginTop: 2 }}>Links in the slab below this SFL (blank: the links of the storey it sits in):</div>
                    <CellField label="Slab outer" field="linksbotouter" value={row.linksBotOuter} placeholder="H10-150" showSame={false}
                      onChange={(v) => patchRow(row.id, 'linksBotOuter', v)} />
                    <CellField label="Slab cross X" field="linksbotx" value={row.linksBotX} placeholder="e.g. 2H10-150" showSame={false}
                      onChange={(v) => patchRow(row.id, 'linksBotX', v)} />
                    <CellField label="Slab cross Y" field="linksboty" value={row.linksBotY} placeholder="e.g. 6H10-150" showSame={false}
                      onChange={(v) => patchRow(row.id, 'linksBotY', v)} />
                  </>
                )}
                {!isBottom && (
                  <details style={{ marginTop: 4 }}>
                    <summary style={{ fontSize: 11, color: '#9fb0cc', cursor: 'pointer' }}>Lap, crank and jog for this level</summary>
                    <div className="grid3">
                      <NumField label="Lap" value={row.lap} placeholder={auto ? pair(auto.long.lap, auto.short.lap) : ''} onChange={(v) => patchRow(row.id, 'lap', v)} />
                      <NumField label="Crank step" value={row.step} placeholder={auto ? pair(auto.long.step, auto.short.step) : ''} onChange={(v) => patchRow(row.id, 'step', v)} />
                      <NumField label="Jog" value={row.jog} placeholder={auto ? pair(auto.long.jog, auto.short.jog) : ''} onChange={(v) => patchRow(row.id, 'jog', v)} />
                    </div>
                  </details>
                )}
              </div>
            );
          })}
          <div className="btnrow">
            <button className="sm" onClick={addRowAbove}>+ Level above the top</button>
          </div>
          {rowsRes && (
            <div className="distnote" style={{ marginTop: 4 }}>
              <div>Heights are above the base. This member is {Math.round(member.lz)} mm high.</div>
              {rowsRes.slice().reverse().map((r) => (
                <div key={r.h}>
                  {r.name}{r.h ? ` at ${r.h} mm` : ''}: {barsText(r.bars)}, links H{r.links.dia} @{r.links.spacing}
                  {r.links.cross.map((g) => `, + ${g.count} hooked cross-ties ${g.dir} H${g.dia} @${g.spacing}`).join('')}
                </div>
              ))}
              {zones && (
                <div style={{ marginTop: 4 }}>
                  <div>Link zones, in mm above the base:</div>
                  {zones.map((z) => (
                    <div key={z.bottom}>
                      {Math.round(z.bottom)} to {Math.round(z.top)}: {z.name}, H{z.links.dia} @{z.links.spacing}
                      {z.links.cross.map((g) => `, + ${g.count} cross links ${g.dir} H${g.dia} @${g.spacing}`).join('')}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="grid3">
            <NumField label="Main Ø" value={W.mainDia} onChange={(v) => patch('wall', 'mainDia', v)} />
            <NumField label="Main spacing" value={W.mainSpacing} onChange={(v) => patch('wall', 'mainSpacing', v)} />
            <NumField label="Distribution Ø" value={W.distDia} onChange={(v) => patch('wall', 'distDia', v)} />
          </div>
          <div className="grid3">
            <NumField label="Distribution spacing" value={W.distSpacing} onChange={(v) => patch('wall', 'distSpacing', v)} />
            <NumField label="Link Ø" value={W.linkDia} onChange={(v) => patch('wall', 'linkDia', v)} />
            <NumField label="Link spacing" value={W.linkSpacing} onChange={(v) => patch('wall', 'linkSpacing', v)} />
          </div>
          <div className="grid3">
            <NumField label="Link spacing (height)" value={W.linkVSpacing} onChange={(v) => patch('wall', 'linkVSpacing', v)} />
            <NumField label="Link leg A" value={W.legA} onChange={(v) => patch('wall', 'legA', v)} />
          </div>
        </>
      )}

      <div className="sect">Starters</div>
      <div className="grid3">
        <label className="chk" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={S.base} onChange={(e) => patch('starters', 'base', e.target.checked)} />
          Base
        </label>
        <label className="chk" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={S.top} onChange={(e) => patch('starters', 'top', e.target.checked)} />
          Top
        </label>
        <NumField label="Base Ø" value={S.dia} placeholder={baseDias && baseDias.long ? pair(baseDias.long, baseDias.short) : ''} onChange={(v) => patch('starters', 'dia', v)} />
      </div>
      <div className="grid3">
        <NumField label="Top Ø" value={S.topDia} placeholder={topDias && topDias.long ? pair(topDias.long, topDias.short) : ''} onChange={(v) => patch('starters', 'topDia', v)} />
        <NumField label="Lap" value={S.lap} placeholder={startBase ? pair(startBase.long.lap, startBase.short.lap) : ''} onChange={(v) => patch('starters', 'lap', v)} />
        <NumField label="Anchorage" value={S.anchorage} placeholder={startBase ? pair(startBase.long.anchorage, startBase.short.anchorage) : ''} onChange={(v) => patch('starters', 'anchorage', v)} />
      </div>
      <div className="grid3">
        <NumField label="Bend leg" value={S.bend} placeholder={startBase ? pair(startBase.long.bend, startBase.short.bend) : ''} onChange={(v) => patch('starters', 'bend', v)} />
      </div>

      {plan.ok ? (
        <div className="distnote" style={{ marginTop: 4 }}>
          {plan.groups.map((g) => (
            <div key={g.name}>{g.name}: {g.rows.length} row{g.rows.length === 1 ? '' : 's'}</div>
          ))}
          {plan.warnings.map((w) => <div key={w}>⚠ {w}</div>)}
        </div>
      ) : (
        <div className="distnote" style={{ marginTop: 4, color: '#f87171' }}>{plan.msg}</div>
      )}
      <div className="btnrow">
        <button disabled={!plan.ok} onClick={generate}>▦ Generate sets</button>
      </div>
      {note && <div className="distnote" style={{ color: note.ok ? '#86efac' : '#f87171' }}>{note.text}</div>}
    </div>
  );
}
