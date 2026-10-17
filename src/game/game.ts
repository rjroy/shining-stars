import {
  getInitialTwilightStrength,
  validateChart,
  type ChartConfig,
  type ChartLane,
} from './chart';
import {
  defaultDifficulty,
  getDifficultyProfile,
  isDifficulty,
  parseAllowedDifficulties,
  type Difficulty,
} from './game-balance';

export type GamePhase = 'audience' | 'twilight';
export type GameStatus = 'playing' | 'results';
export type HitQuality = 'perfect' | 'good';
export type GameOutcome = 'victory' | 'defeat' | 'survived';
export type NoteOutcome = HitQuality | 'miss' | null;

export interface GameNoteState {
  readonly id: string;
  readonly lane: ChartLane;
  readonly phase: GamePhase;
  readonly outcome: NoteOutcome;
}

export interface GamePhaseStats {
  readonly perfect: number;
  readonly good: number;
  readonly miss: number;
  readonly accuracy: number | null;
}

export interface GameResult {
  readonly audience: GamePhaseStats;
  readonly twilight: GamePhaseStats;
  readonly overall: GamePhaseStats;
  readonly renown: number;
  readonly personalStrength: number;
  readonly twilightStrength: number;
  readonly difficulty: Difficulty;
  readonly outcome: GameOutcome;
  readonly score: number;
  readonly combo: number;
  readonly multiplier: number;
  readonly normalMaximum: number;
}

export interface GameSnapshot {
  readonly transportTime: number;
  readonly phase: GamePhase;
  readonly status: GameStatus;
  readonly victory: boolean;
  readonly renown: number;
  readonly personalStrength: number;
  readonly twilightStrength: number;
  readonly initialTwilightStrength: number;
  readonly difficulty: Difficulty;
  readonly score: number;
  readonly combo: number;
  /** Multiplier that applies to the next successful hit. */
  readonly multiplier: number;
  readonly normalMaximum: number;
  readonly notes: readonly GameNoteState[];
  readonly result: GameResult | null;
}

export interface PressResult {
  readonly noteId: string;
  readonly quality: HitQuality;
  readonly timingErrorSeconds: number;
}

export interface GameSession {
  snapshot(): GameSnapshot;
  advanceTo(transportTime: number): GameSnapshot;
  press(lane: ChartLane, transportTime: number): PressResult | null;
}

interface MutableGameNote {
  readonly id: string;
  readonly lane: ChartLane;
  readonly time: number;
  readonly phase: GamePhase;
  outcome: NoteOutcome;
}

interface MutableStats {
  perfect: number;
  good: number;
  miss: number;
}

type GameEvent =
  | { readonly kind: 'boundary'; readonly time: number; readonly order: 0 }
  | {
      readonly kind: 'miss';
      readonly time: number;
      readonly order: 1;
      readonly note: MutableGameNote;
    }
  | { readonly kind: 'end'; readonly time: number; readonly order: 2 };

const MAX_INPUT_OFFSET_SECONDS = 0.2;
const MISS_EVENT_ORDER = 1;
const HANDOFF_EVENT_ORDER = 0;
const END_EVENT_ORDER = 2;
const COMPARISON_ULPS = 8;
const BASE_PERFECT_SCORE = 100;
const MAX_SCORE_MULTIPLIER = 5;

type Comparison = -1 | 0 | 1;

/**
 * Treat only a handful of floating-point ULPs as equality at timing edges.
 * This accounts for arithmetic such as (note + 0.075) - note without adding
 * a human-scale timing grace period.
 */
function compareTimingValues(
  left: number,
  right: number,
  sourceScale = 1,
): Comparison {
  const difference = left - right;
  const scale = Math.max(
    1,
    Math.abs(left),
    Math.abs(right),
    Math.abs(sourceScale),
  );
  const machinePrecision = Number.EPSILON * COMPARISON_ULPS * scale;

  if (Math.abs(difference) <= machinePrecision) {
    return 0;
  }

  return difference < 0 ? -1 : 1;
}

