import type { GameNoteState } from '../game/game';
import type { ChartNote } from '../game/chart';
import { getDifficultyProfile, type Difficulty } from '../game/game-balance';

export const VISIBLE_NOTE_SECONDS = 2.4;

export interface TimingWindowProgress {
  readonly goodHalfProgress: number;
  readonly perfectHalfProgress: number;
}

/** Convert the active timing profile into symmetric dimensionless progress. */
export function projectTimingWindowHalfProgress(
  difficulty: Difficulty,
): TimingWindowProgress {
  const timing = getDifficultyProfile(difficulty).timing;
  return {
    goodHalfProgress: timing.goodWindowSeconds / VISIBLE_NOTE_SECONDS,
    perfectHalfProgress: timing.perfectWindowSeconds / VISIBLE_NOTE_SECONDS,
  };
}

export interface ProjectedNote {
  readonly id: string;
  readonly lane: number;
  /** Position from the far end (0) through the hit line (1), continuing past it while unresolved. */
  readonly progress: number;
}

/** Project unresolved notes in the approach runway, including travel past the hit line until judged. */
export function projectNotes(
  states: readonly GameNoteState[],
  chartNotes: readonly ChartNote[],
  transportTime: number,
  visibleSeconds: number,
): ProjectedNote[] {
  const stateById = new Map(states.map((state) => [state.id, state]));

  return chartNotes.flatMap((note) => {
    const state = stateById.get(note.id);
    const remaining = note.time - transportTime;
    if (
      state === undefined ||
      state.outcome !== null ||
      remaining > visibleSeconds
    ) {
      return [];
    }

    const progress = Math.max(0, 1 - remaining / visibleSeconds);
    return [
      {
        id: note.id,
        lane: note.lane,
        progress,
      },
    ];
  });
}
