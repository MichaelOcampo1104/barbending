// Browser check for the member reinforcement card (Concrete tab, under the selected member; headless Edge, real DOM clicks).
// usage: node scripts/perf/check_member_card.mjs --url <app base url>
// Column C1 (800 x 800 x 4500, cover 40, the base level only: 16 x Ø25 mains, Ø10 lapped links at 150, Ø25 starters at both ends)
// adds 49 rows in three ▦ sets, the same count as inputs/column_sample_800_auto_bbs.json. The same names are refused. One undo removes all three.
// A level 2.5 m above the base with 16H20 (links the same as below) adds 65 rows with 16 double-crank bars; a level 0.1 m above is refused.
// Wall W1 (5000 x 200 x 3000, switched to Wall) adds 204 rows, the same count as inputs/wall_sample_auto_bbs.json.
// Rectangular column R1 (2500 x 1000 x 4500): 44H40 on the long faces and 8H32 on the short, with 2 X and 6 Y cross-ties at 150, adds 165 rows.
// The card's screenshots go to scripts/perf/out/member_card.png and member_card_levels.png.
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
if (!base) { console.error('usage: node scripts/perf/check_member_card.mjs --url <app base url>'); process.exit(2); }

let failures = 0;
const report = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures += 1; };

const COLUMN = { id: 'c1', name: 'C1', kind: 'COLUMN', lx: 800, ly: 800, lz: 4500, x: 0, y: 0, z: 0, covB: 40, covT: 40, slope: 0 };
const WALL = { id: 'c2', name: 'W1', kind: 'WALL', lx: 5000, ly: 200, lz: 3000, x: 2000, y: 2000, z: 0, covB: 40, covT: 40, slope: 0 };
const RECT = { id: 'c3', name: 'R1', kind: 'COLUMN', lx: 2500, ly: 1000, lz: 4500, x: 0, y: 3000, z: 0, covB: 40, covT: 40, slope: 0 };
// The C4/C4A drawing (docs/superpowers/specs/2026-10-20-column-size-steps-design.md): a 3200 x 800 base, a 2400 x 800 section from B1 up, Hz 20900.
const C4 = { id: 'c4', name: 'C4', kind: 'COLUMN', lx: 3200, ly: 800, lz: 20900, x: 0, y: 0, z: 0, covB: 40, covT: 40, slope: 0 };

async function waitFor(b, expr, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { if (await b.ev(expr)) return true; } catch { /* not yet */ }
    await sleep(150);
  }
  return false;
}
// Clicks the card's button with this text (the card's own buttons only, so the toolbar's 'Wall' or 'Column' are not hit).
const clickInCard = (b, text) => b.ev(`(() => {
  const btn = [...document.querySelectorAll('.memberCard button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)});
  if (!btn) return false;
  btn.click();
  return true;
})()`);
// Types into the card's input with this data-field (sfl, size, bars, links, lap, step, jog) at this index, through React's own value setter.
const typeField = (b, field, index, value) => b.ev(`(() => {
  const input = document.querySelectorAll('.memberCard input[data-field="${field}"]')[${index}];
  if (!input) return false;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);

// Picks an option of the card's Layout select, through React's own change handling.
const pickLayout = (b, value) => b.ev(`(() => {
  const select = document.querySelector('.memberCard select');
  if (!select) return false;
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(value)});
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);

