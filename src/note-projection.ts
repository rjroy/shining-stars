import type { GameNoteState } from './game';
import type { ChartNote } from './chart';

export interface ProjectedNote {
  readonly id: string;
  readonly lane: number;
  /** Position from the far end (0) to the hit line (1). */
  readonly progress: number;
  /** CSS offset that places progress 1 on the fixed hit line. */
  readonly bottomPercent: number;
}

/** Project only unresolved notes within the short visible approach runway. */
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
      remaining < -0.35 ||
      remaining > visibleSeconds
    ) {
      return [];
    }

    const progress = Math.max(0, Math.min(1, 1 - remaining / visibleSeconds));
    return [
      {
        id: note.id,
        lane: note.lane,
        progress,
        bottomPercent: 18 + (1 - progress) * 64,
      },
    ];
  });
}
