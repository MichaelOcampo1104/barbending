import test from 'node:test';
import assert from 'node:assert/strict';
import { FieldBuilder } from '../../src/viewer/barfield/fieldClient.js';
import { handleBuildMessage } from '../../src/viewer/barfield/workerCore.js';
import { straightRow, spreadRows } from './helpers.mjs';

// A fake Web Worker that runs the real worker core on this thread, asynchronously.
function fakeWorker({ failWith = null } = {}) {
  return () => {
    const w = {
      onmessage: null, onerror: null, onmessageerror: null, terminated: false,
      postMessage(msg) {
        queueMicrotask(() => {
          if (w.terminated) return;
          if (failWith) { if (w.onerror) w.onerror(new Error(failWith)); return; }
          handleBuildMessage(msg, (m) => { if (!w.terminated && w.onmessage) w.onmessage({ data: m }); });
        });
      },
      terminate() { w.terminated = true; },
    };
    return w;
  };
}

test('build resolves the FieldData from the worker', async () => {
  const fb = new FieldBuilder({ createWorker: fakeWorker() });
  const data = await fb.build([straightRow(), straightRow({ qty_y: 4 })]);
  assert.equal(data.segCount, 5);
  assert.equal(fb.usingFallback, false);
  fb.dispose();
});

test('a newer build supersedes an older one (stale result resolves null)', async () => {
  const fb = new FieldBuilder({ createWorker: fakeWorker() });
  const first = fb.build([straightRow()]);
  const second = fb.build([straightRow(), straightRow({ Pos_x: 9000 })]);
  assert.equal(await first, null);
  assert.equal((await second).segCount, 2);
  fb.dispose();
});

test('a worker error falls back to the main thread and still resolves', async () => {
  const fb = new FieldBuilder({ createWorker: fakeWorker({ failWith: 'boom' }) });
  const data = await fb.build([straightRow(), straightRow({ qty_y: 3 })]);
  assert.equal(data.segCount, 4);
  assert.equal(fb.usingFallback, true);
  fb.dispose();
});

test('a worker that cannot be created falls back to the main thread', async () => {
  const fb = new FieldBuilder({ createWorker: () => { throw new Error('no workers here'); } });
  const data = await fb.build([straightRow()]);
  assert.equal(data.segCount, 1);
  assert.equal(fb.usingFallback, true);
  fb.dispose();
});

test('the main-thread fallback reports progress and drops stale builds', async () => {
  const seen = [];
  // sliceMs 0 = one generator step per slice, so progress is reported deterministically
  const fb = new FieldBuilder({ createWorker: () => { throw new Error('none'); }, onProgress: (f) => seen.push(f), sliceMs: 0 });
  const a = fb.build(spreadRows(1500, 2, 5));
  const b = fb.build([straightRow()]);
  assert.equal(await a, null, 'the superseded build never runs');
  assert.equal((await b).segCount, 1);
  const c = await fb.build(spreadRows(1500, 2, 6));
  assert.equal(c.rowCount, 1500);
  assert.ok(seen.length > 0, 'progress reported while slicing');
  fb.dispose();
});

test('dispose resolves pending builds with null', async () => {
  const fb = new FieldBuilder({ createWorker: fakeWorker() });
  const p = fb.build([straightRow()]);
  fb.dispose();
  assert.equal(await p, null);
});

test('a build error inside the worker rejects the promise', async () => {
  const fb = new FieldBuilder({ createWorker: fakeWorker() });
  // rows must be an array; null makes buildFieldSteps throw (rows.length) inside handleBuildMessage
  await assert.rejects(() => fb.build(null), /./);
  fb.dispose();
});
