// Browser checks for the bottom BBS panel (headless Edge on the real GPU, trusted mouse and key events).
// usage: node scripts/perf/check_bbs.mjs --url <app base url> [--only fixture|scale] [--big <project.json>]
// fixture: a 400-row project (6 members, 5 ▦ groups, 40 free rows). The table draws only what is on screen (fixed 28 px rows) and still
//          reaches the last row; the header of the group you are in stays pinned; a click, Ctrl-click and Shift-click select without moving
//          the table; the find box narrows by mark, group, member, Ø; Collapse all / Expand all; the Groups overview lists members and
//          ▦ groups and a click jumps to one; the table follows a selection made elsewhere and "Go to selection"; maximize; Tools; grouping
//          by element / ▦ group / none; sort; one member; joined members; delete mode; typing in the find box; an empty schedule; the
//          first-run panel height.
// scale  : the same at a million bars (--big, 25,000 rows; 200 members and 500 ▦ groups are added to it): DOM size, row click, scroll to
//          the end, jump to a group, find, follow a selection. On this machine the old table kept the page blocked for about 20 s while
//          loading that project, held 1.2 million DOM nodes and took 1.2-1.4 s to select a row; now the panel holds about 500 nodes and a
//          selection takes 0.2-0.4 s (the scene and the left panel's dropdowns, not the table).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, sleep } from './lib/cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });
const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
};
const base = (arg('url') || '').replace(/\/$/, '');
const only = arg('only', '');
const bigFile = arg('big', '');
if (!base) { console.error('usage: node scripts/perf/check_bbs.mjs --url <app base url> [--only fixture|scale] [--big project.json]'); process.exit(2); }

let failures = 0;
const report = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures += 1; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const ROW_H = 28;

// ---- the app and the project ----
async function waitFor(b, expr, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await b.ev(expr, 15000).catch(() => false)) return true;
    await sleep(100);
  }
  return false;
}
async function openApp(b, projectPath, rowCount) {
  await b.send('Page.navigate', { url: `${base}/?autotest=bbs` });
  if (!(await waitFor(b, '!!document.querySelector("canvas") && !!window.__store', 60000))) throw new Error('the app did not start at ' + base);
  const root = await b.send('DOM.getDocument', { depth: 0 });
  const q = await b.send('DOM.querySelectorAll', { nodeId: root.root.nodeId, selector: 'input[type=file]' });
  const t0 = Date.now();
  await b.send('DOM.setFileInputFiles', { files: [path.resolve(projectPath)], nodeId: q.nodeIds[0] });
  if (!(await waitFor(b, `window.__store.getState().bars.length === ${rowCount}`, Math.max(120000, rowCount * 24)))) throw new Error('the app did not take the project');
  return Date.now() - t0;
}

// 400 rows: 6 members of 60 rows (c1..c6), 40 free rows; ▦ groups S1..S5 of 40 rows over the first 200 rows; Ø cycles 12, 16, 20, 25.
// The free rows sit 50 m away from every member: the app hosts a bar that lies inside a member's volume by itself.
const DIAS = [12, 16, 20, 25];
const MEMBERS = 6;
// S5 (rows 160-199) is a group "drawn from a face sketch": its bars carry the sketch, which group editing has to ask about before dropping.
const SKETCH_SPEC = JSON.stringify({ p1: [0, 0, 1000], p2: [3000, 0, 1000], axis: 'x', planeCoord: 0, cover: 40 });
function makeFixture() {
  const bars = [];
  for (let i = 0; i < 400; i += 1) {
    const bar = {
      Rebar_tag: i + 1, Bar_mark: `M${String(i + 1).padStart(4, '0')}`, Rebar_Type: 'straight', Plane: 'XY', Dia: DIAS[i % 4], 'Length of Bar': 2000,
      Pos_x: (i >= MEMBERS * 60 ? 50000 : 0) + (i % 20) * 150, Pos_y: Math.floor(i / 20) * 200, Pos_z: 1000 + (i % 4) * 100, Pos_Rotation: 0, qty: 1, qty_x: 1, spacing_x: 150, qty_y: 1, spacing_y: 150,
      Group: 'g', bond_condition: i % 2 ? 'good' : 'poor', Visible: 1,
    };
    if (i < MEMBERS * 60) bar.host = `c${1 + Math.floor(i / 60)}`;
    if (i < 200) bar.setId = `S${1 + Math.floor(i / 40)}`;
    if (i >= 160 && i < 200) bar.setSpec = SKETCH_SPEC;
    bars.push(bar);
  }
  const concretes = Array.from({ length: MEMBERS }, (_, k) => ({ id: `c${k + 1}`, name: `Member c${k + 1}`, lx: 3000, ly: 4000, lz: 600, x: 0, y: 0, z: 800 + k * 700 }));
  return { v: 1, app: 'barbending', savedAt: Date.now(), bars, concretes, refLines: [], cover: 40, bond: 'poor', selectedBar: 0, selectedBars: [0] };
}
const hostName = (i) => (i < MEMBERS * 60 ? `Member c${1 + Math.floor(i / 60)}` : 'Free / Unassigned');

