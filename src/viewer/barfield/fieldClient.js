// Worker client: latest build wins, stale results resolve null, and if the worker fails the same
// build runs on the main thread in 12 ms slices (spec section 9.1).
import { buildFieldSteps } from './buildField.js';

function defaultCreateWorker() {
  return new Worker(new URL('./barField.worker.js', import.meta.url), { type: 'module' });
}

// The first slice is deferred too, so a build that is superseded right after it was requested
// never runs at all. `sliceMs` = main-thread time per slice (0 = one generator step per slice).
function runSliced(rows, options, onProgress, isStale, sliceMs) {
  return new Promise((resolve, reject) => {
    let it;
    try { it = buildFieldSteps(rows, options); } catch (e) { reject(e); return; }
    const step = () => {
      if (isStale()) { resolve(null); return; }
      const t0 = performance.now();
      try {
        let r = it.next();
        while (!r.done && performance.now() - t0 < sliceMs) r = it.next();
        if (r.done) { resolve(r.value); return; }
        onProgress(r.value.fraction);
      } catch (e) { reject(e); return; }
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  });
}

export class FieldBuilder {
  constructor({ createWorker = defaultCreateWorker, onProgress = () => {}, sliceMs = 12 } = {}) {
    this.createWorker = createWorker;
    this.onProgress = onProgress;
    this.sliceMs = sliceMs;
    this.worker = null;
    this.latest = 0;
    this.pending = new Map();
    this.usingFallback = false;
    this.disposed = false;
  }

  _ensureWorker() {
    if (this.usingFallback || this.worker) return this.worker;
    try {
      const w = this.createWorker();
      w.onmessage = (e) => this._onMessage(e.data);
      w.onerror = (e) => this._failover(e);
      w.onmessageerror = (e) => this._failover(e);
      this.worker = w;
    } catch (e) {
      this._failover(e);
    }
    return this.worker;
  }

  build(rows, options = {}) {
    const id = ++this.latest;
    return new Promise((resolve, reject) => {
      if (this.disposed) { resolve(null); return; }
      const worker = this._ensureWorker();
      if (!worker) { this._runFallback(id, rows, options, resolve, reject); return; }
      this.pending.set(id, { resolve, reject, rows, options });
      worker.postMessage({ type: 'build', id, rows, options });
    });
  }

  _onMessage(m) {
    if (!m || m.id == null) return;
    if (m.type === 'progress') { if (m.id === this.latest) this.onProgress(m.fraction); return; }
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    if (m.id !== this.latest) { p.resolve(null); return; }
    if (m.type === 'built') p.resolve(m.data);
    else if (m.type === 'error') p.reject(new Error(m.message));
  }

  _failover() {
    if (this.usingFallback) return;
    this.usingFallback = true;
    try { if (this.worker) this.worker.terminate(); } catch { /* already gone */ }
    this.worker = null;
    const jobs = [...this.pending.entries()];
    this.pending.clear();
    for (const [id, p] of jobs) this._runFallback(id, p.rows, p.options, p.resolve, p.reject);
  }

  _runFallback(id, rows, options, resolve, reject) {
    runSliced(rows, options, (f) => { if (id === this.latest) this.onProgress(f); }, () => id !== this.latest || this.disposed, this.sliceMs)
      .then(resolve, reject);
  }

  dispose() {
    this.disposed = true;
    try { if (this.worker) this.worker.terminate(); } catch { /* already gone */ }
    this.worker = null;
    for (const p of this.pending.values()) p.resolve(null);
    this.pending.clear();
  }
}
