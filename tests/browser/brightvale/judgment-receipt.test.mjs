import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  goodJudgmentTargetSeconds,
  recordJudgmentReceipt,
  scheduleJudgmentVisualCapture,
} from './judgment-receipt.mjs';

test('Hard Good target is the Good-only midpoint with no dispatch-lead subtraction', () => {
  const target = goodJudgmentTargetSeconds(50, 100);
  assert.equal(target, 0.075);
  assert.ok(target > 0.05, `Good target ${target}s must be beyond the 50ms Perfect window`);
  assert.ok(target < 0.1, `Good target ${target}s must remain inside the 100ms Good window`);
});

test('judgment receipt retains actual keydown audio time separately from DOM receipt time', () => {
  const inputReceipt = {
    trusted: true,
    audioTime: 22.045,
    performanceTime: 1000,
    code: 'KeyF',
  };
  const receipt = recordJudgmentReceipt({
    runId: 'native-run',
    noteId: 'a02',
    lane: 'F',
    expected: 'good',
    liveRegionText: 'Lane F: Good.',
    receivedAt: 1152,
    inputReceipt,
    receiptAudioTime: 22.047,
    receiptPerformanceTime: 1152,
  });
  assert.equal(receipt.inputAudioTime, 22.045);
  assert.equal(receipt.receiptAudioTime, 22.047);
  assert.equal(receipt.receiptDelayAudioSeconds, 0.0019999999999988916);
  assert.equal(receipt.receiptDelayPerformanceMs, 152);
});

test('a failed judgment retains actual keydown and delayed DOM timing diagnostics', () => {
  assert.throws(
    () => recordJudgmentReceipt({
      runId: 'native-run',
      noteId: 'a02',
      lane: 'F',
      expected: 'good',
      liveRegionText: 'Lane F: Perfect.',
      receivedAt: 1152,
      inputReceipt: { trusted: true, audioTime: 22.045, performanceTime: 1000 },
      receiptAudioTime: 22.047,
      receiptPerformanceTime: 1152,
    }),
    /Expected good feedback.*inputAudioTime.*22\.045.*receiptDelayPerformanceMs.*152/,
  );
});

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
