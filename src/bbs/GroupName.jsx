import { useState } from 'react';
import { GROUP_NAME_MAX } from './groups.js';

// A group's name with a pencil to rename it in place: Enter saves, Esc or clicking away cancels. `onRename(name)` returns { ok, msg } (the
// store's renameGroup); a refused name stays open with the reason beside the box. It sits inside rows that react to a click (the table's
// group header collapses, a line of the Groups list jumps), so every event in it is stopped from reaching them, and the keys typed in the
// box never reach the app's shortcuts.
// Props: name (the group's current name), onRename, prefix (shown before the name, '▦ ' by default), bold (draw the name in <strong>),
// wrap (let the refusal message wrap under the box: for a roomy card; in a table row it stays on one line).
export default function GroupName({ name, onRename, prefix = '▦ ', bold = true, wrap = false }) {
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState('');

  if (!editing) {
    const label = `${prefix}${name}`;
    return (
      <span className="bbs-gname-view">
        {bold ? <strong title={label}>{label}</strong> : <span title={label}>{label}</span>}
        <button
          className="ghost sm bbs-pencil"
          title="Rename this group"
          onClick={(e) => { e.stopPropagation(); setMsg(''); setEditing(true); }}
        >✏️</button>
      </span>
    );
  }

  const stop = (e) => e.stopPropagation();
  const save = (value) => {
    const r = onRename(value);
    if (r && r.ok) setEditing(false);
    else setMsg((r && r.msg) || 'That name is not allowed.');
  };
  return (
    <span className={`bbs-rename${wrap ? ' wrap' : ''}`} onClick={stop} onDoubleClick={stop} onMouseDown={stop}>
      <input
        type="text"
        autoFocus
        defaultValue={name}
        maxLength={GROUP_NAME_MAX}
        spellCheck={false}
        aria-label="Group name"
        title="Enter saves · Esc cancels"
        onFocus={(e) => e.target.select()}
        onChange={() => setMsg('')}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); save(e.currentTarget.value); }
          else if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
        }}
      />
      {msg && <span className="bbs-rename-err" title={msg}>{msg}</span>}
    </span>
  );
}
