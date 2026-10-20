import type { Difficulty } from '../game/game-balance';
import type { PersonalBestScoreResult } from '../app/personal-best-scores';

/** The completed run owns its comparison, even if saved data later changes. */
export function createPersonalBestResultSnapshot() {
  let completed: { runId: number; comparison: PersonalBestScoreResult } | null =
    null;
  return {
    record(runId: number, comparison: PersonalBestScoreResult): void {
      completed = { runId, comparison: { ...comparison } };
    },
    read(runId: number, isResults: boolean): PersonalBestScoreResult | null {
      if (!isResults) completed = null;
      return completed?.runId === runId ? { ...completed.comparison } : null;
    },
  };
}

export function formatPersonalBestScore(
  difficulty: Difficulty,
  best: number | null,
): string {
  const label = `${difficulty[0]!.toUpperCase()}${difficulty.slice(1)}`;
  return best === null
    ? `${label} best score: No score yet`
    : `${label} best score: ${best.toLocaleString('en-US')}`;
}

export function formatPersonalBestResult(
  comparison: PersonalBestScoreResult,
): string {
  if (comparison.previousBest === null)
    return `First score recorded · Personal best: ${comparison.best.toLocaleString('en-US')}`;
  if (comparison.isNewBest)
    return `New personal best · Previous best: ${comparison.previousBest.toLocaleString('en-US')}`;
  return `Personal best: ${comparison.best.toLocaleString('en-US')} · Previous best: ${comparison.previousBest.toLocaleString('en-US')}`;
}
