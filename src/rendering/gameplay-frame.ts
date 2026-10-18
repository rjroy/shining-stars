import type { ChartConfig } from '../game/chart';
import type { ControllerSnapshot } from '../game/controller';
import type { Difficulty } from '../game/game-balance';
import {
  projectNotes,
  projectTimingWindowHalfProgress,
  VISIBLE_NOTE_SECONDS,
  type ProjectedNote,
  type TimingWindowProgress,
} from './note-projection';
import type { BrightvaleViewportLayout } from './brightvale/viewport';

export interface GameplayLane {
  readonly index: 0 | 1 | 2 | 3;
}

export interface GameplayFrame {
  readonly layout: BrightvaleViewportLayout;
  readonly transportTime: number;
  readonly difficulty: Difficulty;
  readonly playing: boolean;
  readonly reducedMotion: boolean;
  readonly lanes: readonly GameplayLane[];
  readonly notes: readonly ProjectedNote[];
  /** Worst-case safe pool size derived from this chart, not a fixed peak. */
  readonly noteCapacity: number;
  readonly timingWindows: TimingWindowProgress;
  readonly feedback: readonly {
    readonly eventId: number;
    readonly runId: number;
    readonly noteId: string;
    readonly lane: 0 | 1 | 2 | 3;
    readonly quality: 'good' | 'perfect' | 'miss';
    readonly onsetTransportTime: number;
    readonly age: number;
  }[];
  readonly timeLabel: string;
  readonly legendLabel: string;
  readonly countdownLabel: string;
}

export { VISIBLE_NOTE_SECONDS } from './note-projection';
export const FEEDBACK_VISIBLE_SECONDS = 1.1;

/** Whether a transport-clock feedback event is inside its visible age window. */
export function isFeedbackWithinVisibleAge(
  transportTime: number,
  onsetTransportTime: number,
): boolean {
  return (
    transportTime >= onsetTransportTime &&
    transportTime - onsetTransportTime < FEEDBACK_VISIBLE_SECONDS
  );
}

function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safeSeconds / 60)
    .toString()
    .padStart(2, '0')}:${(safeSeconds % 60).toString().padStart(2, '0')}`;
}

/** Project one frozen controller snapshot into cached-layout GPU draw data. */
export function projectGameplayFrame(
  snapshot: ControllerSnapshot,
  chart: ChartConfig,
  layout: BrightvaleViewportLayout,
  reducedMotion: boolean,
  audioNow = 0,
): GameplayFrame {
  const { game, audio } = snapshot;
  const timingWindows = projectTimingWindowHalfProgress(game.difficulty);
  const playing =
    game.status === 'playing' &&
    (audio.status === 'playing' || audio.status === 'starting');
  const notes = playing
    ? projectNotes(
        game.notes,
        chart.notes,
        game.transportTime,
        VISIBLE_NOTE_SECONDS,
      )
    : [];
  const feedback = playing
    ? snapshot.feedback
        .filter(
          (event) =>
            event.runId > 0 &&
            isFeedbackWithinVisibleAge(
              game.transportTime,
              event.onsetTransportTime,
            ),
        )
        .map((event) => ({
          eventId: event.eventId,
          runId: event.runId,
          noteId: event.noteId,
          lane: event.lane,
          quality: event.quality,
          onsetTransportTime: event.onsetTransportTime,
          age: game.transportTime - event.onsetTransportTime,
        }))
    : [];

  return {
    layout,
    transportTime: game.transportTime,
    difficulty: game.difficulty,
    playing,
    reducedMotion,
    lanes: [0, 1, 2, 3].map((index) => ({
      index: index as 0 | 1 | 2 | 3,
    })),
    notes,
    noteCapacity: chart.notes.length,
    timingWindows,
    feedback,
    timeLabel: formatTime(game.transportTime),
    // Timing-window explanations belong to the results screen, not the stage.
    legendLabel: '',
    countdownLabel:
      audio.status === 'starting'
        ? `Starting in ${Math.max(
            1,
            Math.ceil((audio.scheduledWhen ?? audioNow + 2) - audioNow),
          )}`
        : '',
  };
}
