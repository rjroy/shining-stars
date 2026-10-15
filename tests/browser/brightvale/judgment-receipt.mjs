const OUTCOMES = new Set(['perfect', 'good', 'miss']);

export function recordJudgmentReceipt({
  runId,
  noteId,
  lane,
  expected,
  liveRegionText,
  receivedAt,
}) {
  const match = liveRegionText.match(
    new RegExp(`Lane ${lane}: (Perfect|Good|Miss)`, 'i'),
  );
  const outcome = match?.[1]?.toLowerCase();
  if (!OUTCOMES.has(outcome)) {
    throw new Error(
      `No ${lane}-lane judgment receipt for ${noteId}: ${liveRegionText}`,
    );
  }
  if (outcome !== expected) {
    throw new Error(
      `Expected ${expected} feedback for ${noteId}, got: ${liveRegionText}`,
    );
  }
  return Object.freeze({ runId, noteId, lane, outcome, expected, liveRegionText, receivedAt });
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
