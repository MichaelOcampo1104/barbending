// Injected into every page before the app loads (Page.addScriptToEvaluateOnNewDocument).
// Counts WebGL draw calls / triangles / lines, records frame times, long tasks, and exposes helpers.
export const INSTR = `(() => {
  if (window.__instr) return; window.__instr = true;
  const g = window.__gl = { calls: 0, tris: 0, lines: 0, frames: 0, on: false };
  for (const proto of [window.WebGL2RenderingContext && WebGL2RenderingContext.prototype, window.WebGLRenderingContext && WebGLRenderingContext.prototype]) {
    if (!proto) continue;
    for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const o = proto[fn]; if (!o) continue;
      proto[fn] = function (mode, a, b, c, d) {
        if (g.on) {
          g.calls++;
          const inst = fn === 'drawElementsInstanced' ? d : fn === 'drawArraysInstanced' ? c : 1;
          const cnt = (fn === 'drawArrays' || fn === 'drawArraysInstanced') ? b : a;
          if (mode === 4) g.tris += (cnt / 3) * (inst || 1); else if (mode === 1 || mode === 3) g.lines += (cnt / 2) * (inst || 1);
        }
        return o.apply(this, arguments);
      };
    }
  }
  const rec = window.__rec = { on: false, t: [] };
  const loop = (now) => { if (rec.on) { rec.t.push(now); g.frames++; } requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  window.__lt = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ entryTypes: ['longtask'] }); } catch (e) {}
  window.__startRec = () => { rec.t.length = 0; g.calls = 0; g.tris = 0; g.lines = 0; g.frames = 0; g.on = true; rec.on = true; };
  window.__stopRec = () => {
    rec.on = false; g.on = false; const t = rec.t, d = [];
    for (let i = 1; i < t.length; i++) d.push(t[i] - t[i - 1]);
    d.sort((a, b) => a - b); const n = d.length; const sum = d.reduce((s, v) => s + v, 0);
    return { frames: t.length, fps: n ? +(1000 * n / sum).toFixed(1) : 0, p50ms: n ? +d[Math.floor(n * 0.5)].toFixed(1) : 0, p95ms: n ? +d[Math.floor(n * 0.95)].toFixed(1) : 0, worstMs: n ? +d[n - 1].toFixed(1) : 0,
      drawCallsPerFrame: g.frames ? Math.round(g.calls / g.frames) : 0, trisPerFrame: g.frames ? Math.round(g.tris / g.frames) : 0, linesPerFrame: g.frames ? Math.round(g.lines / g.frames) : 0 };
  };
  window.__gpuInfo = () => { const c = document.createElement('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl'); if (!gl) return 'no webgl'; const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); };
  window.__status = () => {
    const el = Array.from(document.querySelectorAll('span')).find((e) => e.children.length === 0 && /\\d+\\s*fps\\s*·\\s*cam/.test(e.textContent));
    const m = el && el.textContent.match(/(\\d+)\\s*fps\\s*·\\s*cam\\s*([^·]+)·\\s*(\\d+)\\s*bars/);
    return { bars: m ? Number(m[3]) : -1, appFps: m ? Number(m[1]) : -1, t: performance.now() };
  };
  window.__lat = (fn) => new Promise((res) => { const t0 = performance.now(); fn(); requestAnimationFrame(() => requestAnimationFrame(() => res(+(performance.now() - t0).toFixed(1)))); });
})();`;
