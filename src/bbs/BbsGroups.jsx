import { useMemo, useState } from 'react';
import { orderGroups } from './tableView.js';
import GroupName from './GroupName.jsx';

// The "Groups" view of the bottom panel: every concrete member and every ▦ group of the model in one list with its totals, so a group
// can be found without scrolling through the rows. A click on a line jumps to that group in the Rows view (and opens it); the buttons
// act on the group without leaving the list: a ▦ group can be renamed (the pencil), have the selected bars added to it or taken out of it,
// be selected or dissolved. Sorted by clicking a column title; narrowed by the find box (names and members).
// `selStats` is selectionStats() of the current selection: it says how many bars each ▦ group could take or give up.
const CAP = 600; // lines drawn per section; the find box narrows the rest

function Section({ title, hint, children }) {
  return (
    <>
      <tr className="bbs-section-row"><td colSpan={7}><strong>{title}</strong> <span className="hint">{hint}</span></td></tr>
      {children}
    </>
  );
}

export default function BbsGroups({
  elementGroups, setGroups, query, hostNameOf, onJump, onZoom, onPickOnly, onSelectSet, onUngroupSet,
  onRenameSet, onAddToSet, onRemoveFromSet, selStats,
}) {
  const [sort, setSort] = useState({ key: 'none', dir: 1 });
  const words = useMemo(() => String(query || '').toLowerCase().split(/\s+/).filter(Boolean), [query]);

  // The member names of each ▦ group (at most four), for its line and for the find box.
  const hostsBy = useMemo(() => {
    const m = new Map();
    for (const g of setGroups) {
      const names = new Set();
      for (const r of g.rows) {
        const n = hostNameOf(r);
        if (n) names.add(n);
        if (names.size > 3) break;
      }
      m.set(g.id, [...names]);
    }
    return m;
  }, [setGroups, hostNameOf]);

  const members = useMemo(() => orderGroups({ groups: elementGroups, words, sortKey: sort.key, dir: sort.dir }), [elementGroups, words, sort]);
  const sets = useMemo(() => orderGroups({ groups: setGroups, words, sortKey: sort.key, dir: sort.dir, hostsBy }), [setGroups, words, sort, hostsBy]);

  const arrow = (key) => (sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '');
  const toggle = (key) => setSort((s) => (s.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : { key: 'none', dir: 1 }));
  const th = (key, label, extra) => (
    <th onClick={() => toggle(key)} style={{ cursor: 'pointer' }} title={`Sort by ${label.toLowerCase()}`} className={extra}>{label}{arrow(key)}</th>
  );

  const line = (g, isSet) => {
    const hosts = isSet ? (hostsBy.get(g.id) || []) : [];
    const editable = isSet && !!g.setId; // "No group" is not a group
    const removable = editable && selStats ? (selStats.bySet.get(g.setId) || 0) : 0;
    const addable = editable && selStats ? selStats.total - removable : 0;
    return (
      <tr key={g.id} onClick={() => onJump(g)} title={`Show ${g.name} in the table`}>
        <td className="bbs-gname">
          {editable
            ? <GroupName name={g.name} bold={false} onRename={(to) => onRenameSet(g.setId, to)} />
            : (isSet ? `▦ ${g.name}` : `📦 ${g.name}`)}
          {hosts.length ? <span className="hint"> · {hosts.slice(0, 2).join(', ')}{hosts.length > 2 ? '…' : ''}</span> : null}
        </td>
        <td className="num">{g.rows.length}</td>
        <td className="num">{g.totalBars}</td>
        <td className="num">{g.totalW.toFixed(1)}</td>
        <td className="num">{!isSet && g.concrete ? g.volM3.toFixed(2) : ''}</td>
        <td className="num">{!isSet && g.concrete && g.ratio != null ? g.ratio.toFixed(1) : ''}</td>
        <td onClick={(e) => e.stopPropagation()} className="bbs-gact">
          {isSet ? (
            g.setId && (
              <>
                <button
                  className="ghost sm"
                  disabled={!addable}
                  onClick={() => onAddToSet(g.setId)}
                  title={addable ? `Add the ${addable} selected bar${addable > 1 ? 's' : ''} that ${addable > 1 ? 'are' : 'is'} not in ${g.name} to it (a bar in another group moves over). Undoable.` : `Select bars that are not in ${g.name} (in the Rows view: Ctrl-click, Shift-click, or Box / Lasso in the 3D view) to add them to it.`}
                >+ Add{addable ? ` ${addable}` : ''}</button>
                <button
                  className="ghost sm"
                  disabled={!removable}
                  onClick={() => onRemoveFromSet(g.setId)}
                  title={removable ? `Take the ${removable} selected bar${removable > 1 ? 's' : ''} of ${g.name} out of it. They keep their dimensions; a group needs at least 2 bars. Undoable.` : `Select bars of ${g.name} to take them out of it.`}
                >− Remove{removable ? ` ${removable}` : ''}</button>
                <button className="ghost sm" onClick={() => onSelectSet(g.setId)} title={`Select every bar of ${g.name} (the Set card opens on the left)`}>▦ Select</button>
                <button className="ghost sm" onClick={() => onUngroupSet(g.setId)} title={`Dissolve ${g.name}: its bars stay, they just edit one by one again (undoable)`}>Ungroup</button>
              </>
            )
          ) : (
            <>
              {g.concrete && <button className="ghost sm" onClick={() => onZoom(g)} title={`Zoom the 3D view to ${g.name}`}>🎯 Zoom</button>}
              <button className="ghost sm" onClick={() => onPickOnly(g)} title={`Filter the table and the BBS to ${g.name}`}>🔍 Pick only</button>
            </>
          )}
        </td>
      </tr>
    );
  };

  const more = (shown, total) => (total > shown ? <tr><td colSpan={7} className="hint">… {total - shown} more: narrow the list with the find box</td></tr> : null);

  return (
    <div className="tblwrap">
      <table className="bbs-table bbs-groups">
        <colgroup><col /><col style={{ width: 70 }} /><col style={{ width: 80 }} /><col style={{ width: 90 }} /><col style={{ width: 80 }} /><col style={{ width: 80 }} /><col style={{ width: 360 }} /></colgroup>
        <thead>
          <tr>{th('name', 'Name')}{th('rows', 'Rows', 'num')}{th('bars', 'Bars', 'num')}{th('kg', 'Wt (kg)', 'num')}<th className="num">m³</th><th className="num">kg/m³</th><th /></tr>
        </thead>
        <tbody>
          {elementGroups.length > 0 && (
            <Section title="Members" hint={`${members.length} of ${elementGroups.length}: where the bars sit`}>
              {members.slice(0, CAP).map((g) => line(g, false))}
              {more(Math.min(CAP, members.length), members.length)}
            </Section>
          )}
          {setGroups.length > 0 && (
            <Section title="▦ Groups" hint={`${sets.length} of ${setGroups.length}: sets of bars edited together`}>
              {sets.slice(0, CAP).map((g) => line(g, true))}
              {more(Math.min(CAP, sets.length), sets.length)}
            </Section>
          )}
          {!members.length && !sets.length && <tr className="bbs-empty"><td colSpan={7}>{query ? `No member or group matches “${query}”.` : 'No members or groups yet.'}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
