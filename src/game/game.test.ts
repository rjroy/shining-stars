import { describe, expect, it } from 'vitest';
import {
  type ChartConfig,
  type ChartLane,
  type ChartNote,
  validateChart,
} from './chart';
import { createGame, type GameSession } from './game';
import { getDifficultyProfile, type Difficulty } from './game-balance';

interface ChartOptions {
  readonly duration?: number;
  readonly twilightAt?: number;
  readonly twilightStrength?: number;
  readonly allowedDifficulties?: readonly TestDifficulty[];
}

type TestDifficulty = Difficulty;

const createGameWithDifficulty = createGame as unknown as (
  chart: ChartConfig,
  inputOffset: number,
  difficulty: TestDifficulty,
) => GameSession;

function makeChart(
  notes: readonly ChartNote[],
  options: ChartOptions = {},
): ChartConfig {
  const chart: ChartConfig = {
    sourceStart: 0,
    duration: options.duration ?? 10,
    twilightAt: options.twilightAt ?? 5,
    twilightStrength: options.twilightStrength ?? 100,
    allowedDifficulties: options.allowedDifficulties ?? ['normal'],
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

function makeDifficultyGame(
  notes: readonly ChartNote[],
  difficulty: TestDifficulty,
  options: ChartOptions = {},
): GameSession {
  return createGameWithDifficulty(
    makeChart(notes, {
      ...options,
      allowedDifficulties: options.allowedDifficulties ?? [difficulty],
    }),
    0,
    difficulty,
  );
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

const exactWindowCases = (['easy', 'normal', 'hard'] as const).flatMap(
  (difficulty) => {
    const { perfectWindowSeconds, goodWindowSeconds } =
      getDifficultyProfile(difficulty).timing;
    return [-0.2, 0, 0.2].flatMap((inputOffset) =>
      [
        { timingError: -goodWindowSeconds, quality: 'good' as const },
        { timingError: -perfectWindowSeconds, quality: 'perfect' as const },
        { timingError: perfectWindowSeconds, quality: 'perfect' as const },
        { timingError: goodWindowSeconds, quality: 'good' as const },
      ].map(({ timingError, quality }) => ({
        difficulty,
        inputOffset,
        timingError,
        quality,
      })),
    );
  },
);

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
    'includes the exact $difficulty timing-window edge at offset $inputOffset and error $timingError',
    ({ difficulty, inputOffset, timingError, quality }) => {
      const game = createGameWithDifficulty(
        makeChart([note('edge', 2)], { allowedDifficulties: [difficulty] }),
        inputOffset,
        difficulty,
      );

      expect(
        game.press(0, physicalPressTime(2, inputOffset, timingError)),
      ).toMatchObject({ noteId: 'edge', quality });
    },
  );

  it.each(['easy', 'normal', 'hard'] as const)(
    'classifies just-outside %s boundaries from its selected profile',
    (difficulty) => {
      const { perfectWindowSeconds, goodWindowSeconds } =
        getDifficultyProfile(difficulty).timing;
      const epsilon = 0.0001;
      const outsidePerfect = makeDifficultyGame(
        [note('outside-perfect', 2)],
        difficulty,
      );
      expect(
        outsidePerfect.press(0, 2 + perfectWindowSeconds + epsilon),
      ).toMatchObject({ noteId: 'outside-perfect', quality: 'good' });

      const outsideGood = makeDifficultyGame(
        [note('outside-good', 2)],
        difficulty,
      );
      expect(outsideGood.press(0, 2 + goodWindowSeconds + epsilon)).toBeNull();
      expect(outsideGood.snapshot().notes[0]?.outcome).toBe('miss');
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
    expect(game.snapshot()).toMatchObject({ renown: 0, personalStrength: 0 });
    expect(game.snapshot().notes).toEqual([
      { id: 'lane-zero', lane: 0, phase: 'audience', outcome: null },
    ]);
    expect(game.press(0, 2)).toMatchObject({
      noteId: 'lane-zero',
      quality: 'perfect',
    });
    expect(game.snapshot()).toMatchObject({ renown: 3, personalStrength: 0 });
  });

  it('keeps the exact offset-adjusted miss deadline eligible and misses only after it', () => {
    const goodWindow = getDifficultyProfile('normal').timing.goodWindowSeconds;
    const inputOffset = 0.2;
    const chart = makeChart([note('deadline', 2)], {
      allowedDifficulties: ['normal'],
    });
    const game = createGameWithDifficulty(chart, inputOffset, 'normal');
    const deadline = physicalPressTime(2, inputOffset, goodWindow);

    game.advanceTo(deadline);
    expect(game.snapshot().notes[0]?.outcome).toBeNull();
    expect(game.press(0, deadline)).toMatchObject({
      noteId: 'deadline',
      quality: 'good',
    });

    const missGame = createGameWithDifficulty(
      makeChart([note('miss-deadline', 2)], { allowedDifficulties: ['normal'] }),
      inputOffset,
      'normal',
    );
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

  it('uses transport time for phase changes and transfers Renown once, including a jump to end', () => {
    const inputOffset = 0.2;
    const game = makeGame(
      [note('audience', 2), note('twilight', 7)],
      inputOffset,
    );

    game.press(0, physicalPressTime(2, inputOffset, 0));
    game.advanceTo(5);
    const atBoundary = game.snapshot();

    expect(atBoundary.phase).toBe('twilight');
    expect(atBoundary).toMatchObject({ renown: 3, personalStrength: 3 });
    game.advanceTo(5);
    expect(game.snapshot().personalStrength).toBe(3);

    game.advanceTo(10);
    expect(game.snapshot().status).toBe('results');
    expect(game.snapshot().result).toMatchObject({
      renown: 3,
      personalStrength: 0,
      twilightStrength: 100,
      outcome: 'defeat',
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
      renown: 3,
      personalStrength: 0,
      notes: [
        { id: 'audience', outcome: 'perfect' },
        { id: 'twilight', outcome: 'miss' },
      ],
      result: {
        renown: 3,
        personalStrength: 0,
        twilightStrength: 100,
        outcome: 'defeat',
      },
    });
  });

  it('keeps audience Renown uncapped and transfers the full total at Twilight', () => {
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
      renown: 180,
    });

    game.advanceTo(60);
    expect(game.snapshot().result).toMatchObject({
      renown: 180,
      personalStrength: 180,
      twilightStrength: 100,
      outcome: 'survived',
    });
  });

  it('applies Twilight combat values to independent strengths', () => {
    const audienceNotes = Array.from({ length: 20 }, (_, index) =>
      note(`audience-${index}`, 1 + index * 0.5),
    );
    const twilightNotes = Array.from({ length: 15 }, (_, index) =>
      note(`twilight-${index}`, 21 + index * 0.5),
    );
    const game = makeGame([...audienceNotes, ...twilightNotes], 0, {
      duration: 40,
      twilightAt: 20,
      twilightStrength: 100,
    });

    for (const audienceNote of audienceNotes) {
      game.press(0, audienceNote.time);
    }
    game.advanceTo(20);
    expect(game.snapshot().personalStrength).toBe(60);
    expect(game.snapshot().twilightStrength).toBe(100);

    for (const twilightNote of twilightNotes) {
      game.press(0, twilightNote.time);
    }
    expect(game.snapshot().personalStrength).toBe(60);
    expect(game.snapshot().twilightStrength).toBe(55);
  });

  it('defeats an all-miss run at the zero-Renown handoff', () => {
    const game = makeGame([note('audience-miss', 2), note('twilight-miss', 7)]);

    game.advanceTo(10);

    expect(game.snapshot()).toMatchObject({
      status: 'results',
      renown: 0,
      personalStrength: 0,
      twilightStrength: 100,
      result: { outcome: 'defeat' },
      notes: [
        { id: 'audience-miss', phase: 'audience', outcome: 'miss' },
        { id: 'twilight-miss', phase: 'twilight', outcome: null },
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
      outcome: 'survived',
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
    expect(firstRun.snapshot()).toMatchObject({
      renown: 3,
      personalStrength: 0,
    });
    const nextRun = createGame(chart);

    expect(nextRun.snapshot()).toMatchObject({
      transportTime: 0,
      status: 'playing',
      renown: 0,
      personalStrength: 0,
      twilightStrength: 100,
      notes: [{ id: 'audience', phase: 'audience', outcome: null }],
    });
  });

  it.each(['easy', 'normal', 'hard'] as const)(
    '$difficulty uses inclusive Perfect/Good edges and misses only after its Good edge',
    (difficulty) => {
      const { perfectWindowSeconds: perfect, goodWindowSeconds: good } =
        getDifficultyProfile(difficulty).timing;
      for (const [error, quality] of [
        [-good, 'good'],
        [-perfect, 'perfect'],
        [perfect, 'perfect'],
        [good, 'good'],
      ] as const) {
        const game = makeDifficultyGame([note('edge', 2)], difficulty);
        expect(game.snapshot().twilightStrength).toBe(100);
        expect(game.press(0, 2 + error)).toMatchObject({
          noteId: 'edge',
          quality,
        });
        expect(game.snapshot()).toHaveProperty('difficulty', difficulty);
      }

      const outsidePerfect = makeDifficultyGame(
        [note('outside-perfect', 2)],
        difficulty,
      );
      expect(outsidePerfect.press(0, 2 + perfect + 0.0001)).toMatchObject({
        noteId: 'outside-perfect',
        quality: 'good',
      });

      const lateGame = makeDifficultyGame([note('deadline', 2)], difficulty);
      expect(lateGame.press(0, 2 + good + 0.0001)).toBeNull();
      expect(lateGame.snapshot().notes[0]?.outcome).toBe('miss');
    },
  );

  it('selects the nearest overlapping Easy note and breaks an exact tie earlier', () => {
    const easy = makeDifficultyGame(
      [note('earlier', 2), note('later', 2.24)],
      'easy',
    );

    const midpoint = (2 + 2.24) / 2;
    expect(easy.press(0, midpoint)).toMatchObject({
      noteId: 'earlier',
      quality: 'good',
    });
    expect(easy.press(0, midpoint)).toMatchObject({ noteId: 'later' });

    const hard = makeDifficultyGame(
      [note('earlier', 2), note('later', 2.24)],
      'hard',
    );
    expect(hard.press(0, midpoint)).toBeNull();
  });

  it.each(['easy', 'normal', 'hard'] as const)(
    '%s applies its shared Audience rewards and Twilight combat values',
    (difficulty) => {
      const profile = getDifficultyProfile(difficulty);
      const { perfectWindowSeconds, goodWindowSeconds } = profile.timing;
      const audiencePerfect = profile.audience.perfect;
      const audienceGood = profile.audience.good;
      const goodCost = profile.twilight.good.personalCost;
      const missCost = profile.twilight.miss.personalCost;
      const goodDamage = profile.twilight.good.damage;
      const perfectDamage = profile.twilight.perfect.damage;
      const expectedRenown = audiencePerfect + audienceGood;
      const goodOffset = (perfectWindowSeconds + goodWindowSeconds) / 2;
      const game = makeDifficultyGame(
        [
          note('audience-perfect', 1),
          note('audience-good', 2),
          note('audience-miss', 3),
          note('twilight-good', 6.3),
          note('twilight-perfect', 7.3),
          note('twilight-miss', 8.3),
        ],
        difficulty,
      );

      expect(game.press(0, 1)?.quality).toBe('perfect');
      expect(game.press(0, 2 + goodOffset)?.quality).toBe('good');
      const goodWindow = goodWindowSeconds;
      game.advanceTo(3 + goodWindow + 0.001);
      const audienceSnapshot = game.snapshot();
      expect(audienceSnapshot).toMatchObject({
        renown: audiencePerfect + audienceGood,
      });
      expect(
        audienceSnapshot.notes
          .slice(0, 3)
          .map(({ id, outcome }) => ({ id, outcome })),
      ).toEqual([
        { id: 'audience-perfect', outcome: 'perfect' },
        { id: 'audience-good', outcome: 'good' },
        { id: 'audience-miss', outcome: 'miss' },
      ]);

      game.advanceTo(5);
      expect(game.snapshot().personalStrength).toBe(expectedRenown);
      expect(game.press(0, 6.3 + goodOffset)?.quality).toBe('good');
      expect(game.press(0, 7.3)?.quality).toBe('perfect');
      game.advanceTo(8.3 + goodWindow + 0.001);
      expect(game.snapshot()).toMatchObject({
        renown: expectedRenown,
        personalStrength: Math.max(0, expectedRenown - goodCost - missCost),
        twilightStrength: 100 - goodDamage - perfectDamage,
        notes: [
          { id: 'audience-perfect', outcome: 'perfect' },
          { id: 'audience-good', outcome: 'good' },
          { id: 'audience-miss', outcome: 'miss' },
          { id: 'twilight-good', outcome: 'good' },
          { id: 'twilight-perfect', outcome: 'perfect' },
          { id: 'twilight-miss', outcome: 'miss' },
        ],
      });
    },
  );

  it('defaults to Normal when allowed and the first declared profile otherwise', () => {
    const normalFirst = makeChart([note('normal-default', 2)], {
      allowedDifficulties: ['hard', 'normal'],
    });
    expect(createGame(normalFirst).snapshot()).toHaveProperty(
      'difficulty',
      'normal',
    );

    const declaredFirst = makeChart([note('first-default', 2)], {
      allowedDifficulties: ['hard', 'easy'],
    });
    expect(createGame(declaredFirst).snapshot()).toHaveProperty(
      'difficulty',
      'hard',
    );
  });

  it('rejects a difficulty not allowed for the chart', () => {
    const normalHardChart = makeChart([note('allowed', 2)], {
      allowedDifficulties: ['normal', 'hard'],
    });

    expect(() =>
      createGameWithDifficulty(normalHardChart, 0, 'easy'),
    ).toThrow();
    expect(() =>
      createGameWithDifficulty(normalHardChart, 0, 'expert' as TestDifficulty),
    ).toThrow();
  });
});
