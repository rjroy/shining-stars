import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  recordJudgmentReceipt,
  scheduleJudgmentVisualCapture,
} from './judgment-receipt.mjs';

test('a delayed visual capture cannot replace a received judgment or block later notes', async () => {
  let liveRegionText = 'Lane D: Perfect.';
  const receipts = [];
  const captures = [];
  const firstReceipt = recordJudgmentReceipt({
    runId: 'native-run-1',
    noteId: 'a01',
    lane: 'D',
    expected: 'perfect',
    liveRegionText,
    receivedAt: 10.007,
  });
  const delayedCapture = scheduleJudgmentVisualCapture(
    firstReceipt,
    async () => {
      await delay(40);
      return { capturedLiveRegionText: liveRegionText, capturedAt: 10.09 };
    },
    (capture) => captures.push(capture),
  );

  liveRegionText = 'Lane D: Miss.';
  const nextReceipt = recordJudgmentReceipt({
    runId: 'native-run-1',
    noteId: 'a05',
    lane: 'D',
    expected: 'miss',
    liveRegionText,
    receivedAt: 14.05,
  });
  receipts.push(firstReceipt, nextReceipt);

  assert.equal(firstReceipt.outcome, 'perfect');
  assert.equal(nextReceipt.outcome, 'miss');
  assert.deepEqual(receipts.map(({ noteId }) => noteId), ['a01', 'a05']);
  assert.deepEqual(captures, []);

  await delayedCapture;
  assert.equal(firstReceipt.outcome, 'perfect');
  assert.equal(captures.length, 1);
  assert.equal(captures[0].expectedOutcome, 'perfect');
  assert.equal(captures[0].capturedLiveRegionText, 'Lane D: Miss.');
});
