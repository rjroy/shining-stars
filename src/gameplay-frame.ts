import type { ChartConfig } from './chart';
import type { ControllerSnapshot } from './controller';
import { getDifficultyProfile, type Difficulty } from './game-balance';
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
  readonly feedback: {
    readonly eventId: number;
    readonly runId: number;
    readonly noteId: string;
    readonly quality: 'good' | 'perfect';
    readonly onsetTransportTime: number;
  } | null;
  readonly timeLabel: string;
  readonly legendLabel: string;
  readonly feedbackLabel: string;
  readonly countdownLabel: string;
}

export { VISIBLE_NOTE_SECONDS } from './note-projection';
export const FEEDBACK_VISIBLE_SECONDS = 0.65;

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
  const profile = getDifficultyProfile(game.difficulty);
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
  const event = snapshot.feedback;
  const feedback =
    playing &&
    event !== null &&
    event.runId > 0 &&
    isFeedbackWithinVisibleAge(game.transportTime, event.onsetTransportTime)
      ? {
          eventId: event.eventId,
          runId: event.runId,
          noteId: event.noteId,
          quality: event.quality,
          onsetTransportTime: event.onsetTransportTime,
        }
      : null;
  const milliseconds = (seconds: number) => Math.round(seconds * 1000);

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
    legendLabel:
      `Good ±${milliseconds(profile.timing.goodWindowSeconds)} ms · ` +
      `Perfect ±${milliseconds(profile.timing.perfectWindowSeconds)} ms`,
    feedbackLabel:
      feedback === null
        ? 'Notes meet the line here'
        : feedback.quality === 'perfect'
          ? 'Perfect'
          : 'Good',
    countdownLabel:
      audio.status === 'starting'
        ? `Starting in ${Math.max(
            1,
            Math.ceil((audio.scheduledWhen ?? audioNow + 2) - audioNow),
          )}`
        : '',
  };
}
