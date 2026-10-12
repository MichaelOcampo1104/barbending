import { useState } from 'react';
import { useStore } from '../store.js';
import { concreteBlock, concreteBlockMembers } from './csv.js';
import { finishBbsExport } from './exportCommands.js';
import { readVolumeInputs } from './volumeOverride.js';

// The panel that opens before a BBS CSV export with concrete volumes in it: one row per member of the file, with the volume it has now (its
// exact mesh, or Lx·Ly·Lz) and a box to type a volume for this file. A blank box keeps the computed volume. The total and the rebar ratio
// are the ones the file will carry. Nothing is saved in the project. Clicks and keys in the panel never reach the app underneath (the
// app's shortcuts do not see the keys typed in a box).
export default function ExportVolumes() {
  const exp = useStore((s) => s.volumeExport);
  const concretes = useStore((s) => s.concretes);
  return exp ? <VolumePanel exp={exp} concretes={concretes} /> : null;
}

// Mounted fresh for each export, so the boxes start blank every time.
function VolumePanel({ exp, concretes }) {
  const [text, setText] = useState({});
  const { memberIds, steelKg } = exp;
  const read = readVolumeInputs(concreteBlockMembers(concretes, memberIds).map((c) => c.id), text);
  const block = concreteBlock(concretes, memberIds, read.volumesM3, steelKg);
  const exportNow = () => { if (read.ok) finishBbsExport(read.volumesM3); };
  const stop = (e) => e.stopPropagation();
  const onKeyDown = (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); useStore.getState().closeVolumeExport(); }
    else if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); exportNow(); }
  };
  return (
    <div className="volpanel-backdrop" onKeyDown={onKeyDown} onMouseDown={stop} onClick={stop}>
      <div className="volpanel" role="dialog" aria-modal="true" aria-label="Concrete volumes for this export">
        <h3>Concrete volumes for this export</h3>
        <p className="volpanel-note">
          Type a volume in m³ to use it in this file only (12.5 or 12,5). A blank box keeps the computed volume.
          Nothing is saved in the project.
        </p>
        <div className="volpanel-scroll">
          <table>
            <thead>
              <tr><th>Member</th><th className="num">Computed m³</th><th>From</th><th>Typed m³</th><th className="num">In the file</th></tr>
            </thead>
            <tbody>
              {block.members.map((m, i) => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td className="num">{m.computedM3.toFixed(3)}</td>
                  <td>{m.computedSource}</td>
                  <td>
                    <input
                      type="text"
                      inputMode="decimal"
                      autoFocus={i === 0}
                      spellCheck={false}
                      value={text[m.id] ?? ''}
                      placeholder={m.computedM3.toFixed(3)}
                      aria-label={`Volume of ${m.name} in m³, blank for the computed one`}
                      onChange={(e) => setText((t) => ({ ...t, [m.id]: e.target.value }))}
                    />
                    {read.errors[m.id] && <span className="volpanel-err">{read.errors[m.id]}</span>}
                  </td>
                  <td className="num">{m.volumeM3.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="volpanel-total">
          Total concrete {block.totalM3.toFixed(3)} m³ · steel {steelKg.toFixed(2)} kg · rebar ratio {block.ratio == null ? 'n/a' : `${block.ratio.toFixed(2)} kg/m³`}
        </div>
        <div className="volpanel-actions">
          <button className="ghost" onClick={() => useStore.getState().closeVolumeExport()}>Cancel</button>
          <button className="volpanel-go" disabled={!read.ok} onClick={exportNow}>⤓ Export BBS CSV</button>
        </div>
      </div>
    </div>
  );
}
