// Pure adaptive-quality controller (spec 8.1). No three.js and no DOM.
// While the camera is moving (interacting) and frames run long, step the pixel ratio and the tube
// triangle budget down; step back up when frames are comfortably fast; restore full quality shortly
// after the interaction ends.
export const QUALITY_LEVELS = Object.freeze([
  Object.freeze({ dpr: 1.75, budgetTris: 5_000_000 }),
  Object.freeze({ dpr: 1.25, budgetTris: 3_000_000 }),
  Object.freeze({ dpr: 1.0, budgetTris: 1_500_000 }),
  Object.freeze({ dpr: 1.0, budgetTris: 500_000 }),
]);
export const TARGET_MS = 33;
export const SLOW_MS = 40; // frame-time EMA above this for SLOW_FRAMES frames while interacting: step down
export const SLOW_FRAMES = 10;
export const FAST_MS = 24; // EMA below this for FAST_HOLD_MS while interacting: step up
export const FAST_HOLD_MS = 2000;
export const RESTORE_MS = 250; // after interaction ends, back to full quality
const ALPHA = 0.1;

export function createQualityController() {
  let level = 0;
  let ema = TARGET_MS;
  let slowFrames = 0;
  let fastSince = null;
  let lastInteractAt = -Infinity;
  let wasInteracting = false;
  return {
    get level() { return level; },
    update(frameMs, interacting, nowMs) {
      ema += ALPHA * (frameMs - ema);
      let changed = false;
      if (interacting) {
        lastInteractAt = nowMs;
        wasInteracting = true;
        if (ema > SLOW_MS) {
          slowFrames += 1;
          fastSince = null;
        } else {
          slowFrames = 0;
          if (ema < FAST_MS) {
            if (fastSince === null) fastSince = nowMs;
            else if (nowMs - fastSince >= FAST_HOLD_MS && level > 0) {
              level -= 1;
              changed = true;
              fastSince = null;
              ema = TARGET_MS;
            }
          } else {
            fastSince = null;
          }
        }
        if (slowFrames >= SLOW_FRAMES && level < QUALITY_LEVELS.length - 1) {
          level += 1;
          changed = true;
          slowFrames = 0;
          fastSince = null;
          ema = TARGET_MS; // judge the new level on its own frames
        }
      } else if (wasInteracting && nowMs - lastInteractAt >= RESTORE_MS) {
        wasInteracting = false;
        slowFrames = 0;
        fastSince = null;
        if (level !== 0) { level = 0; changed = true; ema = TARGET_MS; }
      }
      const l = QUALITY_LEVELS[level];
      return { level, changed, dpr: l.dpr, budgetTris: l.budgetTris };
    },
  };
}
