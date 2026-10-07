// Pure worker logic (testable in Node): runs buildFieldSteps and reports through `post`.
import { buildFieldSteps } from './buildField.js';

export function transferablesOf(data) {
  return [
    data.seg.buffer, data.rowOfVtx.buffer, data.rows.radiusM.buffer, data.rows.colorIdx.buffer,
    data.blocks.start.buffer, data.blocks.size.buffer, data.blocks.bounds.buffer, data.blocks.maxRadiusM.buffer,
  ];
}

export function handleBuildMessage(msg, post) {
  if (!msg || msg.type !== 'build') return;
  const { id, rows, options } = msg;
  try {
    const it = buildFieldSteps(rows, options);
    let r = it.next();
    let lastPost = 0;
    while (!r.done) {
      const now = Date.now();
      if (now - lastPost > 50) { post({ type: 'progress', id, fraction: r.value.fraction }); lastPost = now; }
      r = it.next();
    }
    post({ type: 'built', id, data: r.value }, transferablesOf(r.value));
  } catch (err) {
    post({ type: 'error', id, message: String((err && err.message) || err) });
  }
}
