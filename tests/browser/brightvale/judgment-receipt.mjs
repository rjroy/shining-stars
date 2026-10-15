const OUTCOMES = new Set(['perfect', 'good', 'miss']);

export function goodJudgmentTargetSeconds(perfectMs, goodMs) {
  if (
    !Number.isFinite(perfectMs) ||
    !Number.isFinite(goodMs) ||
    perfectMs <= 0 ||
    goodMs <= perfectMs
  ) {
    throw new RangeError('Good judgment requires 0 < perfectMs < goodMs.');
  }
  return (perfectMs + goodMs) / 2000;
}

export function recordJudgmentReceipt({
  runId,
  noteId,
  lane,
  expected,
  liveRegionText,
  receivedAt,
  inputReceipt,
  receiptAudioTime,
  receiptPerformanceTime,
}) {
  const match = liveRegionText.match(
    new RegExp(`Lane ${lane}: (Perfect|Good|Miss)`, 'i'),
  );
  const outcome = match?.[1]?.toLowerCase();
  const timingEvidence = inputReceipt
    ? {
        inputAudioTime: inputReceipt.audioTime,
        inputPerformanceTime: inputReceipt.performanceTime,
        receiptAudioTime,
        receiptPerformanceTime,
        receiptDelayAudioSeconds:
          Number.isFinite(receiptAudioTime) && Number.isFinite(inputReceipt.audioTime)
            ? receiptAudioTime - inputReceipt.audioTime
            : null,
        receiptDelayPerformanceMs:
          Number.isFinite(receiptPerformanceTime) && Number.isFinite(inputReceipt.performanceTime)
            ? receiptPerformanceTime - inputReceipt.performanceTime
            : null,
      }
    : {};
  if (!OUTCOMES.has(outcome)) {
    throw new Error(
      `No ${lane}-lane judgment receipt for ${noteId}: ${liveRegionText}; timing=${JSON.stringify(timingEvidence)}`,
    );
  }
  if (outcome !== expected) {
    throw new Error(
      `Expected ${expected} feedback for ${noteId}, got: ${liveRegionText}; timing=${JSON.stringify(timingEvidence)}`,
    );
  }
  if (inputReceipt && (!inputReceipt.trusted || !Number.isFinite(inputReceipt.audioTime))) {
    throw new Error(
      `Invalid browser keydown receipt for ${noteId}: ${JSON.stringify(inputReceipt)}; timing=${JSON.stringify(timingEvidence)}`,
    );
  }
  return Object.freeze({
    runId,
    noteId,
    lane,
    outcome,
    expected,
    liveRegionText,
    receivedAt,
    ...(inputReceipt ? { inputReceipt, ...timingEvidence } : {}),
  });
}

export function scheduleJudgmentVisualCapture(receipt, capture, onComplete) {
  const requestedAt = Date.now();
  return Promise.resolve()
    .then(capture)
    .then((visual) => {
      const result = Object.freeze({
        runId: receipt.runId,
        noteId: receipt.noteId,
        lane: receipt.lane,
        expectedOutcome: receipt.outcome,
        requestedAt,
        completedAt: Date.now(),
        ...visual,
      });
      onComplete(result);
      return result;
    });
}
