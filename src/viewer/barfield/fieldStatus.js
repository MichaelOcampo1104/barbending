// Tiny external store (no React dependency) for the viewport badge, plus the stats object that
// scripts/perf reads as window.__barfield.
const listeners = new Set();
let state = { building: false, fraction: 0, message: '', error: false };

export const fieldStatus = {
  get: () => state,
  set(patch) {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  },
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export const fieldStats = {
  ready: false, version: 0, rows: 0, segments: 0, chunks: 0, buildMs: 0, maxBlockMs: 0, usingFallback: false,
};

export function publishStats(patch) {
  Object.assign(fieldStats, patch);
  if (typeof window !== 'undefined') window.__barfield = fieldStats;
}

// Runs fn and records the longest synchronous block spent in field work (budget: <= 200 ms).
export function timed(fn) {
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    const dt = performance.now() - t0;
    if (dt > fieldStats.maxBlockMs) fieldStats.maxBlockMs = dt;
  }
}