// ---- reading the panel ----
const DATA_ROWS = `Array.from(document.querySelectorAll('.tblwrap tbody tr')).filter((r) => !r.classList.contains('bbs-spacer') && !r.classList.contains('bbs-group-row') && !r.classList.contains('bbs-empty'))`;
const info = (b) => b.ev(`(() => {
  const f = document.querySelector('footer.bbs'); const w = document.querySelector('.tblwrap');
  const all = Array.from(document.querySelectorAll('.tblwrap tbody tr')).filter((r) => !r.classList.contains('bbs-spacer'));
  const data = ${DATA_ROWS};
  const pin = document.querySelector('.tblwrap thead tr.bbs-group-row');
  return { panelH: Math.round(f.getBoundingClientRect().height), wrapH: Math.round(w.getBoundingClientRect().height), scrollTop: w.scrollTop, scrollH: w.scrollHeight,
    tr: document.querySelectorAll('.tblwrap tbody tr').length, rowHeights: [...new Set(all.map((r) => Math.round(r.getBoundingClientRect().height * 10) / 10))],
    dataMarks: data.map((r) => r.children[2].textContent), groupRows: document.querySelectorAll('.tblwrap tbody tr.bbs-group-row').length,
    pinned: pin ? pin.textContent : null, nodes: document.querySelectorAll('*').length, panelNodes: f.querySelectorAll('*').length };
})()`);
// The first row of the body that is clear of the column titles and of the pinned group header (which floats over the first row of the body).
const firstClear = (b) => b.ev(`(() => {
  const pin = document.querySelector('.tblwrap thead .bbs-group-line'); const head = document.querySelector('.tblwrap thead');
  const clear = (pin || head).getBoundingClientRect().bottom;
  const r = Array.from(document.querySelectorAll('.tblwrap tbody tr')).find((x) => !x.classList.contains('bbs-spacer') && x.getBoundingClientRect().top >= clear - 1);
  if (!r) return null;
  const header = r.classList.contains('bbs-group-row');
  return { header, mark: header ? r.textContent.slice(0, 24) : r.children[2].textContent, pinned: pin ? pin.textContent.slice(0, 30) : null };
})()`);
const modeOf = (b) => b.ev(`Array.from(document.querySelectorAll('footer.bbs label')).find((x) => x.textContent.trim().startsWith('Group by')).querySelector('select').value`);
const nav = (b) => b.ev(`document.querySelector('.bbs-nav').textContent`);
const selected = (b) => b.ev('window.__store.getState().selectedBars.slice()');
// The centre of a table row, only when the whole row is on screen: below the column titles and the pinned group header that floats over the
// first row of the body, above the bottom of the table and of the page (a click outside the page lands on nothing).
const pageXY = (b, expr) => b.ev(`(() => { const e = ${expr}; if (!e) return null; const r = e.getBoundingClientRect();
  const w = document.querySelector('.tblwrap').getBoundingClientRect(); const head = document.querySelector('.tblwrap thead').getBoundingClientRect();
  const pin = document.querySelector('.tblwrap thead .bbs-group-line'); const clear = pin ? pin.getBoundingClientRect().bottom : head.bottom;
  if (r.top < clear - 1 || r.bottom > Math.min(w.bottom, window.innerHeight) + 1) return null;
  return [r.left + Math.min(r.width / 2, 120), r.top + r.height / 2]; })()`);
