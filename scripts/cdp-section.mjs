import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9333;
const URL = process.argv[2] || 'http://localhost:5174/?autotest=section';
const OUT = process.argv[3] || 'C:/Users/Michael Ocampo/AppData/Local/Temp/opencode/sec3.png';

const edge = spawn(EDGE, [
  '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--window-size=1600,900', `--remote-debugging-port=${PORT}`, 'about:blank',
], { stdio: 'ignore', detached: true });
edge.unref();

async function json(path) {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`);
  return r.json();
}
let wsUrl = null;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await new Promise((r) => setTimeout(r, 300));
  try {
    const targets = await json('/json/list');
    const page = targets.find((t) => t.type === 'page');
    if (page) wsUrl = page.webSocketDebuggerUrl;
  } catch { /* retry */ }
}
if (!wsUrl) throw new Error('no debuggable page');

const ws = new WebSocket(wsUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data.toString());
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
await new Promise((r) => ws.onopen = r);
const send = (method, params = {}) => new Promise((res) => {
  id += 1; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
});
await send('Page.enable');
await send('Log.enable');
await send('Runtime.enable');
const logs = [];
ws.onmessage = ((prev) => (ev) => {
  prev(ev);
  try {
    const m = JSON.parse(ev.data.toString());
    if (m.method === 'Log.entryAdded') logs.push(`[${m.params.entry.level}] ${m.params.entry.text} ${m.params.entry.url || ''}`);
    if (m.method === 'Runtime.consoleAPICalled') {
      const vals = (m.params.args || []).map((a) => a.value ?? `[${a.type}]`).join(' ');
      logs.push(`[con.${m.params.type}] ${vals}`);
    }
    if (m.method === 'Runtime.exceptionThrown') logs.push(`[EXC] ${(m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text} :: ${(m.params.exceptionDetails.stackTrace || {}).callFrames || []}`.slice(0, 900));
  } catch { /* ignore */ }
})(ws.onmessage);
await send('Page.navigate', { url: URL });
const CLICK = process.argv[4] || '';
// Optional 5th arg "synclk": after CLICK, send TRUSTED mouse clicks on a grid
// across the canvas via CDP Input (real pointer pipeline).
const SYN = process.argv[5] || '';
if (CLICK) {
  await new Promise((r) => setTimeout(r, 4000));
  const clickRes = await send('Runtime.evaluate', { expression: `(() => {
    const btns = [...document.querySelectorAll('button')];
    const b = btns.find((x) => (x.textContent || '').includes(${JSON.stringify(CLICK)}));
    if (b) { b.click(); return 'clicked:' + b.textContent.trim(); }
    return 'not-found';
  })()`, returnByValue: true });
  console.log('CLICKRES:', JSON.stringify(clickRes?.result?.result));
  await new Promise((r) => setTimeout(r, 5000));
}
if (SYN === 'synclk' && CLICK) {
  const r = await send('Runtime.evaluate', { expression: `(() => {
    const cv = document.querySelector('.view canvas') || document.querySelector('canvas');
    if (!cv) return null;
    const b = cv.getBoundingClientRect();
    return JSON.stringify({ x: b.left, y: b.top, w: b.width, h: b.height });
  })()`, returnByValue: true });
  const rect = JSON.parse(r?.result?.result?.value || 'null');
  console.log('CLICKRECT:', JSON.stringify(rect));
  if (rect) {
    for (const [fx, fy] of [[0.5, 0.5], [0.35, 0.6], [0.65, 0.4], [0.45, 0.45], [0.55, 0.55], [0.3, 0.5], [0.7, 0.5]]) {
      const x = Math.round(rect.x + rect.w * fx), y = Math.round(rect.y + rect.h * fy);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      await new Promise((rr) => setTimeout(rr, 600));
    }
  }
  await new Promise((r) => setTimeout(r, 4000));
}
// poll for settled dump (section applied + several rewrite ticks;
// with &sample=1 also waits for the IFC to finish loading)
const needIfc = URL.includes('sample=1');
const needDump = URL.includes('autotest');
let dump = null;
if (needDump) {
for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const r = await send('Runtime.evaluate', { expression: `(() => { const el = document.getElementById('autotest-dump'); const root = document.getElementById('root'); return JSON.stringify({ dump: el ? el.textContent : '', rootLen: root ? root.innerHTML.length : -1 }); })()` });
  const v = r?.result?.result?.value || null;
  if (v) {
    try {
      const o = JSON.parse(v);
      if (o.dump) { const d = JSON.parse(o.dump); if (d.section && (!needIfc || (d.ifc && d.meshesStandard >= 10))) { dump = v; break; } }
    } catch { /* keep polling */ }
  }
}
} else {
  const r = await send('Runtime.evaluate', { expression: `(() => { const root = document.getElementById('root'); return JSON.stringify({ rootLen: root ? root.innerHTML.length : -1, body: document.body.innerText.slice(0, 120) }); })()` });
  dump = r?.result?.result?.value || null;
}
console.log('DUMP:', dump || 'NO-DUMP-DIV');
console.log('LOGS:');
logs.slice(0, 20).forEach((l) => console.log(' ', l.slice(0, 300)));
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
console.log('SHOT OK:', OUT);
// Optional 6th arg "probe": NDC pairs "x,y;x,y" raycast via page probe.
const PROBE = process.argv[6] || '';
if (PROBE) {
  for (const pair of PROBE.split(';')) {
    const r = await send('Runtime.evaluate', { expression: `window.__probePick${pair ? `(${pair})` : '(0,0)'}` });
    console.log('PROBE', pair, '=>', (r?.result?.result?.value || 'n/a').slice(0, 1200));
  }
}
ws.close();
try { execSync(`taskkill /PID ${edge.pid} /F`); } catch { /* gone */ }
