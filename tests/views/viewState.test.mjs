import test from 'node:test';
import assert from 'node:assert/strict';
import { useStore } from '../../src/store.js';

test('the six true views switch to orthographic, Iso back to perspective', () => {
  const st = () => useStore.getState();
  assert.equal(st().projection, 'persp', 'perspective is the default');
  for (const dir of ['top', 'bottom', 'front', 'back', 'left', 'right']) {
    st().requestView('iso');
    assert.equal(st().projection, 'persp');
    st().requestView(dir);
    assert.equal(st().projection, 'ortho', `${dir} is orthographic`);
    assert.equal(st().viewReq.dir, dir);
  }
  st().requestView('iso');
  assert.equal(st().projection, 'persp', 'Iso is perspective');
});

test('every view request is a new request, even for the same direction', () => {
  const st = () => useStore.getState();
  st().requestView('front');
  const a = st().viewReq;
  st().requestView('front');
  const b = st().viewReq;
  assert.notEqual(a, b, 'a new object, so the camera animates again');
  assert.equal(b.dir, 'front');
});

test('the projection can be toggled and set without touching the requested view', () => {
  const st = () => useStore.getState();
  st().requestView('iso');
  const req = st().viewReq;
  st().toggleProjection();
  assert.equal(st().projection, 'ortho');
  assert.equal(st().viewReq, req, 'toggling does not request a view');
  st().toggleProjection();
  assert.equal(st().projection, 'persp');
  st().setProjection('ortho');
  assert.equal(st().projection, 'ortho');
  st().setProjection('anything else');
  assert.equal(st().projection, 'persp', 'unknown values fall back to perspective');
});

test('the active view name only publishes changes', () => {
  const st = () => useStore.getState();
  let notified = 0;
  const unsub = useStore.subscribe(() => { notified += 1; });
  st().setViewName('front');
  const afterFirst = notified;
  st().setViewName('front');
  assert.equal(notified, afterFirst, 'same name: no store update');
  st().setViewName('free');
  assert.equal(st().viewName, 'free');
  assert.ok(notified > afterFirst);
  unsub();
});
