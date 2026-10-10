import type { ChartConfig } from './chart';
import type { ControllerSnapshot } from './controller';
import { getDifficultyProfile, type Difficulty } from './game-balance';
import {
  projectNotes,
  projectTimingWindowGeometry,
  RUNWAY_TRAVEL_FRACTION,
  type ProjectedNote,
  type TimingWindowGeometry,
} from './note-projection';

export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Cached CSS-pixel geometry measured by the UI resize observer. */
export interface GameplayLayout {
  readonly width: number;
  readonly height: number;
  readonly stage: ScreenRect;
  readonly board: ScreenRect;
  readonly header: ScreenRect;
  readonly legend: ScreenRect;
  readonly feedback: ScreenRect;
}

export interface GameplayLane {
  readonly index: 0 | 1 | 2 | 3;
  readonly x: number;
  readonly width: number;
}

export interface GameplayFrame {
  readonly layout: GameplayLayout;
  readonly transportTime: number;
  readonly difficulty: Difficulty;
  readonly playing: boolean;
  readonly reducedMotion: boolean;
  readonly lanes: readonly GameplayLane[];
  readonly notes: readonly ProjectedNote[];
  /** Worst-case safe pool size derived from this chart, not a fixed peak. */
  readonly noteCapacity: number;
  readonly timingWindows: TimingWindowGeometry;
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

export const VISIBLE_NOTE_SECONDS = 2.4;
export const FEEDBACK_VISIBLE_SECONDS = 0.65;
export const LOGICAL_PLAYFIELD_WIDTH = 480;
export const LOGICAL_PLAYFIELD_HEIGHT = 240;

/** Fit the logical 2:1 board inside its measured CSS slot without stretching. */
export function containPlayfield(available: ScreenRect): ScreenRect {
  const scale = Math.max(
    0,
    Math.min(
      available.width / LOGICAL_PLAYFIELD_WIDTH,
      available.height / LOGICAL_PLAYFIELD_HEIGHT,
    ),
  );
  const width = LOGICAL_PLAYFIELD_WIDTH * scale;
  const height = LOGICAL_PLAYFIELD_HEIGHT * scale;
  return {
    x: available.x + (available.width - width) / 2,
    y: available.y + (available.height - height) / 2,
    width,
    height,
  };
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
  layout: GameplayLayout,
  reducedMotion: boolean,
  audioNow = 0,
): GameplayFrame {
  const { game, audio } = snapshot;
  const profile = getDifficultyProfile(game.difficulty);
  const board = containPlayfield(layout.board);
  const fittedLayout = { ...layout, board };
  const runwayTravelPx = board.height * RUNWAY_TRAVEL_FRACTION;
  const timingWindows = projectTimingWindowGeometry(
    game.difficulty,
    runwayTravelPx,
    VISIBLE_NOTE_SECONDS,
  );
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
    game.transportTime >= event.onsetTransportTime &&
    game.transportTime - event.onsetTransportTime < FEEDBACK_VISIBLE_SECONDS
      ? {
          eventId: event.eventId,
          runId: event.runId,
          noteId: event.noteId,
          quality: event.quality,
          onsetTransportTime: event.onsetTransportTime,
        }
      : null;
  const laneWidth = board.width / 4;
  const milliseconds = (seconds: number) => Math.round(seconds * 1000);

  return {
    layout: fittedLayout,
    transportTime: game.transportTime,
    difficulty: game.difficulty,
    playing,
    reducedMotion,
    lanes: [0, 1, 2, 3].map((index) => ({
      index: index as 0 | 1 | 2 | 3,
      x: board.x + laneWidth * index,
      width: laneWidth,
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
