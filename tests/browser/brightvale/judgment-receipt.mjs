const OUTCOMES = new Set(['perfect', 'good', 'miss']);

// This is the same collector serialized into the browser preload and used in
// unit tests, so event-order regressions exercise the actual receipt logic.
export function createJudgmentReceiptCollector() {
  const pendingInputs = new Map();
  let activeJudgment = null;
  const judgments = [];
  const keydowns = [];
  return {
    begin(active) {
      if (activeJudgment || pendingInputs.size > 0) {
        throw new Error('Cannot begin a judgment before the previous note is finished.');
      }
      const note = { ...active };
      activeJudgment = note;
      pendingInputs.set(note.noteId, note);
    },
    observeStatus(text, performanceTime, audioTime, scheduledWhen) {
      const active = activeJudgment;
      if (!active || !text || text === active.baselineText) return;
      const match = text.match(new RegExp(`Lane ${active.lane}: (Perfect|Good|Miss)`, 'i'));
      if (!match) return;
      judgments.push({ ...active, outcome: match[1].toLowerCase(), liveRegionText: text, performanceTime, audioTime, scheduledWhen });
      // A judgment ends status attribution, but a trusted keydown may still
      // arrive late. Keep only that note's input receipt pending until finish.
      activeJudgment = null;
    },
    observeKeydown(event, performanceTime, audioTime) {
      if (event.repeat) return;
      const active = [...pendingInputs.values()].find((item) => item.keyCode === event.code);
      if (!active || keydowns.some((receipt) => receipt.noteId === active.noteId)) return;
      keydowns.push({ ...active, trusted: event.isTrusted, code: event.code, performanceTime, audioTime });
    },
    finish(noteId) {
      if (!pendingInputs.has(noteId)) throw new Error(`Cannot finish unknown judgment note ${noteId}.`);
      pendingInputs.delete(noteId);
      if (activeJudgment?.noteId === noteId) activeJudgment = null;
    },
    judgments,
    keydowns,
  };
}

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
