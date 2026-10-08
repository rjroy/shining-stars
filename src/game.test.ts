import { describe, expect, it } from 'vitest';
import {
  type ChartConfig,
  type ChartLane,
  type ChartNote,
  validateChart,
} from './chart';
import { createGame, type GameSession, type HitQuality } from './game';

interface ChartOptions {
  readonly duration?: number;
  readonly twilightAt?: number;
}

function makeChart(
  notes: readonly ChartNote[],
  options: ChartOptions = {},
): ChartConfig {
  const chart: ChartConfig = {
    sourceStart: 0,
    duration: options.duration ?? 10,
    twilightAt: options.twilightAt ?? 5,
    notes,
  };

  expect(validateChart(chart)).toEqual([]);
  return chart;
}

function makeGame(
  notes: readonly ChartNote[],
  inputOffset = 0,
  options: ChartOptions = {},
): GameSession {
  return createGame(makeChart(notes, options), inputOffset);
}

function note(id: string, time: number, lane: ChartLane = 0): ChartNote {
  return { id, time, lane };
}

function physicalPressTime(
  noteTime: number,
  inputOffset: number,
  timingError: number,
): number {
  return noteTime + timingError + inputOffset;
}

const exactWindowCases: readonly {
  readonly inputOffset: number;
  readonly timingError: number;
  readonly quality: HitQuality;
}[] = [
  { inputOffset: -0.2, timingError: -0.15, quality: 'good' },
  { inputOffset: -0.2, timingError: -0.075, quality: 'perfect' },
  { inputOffset: -0.2, timingError: 0.075, quality: 'perfect' },
  { inputOffset: -0.2, timingError: 0.15, quality: 'good' },
  { inputOffset: 0, timingError: -0.15, quality: 'good' },
  { inputOffset: 0, timingError: -0.075, quality: 'perfect' },
  { inputOffset: 0, timingError: 0.075, quality: 'perfect' },
  { inputOffset: 0, timingError: 0.15, quality: 'good' },
  { inputOffset: 0.2, timingError: -0.15, quality: 'good' },
  { inputOffset: 0.2, timingError: -0.075, quality: 'perfect' },
  { inputOffset: 0.2, timingError: 0.075, quality: 'perfect' },
  { inputOffset: 0.2, timingError: 0.15, quality: 'good' },
];

