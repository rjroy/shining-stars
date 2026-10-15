import assert from 'node:assert/strict';
import test from 'node:test';
import { createBackgroundTaskTracker } from './background-task-tracker.mjs';

test('rejected screenshot work is handled immediately and propagates at the next check', async () => {
  const tracker = createBackgroundTaskTracker();
  tracker.track(async () => {
    throw new Error('screenshot write failed');
  }, 'Screenshot capture image.webp');

  await new Promise((resolve) => setImmediate(resolve));
  assert.throws(tracker.throwIfFailed, /Screenshot capture image\.webp failed: screenshot write failed/);
  await assert.rejects(tracker.drain(), /Screenshot capture image\.webp failed/);
});
