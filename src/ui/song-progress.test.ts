import { describe, expect, it } from 'vitest';
import type { ChartConfig } from '../game/chart';
import { createGame } from '../game/game';
import { getSongProgress } from './song-progress';

const chart: ChartConfig = {
  sourceStart: 42,
  duration: 10,
  twilightAt: 5,
  allowedDifficulties: ['normal'],
  notes: [
    { id: 'audience', lane: 0, time: 1 },
    { id: 'twilight', lane: 0, time: 7 },
  ],
};

describe('song progress presentation', () => {
  it('uses normalized excerpt duration, not the source offset or full audio length', () => {
    const excerpt = {
      ...chart,
      sourceStart: 120,
      duration: 30,
      twilightAt: 20,
    };
    expect(getSongProgress(excerpt, 15)).toEqual({
      elapsed: 15,
      duration: 30,
      fraction: 0.5,
      twilightFraction: 2 / 3,
      valueText: '0:15 of 0:30. Twilight begins at 0:20.',
    });
  });

  it.each([
    [-1, 0],
    [0, 0],
    [2.5, 0.25],
    [10, 1],
    [12, 1],
  ])('clamps transport time %s to fraction %s', (time, fraction) => {
    expect(getSongProgress(chart, time).fraction).toBe(fraction);
  });

  it('preserves fractional playable durations and the authored transition position', () => {
    const excerpt = { ...chart, duration: 30.5, twilightAt: 18.3 };
    expect(getSongProgress(excerpt, 15.25).fraction).toBe(0.5);
    expect(getSongProgress(excerpt, 15.25).twilightFraction).toBeCloseTo(0.6);
  });

  it('continues through real Audience, Twilight and Radiant transitions without resetting', () => {
    const game = createGame(chart, 0, 'normal');
    expect(getSongProgress(chart, game.snapshot().transportTime).fraction).toBe(
      0,
    );
    game.press(0, 1);
    const audience = game.advanceTo(4.99);
    const twilight = game.advanceTo(5);
    game.press(0, 7);
    const radiant = game.snapshot();
    const results = game.advanceTo(10);
    expect(audience.phase).toBe('audience');
    expect(twilight.phase).toBe('twilight');
    expect(radiant.victory).toBe(true);
    expect(
      [audience, twilight, radiant, results].map(
        (snapshot) => getSongProgress(chart, snapshot.transportTime).fraction,
      ),
    ).toEqual([0.499, 0.5, 0.7, 1]);
    for (const snapshot of [audience, twilight, radiant, results]) {
      expect(
        getSongProgress(chart, snapshot.transportTime).twilightFraction,
      ).toBe(0.5);
    }
  });

  it('uses the held transport time while paused and does not keep state across restart', () => {
    const paused = createGame(chart, 0, 'normal').advanceTo(2);
    expect(getSongProgress(chart, paused.transportTime).fraction).toBe(0.2);
    expect(getSongProgress(chart, paused.transportTime).fraction).toBe(0.2);
    const restarted = createGame(chart, 0, 'normal').snapshot();
    expect(getSongProgress(chart, restarted.transportTime).fraction).toBe(0);
    expect(getSongProgress(chart, paused.transportTime).fraction).toBe(0.2);
  });
});
