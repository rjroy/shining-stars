import { describe, expect, it } from 'vitest';
import type { ChartConfig, ChartLane, ChartNote } from './chart';
import { createGame } from './game';

interface RenownChartOptions {
  readonly duration?: number;
  readonly twilightAt?: number;
  readonly twilightStrength?: number;
}

function chart(
  notes: readonly ChartNote[],
  options: RenownChartOptions = {},
): ChartConfig {
  return {
    sourceStart: 0,
    duration: options.duration ?? 12,
    twilightAt: options.twilightAt ?? 5,
    twilightStrength: options.twilightStrength ?? 100,
    allowedDifficulties: ['normal'],
    notes,
  } as unknown as ChartConfig;
}

function note(id: string, time: number, lane: ChartLane = 0): ChartNote {
  return { id, time, lane };
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

  it('hands off all audience Renown as Personal Strength and starts configured Twilight Strength', () => {
    const game = createGame(
      chart([note('audience', 2), note('twilight', 7)], {
        twilightStrength: 137,
      }),
    );
    game.press(0, 2);

    expect(game.snapshot().renown).toBe(3);
    game.advanceTo(5);

    expect(game.snapshot()).toMatchObject({
      phase: 'twilight',
      personalStrength: 3,
      twilightStrength: 137,
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
    const missed = createGame(
      chart([note('audience', 2), note('twilight-miss', 7)], {
        twilightStrength: 5,
      }),
    );
    missed.press(0, 2);
    missed.advanceTo(5);
    missed.advanceTo(7.151);
    expect(missed.snapshot()).toMatchObject({
      personalStrength: 0,
      twilightStrength: 5,
      result: { outcome: 'defeat' },
    });

    const good = createGame(
      chart(
        [
          note('audience-one', 2),
          note('audience-two', 3),
          note('twilight-good', 7),
        ],
        { twilightStrength: 5 },
      ),
    );
    good.press(0, 2);
    good.press(0, 3);
    good.advanceTo(5);
    good.press(0, 7.1);
    expect(good.snapshot()).toMatchObject({
      personalStrength: 3,
      twilightStrength: 3,
      status: 'playing',
    });

    const perfect = createGame(
      chart([note('audience', 2), note('twilight-perfect', 7)], {
        twilightStrength: 3,
      }),
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
    const game = createGame(
      chart(
        [
          note('audience-perfect-one', 2),
          note('audience-perfect-two', 3),
          note('twilight-good-one', 7),
          note('twilight-good-two', 9),
        ],
        { twilightStrength: 4 },
      ),
    );
    game.press(0, 2);
    game.press(0, 3); // Two Perfect hits provide six strength for two Good costs.
    game.advanceTo(5);
    game.press(0, 7.1);
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
    const game = createGame(
      chart([note('future-twilight', 7)], { twilightStrength: 100 }),
    );
    game.advanceTo(5);

    expect(game.snapshot()).toMatchObject({
      phase: 'twilight',
      status: 'results',
      victory: false,
      personalStrength: 0,
      twilightStrength: 100,
      result: { outcome: 'defeat' },
      notes: [{ id: 'future-twilight', outcome: null }],
    });
  });

  it('ends naturally as survived when both strengths remain', () => {
    const game = createGame(
      chart([note('audience', 2)], {
        duration: 12,
        twilightStrength: 100,
      }),
    );
    game.press(0, 2);
    game.advanceTo(5);
    game.advanceTo(12);

    expect(game.snapshot()).toMatchObject({
      status: 'results',
      personalStrength: 3,
      twilightStrength: 100,
      notes: [{ id: 'audience', outcome: 'perfect' }],
      result: {
        outcome: 'survived',
        twilight: { perfect: 0, good: 0, miss: 0, accuracy: null },
        overall: { perfect: 1, miss: 0, accuracy: 100 },
      },
    });
  });

  it('continues judging after combat victory, freezes strengths, then wins at excerpt end', () => {
    const game = createGame(
      chart(
        [
          note('audience', 2),
          note('victory-hit', 7),
          note('post-victory-hit', 8, 1),
          note('post-victory-miss', 9, 2),
        ],
        { twilightStrength: 3 },
      ),
    );
    expect(game.snapshot()).toMatchObject({
      victory: false,
      status: 'playing',
    });
    game.press(0, 2);
    game.advanceTo(5);
    game.press(0, 7);
    expect(game.snapshot()).toMatchObject({
      victory: true,
      phase: 'twilight',
      status: 'playing',
      personalStrength: 3,
      twilightStrength: 0,
      result: null,
    });

    expect(game.press(1, 8.1)).toMatchObject({
      noteId: 'post-victory-hit',
      quality: 'good',
    });
    game.advanceTo(9.151);
    const afterVictoryMiss = game.snapshot();
    expect(afterVictoryMiss).toMatchObject({
      victory: true,
      phase: 'twilight',
      status: 'playing',
      personalStrength: 3,
      twilightStrength: 0,
      notes: [
        { id: 'audience', outcome: 'perfect' },
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
        twilight: { perfect: 1, good: 1, miss: 1 },
      },
    });

    expect(game.press(2, 12)).toBeNull();
    expect(game.snapshot()).toEqual(final);
  });
});