function isLane(value: number): value is ChartLane {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

function isInsideInclusiveWindow(
  transportTime: number,
  noteTime: number,
  halfWindow: number,
  inputOffset: number,
): boolean {
  const earliest = noteTime - halfWindow + inputOffset;
  const latest = noteTime + halfWindow + inputOffset;

  return (
    compareTimingValues(transportTime, earliest) >= 0 &&
    compareTimingValues(transportTime, latest) <= 0
  );
}

function makeStats(notes: readonly MutableGameNote[]): {
  readonly stats: GamePhaseStats;
  readonly counts: MutableStats;
} {
  const counts: MutableStats = { perfect: 0, good: 0, miss: 0 };

  for (const note of notes) {
    if (note.outcome === 'perfect') {
      counts.perfect += 1;
    } else if (note.outcome === 'good') {
      counts.good += 1;
    } else if (note.outcome === 'miss') {
      counts.miss += 1;
    }
  }

  const totalNotes = counts.perfect + counts.good + counts.miss;
  const accuracy =
    totalNotes === 0
      ? null
      : ((counts.perfect + counts.good) / totalNotes) * 100;

  return {
    counts,
    stats: {
      ...counts,
      accuracy,
    },
  };
}

/** Return the theoretical all-Perfect score for a chart with this many notes. */
export function getTheoreticalMaximumScore(noteCount: number): number {
  if (!Number.isInteger(noteCount) || noteCount < 0) {
    throw new RangeError('Note count must be a non-negative integer.');
  }

  let total = 0;
  for (let index = 0; index < noteCount; index += 1) {
    const multiplier = Math.min(
      MAX_SCORE_MULTIPLIER,
      Math.floor(index / 10) + 1,
    );
    total += BASE_PERFECT_SCORE * multiplier;
  }
  return total;
}

function multiplierForNextHit(combo: number): number {
  return Math.min(
    MAX_SCORE_MULTIPLIER,
    Math.floor(combo / 10) + 1,
  );
}

function copyResult(result: GameResult | null): GameResult | null {
  if (result === null) {
    return null;
  }

  return {
    audience: { ...result.audience },
    twilight: { ...result.twilight },
    overall: { ...result.overall },
    renown: result.renown,
    personalStrength: result.personalStrength,
    twilightStrength: result.twilightStrength,
    difficulty: result.difficulty,
    outcome: result.outcome,
    score: result.score,
    combo: result.combo,
    multiplier: result.multiplier,
    normalMaximum: result.normalMaximum,
  };
}

/** Create a deterministic game model with an input offset frozen for this run. */
export function createGame(
  chart: ChartConfig,
  inputOffset = 0,
  requestedDifficulty?: Difficulty,
  requestedNormalMaximum?: number,
): GameSession {
  if (
    !Number.isFinite(inputOffset) ||
    Math.abs(inputOffset) > MAX_INPUT_OFFSET_SECONDS
  ) {
    throw new RangeError(
      'Input offset must be finite and within +/-0.200 seconds.',
    );
  }

  const chartIssues = validateChart(chart);
  if (chartIssues.length > 0) {
    const summary = chartIssues
      .map((chartIssue) => chartIssue.message)
      .join(' ');
    throw new TypeError(
      `Cannot start a game with an invalid chart. ${summary}`,
    );
  }

  const normalMaximum =
    requestedNormalMaximum ?? getTheoreticalMaximumScore(chart.notes.length);
  if (!Number.isInteger(normalMaximum) || normalMaximum < 0) {
    throw new RangeError('Normal maximum score must be a non-negative integer.');
  }

  const allowedDifficulties = parseAllowedDifficulties(
    chart.allowedDifficulties,
  );
  if (requestedDifficulty !== undefined && !isDifficulty(requestedDifficulty)) {
    throw new RangeError(
      `Unknown difficulty '${String(requestedDifficulty)}'.`,
    );
  }
  const difficulty =
    requestedDifficulty ?? defaultDifficulty(allowedDifficulties);
  if (!allowedDifficulties.includes(difficulty)) {
    throw new RangeError(
      `Difficulty '${difficulty}' is not allowed for this song.`,
    );
  }
  const profile = getDifficultyProfile(difficulty);

  const notes: MutableGameNote[] = chart.notes.map((chartNote) => ({
    id: chartNote.id,
    lane: chartNote.lane,
    time: chartNote.time,
    phase: chartNote.time < chart.twilightAt ? 'audience' : 'twilight',
    outcome: null,
  }));

  let currentTransportTime = 0;
  let phase: GamePhase = 'audience';
  let status: GameStatus = 'playing';
  let victory = false;
  let renown = 0;
  let personalStrength = 0;
  const initialTwilightStrength = getInitialTwilightStrength(chart, difficulty);
  let twilightStrength = initialTwilightStrength;
  let score = 0;
  let combo = 0;
  let boundaryProcessed = false;
  let result: GameResult | null = null;

  function buildResult(outcome: GameOutcome): GameResult {
    const audienceNotes = notes.filter((note) => note.phase === 'audience');
    const twilightNotes = notes.filter((note) => note.phase === 'twilight');
    const audienceStats = makeStats(audienceNotes).stats;
    const twilightStats = makeStats(twilightNotes).stats;
    const overallStats = makeStats(notes).stats;

    return {
      audience: audienceStats,
      twilight: twilightStats,
      overall: overallStats,
      renown,
      personalStrength,
      twilightStrength,
      difficulty,
      outcome,
      score,
      combo,
      multiplier: multiplierForNextHit(combo),
      normalMaximum,
    };
  }

  function finish(outcome: GameOutcome): void {
    if (status === 'results') return;
    status = 'results';
    result = buildResult(outcome);
  }

  function isFinished(): boolean {
    return status === 'results';
  }

  function applyTwilightOutcome(outcome: NoteOutcome): void {
    if (outcome === null || victory) return;
    const balance = profile.twilight[outcome];
    personalStrength = Math.max(0, personalStrength - balance.personalCost);
    twilightStrength = Math.max(0, twilightStrength - balance.damage);

    // When one hit exhausts both strengths, victory takes precedence.
    if (twilightStrength === 0) victory = true;
    else if (personalStrength === 0) finish('defeat');
  }

  function resolveMiss(note: MutableGameNote): void {
    if (note.outcome === null) {
      note.outcome = 'miss';
      combo = 0;
      if (note.phase === 'audience') {
        renown = Math.max(0, renown + profile.audience.miss);
      }
    }
  }

  function processBoundary(): void {
    if (boundaryProcessed) {
      return;
    }

    boundaryProcessed = true;
    phase = 'twilight';
    personalStrength = renown;
    if (personalStrength === 0) finish('defeat');
  }

  function processEventsThrough(targetTime: number): void {
    const events: GameEvent[] = [];

    if (!boundaryProcessed) {
      events.push({
        kind: 'boundary',
        time: chart.twilightAt,
        order: HANDOFF_EVENT_ORDER,
      });
    }

    for (const note of notes) {
      if (note.outcome === null) {
        events.push({
          kind: 'miss',
          time: note.time + profile.timing.goodWindowSeconds + inputOffset,
          order: MISS_EVENT_ORDER,
          note,
        });
      }
    }

    events.push({
      kind: 'end',
      time: chart.duration,
      order: END_EVENT_ORDER,
    });

    events.sort((left, right) => {
      if (left.time < right.time) {
        return -1;
      }
      if (left.time > right.time) {
        return 1;
      }
      return left.order - right.order;
    });

    for (const event of events) {
      if (status === 'results') {
        break;
      }

      if (event.kind === 'miss') {
        if (compareTimingValues(targetTime, event.time) > 0) {
          if (event.note.outcome === null) {
            resolveMiss(event.note);
            if (event.note.phase === 'twilight') {
              applyTwilightOutcome('miss');
              if (isFinished()) currentTransportTime = event.time;
            }
          }
        }
      } else if (compareTimingValues(targetTime, event.time) >= 0) {
        if (event.kind === 'boundary') {
          processBoundary();
          if (isFinished()) currentTransportTime = event.time;
        } else {
          currentTransportTime = chart.duration;
          finish(victory ? 'victory' : 'survived');
        }
      }
    }
  }

  function validateTransportTime(transportTime: number): void {
    if (
      !Number.isFinite(transportTime) ||
      transportTime < 0 ||
      transportTime > chart.duration ||
      transportTime < currentTransportTime
    ) {
      throw new RangeError(
        'Transport time must be finite, monotonic, and within the excerpt.',
      );
    }
  }

  function snapshot(): GameSnapshot {
    return {
      transportTime: currentTransportTime,
      phase,
      status,
      victory,
      renown,
      personalStrength,
      twilightStrength,
      initialTwilightStrength,
      difficulty,
      score,
      combo,
      multiplier: multiplierForNextHit(combo),
      normalMaximum,
      notes: notes.map((note) => ({
        id: note.id,
        lane: note.lane,
        phase: note.phase,
        outcome: note.outcome,
      })),
      result: copyResult(result),
    };
  }

  function advanceTo(transportTime: number): GameSnapshot {
    validateTransportTime(transportTime);

    if (status === 'playing') {
      processEventsThrough(transportTime);
      if (status === 'playing') {
        currentTransportTime = transportTime;
      }
    }

    return snapshot();
  }

  return {
    snapshot,
    advanceTo,
    press(lane, transportTime) {
      if (!isLane(lane)) {
        throw new RangeError('Lane must be one of 0, 1, 2, or 3.');
      }
      validateTransportTime(transportTime);
      advanceTo(transportTime);

      if (status === 'results') {
        return null;
      }

      let selected: MutableGameNote | null = null;
      let selectedError = 0;
      let selectedDistance = Number.POSITIVE_INFINITY;

      for (const note of notes) {
        if (
          note.outcome !== null ||
          note.lane !== lane ||
          !isInsideInclusiveWindow(
            transportTime,
            note.time,
            profile.timing.goodWindowSeconds,
            inputOffset,
          )
        ) {
          continue;
        }

        const timingError = transportTime - inputOffset - note.time;
        const distance = Math.abs(timingError);
        if (selected === null) {
          selected = note;
          selectedError = timingError;
          selectedDistance = distance;
          continue;
        }

        const timestampScale = Math.max(
          Math.abs(transportTime),
          Math.abs(note.time),
          Math.abs(selected.time),
        );
        const distanceComparison = compareTimingValues(
          distance,
          selectedDistance,
          timestampScale,
        );

        if (
          distanceComparison < 0 ||
          (distanceComparison === 0 && note.time < selected.time)
        ) {
          selected = note;
          selectedError = timingError;
          selectedDistance = distance;
        }
      }

      if (selected === null) {
        return null;
      }

      const quality: HitQuality = isInsideInclusiveWindow(
        transportTime,
        selected.time,
        profile.timing.perfectWindowSeconds,
        inputOffset,
      )
        ? 'perfect'
        : 'good';

      selected.outcome = quality;
      const absoluteError = Math.abs(selectedError);
      const basePoints =
        quality === 'perfect'
          ? BASE_PERFECT_SCORE
          : Math.max(
              0,
              (BASE_PERFECT_SCORE *
                (profile.timing.goodWindowSeconds - absoluteError)) /
                (profile.timing.goodWindowSeconds -
                  profile.timing.perfectWindowSeconds),
            );
      const hitMultiplier = multiplierForNextHit(combo);
      // Account only for input-time floating-point cancellation at exact
      // half-point boundaries; the scoring result remains an integer.
      const goodWindowWidth =
        profile.timing.goodWindowSeconds -
        profile.timing.perfectWindowSeconds;
      const roundingTolerance =
        quality === 'good' && goodWindowWidth > 0
          ? (Number.EPSILON *
              COMPARISON_ULPS *
              Math.max(1, Math.abs(transportTime), Math.abs(selected.time)) *
              BASE_PERFECT_SCORE *
              hitMultiplier) /
            goodWindowWidth
          : 0;
      score += Math.round(basePoints * hitMultiplier + roundingTolerance);
      combo += 1;
      if (phase === 'audience') {
        renown += profile.audience[quality];
      } else {
        applyTwilightOutcome(quality);
      }

      return {
        noteId: selected.id,
        quality,
        timingErrorSeconds: selectedError,
      };
    },
  };
}
