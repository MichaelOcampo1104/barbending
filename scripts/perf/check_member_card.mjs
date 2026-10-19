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
  await typeField(b, 'links', 0, 'H10-100 + 2H10-100 X + 2H10-100 Y');
  report(await waitFor(b, `/hooked cross-ties X/.test(document.querySelector('.memberCard').textContent) && /hooked cross-ties Y/.test(document.querySelector('.memberCard').textContent)`), 'the read-back shows the X and Y cross-ties as hooked');
  await clickInCard(b, '▦ Generate sets');
  report(await waitFor(b, `window.__store.getState().bars.length === 53`), 'two cross-ties along X and two along Y add 53 rows: 16 mains, 32 starters, 1 outer link set and 4 cross-ties');
  report(await b.ev(`window.__store.getState().bars.filter((r) => r.Rebar_Type === 'c_link_with_hook' && r.double_hook === 'yes' && r.Pos_Rotation === 0).length === 2 && window.__store.getState().bars.filter((r) => r.Rebar_Type === 'c_link_with_hook' && r.double_hook === 'yes' && r.Pos_Rotation === 90).length === 2`), 'the X and Y cross-ties are c_link_with_hook rows with double hooks, along X and along Y');
  await b.ev(`window.__store.getState().undo()`);
  report(await waitFor(b, `window.__store.getState().bars.length === 0`), 'one undo removes the cross-ties with the rest');

  // Long and short faces: 44H40 on the long faces (the bottom and top rows) and 8H32 on the short, with 2 X and 6 Y cross-ties at 150.
  await b.ev(`window.__store.getState().selectConcrete('c3')`);
  report(await waitFor(b, `document.querySelector('.memberCard') && window.__store.getState().selectedConcrete === 'c3'`), 'selecting the rectangular column moves the card to it');
  await typeField(b, 'bars', 0, '44H40 long + 8H32 short');
  await typeField(b, 'links', 0, 'H10-100 + 2H10-150 X + 6H10-150 Y');
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
  report(b.consoleErrors.length === 0, `no console errors${b.consoleErrors.length ? `: ${b.consoleErrors.slice(0, 3).join(' | ')}` : ''}`);
} catch (e) {
  report(false, `check stopped: ${e.message}`);
} finally {
  b.close();
}
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exitCode = failures ? 1 : 0;
