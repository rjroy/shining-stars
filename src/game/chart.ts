import {
  DIFFICULTY_PROFILES,
  maximumGoodWindowSeconds,
  parseAllowedDifficulties,
  type Difficulty,
} from './game-balance';

export type ChartLane = 0 | 1 | 2 | 3;

export interface ChartNote {
  readonly id: string;
  /** Seconds relative to the beginning of the selected excerpt. */
  readonly time: number;
  readonly lane: ChartLane;
}

export interface ChartConfig {
  /** Source-audio offset, in seconds. */
  readonly sourceStart: number;
  /** Selected excerpt duration, in seconds. */
  readonly duration: number;
  /** Audience-to-Twilight boundary, relative to the excerpt. */
  readonly twilightAt: number;
  /** Initial Twilight Strength for this song. */
  readonly twilightStrength: number;
  /** Difficulties permitted for this song, in preferred fallback order. */
  readonly allowedDifficulties: readonly Difficulty[];
  readonly notes: readonly ChartNote[];
}

export type ChartIssueCode =
  | 'invalid-source-start'
  | 'invalid-duration'
  | 'invalid-twilight'
  | 'invalid-twilight-strength'
  | 'invalid-allowed-difficulties'
  | 'duplicate-note-id'
  | 'non-finite-note-time'
  | 'invalid-lane'
  | 'before-excerpt-start'
  | 'audience-window-near-twilight'
  | 'twilight-window-near-audience'
  | 'after-excerpt-end'
  | 'note-at-twilight'
  | 'simultaneous-notes';

export interface ChartIssue {
  readonly code: ChartIssueCode;
  readonly message: string;
  readonly noteId?: string;
}

const MAX_INPUT_OFFSET_SECONDS = 0.2;
const HANDOFF_GUARD_SECONDS = 0.5;

function isChartLane(lane: number): lane is ChartLane {
  return lane === 0 || lane === 1 || lane === 2 || lane === 3;
}

function issue(
  code: ChartIssueCode,
  message: string,
  noteId?: string,
): ChartIssue {
  return noteId === undefined ? { code, message } : { code, message, noteId };
}

/**
 * Return an empty list for a valid chart, otherwise the chart's validation issues.
 */
export function validateChart(chart: ChartConfig): readonly ChartIssue[] {
  const issues: ChartIssue[] = [];

  if (!Number.isFinite(chart.sourceStart) || chart.sourceStart < 0) {
    issues.push(
      issue(
        'invalid-source-start',
        'Source start must be finite and non-negative.',
      ),
    );
  }

  const durationIsValid = Number.isFinite(chart.duration) && chart.duration > 0;
  if (!durationIsValid) {
    issues.push(
      issue(
        'invalid-duration',
        'Excerpt duration must be finite and positive.',
      ),
    );
  }

  const twilightIsValid =
    Number.isFinite(chart.twilightAt) &&
    chart.twilightAt > 0 &&
    durationIsValid &&
    chart.twilightAt < chart.duration;
  if (!twilightIsValid) {
    issues.push(
      issue(
        'invalid-twilight',
        'Twilight boundary must be finite and strictly inside the excerpt.',
      ),
    );
  }

  if (!Number.isFinite(chart.twilightStrength) || chart.twilightStrength <= 0) {
    issues.push(
      issue(
        'invalid-twilight-strength',
        'Initial Twilight Strength must be finite and positive.',
      ),
    );
  }

  let maxGoodWindowSeconds =
    DIFFICULTY_PROFILES.normal.timing.goodWindowSeconds;
  try {
    const allowedDifficulties = parseAllowedDifficulties(
      chart.allowedDifficulties,
    );
    maxGoodWindowSeconds = maximumGoodWindowSeconds(allowedDifficulties);
  } catch (error) {
    issues.push(
      issue(
        'invalid-allowed-difficulties',
        error instanceof Error
          ? error.message
          : 'Allowed difficulties must be a non-empty list of known profiles.',
      ),
    );
  }
  const timingEnvelopeSeconds = maxGoodWindowSeconds + MAX_INPUT_OFFSET_SECONDS;

  const seenIds = new Set<string>();
  const seenTimes = new Set<number>();
  for (const note of chart.notes) {
    if (seenIds.has(note.id)) {
      issues.push(
        issue(
          'duplicate-note-id',
          `Note ID '${note.id}' is used more than once.`,
          note.id,
        ),
      );
    } else {
      seenIds.add(note.id);
    }

    if (!Number.isFinite(note.time)) {
      issues.push(
        issue('non-finite-note-time', 'Note time must be finite.', note.id),
      );
      continue;
    }

    if (seenTimes.has(note.time)) {
      issues.push(
        issue(
          'simultaneous-notes',
          `A note already exists at ${note.time} seconds; simultaneous notes are not supported.`,
          note.id,
        ),
      );
    } else {
      seenTimes.add(note.time);
    }

    if (!isChartLane(note.lane)) {
      issues.push(
        issue(
          'invalid-lane',
          'Note lane must be one of 0, 1, 2, or 3.',
          note.id,
        ),
      );
    }

    const earliest = note.time - timingEnvelopeSeconds;
    const latest = note.time + timingEnvelopeSeconds;

    if (earliest < 0) {
      issues.push(
        issue(
          'before-excerpt-start',
          'The earliest supported hit time must be at or after excerpt time zero.',
          note.id,
        ),
      );
    }

    if (twilightIsValid) {
      if (note.time === chart.twilightAt) {
        issues.push(
          issue(
            'note-at-twilight',
            'A note cannot be centered exactly on the Twilight boundary.',
            note.id,
          ),
        );
      } else if (note.time < chart.twilightAt) {
        if (latest >= chart.twilightAt - HANDOFF_GUARD_SECONDS) {
          issues.push(
            issue(
              'audience-window-near-twilight',
              'The audience note’s latest supported hit time must be strictly before the handoff guard.',
              note.id,
            ),
          );
        }
      } else if (earliest <= chart.twilightAt + HANDOFF_GUARD_SECONDS) {
        issues.push(
          issue(
            'twilight-window-near-audience',
            'The Twilight note’s earliest supported hit time must be strictly after the handoff guard.',
            note.id,
          ),
        );
      }
    }

    if (durationIsValid && latest > chart.duration - HANDOFF_GUARD_SECONDS) {
      issues.push(
        issue(
          'after-excerpt-end',
          'The latest supported hit time must be at or before excerpt duration minus 0.5 seconds.',
          note.id,
        ),
      );
    }
  }

  return issues;
}