async function click(b, pt, modifiers = 0) {
  if (!pt) throw new Error('click: that row is not fully on screen');
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt[0], y: pt[1] });
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt[0], y: pt[1], button: 'left', buttons: 1, clickCount: 1, modifiers });
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt[0], y: pt[1], button: 'left', buttons: 0, clickCount: 1, modifiers });
}
const rowOf = (mark) => `${DATA_ROWS}.find((r) => r.children[2].textContent === ${JSON.stringify(mark)})`;
const clickButton = (b, text) => b.ev(`(() => { const e = Array.from(document.querySelectorAll('footer.bbs button')).find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!e) return false; e.click(); return true; })()`);
const setFind = (b, text) => b.ev(`(() => { const i = document.querySelector('.bbs-find'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const setSelect = (b, label, value) => b.ev(`(() => { const l = Array.from(document.querySelectorAll('footer.bbs label')).find((x) => x.textContent.trim().startsWith(${JSON.stringify(label)})); const s = l && l.querySelector('select'); if (!s) return false; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
const scrollTo = async (b, top) => { await b.ev(`document.querySelector('.tblwrap').scrollTop = ${top}`); await sleep(250); };
const settle = (ms = 350) => sleep(ms);

// ---- group editing helpers ----
const storeEv = (b, expr) => b.ev(`(() => { const s = window.__store.getState(); return ${expr}; })()`);
const groupCounts = (b) => storeEv(b, `s.bars.reduce((m, x) => { if (x.setId) m[x.setId] = (m[x.setId] || 0) + 1; return m; }, {})`);
const pastDepth = (b) => storeEv(b, 's.past.length');
// The centre of any element that is on the page (the Set card is outside the table, so pageXY does not do).
const viewXY = (b, expr) => b.ev(`(() => { const e = ${expr}; if (!e) return null; const r = e.getBoundingClientRect(); if (!r.width || r.top < 0 || r.bottom > window.innerHeight) return null; return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
// A line of the Groups list, by the group's name, and a button of that line by the start of its label.
const lineEl = (name) => `Array.from(document.querySelectorAll('.bbs-groups tbody tr')).find((r) => { const v = r.querySelector('.bbs-gname-view > strong, .bbs-gname-view > span'); return v && v.title === ${JSON.stringify(`▦ ${name}`)}; })`;
const pencilOf = (name) => `(${lineEl(name)} || document.createElement('i')).querySelector('.bbs-pencil')`;
const lineBtn = (name, label) => `Array.from((${lineEl(name)} || document.createElement('i')).querySelectorAll('button')).find((x) => x.textContent.trim().startsWith(${JSON.stringify(label)}))`;
const pressKey = async (b, key, vk) => {
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: vk, ...(key === 'Enter' ? { text: '\r' } : {}) });
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: vk });
};
const typeKeys = async (b, text) => {
  for (const ch of text) {
    const code = /[a-z]/i.test(ch) ? `Key${ch.toUpperCase()}` : /[0-9]/.test(ch) ? `Digit${ch}` : '';
    const vk = ch.toUpperCase().charCodeAt(0);
    await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, code, text: ch, windowsVirtualKeyCode: vk });
    await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code, windowsVirtualKeyCode: vk });
  }
};
// The rename box is open and its text selected: type the new name (replacing it) and press Enter.
const typeName = async (b, text) => { await b.send('Input.insertText', { text }); await pressKey(b, 'Enter', 13); };
// The confirm / alert dialogs the page opens are answered by the check: `answer` is what the user clicks, `seen` what was asked.
const dlg = { answer: true, seen: [] };

async function fixture() {
  const project = makeFixture();
  const file = path.join(outDir, 'check_bbs_fixture.json');
  fs.writeFileSync(file, JSON.stringify(project));
  const b = await launchBrowser({ width: 1600, height: 900 });
  b.on('Page.javascriptDialogOpening', (p) => {
    dlg.seen.push({ type: p.type, message: p.message });
    b.send('Page.handleJavaScriptDialog', { accept: dlg.answer }).catch(() => {});
  });
  try {
    await openApp(b, file, project.bars.length);
    await settle(1200);

    // First run: the panel has its default height (it used to come up 120 px tall, the toolbar alone filling it) and the table is visible.
    const i0 = await info(b);
    report(i0.panelH === 300 && i0.wrapH >= 120, `fixture: on a first run the panel is ${i0.panelH} px tall and the table ${i0.wrapH} px (was 120 and 2)`);

    // Only what is on screen is in the page, every row is exactly 28 px, and the scroll height is the whole list.
    const items = 7 + 400;
    report(i0.tr <= 40 && i0.rowHeights.length === 1 && i0.rowHeights[0] === ROW_H, `fixture: ${i0.tr} table rows in the page for ${items} items, all ${i0.rowHeights.join(' / ')} px tall`);
    report(near(i0.scrollH, items * ROW_H + ROW_H, 6), `fixture: the table scrolls over the whole list (${i0.scrollH} px for ${items} items and the column titles)`);
    // At the top of the list the pinned header is the first group's own header: the row under it is the first bar, not a repeat of the header.
    const top0 = await firstClear(b);
    report(top0 && !top0.header && top0.mark === 'M0001' && top0.pinned && top0.pinned.includes('Member c1'), `fixture: at the top the row under the pinned header "${top0 && top0.pinned}" is ${top0 && top0.mark} (the header is not shown twice)`);

    // To the end and back; the header of the group at the top stays pinned and names the right member.
    await scrollTo(b, 1e7);
    const iEnd = await info(b);
    report(iEnd.dataMarks.includes('M0400') && iEnd.tr <= 40, `fixture: scrolled to the end it shows the last row M0400 (${iEnd.tr} table rows in the page)`);
    await scrollTo(b, 5000);
    const iMid = await info(b);
    const topTag = await b.ev(`(() => { const w = document.querySelector('.tblwrap'); const top = w.getBoundingClientRect().top + 2 * ${ROW_H}; const r = ${DATA_ROWS}.find((x) => x.getBoundingClientRect().top >= top); return r ? Number(r.children[1].textContent) : -1; })()`);
    report(topTag > 0 && iMid.pinned && iMid.pinned.includes(hostName(topTag - 1)), `fixture: halfway down the pinned header reads "${(iMid.pinned || '').slice(0, 40)}" for row #${topTag} (${hostName(topTag - 1)})`);
    await scrollTo(b, 0);

    // A click, Ctrl-click and Shift-click select; the table does not move under the pointer.
    // (the 300 px panel shows at least M0001..M0003 under the pinned header, more when the toolbar is on one line)
    const before = (await info(b)).scrollTop;
    await click(b, await pageXY(b, rowOf('M0002')));
    await settle();
    report(JSON.stringify(await selected(b)) === '[1]' && (await info(b)).scrollTop === before, `fixture: a click on M0002 selects it and the table stays put`);
    await click(b, await pageXY(b, rowOf('M0003')), 2);
    await settle();
    report(JSON.stringify(await selected(b)) === '[1,2]', `fixture: Ctrl-click adds M0003 (selection ${JSON.stringify(await selected(b))})`);
    await click(b, await pageXY(b, rowOf('M0001')));
    await click(b, await pageXY(b, rowOf('M0003')), 8);
    await settle();
    report(JSON.stringify(await selected(b)) === '[0,1,2]', `fixture: Shift-click selects the range M0001..M0003 (selection ${JSON.stringify(await selected(b))})`);
    // A row cut off by the bottom edge: a click on its visible part selects it and must not scroll the table to reveal it
    // (a selection made anywhere else does scroll; see "selecting M0301 elsewhere" below). The table is first scrolled so that the
    // bottom edge cuts a row in half, whatever height the toolbar has taken.
    const s0 = await b.ev(`(() => { const el = document.querySelector('.tblwrap'); const s = (((14 - ((el.clientHeight - ${ROW_H}) % ${ROW_H})) % ${ROW_H}) + ${ROW_H}) % ${ROW_H}; el.scrollTop = s; return s; })()`);
    await settle(400);
    const edge = await b.ev(`(() => { const el = document.querySelector('.tblwrap'); const w = el.getBoundingClientRect(); const bottom = w.top + el.clientTop + el.clientHeight;
      const rows = ${DATA_ROWS}.map((x) => ({ x, q: x.getBoundingClientRect() }));
      const hit = rows.find(({ q }) => q.top < bottom - 2 && q.bottom > bottom + 2);
      if (!hit) return { none: true, bottom, scrollTop: el.scrollTop, rows: rows.slice(0, 8).map(({ x, q }) => [x.children[2].textContent, Math.round(q.top), Math.round(q.bottom)]) };
      return { mark: hit.x.children[2].textContent, pt: [hit.q.left + 120, (hit.q.top + bottom) / 2], visible: Math.round(bottom - hit.q.top) }; })()`);
    if (edge && !edge.none) {
      await click(b, edge.pt);
      await settle(600);
      const sel = await selected(b);
      report(sel.length === 1 && sel[0] === Number(edge.mark.slice(1)) - 1 && (await info(b)).scrollTop === s0, `fixture: a click on ${edge.mark}, cut off by the bottom edge (${edge.visible} px showing), selects it and the table stays put`);
    } else {
      report(false, `fixture: no row was cut off by the bottom edge to click ${JSON.stringify(edge)}`);
    }
    await scrollTo(b, 0);

    // The find box.
    const finds = [
      ['M0017', (r, i) => r === `M${String(i + 1).padStart(4, '0')}` && i === 16, 1],
      ['s3', (r, i) => i >= 80 && i < 120, 40],
      ['Member c2', (r, i) => i >= 60 && i < 120, 60],
      ['d25', (r, i) => i % 4 === 3, 100],
      ['s3 d25', (r, i) => i >= 80 && i < 120 && i % 4 === 3, 10],
      ['poor', (r, i) => i % 2 === 0, 200],
    ];
    for (const [text, , want] of finds) {
      await setFind(b, text);
      await settle();
      const n = await nav(b);
      const m = /(\d[\d,]*) of (\d[\d,]*) rows match/.exec(n);
      const got = m ? Number(m[1].replace(/,/g, '')) : -1;
      report(got === want, `fixture: find "${text}" leaves ${got} of 400 rows (expected ${want})`);
    }
    await setFind(b, 'M0017');
    await settle();
    const iFind = await info(b);
    report(iFind.dataMarks.length === 1 && iFind.dataMarks[0] === 'M0017' && iFind.groupRows === 1, `fixture: the table lists M0017 under its member only (${iFind.groupRows} header, ${iFind.dataMarks.length} row)`);
    await b.ev(`document.querySelector('.bbs-find').focus()`);
    await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await settle();
    report((await b.ev(`document.querySelector('.bbs-find').value`)) === '' && (await info(b)).groupRows >= 1 && !/match/.test(await nav(b)), 'fixture: Esc clears the find box and the whole table is back');

    // Typing in the find box fills the box and nothing else: the single-key shortcuts of the app (C duplicates the bar, F fits the view,
    // Shift+B arms the box tool) stay quiet.
    await b.ev(`document.querySelector('.bbs-find').focus()`);
    for (const ch of ['c', 'f', 'b']) {
      const code = `Key${ch.toUpperCase()}`;
      const vk = ch.toUpperCase().charCodeAt(0);
      await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, code, text: ch, windowsVirtualKeyCode: vk });
      await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code, windowsVirtualKeyCode: vk });
    }
    await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'B', code: 'KeyB', text: 'B', modifiers: 8, windowsVirtualKeyCode: 66 });
    await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'B', code: 'KeyB', modifiers: 8, windowsVirtualKeyCode: 66 });
    await settle();
    const typed = await b.ev(`document.querySelector('.bbs-find').value`);
    const afterTyping = await b.ev(`(() => { const s = window.__store.getState(); return { bars: s.bars.length, tool: s.selectTool }; })()`);
    report(typed === 'cfbB' && afterTyping.bars === 400 && afterTyping.tool === null, `fixture: typing "cfbB" in the find box only fills the box: no bar duplicated, no select tool armed (box "${typed}", ${JSON.stringify(afterTyping)})`);
    await setFind(b, '');
    await settle();

    // A find that shortens the list while the table is scrolled to the end must not show an empty table for a frame or two
    // (the scroll position kept in state is stale until the browser's scroll event arrives).
    await scrollTo(b, 1e7);
    const seen = await b.ev(`(async () => { ${setFindJs('M0017')}; const n = []; for (let i = 0; i < 10; i += 1) { await new Promise((r) => requestAnimationFrame(r)); n.push(${DATA_ROWS}.length); } return n; })()`);
    report(seen.every((n) => n === 1), `fixture: a find that shortens the list while scrolled to the end never shows an empty table (data rows per frame ${JSON.stringify(seen)})`);
    await setFind(b, '');
    await settle();
    await scrollTo(b, 0);

    // Collapse all / Expand all.
    await clickButton(b, '⊟ Collapse all');
    await settle();
    const iCollapsed = await info(b);
    report(iCollapsed.dataMarks.length === 0 && iCollapsed.groupRows === 7 && near(iCollapsed.scrollH, 7 * ROW_H + ROW_H, 4), `fixture: Collapse all leaves the ${iCollapsed.groupRows} group headers and no rows`);
    await clickButton(b, '⊞ Expand all');
    await settle();
    report((await info(b)).dataMarks.length > 0, 'fixture: Expand all opens them again');

    // The table follows a selection made elsewhere (the 3D view, the Groups list): it opens the group and scrolls to the row.
    await clickButton(b, '⊟ Collapse all');
    await settle();
    await b.ev('window.__store.getState().selectBar(300)'); // row #301, a free row in the last group
    await settle(500);
    const loc = await b.ev(`(() => { const w = document.querySelector('.tblwrap').getBoundingClientRect(); const r = ${rowOf('M0301')}; if (!r) return { found: false }; const q = r.getBoundingClientRect(); return { found: true, sel: r.classList.contains('sel'), inside: q.top >= w.top && q.bottom <= w.bottom }; })()`);
    report(loc.found && loc.sel && loc.inside, `fixture: selecting M0301 elsewhere opens its collapsed group and scrolls to it (${JSON.stringify(loc)})`);
    await scrollTo(b, 0);
    await clickButton(b, '⌖ Selection');
    await settle(500);
    const loc2 = await b.ev(`(() => { const w = document.querySelector('.tblwrap').getBoundingClientRect(); const r = ${rowOf('M0301')}; if (!r) return false; const q = r.getBoundingClientRect(); return q.top >= w.top && q.bottom <= w.bottom; })()`);
    report(loc2, 'fixture: "⌖ Selection" brings the selected row back into view');
    await clickButton(b, '⊞ Expand all');

    // The Groups overview.
    await clickButton(b, 'Groups');
    await settle();
    const ov = await b.ev(`(() => { const rows = Array.from(document.querySelectorAll('.bbs-groups tbody tr')); const names = rows.filter((r) => r.querySelector('.bbs-gname')).map((r) => r.querySelector('.bbs-gname').textContent); return { names, sections: rows.filter((r) => r.classList.contains('bbs-section-row')).map((r) => r.textContent) }; })()`);
    const memberNames = ov.names.filter((n) => n.includes('📦'));
    const setNames = ov.names.filter((n) => n.includes('▦'));
    report(memberNames.length === 7 && setNames.length === 6, `fixture: the Groups view lists ${memberNames.length} members and ${setNames.length} ▦ groups (${setNames.map((n) => n.replace(/\s*·.*/, '')).join(', ')})`);
    // The find box also reads the members a ▦ group sits in: "c3" leaves Member c3 and the two ▦ groups (S4, S5) that have bars in it.
    await setFind(b, 'c3');
    await settle();
    const narrowed = await b.ev(`Array.from(document.querySelectorAll('.bbs-groups .bbs-gname')).map((e) => e.textContent.replace(/\\s*·.*/, ''))`);
    report(narrowed.length === 3 && narrowed.some((n) => n.includes('Member c3')) && narrowed.some((n) => n.includes('S4')) && narrowed.some((n) => n.includes('S5')), `fixture: the find box narrows the Groups list ("c3" leaves ${JSON.stringify(narrowed)})`);
    await setFind(b, '');
    await clickText(b, '.bbs-groups .bbs-gname', '▦ S4');
    await settle(600);
    const jumpSet = { rows: await b.ev(`!!document.querySelector('.tblwrap .bbs-table:not(.bbs-groups)')`), mode: await modeOf(b), top: await firstClear(b) };
    report(jumpSet.rows && jumpSet.mode === 'set' && jumpSet.top && jumpSet.top.pinned.includes('▦ S4') && jumpSet.top.mark === 'M0121', `fixture: a click on ▦ S4 in the Groups list pins its header at the top of the table, grouped by ▦ Group, its first row M0121 under it (${JSON.stringify(jumpSet)})`);
    await clickButton(b, 'Groups');
    await settle();
    await clickText(b, '.bbs-groups .bbs-gname', '📦 Member c5');
    await settle(600);
    const jumpMember = { mode: await modeOf(b), top: await firstClear(b) };
    report(jumpMember.mode === 'element' && jumpMember.top && jumpMember.top.pinned.includes('Member c5') && jumpMember.top.mark === 'M0241', `fixture: a click on Member c5 pins its header at the top, grouped by Element, its first row M0241 under it (${JSON.stringify(jumpMember)})`);

    await groupEditing(b);

    // One member picked in the Element dropdown: its rows only, as a plain list (the member is the whole scope, so no group headers).
    await setSelect(b, 'Element', 'c2');
    await settle(500);
    const iOne = await info(b);
    report(iOne.groupRows === 0 && near(iOne.scrollH, 60 * ROW_H + ROW_H, 4) && /BBS for Member c2 · 60 rows/.test(await nav(b)), `fixture: Element = Member c2 lists its 60 rows without group headers (${iOne.groupRows} headers, ${iOne.scrollH} px, "${(await nav(b)).slice(0, 40)}")`);
    // Joined members: the six members as one schedule, grouped by member.
    await setSelect(b, 'Element', '__joined');
    await settle(600);
    await clickButton(b, '⊟ Collapse all');
    await settle();
    const iJoin = await info(b);
    report(iJoin.groupRows === 6 && /BBS for Joined 6 members · 360 rows/.test(await nav(b)), `fixture: Joined members lists the 6 members as groups (${iJoin.groupRows} headers, "${(await nav(b)).slice(0, 50)}")`);
    await clickButton(b, '⊞ Expand all');
    await setSelect(b, 'Element', 'all');
    await settle(500);

    // Grouping none, sort, maximize, Tools.
    await setSelect(b, 'Group by', 'none');
    await settle();
    const iNone = await info(b);
    report(iNone.groupRows === 0 && iNone.pinned === null && near(iNone.scrollH, 400 * ROW_H + ROW_H, 40), `fixture: Group by None is a flat list of 400 rows (${iNone.scrollH} px, no headers)`);
    await scrollTo(b, 0);
    await b.ev(`Array.from(document.querySelectorAll('.tblwrap thead th')).find((t) => t.textContent.startsWith('Mark')).click()`);
    await settle();
    const asc = (await info(b)).dataMarks[0];
    await b.ev(`Array.from(document.querySelectorAll('.tblwrap thead th')).find((t) => t.textContent.startsWith('Mark')).click()`);
    await settle();
    await scrollTo(b, 0);
    const desc = (await info(b)).dataMarks[0];
    report(asc === 'M0001' && desc === 'M0400', `fixture: sorting by Mark still works (${asc} first, then ${desc} first when reversed)`);
    await b.ev(`Array.from(document.querySelectorAll('.tblwrap thead th')).find((t) => t.textContent.startsWith('Mark')).click()`); // back to model order
    await setSelect(b, 'Group by', 'element');
    await settle();

    const h300 = (await info(b)).wrapH;
    await clickButton(b, '▴ Tools');
    await settle();
    const hTools = (await info(b)).wrapH;
    const toolsKey = await b.ev(`localStorage.getItem('barbending.bbsTools')`);
    report(hTools > h300 + 20 && toolsKey === '0', `fixture: Tools hides the filter and export buttons, the table grows from ${h300} to ${hTools} px (stored "${toolsKey}")`);
    await clickButton(b, '▾ Tools');
    await settle();
    await clickButton(b, '⤢');
    await settle(500);
    const big = await info(b);
    const winH = await b.ev('window.innerHeight');
    report(near(big.panelH, 0.75 * winH, 3) && big.wrapH > h300 + 100, `fixture: ⤢ makes the panel ${big.panelH} px tall (three quarters of ${winH}), the table ${big.wrapH} px`);
    await clickButton(b, '⤡');
    await settle(500);
    report((await info(b)).panelH === 300, 'fixture: ⤡ takes it back to its height');

    // Delete mode: arm it, click a row (it goes), undo brings it back.
    await scrollTo(b, 0);
    await clickButton(b, '🗑 Delete');
    await settle();
    await click(b, await pageXY(b, rowOf('M0002')));
    await settle(500);
    const gone = await b.ev('window.__store.getState().bars.length');
    await clickButton(b, '🗑 Delete ON');
    await b.ev('window.__store.getState().undo()');
    await settle(500);
    const back = await b.ev('window.__store.getState().bars.length');
    report(gone === 399 && back === 400, `fixture: delete mode removes the clicked row (${gone} bars left) and undo brings it back (${back})`);

    // An empty schedule: a message, no rows, and nothing breaks.
    await b.ev('window.__store.getState().setBars([])');
    await settle(600);
    const empty = await b.ev(`({ text: (document.querySelector('.tblwrap tbody tr.bbs-empty') || {}).textContent || '', rows: document.querySelectorAll('.tblwrap tbody tr:not(.bbs-spacer):not(.bbs-empty)').length })`);
    report(/No rows/.test(empty.text) && empty.rows === 0, `fixture: with no bars the table says so (${JSON.stringify(empty)})`);

    report(b.consoleErrors.length === 0, `fixture: no errors logged${b.consoleErrors.length ? ': ' + b.consoleErrors[0] : ''}`);
  } finally {
    b.close();
  }
}
// Group editing through the real buttons, trusted clicks and keys: rename (Groups list, group header, Set card), add bars, remove bars, a
// group left with one bar, a face-sketch group that asks first, a collapsed group that stays collapsed. Every step is undone at the end.
async function groupEditing(b) {
  const depth0 = await pastDepth(b);
  const start = await groupCounts(b);
  report(JSON.stringify(start) === JSON.stringify({ S1: 40, S2: 40, S3: 40, S4: 40, S5: 40 }), `groups: the fixture starts with five groups of 40 (${JSON.stringify(start)})`);
  dlg.seen.length = 0;
  dlg.answer = true;

  // Rename in the Groups list: the pencil opens a focused box, Enter saves, one undo step.
  await clickButton(b, 'Groups');
  await settle();
  await setFind(b, 'S2');
  await settle();
  await click(b, await pageXY(b, pencilOf('S2')));
  await settle(250);
  const boxFocused = await b.ev(`!!document.activeElement && document.activeElement.matches('.bbs-rename input')`);
  await typeName(b, 'Roof ties');
  await settle(500);
  const c1 = await groupCounts(b);
  const stillList = await b.ev(`!!document.querySelector('.bbs-groups')`);
  await setFind(b, '');
  await settle();
  const names1 = await b.ev(`Array.from(document.querySelectorAll('.bbs-groups .bbs-gname-view > span')).map((e) => e.title)`);
  report(boxFocused && stillList && c1['Roof ties'] === 40 && c1.S2 === undefined && names1.includes('▦ Roof ties') && !names1.includes('▦ S2') && (await pastDepth(b)) === depth0 + 1,
    `groups: the pencil in the Groups list opens a focused box and Enter renames S2 to "Roof ties" for its 40 bars, in one undo step, without jumping to the group`);

  // A name that another group has is refused with the reason and the box stays open; keys typed in it reach no shortcut; Esc cancels.
  await setFind(b, 'roof');
  await settle();
  await click(b, await pageXY(b, pencilOf('Roof ties')));
  await settle(250);
  await typeKeys(b, 's1');
  await pressKey(b, 'Enter', 13);
  await settle(300);
  const refusal = await b.ev(`(document.querySelector('.bbs-rename-err') || {}).textContent || ''`);
  const stillOpen = await b.ev(`!!document.querySelector('.bbs-rename input')`);
  const depthRefused = await pastDepth(b);
  await typeKeys(b, 'cfb');
  const afterKeys = await storeEv(b, '({ bars: s.bars.length, tool: s.selectTool })');
  await pressKey(b, 'Escape', 27);
  await settle(300);
  const closed = !(await b.ev(`!!document.querySelector('.bbs-rename input')`));
  const c2 = await groupCounts(b);
  report(stillOpen && /already called .S1./.test(refusal) && depthRefused === depth0 + 1 && c2['Roof ties'] === 40 && c2.S1 === 40, `groups: renaming to "s1" is refused with its reason and nothing changes ("${refusal}")`);
  report(closed && afterKeys.bars === 400 && afterKeys.tool === null && c2['Roof ties'] === 40, 'groups: keys typed in the rename box reach no shortcut (400 bars, no tool armed) and Esc cancels the edit');

  // Add: the selected bars that are not in the group join it; the button says how many and "Remove" is disabled.
  await b.ev('window.__store.getState().setSelectedBars([200, 201, 202])');
  await setFind(b, 'S1');
  await settle();
  const addLabel = await b.ev(`${lineBtn('S1', '+ Add')}.textContent.trim()`);
  const rmDisabled = await b.ev(`${lineBtn('S1', '− Remove')}.disabled`);
  await click(b, await pageXY(b, lineBtn('S1', '+ Add')));
  await settle(500);
  const c3 = await groupCounts(b);
  const joined = await storeEv(b, `[200, 201, 202].every((i) => s.bars[i].setId === 'S1')`);
  const after = { add: await b.ev(`${lineBtn('S1', '+ Add')}.disabled`), rm: await b.ev(`${lineBtn('S1', '− Remove')}.textContent.trim()`) };
  report(addLabel === '+ Add 3' && rmDisabled && c3.S1 === 43 && joined && after.add && after.rm === '− Remove 3', `groups: "+ Add 3" puts the 3 selected free bars in S1 (43 bars) and the line then offers "− Remove 3" only ("${addLabel}", then "${after.rm}")`);

  // A bar added from another group moves over.
  await b.ev('window.__store.getState().setSelectedBars([41])'); // a bar of "Roof ties"
  await settle();
  await click(b, await pageXY(b, lineBtn('S1', '+ Add')));
  await settle(500);
  const c4 = await groupCounts(b);
  report(c4.S1 === 44 && c4['Roof ties'] === 39, `groups: a bar added from another group moves over (S1 ${c4.S1}, Roof ties ${c4['Roof ties']})`);

  // Remove: only the selected bars of the group leave, with their own dimensions.
  await b.ev('window.__store.getState().setSelectedBars([200, 201])');
  await settle();
  await click(b, await pageXY(b, lineBtn('S1', '− Remove')));
  await settle(500);
  const c5 = await groupCounts(b);
  const solo = await storeEv(b, `[200, 201].map((i) => [s.bars[i].setId === undefined, s.bars[i].Dia])`);
  report(c5.S1 === 42 && solo[0][0] && solo[1][0] && solo[0][1] === 12 && solo[1][1] === 16, `groups: "− Remove 2" takes the 2 selected bars out of S1 (42 left) and they keep their own diameters (${JSON.stringify(solo)})`);

  // A group left with one bar is dissolved.
  await setFind(b, 'S3');
  await b.ev('window.__store.getState().setSelectedBars(Array.from({ length: 39 }, (_, i) => 80 + i))');
  await settle();
  await click(b, await pageXY(b, lineBtn('S3', '− Remove')));
  await settle(500);
  const c6 = await groupCounts(b);
  report(c6.S3 === undefined && (await storeEv(b, 's.bars[119].setId === undefined')), 'groups: taking 39 of the 40 bars of S3 out dissolves it (a group needs two): the last bar is free too');

  // A face-sketch group asks first: Cancel changes nothing, OK makes it an ordinary group.
  await setFind(b, 'S5');
  await b.ev('window.__store.getState().setSelectedBars([160])');
  await settle();
  dlg.answer = false;
  await click(b, await pageXY(b, lineBtn('S5', '− Remove')));
  await settle(500);
  const asked = dlg.seen.filter((d) => d.type === 'confirm');
  const c7 = await groupCounts(b);
  const kept = await storeEv(b, `s.bars.slice(160, 200).filter((x) => x.setSpec).length`);
  report(asked.length === 1 && /S5 was drawn from a face sketch/.test(asked[0].message) && c7.S5 === 40 && kept === 40, `groups: removing a bar from the face-sketch group S5 asks first, and Cancel changes nothing (${asked.length} question)`);
  dlg.answer = true;
  await click(b, await pageXY(b, lineBtn('S5', '− Remove')));
  await settle(500);
  const c8 = await groupCounts(b);
  const kept2 = await storeEv(b, `s.bars.slice(160, 200).filter((x) => x.setSpec).length`);
  report(c8.S5 === 39 && kept2 === 0 && (await storeEv(b, 's.bars[160].setId === undefined')), 'groups: OK removes it; S5 (39 bars) is an ordinary group now, and no bar keeps the sketch');

  // The pencil on a group header in the table renames it without toggling it, and a collapsed group stays collapsed.
  await setFind(b, '');
  await clickText(b, '.bbs-groups .bbs-gname', '▦ S4');
  await settle(700);
  const pinXY = await b.ev(`(() => { const p = document.querySelector('.tblwrap thead .bbs-group-line'); if (!p) return null; const r = p.getBoundingClientRect(); return [r.left + r.width * 0.6, r.top + r.height / 2]; })()`);
  await click(b, pinXY); // a click on the pinned header, away from its buttons, collapses S4
  await settle(400);
  const collapsedBefore = await b.ev(`Array.from(document.querySelectorAll('.tblwrap tbody tr.bbs-group-row')).some((r) => r.textContent.includes('▦ S4') && r.textContent.startsWith('▶'))`);
  await click(b, await viewXY(b, `document.querySelector('.tblwrap thead .bbs-group-line .bbs-pencil')`));
  await settle(250);
  await typeName(b, 'Slab mat');
  await settle(600);
  const c9 = await groupCounts(b);
  // a renamed group sorts after the S-numbered ones, far from where it was: narrow the table to it to see its header
  await setFind(b, 'slab mat');
  await settle(500);
  const collapsedAfter = await b.ev(`Array.from(document.querySelectorAll('.tblwrap tbody tr.bbs-group-row')).some((r) => r.textContent.includes('▦ Slab mat') && r.textContent.startsWith('▶'))`);
  await setFind(b, '');
  report(collapsedBefore && c9['Slab mat'] === 40 && c9.S4 === undefined && collapsedAfter, `groups: the pencil on a group header renames S4 to "Slab mat", the click does not toggle the group, and it stays collapsed (collapsed before: ${collapsedBefore}, "Slab mat" ${c9['Slab mat']}, S4 ${c9.S4}, collapsed after: ${collapsedAfter})`);
  await clickButton(b, '⊞ Expand all');

  // The Set card on the left: the same pencil, and + Add selected / − Remove selected for the active bar's group.
  await b.ev('window.__store.getState().selectBar(121)'); // in "Slab mat" (rows 120-159)
  await settle(500);
  const cardName = await b.ev(`(document.querySelector('.cbox .bbs-gname-view > strong') || {}).title || ''`);
  await click(b, await viewXY(b, `document.querySelector('.cbox .bbs-pencil')`));
  await settle(250);
  await typeName(b, 'Top mat');
  await settle(500);
  const c10 = await groupCounts(b);
  report(cardName === 'Slab mat' && c10['Top mat'] === 40 && c10['Slab mat'] === undefined, `groups: the Set card shows the group's name and its pencil renames it ("${cardName}" to "Top mat")`);
  const cardBtn = (label) => `Array.from(document.querySelectorAll('.cbox button')).find((x) => x.textContent.trim().startsWith(${JSON.stringify(label)}))`;
  const cardState = { add: await b.ev(`${cardBtn('+ Add selected')}.disabled`), rm: await b.ev(`${cardBtn('− Remove selected')}.textContent.trim()`) };
  await click(b, await viewXY(b, cardBtn('− Remove selected')));
  await settle(500);
  const c11 = await groupCounts(b);
  report(cardState.add && cardState.rm === '− Remove selected (1)' && c11['Top mat'] === 39, `groups: the Set card's "− Remove selected (1)" takes the active bar out of its group (39 left; "+ Add selected (0)" was disabled)`);
  await b.ev('window.__store.getState().setSelectedBars([121, 150])'); // 121 is free now, 150 is in "Top mat" and is the active bar
  await settle(500);
  const addLabel2 = await b.ev(`${cardBtn('+ Add selected')}.textContent.trim()`);
  await click(b, await viewXY(b, cardBtn('+ Add selected')));
  await settle(500);
  const c12 = await groupCounts(b);
  report(addLabel2 === '+ Add selected (1)' && c12['Top mat'] === 40, `groups: the Set card's "${addLabel2}" brings the free bar back (40 bars)`);

  // The find box knows the new name.
  await clickButton(b, 'Rows');
  await setFind(b, 'top mat');
  await settle(500);
  const found = ((await nav(b)).match(/\d+ of \d+ rows match/) || [''])[0];
  report(found === '40 of 400 rows match', `groups: the find box finds the renamed group by its new name (${found})`);
  await setFind(b, '');

  // Undo every step.
  let steps = 0;
  while ((await pastDepth(b)) > depth0 && steps < 40) { await b.ev('window.__store.getState().undo()'); steps += 1; }
  const end = await groupCounts(b);
  const sketch = await storeEv(b, `s.bars.slice(160, 200).filter((x) => x.setSpec).length`);
  report(JSON.stringify(end) === JSON.stringify(start) && sketch === 40, `groups: undoing the ${steps} steps brings back the five groups of 40 and the sketch of S5`);
  report(dlg.seen.length === 2 && dlg.seen.every((d) => d.type === 'confirm'), `groups: the only questions asked were the two about the face-sketch group (${dlg.seen.map((d) => d.type).join(', ')})`);
  await setSelect(b, 'Group by', 'element'); // the checks that follow expect the table grouped by member
  await settle();
}