describe('game model', () => {
  it.each([-0.2, 0.2])(
    'applies the frozen input-offset sign (%s seconds)',
    (inputOffset) => {
      const game = makeGame([note('center', 2)], inputOffset);

      expect(game.press(0, physicalPressTime(2, inputOffset, 0))).toMatchObject(
        {
          noteId: 'center',
          quality: 'perfect',
        },
      );
    },
  );

  it.each(exactWindowCases)(
    'includes the exact timing-window edge at offset $inputOffset and error $timingError',
    ({ inputOffset, timingError, quality }) => {
      const game = makeGame([note('edge', 2)], inputOffset);

      expect(
        game.press(0, physicalPressTime(2, inputOffset, timingError)),
      ).toMatchObject({ noteId: 'edge', quality });
    },
  );

  it('selects the nearest unresolved same-lane note and resolves only one per press', () => {
    const game = makeGame([note('earlier', 2), note('later', 2.2)]);

    expect(game.press(0, 2.1)).toMatchObject({ noteId: 'earlier' });
    expect(game.press(0, 2.1)).toMatchObject({ noteId: 'later' });
    expect(game.press(0, 2.1)).toBeNull();
  });

  it('breaks a floating-point midpoint tie by choosing the earlier note', () => {
    const game = makeGame(
      [note('earlier-midpoint', 40.1), note('later-midpoint', 40.3)],
      0,
      { duration: 60, twilightAt: 50 },
    );

    expect(game.press(0, 40.2)).toMatchObject({
      noteId: 'earlier-midpoint',
    });
  });

  it('chooses the genuinely nearer later note rather than widening the tie', () => {
    const game = makeGame(
      [note('earlier-near', 40.1), note('later-near', 40.3)],
      0,
      { duration: 60, twilightAt: 50 },
    );

    expect(game.press(0, 40.21)).toMatchObject({ noteId: 'later-near' });
  });

  it('does not penalize an unmatched lane press', () => {
    const game = makeGame([note('lane-zero', 2)]);

    expect(game.press(1, 2)).toBeNull();
    expect(game.snapshot()).toMatchObject({ resonance: 0, resonanceEarned: 0 });
    expect(game.snapshot().notes).toEqual([
      { id: 'lane-zero', phase: 'audience', outcome: null },
    ]);
    expect(game.press(0, 2)).toMatchObject({
      noteId: 'lane-zero',
      quality: 'perfect',
    });
    expect(game.snapshot()).toMatchObject({ resonance: 2, resonanceEarned: 2 });
  });

  it('keeps the exact offset-adjusted miss deadline eligible and misses only after it', () => {
    const inputOffset = 0.2;
    const game = makeGame([note('deadline', 2)], inputOffset);
    const deadline = physicalPressTime(2, inputOffset, 0.15);

    game.advanceTo(deadline);
    expect(game.snapshot().notes[0]?.outcome).toBeNull();
    expect(game.press(0, deadline)).toMatchObject({
      noteId: 'deadline',
      quality: 'good',
    });

    const missGame = makeGame([note('miss-deadline', 2)], inputOffset);
    missGame.advanceTo(deadline + 0.0001);
    expect(missGame.snapshot().notes[0]?.outcome).toBe('miss');
  });

  it('requires finite monotonic transport time within the excerpt', () => {
    const game = makeGame([note('clock', 2)]);

    expect(game.advanceTo(0.5).transportTime).toBe(0.5);
    expect(() => game.advanceTo(0.4)).toThrow(RangeError);
    expect(() => game.advanceTo(-0.001)).toThrow(RangeError);
    expect(() => game.advanceTo(10.001)).toThrow(RangeError);
    expect(() => game.advanceTo(Number.NaN)).toThrow(RangeError);
    expect(() => game.advanceTo(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => game.press(0, Number.NaN)).toThrow(RangeError);
    expect(() => game.press(0, 10.001)).toThrow(RangeError);
  });

  it.each([-0.2001, 0.2001, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an unsupported frozen input offset (%s)',
    (inputOffset) => {
      const chart = makeChart([note('offset', 2)]);

      expect(() => createGame(chart, inputOffset)).toThrow(RangeError);
    },
  );

  it('uses transport time for phase changes and transfers Resonance once, including a jump to end', () => {
    const inputOffset = 0.2;
    const game = makeGame(
      [note('audience', 2), note('twilight', 7)],
      inputOffset,
    );

    game.press(0, physicalPressTime(2, inputOffset, 0));
    game.advanceTo(5);
    const atBoundary = game.snapshot();

    expect(atBoundary.phase).toBe('twilight');
    expect(atBoundary).toMatchObject({ resonance: 0, cityAnswer: 4 });
    game.advanceTo(5);
    expect(game.snapshot().cityAnswer).toBe(4);

    game.advanceTo(10);
    expect(game.snapshot().status).toBe('results');
    expect(game.snapshot().result).toMatchObject({
      resonanceEarned: 2,
      resonanceSpent: 2,
      resonanceDiscarded: 0,
      cityAnswer: 4,
    });
  });

  it('produces identical results for sparse and frequent chronological advances', () => {
    const chartNotes = [note('audience', 2), note('twilight', 7)];
    const sparse = makeGame(chartNotes, 0.2);
    const frequent = makeGame(chartNotes, 0.2);

    for (const game of [sparse, frequent]) {
      game.press(0, physicalPressTime(2, 0.2, 0));
    }

    sparse.advanceTo(10);
    for (let time = 2.25; time < 10; time += 0.25) {
      frequent.advanceTo(time);
    }
    frequent.advanceTo(10);

    expect(sparse.snapshot()).toEqual(frequent.snapshot());
    expect(sparse.snapshot()).toMatchObject({
      status: 'results',
      resonanceEarned: 2,
      cityAnswer: 4,
      notes: [
        { id: 'audience', outcome: 'perfect' },
        { id: 'twilight', outcome: 'miss' },
      ],
      result: {
        resonanceEarned: 2,
        resonanceSpent: 2,
        resonanceDiscarded: 0,
        cityAnswer: 4,
      },
    });
  });

  it('caps audience Resonance at 100 and reports only actually earned points', () => {
    const audienceNotes = Array.from({ length: 60 }, (_, index) =>
      note(`audience-${index}`, 1 + index * 0.5),
    );
    const game = makeGame(audienceNotes, 0, {
      duration: 60,
      twilightAt: 40,
    });

    for (const audienceNote of audienceNotes) {
      game.press(0, audienceNote.time);
    }
    expect(game.snapshot()).toMatchObject({
      resonance: 100,
      resonanceEarned: 100,
    });

    game.advanceTo(60);
    expect(game.snapshot().result).toMatchObject({
      resonanceEarned: 100,
      resonanceSpent: 40,
      resonanceDiscarded: 60,
      cityAnswer: 80,
    });
  });

  it('adds two City Answer per Twilight hit and caps City Answer at 100', () => {
    const audienceNotes = Array.from({ length: 20 }, (_, index) =>
      note(`audience-${index}`, 1 + index * 0.5),
    );
    const twilightNotes = Array.from({ length: 15 }, (_, index) =>
      note(`twilight-${index}`, 21 + index * 0.5),
    );
    const game = makeGame([...audienceNotes, ...twilightNotes], 0, {
      duration: 40,
      twilightAt: 20,
    });

    for (const audienceNote of audienceNotes) {
      game.press(0, audienceNote.time);
    }
    game.advanceTo(20);
    expect(game.snapshot().cityAnswer).toBe(80);

    for (const twilightNote of twilightNotes) {
      game.press(0, twilightNote.time);
    }
    expect(game.snapshot().cityAnswer).toBe(100);
  });

  it('completes an all-miss run without surrender and leaves resources unchanged', () => {
    const game = makeGame([note('audience-miss', 2), note('twilight-miss', 7)]);

    game.advanceTo(10);

    expect(game.snapshot()).toMatchObject({
      status: 'results',
      resonance: 0,
      resonanceEarned: 0,
      cityAnswer: 0,
      notes: [
        { id: 'audience-miss', phase: 'audience', outcome: 'miss' },
        { id: 'twilight-miss', phase: 'twilight', outcome: 'miss' },
      ],
    });
  });

  it('counts Perfect and Good equally for per-phase and overall accuracy', () => {
    const game = makeGame([
      note('perfect', 2),
      note('good', 3),
      note('twilight-miss', 7),
    ]);

    game.press(0, 2);
    game.press(0, 3.1);
    game.advanceTo(10);

    expect(game.snapshot().result).toMatchObject({
      audience: { perfect: 1, good: 1, miss: 0, accuracy: 100 },
      twilight: { perfect: 0, good: 0, miss: 1, accuracy: 0 },
      overall: {
        perfect: 1,
        good: 1,
        miss: 1,
        accuracy: (2 / 3) * 100,
      },
    });
  });

  it('reports null accuracy for phases and runs with no charted notes', () => {
    const game = makeGame([]);

    game.advanceTo(10);

    expect(game.snapshot().result).toMatchObject({
      audience: { accuracy: null },
      twilight: { accuracy: null },
      overall: { accuracy: null },
    });
  });

  it('keeps Playing through the audio tail and freezes results only at excerpt end', () => {
    const game = makeGame([note('last-note', 2)]);

    game.press(0, 2);
    expect(game.snapshot()).toMatchObject({ status: 'playing', result: null });

    game.advanceTo(10);
    const finalSnapshot = game.snapshot();
    expect(finalSnapshot.status).toBe('results');
    expect(game.press(0, 10)).toBeNull();
    expect(game.snapshot()).toEqual(finalSnapshot);
  });

  it('creates a fresh run from the factory without carrying prior resources', () => {
    const chart = makeChart([note('audience', 2)]);
    const firstRun = createGame(chart);

    firstRun.press(0, 2);
    expect(firstRun.snapshot()).toMatchObject({ resonance: 2, cityAnswer: 0 });
    const nextRun = createGame(chart);

    expect(nextRun.snapshot()).toMatchObject({
      transportTime: 0,
      status: 'playing',
      resonance: 0,
      resonanceEarned: 0,
      cityAnswer: 0,
      notes: [{ id: 'audience', phase: 'audience', outcome: null }],
    });
  });
});
