import test from 'node:test';
import assert from 'node:assert/strict';
import { AXIS_TOL, END_VERTEX, segmentAxisCode, vertexAxisFlags, cameraEndOnAxis } from '../../src/viewer/barfield/endOn.js';

test('a segment along a scene axis gets that axis code, in either direction', () => {
  assert.equal(segmentAxisCode(3, 0, 0), 1);
  assert.equal(segmentAxisCode(-3, 0, 0), 1);
  assert.equal(segmentAxisCode(0, 2, 0), 2);
  assert.equal(segmentAxisCode(0, 0, -4.25), 3);
});

test('tiny skews still count as along the axis, real slopes and diagonals do not', () => {
  assert.equal(segmentAxisCode(4, 0.002, -0.001), 1, '0.03 degrees off');
  assert.equal(segmentAxisCode(4, 0.1, 0), 0, '1.4 degrees off');
  assert.equal(segmentAxisCode(1, 1, 0), 0, 'a diagonal');
  assert.equal(segmentAxisCode(1, 1, 1), 0);
  assert.equal(segmentAxisCode(0, 0, 0), 0, 'a zero-length segment has no axis');
  assert.ok(AXIS_TOL > 0 && AXIS_TOL < 0.01);
});

test('vertex flags: the start carries the axis, the end vertex adds the end bit, no axis means no flags', () => {
  assert.equal(END_VERTEX, 4);
  assert.deepEqual(vertexAxisFlags(1), [1, 1 + END_VERTEX]);
  assert.deepEqual(vertexAxisFlags(3), [3, 3 + END_VERTEX]);
  assert.deepEqual(vertexAxisFlags(0), [0, 0]);
});

test('an orthographic camera looking exactly along a scene axis reports it, whichever way it faces', () => {
  assert.equal(cameraEndOnAxis([1, 0, 0]), 1, 'left / right');
  assert.equal(cameraEndOnAxis([-1, 0, 0]), 1);
  assert.equal(cameraEndOnAxis([0, -1, 0]), 2, 'top');
  assert.equal(cameraEndOnAxis([0, 1, 0]), 2, 'bottom');
  assert.equal(cameraEndOnAxis([0, 0, -1]), 3, 'front');
  assert.equal(cameraEndOnAxis([0, 0, 1]), 3, 'back');
  assert.equal(cameraEndOnAxis([0, 0, -37]), 3, 'length does not matter');
});

test('a tilted or degenerate view direction is not end-on to anything', () => {
  assert.equal(cameraEndOnAxis([0.0005, 0, -1]), 3, '0.03 degrees off is still front');
  assert.equal(cameraEndOnAxis([0.02, 0, -1]), 0, '1.1 degrees off');
  assert.equal(cameraEndOnAxis([-0.59, -0.45, -0.67]), 0, 'iso');
  assert.equal(cameraEndOnAxis([0, 0, 0]), 0);
});

test('a bar and a camera on the same axis agree: that is exactly the end-on case', () => {
  // A bar along scene Z (app Y) seen from the front: both sides report axis 3.
  assert.equal(segmentAxisCode(0, 0, -4.25), cameraEndOnAxis([0, 0, -1]));
  // The same bar seen from the top is not end-on.
  assert.notEqual(segmentAxisCode(0, 0, -4.25), cameraEndOnAxis([0, -1, 0]));
});