const clickText = (b, selector, text) => b.ev(`(() => { const e = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find((x) => x.textContent.includes(${JSON.stringify(text)})); if (!e) return false; e.click(); return true; })()`);

// The million-bar project plus 200 members and 500 ▦ groups, so that there is something to navigate.
function makeBigProject() {
  const p = JSON.parse(fs.readFileSync(path.resolve(bigFile), 'utf8'));
  p.concretes = Array.from({ length: 200 }, (_, k) => ({ id: `m${k + 1}`, name: `Member ${String(k + 1).padStart(3, '0')}`, lx: 2000, ly: 400, lz: 600, x: (k % 20) * 3000, y: Math.floor(k / 20) * 3000, z: 0 }));
  p.bars.forEach((b, i) => { b.host = `m${1 + (i % 200)}`; b.setId = `S${1 + Math.floor(i / 50)}`; });
  return p;
}

// Milliseconds until `expr` (an expression about the page) is true, polled once per animation frame after `action` ran in the page; -1 on timeout.
const timed = (b, action, expr, timeoutMs = 15000) => b.ev(`(async () => { const t0 = performance.now(); ${action}; while (performance.now() - t0 < ${timeoutMs}) { await new Promise((r) => requestAnimationFrame(r)); if (${expr}) return Math.round(performance.now() - t0); } return -1; })()`, timeoutMs + 10000);
const setFindJs = (text) => `(() => { const i = document.querySelector('.bbs-find'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`;
const hasMark = (mark) => `${DATA_ROWS}.some((r) => r.children[2].textContent === ${JSON.stringify(mark)})`;

