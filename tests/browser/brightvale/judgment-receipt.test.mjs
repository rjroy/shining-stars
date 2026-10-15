import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createJudgmentReceiptCollector,
  goodJudgmentTargetSeconds,
  recordJudgmentReceipt,
  scheduleJudgmentVisualCapture,
} from './judgment-receipt.mjs';

test('Miss before a late keydown keeps independent per-note receipts', () => {
  const collector = createJudgmentReceiptCollector();
  collector.begin({ runId: 'run', noteId: 'a18', lane: 'J', keyCode: 'KeyJ', expected: 'miss', baselineText: '' });

  // Exercise the exact collector used in the injected browser preload.
  collector.observeStatus('Lane J: Miss.', 1200, 4.2, 4.0);
  collector.observeKeydown({ code: 'KeyJ', isTrusted: true, repeat: false }, 1418, 4.418);

  assert.equal(collector.judgments[0].outcome, 'miss');
  assert.equal(collector.judgments[0].noteId, 'a18');
  assert.equal(collector.keydowns[0].noteId, 'a18');
  assert.equal(collector.keydowns[0].trusted, true);
  assert.equal(collector.keydowns[0].performanceTime - collector.judgments[0].performanceTime, 218);
  const receipt = recordJudgmentReceipt({
    runId: 'run', noteId: 'a18', lane: 'J', expected: 'miss',
    liveRegionText: collector.judgments[0].liveRegionText,
    receivedAt: collector.judgments[0].performanceTime,
    inputReceipt: collector.keydowns[0],
    receiptAudioTime: collector.judgments[0].audioTime,
    receiptPerformanceTime: collector.judgments[0].performanceTime,
  });
  assert.equal(receipt.outcome, 'miss');
  assert.equal(receipt.receiptDelayPerformanceMs, -218);
  collector.finish('a18');
});

test('sequential notes in the same lane receive distinct judgments and keydowns', () => {
  const collector = createJudgmentReceiptCollector();
  for (const [noteId, outcome, time] of [['j01', 'perfect', 100], ['j02', 'good', 200]]) {
    collector.begin({ runId: 'run', noteId, lane: 'J', keyCode: 'KeyJ', baselineText: '' });
    collector.observeStatus(`Lane J: ${outcome}.`, time, time / 1000, 1);
    collector.observeKeydown({ code: 'KeyJ', isTrusted: true, repeat: false }, time + 3, time / 1000 + 0.003);
    collector.finish(noteId);
  }

  assert.deepEqual(collector.judgments.map(({ noteId, outcome }) => [noteId, outcome]), [
    ['j01', 'perfect'], ['j02', 'good'],
  ]);
  assert.deepEqual(collector.keydowns.map(({ noteId }) => noteId), ['j01', 'j02']);
});

test('interleaved lanes and intentional Miss without input do not retain stale note ownership', () => {
  const collector = createJudgmentReceiptCollector();
  collector.begin({ runId: 'run', noteId: 'd01', lane: 'D', keyCode: 'KeyD', baselineText: '' });
  collector.observeKeydown({ code: 'KeyD', isTrusted: true, repeat: false }, 10, 1);
  collector.observeStatus('Lane D: Perfect.', 11, 1.001, 1);
  collector.finish('d01');

  collector.begin({ runId: 'run', noteId: 'j-miss', lane: 'J', keyCode: 'KeyJ', baselineText: 'Lane D: Perfect.' });
  collector.observeStatus('Lane J: Miss.', 20, 1.01, 1);
  collector.finish('j-miss'); // This chart note was intentionally left unplayed.

  collector.begin({ runId: 'run', noteId: 'j-next', lane: 'J', keyCode: 'KeyJ', baselineText: 'Lane J: Miss.' });
  collector.observeKeydown({ code: 'KeyJ', isTrusted: true, repeat: false }, 30, 1.02);
  collector.observeStatus('Lane J: Good.', 31, 1.021, 1);
  collector.finish('j-next');

  assert.deepEqual(collector.judgments.map(({ noteId, outcome }) => [noteId, outcome]), [
    ['d01', 'perfect'], ['j-miss', 'miss'], ['j-next', 'good'],
  ]);
  assert.deepEqual(collector.keydowns.map(({ noteId }) => noteId), ['d01', 'j-next']);
});

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
