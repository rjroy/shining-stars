import { describe, expect, it } from 'vitest';
import type { ChartConfig, ChartLane, ChartNote } from './chart';
import { createGame } from './game';
import { getDifficultyProfile } from './game-balance';

interface RenownChartOptions {
  readonly duration?: number;
  readonly twilightAt?: number;
}

function chart(
  notes: readonly ChartNote[],
  options: RenownChartOptions = {},
): ChartConfig {
  return {
    sourceStart: 0,
    duration: options.duration ?? 12,
    twilightAt: options.twilightAt ?? 5,
    allowedDifficulties: ['normal'],
    notes,
  };
}

function note(id: string, time: number, lane: ChartLane = 0): ChartNote {
  return { id, time, lane };
}

function deriveInitialStrength(notes: readonly ChartNote[]): number {
  const profile = getDifficultyProfile('normal');
  const twilightNotes = notes.filter(({ time }) => time >= 5).length;
  return Math.ceil(
    twilightNotes *
      profile.twilight.perfect.damage *
      (profile.twilightStrengthPercent / 100),
  );
}

describe('Renown and Twilight Strength model', () => {
  it('awards audience Renown by quality without an upper cap', () => {
    const audienceNotes = Array.from({ length: 40 }, (_, index) =>
      note(`audience-${index}`, 0.5 + index * 0.5),
    );
    const game = createGame(
      chart(audienceNotes, { duration: 30, twilightAt: 25 }),
    );

    for (const audienceNote of audienceNotes) {
      game.press(0, audienceNote.time);
    }

    expect(game.snapshot().renown).toBe(120);
  });

  it('hands off all audience Renown as Personal Strength and starts derived Twilight Strength', () => {
    const chartNotes = [note('audience', 2), note('twilight', 7)];
    const game = createGame(chart(chartNotes));
    game.press(0, 2);

    expect(game.snapshot().renown).toBe(3);
    game.advanceTo(5);

    expect(game.snapshot()).toMatchObject({
      phase: 'twilight',
      personalStrength: 3,
      twilightStrength: deriveInitialStrength(chartNotes),
    });
  });

  it('awards no Renown for an Audience miss', () => {
    const game = createGame(chart([note('audience-miss', 2)]));
    game.advanceTo(2.151);

    expect(game.snapshot()).toMatchObject({
      renown: 0,
      notes: [{ id: 'audience-miss', outcome: 'miss' }],
    });
  });

  it('applies Twilight miss, good, and perfect effects to separate strengths', () => {
    const missChartNotes = [note('audience', 2), note('twilight-miss', 7)];
    const missed = createGame(chart(missChartNotes));
    missed.press(0, 2);
    missed.advanceTo(5);
    missed.advanceTo(7.151);
    expect(missed.snapshot()).toMatchObject({
      personalStrength: 0,
      twilightStrength: Math.max(
        0,
        deriveInitialStrength(missChartNotes) -
          getDifficultyProfile('normal').twilight.miss.damage,
      ),
      result: { outcome: 'defeat' },
    });

    const goodChartNotes = [
      note('audience-one', 2),
      note('audience-two', 3),
      note('twilight-good', 7),
    ];
    const good = createGame(chart(goodChartNotes));
    good.press(0, 2);
    good.press(0, 3);
    good.advanceTo(5);
    good.press(0, 7.1);
    expect(good.snapshot()).toMatchObject({
      personalStrength: 3,
      twilightStrength:
        deriveInitialStrength(goodChartNotes) -
        getDifficultyProfile('normal').twilight.good.damage,
      status: 'playing',
    });

    const perfect = createGame(
      chart([note('audience', 2), note('twilight-perfect', 7)]),
    );
    perfect.press(0, 2);
    perfect.advanceTo(5);
    perfect.press(0, 7);
    expect(perfect.snapshot()).toMatchObject({
      victory: true,
      status: 'playing',
      personalStrength: 3,
      twilightStrength: 0,
      result: null,
    });
    perfect.advanceTo(12);
    expect(perfect.snapshot().result).toMatchObject({ outcome: 'victory' });
  });

  it('uses victory precedence when good hits deplete both strengths together', () => {
    const combatNotes = [
      note('twilight-perfect-one', 6),
      note('twilight-perfect-two', 6.5),
      note('twilight-good-one', 7),
      note('twilight-good-two', 9),
    ];
    const game = createGame(
      chart([
        note('audience-perfect-one', 2),
        note('audience-perfect-two', 3),
        ...combatNotes,
      ]),
    );
    game.press(0, 2);
    game.press(0, 3); // Two Perfect hits provide six strength for two Good costs.
    game.advanceTo(5);
    game.press(0, 6);
    game.press(0, 6.5);
    const initialStrength = deriveInitialStrength(combatNotes);
    const profile = getDifficultyProfile('normal');
    expect(game.snapshot()).toMatchObject({
      personalStrength: 6,
      twilightStrength: initialStrength - 2 * profile.twilight.perfect.damage,
    });
    game.press(0, 7.1);
    expect(game.snapshot()).toMatchObject({
      personalStrength: 3,
      twilightStrength:
        initialStrength -
        2 * profile.twilight.perfect.damage -
        profile.twilight.good.damage,
    });
    game.press(0, 9.1);

    expect(game.snapshot()).toMatchObject({
      victory: true,
      status: 'playing',
      personalStrength: 0,
      twilightStrength: 0,
      result: null,
    });
    game.advanceTo(12);
    expect(game.snapshot().result).toMatchObject({ outcome: 'victory' });
  });

  it('defeats a run with zero Renown at handoff', () => {
    const game = createGame(chart([note('future-twilight', 7)]));
    game.advanceTo(5);
    expect(game.snapshot().twilightStrength).toBe(
      deriveInitialStrength([note('future-twilight', 7)]),
    );

    expect(game.snapshot()).toMatchObject({
      phase: 'twilight',
      status: 'results',
      victory: false,
      personalStrength: 0,
      twilightStrength: deriveInitialStrength([note('future-twilight', 7)]),
      result: { outcome: 'defeat' },
      notes: [{ id: 'future-twilight', outcome: null }],
    });
  });

  it('ends naturally as survived when both strengths remain', () => {
    const survivalNotes = [
      note('audience-one', 2),
      note('audience-two', 3),
      note('combat-miss', 7),
    ];
    const game = createGame(chart(survivalNotes, { duration: 12 }));
    game.press(0, 2);
    game.press(0, 3);
    game.advanceTo(5);
    game.advanceTo(12);

    expect(game.snapshot()).toMatchObject({
      status: 'results',
      renown: 6,
      personalStrength: 2,
      twilightStrength:
        deriveInitialStrength(survivalNotes) -
        getDifficultyProfile('normal').twilight.miss.damage,
      notes: [
        { id: 'audience-one', outcome: 'perfect' },
        { id: 'audience-two', outcome: 'perfect' },
        { id: 'combat-miss', outcome: 'miss' },
      ],
      result: {
        outcome: 'survived',
        twilight: { perfect: 0, good: 0, miss: 1, accuracy: 0 },
        overall: { perfect: 2, miss: 1, accuracy: (2 / 3) * 100 },
      },
    });
  });

  it('continues judging after combat victory, freezes strengths, then wins at excerpt end', () => {
    const chartNotes = [
      note('audience', 2),
      ...Array.from({ length: 7 }, (_, index) =>
        note(`setup-${index}`, 6 + index * 0.25),
      ),
      note('victory-hit', 7.75),
      note('post-victory-hit', 9, 1),
      note('post-victory-miss', 10, 2),
    ];
    const game = createGame(chart(chartNotes));
    expect(game.snapshot()).toMatchObject({
      victory: false,
      status: 'playing',
    });
    game.press(0, 2);
    game.advanceTo(5);
    const initialStrength = deriveInitialStrength(chartNotes);
    expect(game.snapshot().twilightStrength).toBe(initialStrength);
    for (let index = 0; index < 7; index += 1) {
      game.press(0, 6 + index * 0.25);
    }
    game.press(0, 7.75);
    expect(game.snapshot()).toMatchObject({
      victory: true,
      phase: 'twilight',
      status: 'playing',
      personalStrength: 3,
      twilightStrength: 0,
      result: null,
    });

    expect(game.press(1, 9.1)).toMatchObject({
      noteId: 'post-victory-hit',
      quality: 'good',
    });
    game.advanceTo(10.151);
    const afterVictoryMiss = game.snapshot();
    expect(afterVictoryMiss).toMatchObject({
      victory: true,
      phase: 'twilight',
      status: 'playing',
      personalStrength: 3,
      twilightStrength: 0,
      notes: [
        { id: 'audience', outcome: 'perfect' },
        ...Array.from({ length: 7 }, (_, index) => ({
          id: `setup-${index}`,
          outcome: 'perfect',
        })),
        { id: 'victory-hit', outcome: 'perfect' },
        { id: 'post-victory-hit', outcome: 'good' },
        { id: 'post-victory-miss', outcome: 'miss' },
      ],
      result: null,
    });

    game.advanceTo(12);
    const final = game.snapshot();
    expect(final).toMatchObject({
      victory: true,
      phase: 'twilight',
      status: 'results',
      personalStrength: 3,
      twilightStrength: 0,
      result: {
        outcome: 'victory',
        personalStrength: 3,
        twilightStrength: 0,
        twilight: { perfect: 8, good: 1, miss: 1 },
      },
    });

    expect(game.press(2, 12)).toBeNull();
    expect(game.snapshot()).toEqual(final);
  });
});