// Picks the layout of one level (its MAIN BARS layout select), counting the level rows from the top.
const pickRowLayout = (b, index, value) => b.ev(`(() => {
  const select = document.querySelectorAll('.memberCard .levelRow select')[${index}];
  if (!select) return false;
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(value)});
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);

const b = await launchBrowser({ width: 1600, height: 1000 });
try {
  // ?autotest exposes window.__store (the store is driven through it, as in check_bbs.mjs)
  await b.send('Page.navigate', { url: base + '/?autotest=member-card' });
  if (!(await waitFor(b, '!!document.querySelector("canvas") && !!window.__store', 90000))) throw new Error('the app did not start at ' + base);
  await b.ev(`window.__store.setState({ concretes: [${JSON.stringify(COLUMN)}, ${JSON.stringify(WALL)}, ${JSON.stringify(RECT)}], bars: [], selectedConcrete: 'c1', cover: 40, past: [], future: [] })`);
  await b.ev(`[...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Concrete').click()`);

  report(await waitFor(b, `!!document.querySelector('.memberCard')`), 'the card appears under the selected member');
  report(await b.ev(`document.querySelectorAll('.memberCard').length === 1`), 'only the selected member has a card');
  report(await b.ev(`!!document.querySelector('.memberCard input[placeholder="240"]')`), 'the lap placeholder is the drawn proportion, 240 mm');
  report(await b.ev(`document.querySelectorAll('.memberCard input[data-field="sfl"]').length === 1`), 'the schedule starts with one level, the base');

  // Column: generate, then the same names are refused, then one undo removes all three sets.
  await clickInCard(b, '▦ Generate sets');
  report(await waitFor(b, `window.__store.getState().bars.length === 49`), 'column card adds 49 rows (the column sample has 49)');
  const sets = await b.ev(`[...new Set(window.__store.getState().bars.map((r) => r.setId))]`);
  report(JSON.stringify(sets) === JSON.stringify(['C1 mains', 'C1 links', 'C1 starters']), `column sets: ${JSON.stringify(sets)}`);
  report(await b.ev(`document.querySelector('.memberCard').textContent.includes('Added 3 sets, 49 rows')`), 'the card reports the sets it added');

  await clickInCard(b, '▦ Generate sets');
  await sleep(300);
  report(await b.ev(`window.__store.getState().bars.length === 49`), 'the same set names are refused: no rows added');
  report(await b.ev(`/already called/.test(document.querySelector('.memberCard').textContent)`), 'the card says another group already has the set name');

  await b.ev(`window.__store.getState().undo()`);
  report(await b.ev(`window.__store.getState().bars.length === 0`), 'one undo removes all three column sets');

  // Schedule: a level 2.5 m above the base with 16H20 (its links are the same as below). A level 0.1 m above has no room and is refused.
  await clickInCard(b, '+ Level above the top');
  report(await waitFor(b, `document.querySelectorAll('.memberCard input[data-field="sfl"]').length === 2`), 'a level row appears above the base');
  await typeField(b, 'sfl', 0, '0.1');
  report(await waitFor(b, `/room/.test(document.querySelector('.memberCard').textContent)`), 'a level 0.1 m above the base is refused: no room for its splice');
  report(await b.ev(`[...document.querySelectorAll('.memberCard button')].find((x) => x.textContent.trim() === '▦ Generate sets').disabled`), 'Generate is off while the schedule is wrong');
  await typeField(b, 'sfl', 0, '2.5');
  await typeField(b, 'bars', 0, '16H20');
  report(await waitFor(b, `!!document.querySelector('.memberCard input[placeholder="1290"]')`), 'a 25 to 20 splice takes the 1290 mm lap by default');
  report(await waitFor(b, `/16 × H20/.test(document.querySelector('.memberCard').textContent)`), 'the read-back shows the level as 16 × H20');
  await b.ev(`document.querySelector('.memberCard').scrollIntoView({ block: 'start' })`);
  await sleep(400);
  const levelShot = await b.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, 'member_card_levels.png'), Buffer.from(levelShot.data, 'base64'));
  await clickInCard(b, '▦ Generate sets');
  report(await waitFor(b, `window.__store.getState().bars.length === 65`), 'a level 2.5 m up with 16H20 adds 65 rows: 32 main pieces, 32 starters, 1 link set');
  report(await b.ev(`window.__store.getState().bars.filter((r) => r.Rebar_Type === 'double_crank').length === 16`), 'the bottom bars are 16 double cranks (Z bars)');
  await b.ev(`window.__store.getState().undo()`);
  report(await waitFor(b, `window.__store.getState().bars.length === 0`), 'one undo removes the level sets too');

  // Cross-ties: remove the test level, then type two cross-ties into the base level. 16 bars leave 3 bars per long side to hook.
  await clickInCard(b, '× Remove');
  await waitFor(b, `document.querySelectorAll('.memberCard input[data-field="sfl"]').length === 1`);
  await typeField(b, 'linksouter', 0, 'H10-100');
  await typeField(b, 'linksx', 0, '2H10-100');
  await typeField(b, 'linksy', 0, '2H10-100');
  report(await waitFor(b, `/hooked cross-ties X/.test(document.querySelector('.memberCard').textContent) && /hooked cross-ties Y/.test(document.querySelector('.memberCard').textContent)`), 'the read-back shows the X and Y cross-ties as hooked');
  await clickInCard(b, '▦ Generate sets');
  report(await waitFor(b, `window.__store.getState().bars.length === 53`), 'two cross-ties along X and two along Y add 53 rows: 16 mains, 32 starters, 1 outer link set and 4 cross-ties');
  report(await b.ev(`window.__store.getState().bars.filter((r) => r.Rebar_Type === 'c_link_with_hook' && r.double_hook === 'yes' && r.Pos_Rotation === 0).length === 2 && window.__store.getState().bars.filter((r) => r.Rebar_Type === 'c_link_with_hook' && r.double_hook === 'yes' && r.Pos_Rotation === 90).length === 2`), 'the X and Y cross-ties are c_link_with_hook rows with double hooks, along X and along Y');
  await b.ev(`window.__store.getState().undo()`);
  report(await waitFor(b, `window.__store.getState().bars.length === 0`), 'one undo removes the cross-ties with the rest');

  // Long and short faces: 44H40 on the long faces (the bottom and top rows) and 8H32 on the short, with 2 X and 6 Y cross-ties at 150.
  await b.ev(`window.__store.getState().selectConcrete('c3')`);
  report(await waitFor(b, `document.querySelector('.memberCard') && window.__store.getState().selectedConcrete === 'c3'`), 'selecting the rectangular column moves the card to it');
  await pickLayout(b, 'faces');
  await typeField(b, 'barslong', 0, '44H40');
  await typeField(b, 'barsshort', 0, '8H32');
  await typeField(b, 'linksouter', 0, 'H10-100');
  await typeField(b, 'linksx', 0, '2H10-150');
  await typeField(b, 'linksy', 0, '6H10-150');
  report(await waitFor(b, `document.querySelector('.memberCard').textContent.includes('44 × H40 long + 8 × H32 short')`), 'the read-back shows the long and short faces');
  await clickInCard(b, '▦ Generate sets');
  report(await waitFor(b, `window.__store.getState().bars.length === 165`), 'the rectangular column adds 165 rows: 52 mains, 104 starters, 1 outer link set and 8 cross-ties');
  report(await b.ev(`(() => {
    const mains = window.__store.getState().bars.filter((x) => x.setId === 'R1 mains');
    return mains.filter((x) => x.Dia === 40).length === 44 && mains.filter((x) => x.Dia === 32).length === 8;
  })()`), 'the mains are 44 bars of H40 on the long faces and 8 of H32 on the short');
  report(await b.ev(`(() => {
    const ties = window.__store.getState().bars.filter((x) => x.Rebar_Type === 'c_link_with_hook');
    const y = ties.filter((x) => x.Pos_Rotation === 90), xs = ties.filter((x) => x.Pos_Rotation === 0);
    return y.length === 6 && xs.length === 2 && y.every((t) => t.c_length_b === 60) && xs.every((t) => t.c_length_b === 52);
  })()`), 'Y ties hook the H40 long-face bars (hook 60), X ties the H32 short-face bars (hook 52)');
  await b.ev(`window.__store.getState().undo()`);
  report(await waitFor(b, `window.__store.getState().bars.length === 0`), 'one undo removes the rectangular column\'s sets');

  // Heights: a level 9 m above the base of the 4.5 m member is refused by name, with both heights. A millimetre SFL is refused with the metres to type.
  await clickInCard(b, '+ Level above the top');
  report(await waitFor(b, `document.querySelectorAll('.memberCard input[data-field="sfl"]').length === 2`), 'a level row appears above the base of R1');
  await typeField(b, 'sfl', 0, '9');
  report(await waitFor(b, `document.querySelector('.memberCard').textContent.includes('is 9000 mm above the base, but this member is only 4500 mm high')`), 'a level 9 m above the base is refused, with its height and the member height');
  await typeField(b, 'sfl', 0, '-20870');
  report(await waitFor(b, `document.querySelector('.memberCard').textContent.includes('is over 1000 m')`), 'an SFL typed in millimetres is refused, with the metres to type');
  await clickInCard(b, '× Remove');
  report(await waitFor(b, `document.querySelectorAll('.memberCard input[data-field="sfl"]').length === 1`), 'the test level is removed again');

  // Slab below a level: a 1500 mm slab under a level 2.3 m above the base sits in the storey below, from 800 to 2300 mm.
  await clickInCard(b, '+ Level above the top');
  report(await waitFor(b, `document.querySelectorAll('.memberCard input[data-field="sfl"]').length === 2`), 'a level row appears above the base of R1 for its slab');
  await typeField(b, 'sfl', 0, '2.3');
  await typeField(b, 'slab', 0, '1500');
  report(await waitFor(b, `document.querySelector('.memberCard').textContent.includes('800 to 2300')`), 'a 1500 mm slab under a level 2.3 m up shows as a gap from 800 to 2300 mm');
  report(await b.ev(`document.querySelector('.memberCard').textContent.includes('no links')`), 'the slab zone reads no links');
  await clickInCard(b, '× Remove');
  report(await waitFor(b, `document.querySelectorAll('.memberCard input[data-field="sfl"]').length === 1`), 'the slab test level is removed again');

  // Wall: select the wall, switch the card to Wall, generate.
  await b.ev(`window.__store.getState().selectConcrete('c2')`);
  report(await waitFor(b, `document.querySelector('.memberCard') && window.__store.getState().selectedConcrete === 'c2'`), 'selecting the wall moves the card to it');
  await clickInCard(b, 'Wall');
  report(await waitFor(b, `!!document.querySelector('.memberCard input[placeholder="580"], .memberCard input[placeholder="760"]')`), 'the wall form shows its starter lap');
  await clickInCard(b, '▦ Generate sets');
  report(await waitFor(b, `window.__store.getState().bars.length === 204`), 'wall card adds 204 rows (the wall sample has 204)');
  const wallSets = await b.ev(`[...new Set(window.__store.getState().bars.map((r) => r.setId))]`);
  report(JSON.stringify(wallSets) === JSON.stringify(['W1 mains', 'W1 distribution', 'W1 links', 'W1 starters']), `wall sets: ${JSON.stringify(wallSets)}`);
  report(await b.ev(`window.__store.getState().bars.every((r) => r.host === 'c2' && r.Group === 'W1')`), 'every wall row is hosted by W1 and grouped under W1');

  await b.ev(`document.querySelector('.memberCard').scrollIntoView({ block: 'start' })`);
  await sleep(400);
  const shot = await b.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, 'member_card.png'), Buffer.from(shot.data, 'base64'));
  // Size steps: the C4/C4A drawing, typed as the drawing writes it. The base has long and short faces; B3 platform and B2 keep them ("same as
  // below"); B1 takes one size, 2400 x 800, from its SFL up. Entered bottom up, so each new level goes above the one before.
  await b.ev(`window.__store.setState({ concretes: [${JSON.stringify(COLUMN)}, ${JSON.stringify(C4)}], bars: [], selectedConcrete: 'c4', past: [], future: [] })`);
  report(await waitFor(b, `!!document.querySelector('.memberCard') && /This member is 20900 mm high/.test(document.querySelector('.memberCard').textContent)`), 'the card shows the C4 member, 20900 mm high');
  await pickLayout(b, 'faces');
  await typeField(b, 'sfl', 0, '-20.87');
  await typeField(b, 'barslong', 0, '40H40');
  await typeField(b, 'barsshort', 0, '8H32');
  await typeField(b, 'linksouter', 0, 'H10-100');
  await typeField(b, 'linksx', 0, '2H10-100');
  await typeField(b, 'linksy', 0, '4H10-100');
  for (const [sfl, slab] of [['-18.57', '1500'], ['-12.27', '1200']]) {
    const n = await b.ev(`document.querySelectorAll('.memberCard input[data-field="sfl"]').length`);
    await clickInCard(b, '+ Level above the top');
    await waitFor(b, `document.querySelectorAll('.memberCard input[data-field="sfl"]').length === ${n + 1}`);
    await typeField(b, 'sfl', 0, sfl);
    await typeField(b, 'slab', 0, slab);
  }
  await clickInCard(b, '+ Level above the top');
  await waitFor(b, `document.querySelectorAll('.memberCard input[data-field="sfl"]').length === 4`);
  await typeField(b, 'sfl', 0, '-5.79');
  await typeField(b, 'size', 0, '2400 x 800');
  await typeField(b, 'slab', 0, '800');
  await pickRowLayout(b, 0, 'all');
  await waitFor(b, `!!document.querySelector('.memberCard input[data-field="bars"]')`);
  await typeField(b, 'bars', 0, '40H25');
  await clickInCard(b, '▦ Generate sets');
  report(await waitFor(b, `window.__store.getState().bars.length === 300`), 'the C4/C4A drawing adds 300 rows');
  const c4Sets = await b.ev(`Object.fromEntries(['C4 mains', 'C4 links', 'C4 starters'].map((n) => [n, window.__store.getState().bars.filter((r) => r.setId === n).length]))`);
  report(JSON.stringify(c4Sets) === JSON.stringify({ 'C4 mains': 184, 'C4 links': 28, 'C4 starters': 88 }), `C4 sets: ${JSON.stringify(c4Sets)}`);
  report(await b.ev(`document.querySelector('.memberCard').textContent.includes('Size step to 2400 x 800')`), 'the read-back names the size step at B1');
  await b.ev(`window.__store.getState().undo()`);
  report(await waitFor(b, `window.__store.getState().bars.length === 0`), 'one undo removes the C4 sets');

  report(b.consoleErrors.length === 0, `no console errors${b.consoleErrors.length ? `: ${b.consoleErrors.slice(0, 3).join(' | ')}` : ''}`);
} catch (e) {
  report(false, `check stopped: ${e.message}`);
} finally {
  b.close();
}
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exitCode = failures ? 1 : 0;