// Budgets for the million-bar project (the old table, measured on this machine: load blocked the page for 19.6 s, 1,225,975 DOM nodes, 1,161 ms to select a row).
// Selecting a bar costs about 250 ms at this size whatever the table does (the scene and the sidebar), so the select and locate budgets sit above that.
// The load time is only a "did not hang" bound: it ranged 4.5-15.5 s over nine runs on this machine (median about 7 s), mostly React inserting the
// 50,000 <option>s of the left panel's bar dropdowns, not the table; a table that drew every row would show in the node and row counts instead.
const BUDGET = { loadMs: 30000, panelNodes: 1500, tr: 60, selectMs: 500, endMs: 400, jumpMs: 600, findMs: 600, locateMs: 1000 };

async function scale() {
  if (!bigFile) {
    if (only) { console.error('scale needs --big <project.json> (node scripts/perf/gen_project.mjs 25000 40 p1m 7)'); process.exit(2); }
    console.log('SKIP  scale (needs --big)');
    return;
  }
  const project = makeBigProject();
  const rows = project.bars.length;
  const file = path.join(outDir, 'check_bbs_big.json');
  fs.writeFileSync(file, JSON.stringify(project));
  const b = await launchBrowser({ width: 1600, height: 900 });
  try {
    const loadMs = await openApp(b, file, rows);
    await settle(1500);
    const i0 = await info(b);
    report(loadMs <= BUDGET.loadMs, `scale: ${rows} rows (200 members, 500 ▦ groups) are in the app ${(loadMs / 1000).toFixed(1)} s after the file is chosen (only a hang is a failure: over ${BUDGET.loadMs / 1000} s)`);
    report(i0.panelNodes <= BUDGET.panelNodes && i0.tr <= BUDGET.tr, `scale: the panel holds ${i0.panelNodes} DOM nodes and ${i0.tr} table rows (budget ${BUDGET.panelNodes} and ${BUDGET.tr}); the whole page ${i0.nodes} (the old table alone was about 1.2 million)`);
    report(i0.rowHeights.length === 1 && i0.rowHeights[0] === ROW_H, `scale: every row is ${i0.rowHeights.join(' / ')} px tall`);

    // A click on a row: the row shows as selected.
    const selectMs = await timed(b, `${DATA_ROWS}[2].click()`, `${DATA_ROWS}[2].classList.contains('sel')`);
    report(selectMs >= 0 && selectMs <= BUDGET.selectMs, `scale: selecting a row takes ${selectMs} ms (budget ${BUDGET.selectMs}; the old table: 1,161 ms)`);

    // To the very end of the list, 25,000 rows and 200 group headers further down.
    const endMs = await timed(b, `document.querySelector('.tblwrap').scrollTop = 1e9`, hasMark('B25000'));
    const iEnd = await info(b);
    report(endMs >= 0 && endMs <= BUDGET.endMs && iEnd.tr <= BUDGET.tr, `scale: scrolled to the end (${iEnd.scrollH.toLocaleString('en-US')} px of list) the last row shows after ${endMs} ms, ${iEnd.tr} table rows in the page (budget ${BUDGET.endMs} ms)`);
    await scrollTo(b, 0);

    // The Groups overview and a jump to the last ▦ group.
    await clickButton(b, 'Groups');
    await settle(800);
    const names = await b.ev(`Array.from(document.querySelectorAll('.bbs-groups .bbs-gname')).map((e) => e.textContent)`);
    const nMembers = names.filter((n) => n.includes('📦')).length;
    const nSets = names.filter((n) => n.includes('▦')).length;
    report(nMembers === 200 && nSets === 500, `scale: the Groups list holds ${nMembers} members and ${nSets} ▦ groups`);
    await b.ev(setFindJs('S500'));
    await settle(500);
    const jumpMs = await timed(b, `Array.from(document.querySelectorAll('.bbs-groups .bbs-gname')).find((x) => x.textContent.includes('▦ S500')).click()`,
      `!!document.querySelector('.tblwrap .bbs-table:not(.bbs-groups)') && (() => { const p = document.querySelector('.tblwrap thead .bbs-group-line'); return !!p && p.textContent.includes('▦ S500') && ${hasMark('B24951')}; })()`);
    const top = await firstClear(b);
    report(jumpMs >= 0 && jumpMs <= BUDGET.jumpMs && top && top.pinned.includes('▦ S500') && top.mark === 'B24951', `scale: ▦ S500, the last group, is pinned at the top of the table with its first row B24951 under it ${jumpMs} ms after the click (budget ${BUDGET.jumpMs} ms)`);

    // Find one mark among 25,000 rows.
    const findMs = await timed(b, setFindJs('B12345'), `/\\b1 of 25000 rows match/.test(document.querySelector('.bbs-nav').textContent)`);
    const found = await info(b);
    report(findMs >= 0 && findMs <= BUDGET.findMs && found.dataMarks.length === 1 && found.dataMarks[0] === 'B12345', `scale: find "B12345" lists one row of ${rows} after ${findMs} ms (budget ${BUDGET.findMs} ms)`);
    await b.ev(setFindJs(''));
    await settle();

    // Group editing at this size: rename the last of the 500 groups, add 30 bars of S1 to it, take them out again. Any change to the bars costs
    // 0.3-0.6 s here whatever it is (the status bar, the viewport bar and this panel each derive all 25,000 rows again, and undo takes a
    // snapshot), so the budget is relative to a plain edit of one bar measured first; the time runs until the next frame after the change.
    const editMs = await timed(b, `window.__store.getState().updateBar(5, { Dia: 13 })`, `window.__store.getState().bars[5].Dia === 13`);
    const groupBudget = Math.round(editMs * 2 + 400); // generous: this catches a pass that goes quadratic, not 30% of noise
    const renameMs = await timed(b, `window.__store.getState().renameGroup('S500', 'Last set')`, `window.__store.getState().bars[24999].setId === 'Last set'`);
    const addMs = await timed(b, `(() => { const s = window.__store.getState(); s.setSelectedBars(Array.from({ length: 30 }, (_, i) => i)); s.addToGroup('Last set'); })()`, `window.__store.getState().bars[0].setId === 'Last set'`);
    const afterAdd = await storeEv(b, `[s.bars.filter((x) => x.setId === 'Last set').length, s.bars.filter((x) => x.setId === 'S1').length]`);
    const removeMs = await timed(b, `window.__store.getState().removeFromGroup('Last set')`, `window.__store.getState().bars[0].setId === undefined`);
    const afterRemove = await storeEv(b, `[s.bars.filter((x) => x.setId === 'Last set').length, s.bars.filter((x) => !x.setId).length]`);
    report(renameMs >= 0 && renameMs <= groupBudget, `scale: renaming a group of 50 bars among 25,000 rows takes ${renameMs} ms (a plain edit of one bar: ${editMs} ms; budget ${groupBudget} ms)`);
    report(addMs >= 0 && addMs <= groupBudget && afterAdd[0] === 80 && afterAdd[1] === 20, `scale: adding 30 bars to a group takes ${addMs} ms (budget ${groupBudget} ms): the group has ${afterAdd[0]} bars, the group they came from ${afterAdd[1]}`);
    report(removeMs >= 0 && removeMs <= groupBudget && afterRemove[0] === 50 && afterRemove[1] === 30, `scale: taking 30 bars out of a group takes ${removeMs} ms (budget ${groupBudget} ms): ${afterRemove[0]} left in it, ${afterRemove[1]} bars in no group`);

    // A bar picked in the 3D view while every group is collapsed: its group opens and the table scrolls to it.
    await clickButton(b, '⊟ Collapse all');
    await settle(500);
    const locateMs = await timed(b, `window.__store.getState().selectBar(20000)`, `(() => { const r = ${DATA_ROWS}.find((x) => x.children[2].textContent === 'B20001'); if (!r || !r.classList.contains('sel')) return false; const w = document.querySelector('.tblwrap').getBoundingClientRect(); const q = r.getBoundingClientRect(); return q.top >= w.top && q.bottom <= w.bottom; })()`);
    report(locateMs >= 0 && locateMs <= BUDGET.locateMs, `scale: selecting row 20,001 elsewhere opens its group and scrolls the table to it in ${locateMs} ms (budget ${BUDGET.locateMs} ms)`);
    report(b.consoleErrors.length === 0, `scale: no errors logged${b.consoleErrors.length ? ': ' + b.consoleErrors[0] : ''}`);
  } finally {
    b.close();
  }
}

const sections = { fixture, scale };
try {
  for (const [name, fn] of Object.entries(sections)) {
    if (!only || only === name) await fn();
  }
} catch (e) {
  console.error('ERROR', e.message);
  failures += 1;
}
console.log(failures ? `RESULT: FAIL (${failures})` : 'RESULT: PASS');
process.exit(failures ? 1 : 0);
