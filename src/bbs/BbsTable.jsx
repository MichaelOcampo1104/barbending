import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../store.js';
import { ROW_H, windowRange, clampScrollTop, revealTop, groupNumberAt } from './tableView.js';

// The BBS table of the bottom panel. It draws only the rows that are on screen (plus a few each side) between two spacer rows, so 25,000
// rows (1M bars) cost the same as 25 and scrolling, selecting and loading stay instant. Every row is exactly ROW_H tall (App.css), which makes
// the scroll maths plain arithmetic (see tableView.js). In a grouped table the header of the group you are in stays pinned under the
// column titles: a row of no height that floats over the first row of the body (App.css), so at the top of the list it is the first
// group's own header rather than a copy of it, and the item that scrolled under it is the one it stands for. The table also moves
// itself: to the selected bar when the selection changes from outside (a click in the 3D view),
// on "Go to selection", and to a group or row when the Groups overview jumps here. It never moves under a click made in the table.
//
// Props: items (flattenItems), grouped, collapsed ({ [groupId]: true }), head (the column title cells), cols (column widths),
// renderRow(row) / renderGroupRow(group, pinned) (return <tr>), onExpandGroup(id), goNonce (bump to scroll to the selection),
// jump ({ gid } | { firstIdx } object; a new object is a new jump), emptyText.
export default function BbsTable({
  items, grouped, collapsed, head, cols, renderRow, renderGroupRow, onExpandGroup, goNonce, jump, emptyText,
}) {
  const wrapRef = useRef(null);
  const frameRef = useRef(0);
  const pendingRef = useRef(null);
  const touchedRef = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(0);
  const selectedBar = useStore((s) => s.selectedBar);
  const colSpan = cols.length;

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => setViewH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); }, []);

  const onScroll = () => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      if (wrapRef.current) setScrollTop(wrapRef.current.scrollTop);
    });
  };

  // Requests to put something on screen. The selected bar changed (not by a click in this table: the row is where the user pointed,
  // so it stays), "Go to selection", or a jump from the Groups overview (declared last, so it wins when this table has just been opened).
  // These only note what is wanted; the effect below carries it out in the same commit.
  useEffect(() => {
    if (performance.now() - touchedRef.current < 400) return;
    pendingRef.current = { origIdx: selectedBar, force: false };
  }, [selectedBar]);
  useEffect(() => {
    if (goNonce) pendingRef.current = { origIdx: useStore.getState().selectedBar, force: true };
  }, [goNonce]);
  useEffect(() => {
    if (jump) pendingRef.current = { ...jump };
  }, [jump]);

  // Carries the request out as soon as the items allow. It runs after every render (nothing to do but a null check when no request is
  // pending): a collapsed group is opened first, and the render that follows finishes the job.
  useEffect(() => {
    const p = pendingRef.current;
    const el = wrapRef.current;
    if (!p || !el) return;
    if (p.gid !== undefined && items.groupAt.has(p.gid)) { // a group header goes to the top of the table, and the group opens
      pendingRef.current = null;
      if (collapsed[p.gid]) onExpandGroup(p.gid);
      el.scrollTop = items.groupAt.get(p.gid) * ROW_H;
      return;
    }
    const origIdx = p.gid !== undefined ? p.firstIdx : p.origIdx; // no such header (a flat table): fall back to the group's first row
    const force = p.gid !== undefined ? true : p.force;
    const at = items.rowAt.get(origIdx);
    if (at === undefined) {
      const owner = items.rowGroup.get(origIdx);
      if (owner !== undefined && collapsed[owner]) { onExpandGroup(owner); return; }
      pendingRef.current = null; // the row is not in this view (the find box filters it out)
      return;
    }
    pendingRef.current = null;
    const top = revealTop({ index: at, scrollTop: el.scrollTop, bodyH: Math.max(0, el.clientHeight - ROW_H), force, inset: grouped ? ROW_H : 0 });
    if (top !== null) el.scrollTop = top;
  });

  // The column titles are the only header in the flow (one row); the pinned group header floats over the first row of the body.
  // Drawn from the clamped position: the stored one is stale for a frame when the list just got shorter (a find, Collapse all).
  const top = clampScrollTop(scrollTop, items.count, viewH);
  const { first, last } = windowRange(top, Math.max(0, viewH - ROW_H), items.count);
  const pinned = grouped && items.groupItems.length
    ? items.refs[items.groupItems[groupNumberAt(items.groupItems, Math.min(items.count - 1, Math.floor(top / ROW_H)))]]
    : null;
  const shown = [];
  for (let i = first; i < last; i += 1) shown.push(items.kinds[i] === 1 ? renderGroupRow(items.refs[i], false) : renderRow(items.refs[i]));

  return (
    <div
      className="tblwrap"
      ref={wrapRef}
      onScroll={onScroll}
      onPointerDownCapture={() => { touchedRef.current = performance.now(); }}
      style={{ '--bbs-row-h': `${ROW_H}px` }}
    >
      <table className="bbs-table">
        <colgroup>{cols.map((w, i) => <col key={i} style={w ? { width: w } : undefined} />)}</colgroup>
        <thead>
          <tr>{head}</tr>
          {grouped && (pinned ? renderGroupRow(pinned, true) : <tr className="bbs-group-row pin"><td colSpan={colSpan} /></tr>)}
        </thead>
        <tbody>
          {first > 0 && <tr className="bbs-spacer" style={{ height: first * ROW_H }}><td colSpan={colSpan} /></tr>}
          {shown}
          {last < items.count && <tr className="bbs-spacer" style={{ height: (items.count - last) * ROW_H }}><td colSpan={colSpan} /></tr>}
          {items.count === 0 && <tr className="bbs-empty"><td colSpan={colSpan}>{emptyText}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
