import { validateChart, type ChartConfig, type ChartLane } from './chart';

export type GamePhase = 'audience' | 'twilight';
export type GameStatus = 'playing' | 'results';
export type HitQuality = 'perfect' | 'good';
export type NoteOutcome = HitQuality | 'miss' | null;

export interface GameNoteState {
  readonly id: string;
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
  readonly resonanceEarned: number;
  readonly resonanceSpent: number;
  readonly resonanceDiscarded: number;
  readonly cityAnswer: number;
}

export interface GameSnapshot {
  readonly transportTime: number;
  readonly phase: GamePhase;
  readonly status: GameStatus;
  readonly resonance: number;
  readonly resonanceEarned: number;
  readonly cityAnswer: number;
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

const PERFECT_WINDOW_SECONDS = 0.075;
const GOOD_WINDOW_SECONDS = 0.15;
const MAX_INPUT_OFFSET_SECONDS = 0.2;
const MISS_EVENT_ORDER = 1;
const HANDOFF_EVENT_ORDER = 0;
const END_EVENT_ORDER = 2;
const RESONANCE_CAP = 100;
const RESONANCE_SPEND_CAP = 40;
const CITY_ANSWER_CAP = 100;
const CITY_ANSWER_PER_RESONANCE = 2;
const RESOURCE_PER_HIT = 2;
const COMPARISON_ULPS = 8;

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

  const totalNotes = notes.length;
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

function copyResult(result: GameResult | null): GameResult | null {
  if (result === null) {
    return null;
  }

  return {
    audience: { ...result.audience },
    twilight: { ...result.twilight },
    overall: { ...result.overall },
    resonanceEarned: result.resonanceEarned,
    resonanceSpent: result.resonanceSpent,
    resonanceDiscarded: result.resonanceDiscarded,
    cityAnswer: result.cityAnswer,
  };
}

/** Create a deterministic game model with an input offset frozen for this run. */
export function createGame(chart: ChartConfig, inputOffset = 0): GameSession {
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
  let resonance = 0;
  let resonanceEarned = 0;
  let resonanceSpent = 0;
  let resonanceDiscarded = 0;
  let cityAnswer = 0;
  let boundaryProcessed = false;
  let result: GameResult | null = null;

  function buildResult(): GameResult {
    const audienceNotes = notes.filter((note) => note.phase === 'audience');
    const twilightNotes = notes.filter((note) => note.phase === 'twilight');
    const audienceStats = makeStats(audienceNotes).stats;
    const twilightStats = makeStats(twilightNotes).stats;
    const overallStats = makeStats(notes).stats;

    return {
      audience: audienceStats,
      twilight: twilightStats,
      overall: overallStats,
      resonanceEarned,
      resonanceSpent,
      resonanceDiscarded,
      cityAnswer,
    };
  }

  function resolveMiss(note: MutableGameNote): void {
    if (note.outcome === null) {
      note.outcome = 'miss';
    }
  }

  function processBoundary(): void {
    if (boundaryProcessed) {
      return;
    }

    boundaryProcessed = true;
    phase = 'twilight';
    resonanceSpent = Math.min(resonance, RESONANCE_SPEND_CAP);
    resonanceDiscarded = resonance - resonanceSpent;
    resonance = 0;
    cityAnswer = Math.min(
      CITY_ANSWER_CAP,
      cityAnswer + resonanceSpent * CITY_ANSWER_PER_RESONANCE,
    );
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
          time: note.time + GOOD_WINDOW_SECONDS + inputOffset,
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
          resolveMiss(event.note);
        }
      } else if (compareTimingValues(targetTime, event.time) >= 0) {
        if (event.kind === 'boundary') {
          processBoundary();
        } else {
          for (const note of notes) {
            resolveMiss(note);
          }
          currentTransportTime = chart.duration;
          status = 'results';
          result = buildResult();
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
      resonance,
      resonanceEarned,
      cityAnswer,
      notes: notes.map((note) => ({
        id: note.id,
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
            GOOD_WINDOW_SECONDS,
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
        PERFECT_WINDOW_SECONDS,
        inputOffset,
      )
        ? 'perfect'
        : 'good';

      selected.outcome = quality;
      if (phase === 'audience') {
        const previousResonance = resonance;
        resonance = Math.min(RESONANCE_CAP, resonance + RESOURCE_PER_HIT);
        resonanceEarned += resonance - previousResonance;
      } else {
        cityAnswer = Math.min(CITY_ANSWER_CAP, cityAnswer + RESOURCE_PER_HIT);
      }

      return {
        noteId: selected.id,
        quality,
        timingErrorSeconds: selectedError,
      };
    },
  };
}
