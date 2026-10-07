// Minimal Chrome DevTools Protocol driver for headless Edge with the real GPU (Windows).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

export async function launchBrowser({ dpr = 1, width = 1600, height = 900, instrument = '' } = {}) {
  const port = 9400 + Math.floor(Math.random() * 500);
  const profile = path.join(os.tmpdir(), `barbending-perf-edge-${port}`);
  const proc = spawn(EDGE, [
    '--headless=new', '--no-sandbox', '--hide-scrollbars', `--window-size=${width},${height}`,
    `--force-device-scale-factor=${dpr}`, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--js-flags=--max-old-space-size=8192', 'about:blank',
  ], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await sleep(300);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch { /* retry */ }
  }
  if (!wsUrl) { proc.kill(); throw new Error('Edge did not expose a debuggable page (set EDGE_PATH?)'); }

  const ws = new WebSocket(wsUrl);
  let nid = 0;
  let crashed = false;
  const pend = new Map();
  const consoleErrors = [];
  const handlers = new Map(); // CDP event name -> listener, see on()
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data.toString());
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
    if (m.method && handlers.has(m.method)) handlers.get(m.method)(m.params);
    if (m.method === 'Inspector.targetCrashed') crashed = true;
    else if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push('EXC ' + String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      const text = (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 300);
      // React's StrictMode warning about drei's <Html> label in the section box (dev server only, logged by
      // the classic renderer too): not an app error, so it must not fail the checks.
      if (!/synchronously unmount a root/.test(text)) consoleErrors.push('console.error ' + text);
    }
  };
  await new Promise((r) => { ws.onopen = r; });

  const send = (method, params = {}, timeoutMs = 180000) => new Promise((resolve, reject) => {
    const id = ++nid;
    const t = setTimeout(() => { pend.delete(id); reject(new Error('CDP-TIMEOUT ' + method)); }, timeoutMs);
    pend.set(id, (m) => { clearTimeout(t); if (m.error) reject(new Error(m.error.message)); else resolve(m.result); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expression, timeoutMs = 180000) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'eval error').slice(0, 300));
    return r.result.value;
  };

  for (const domain of ['Page', 'Runtime', 'Inspector', 'DOM', 'Performance']) await send(`${domain}.enable`);
  if (instrument) await send('Page.addScriptToEvaluateOnNewDocument', { source: instrument });

  const close = () => {
    try { ws.close(); } catch { /* gone */ }
    try { proc.kill(); } catch { /* gone */ }
    try { spawn('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { stdio: 'ignore' }); } catch { /* gone */ }
    setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* busy */ } }, 1500);
  };
  const on = (method, fn) => handlers.set(method, fn);
  return { send, ev, on, close, sleep, isCrashed: () => crashed, consoleErrors };
}
