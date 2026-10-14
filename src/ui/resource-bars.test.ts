import { describe, expect, it } from 'vitest';
import { MVP_CHART } from '../game/mvp-chart';
import { createGame } from '../game/game';
import { getResourceBars } from './resource-bars';

describe('resource bar display ranges', () => {
  it('uses chart notes and selected difficulty for the uncapped Renown range', () => {
    const normal = getResourceBars(MVP_CHART, createGame(MVP_CHART).snapshot());
    expect(normal.audience).toEqual({ value: 0, maximum: 132, fraction: 0 });

    const hard = createGame(MVP_CHART, 0, 'hard').snapshot();
    expect(getResourceBars(MVP_CHART, hard).audience.maximum).toBe(220);
  });

  it('uses carried Renown and configured Twilight strength as run-relative ranges', () => {
    const game = createGame(MVP_CHART);
    game.press(0, 1.214102);
    game.press(2, 3.198477);
    const beforeHandoff = getResourceBars(MVP_CHART, game.snapshot());
    expect(beforeHandoff.audience.value).toBe(6);

    game.advanceTo(MVP_CHART.twilightAt);
    const twilight = getResourceBars(MVP_CHART, game.snapshot());
    expect(twilight.personal).toEqual({ value: 6, maximum: 6, fraction: 1 });
    expect(twilight.twilight).toEqual({
      value: 100,
      maximum: 100,
      fraction: 1,
    });

    game.press(0, 40.534079);
    const afterHit = getResourceBars(MVP_CHART, game.snapshot());
    expect(afterHit.personal).toEqual({ value: 6, maximum: 6, fraction: 1 });
    expect(afterHit.twilight).toEqual({
      value: 97,
      maximum: 100,
      fraction: 0.97,
    });
  });

  it('keeps a zero earned-strength range at zero after the handoff', () => {
    const game = createGame(MVP_CHART);
    game.advanceTo(MVP_CHART.twilightAt);
    expect(getResourceBars(MVP_CHART, game.snapshot()).personal).toEqual({
      value: 0,
      maximum: 0,
      fraction: 0,
    });
  });

  it('clamps only visual fractions and handles a zero range without NaN', () => {
    const snapshot = createGame(MVP_CHART).snapshot();
    const bars = getResourceBars(MVP_CHART, {
      ...snapshot,
      renown: 4,
      personalStrength: 7,
      twilightStrength: 125,
    });
    expect(bars.audience.fraction).toBeGreaterThan(0);
    expect(bars.personal.fraction).toBe(1);
    expect(bars.twilight.fraction).toBe(1);
    expect(
      Object.values(bars).every(({ fraction }) => Number.isFinite(fraction)),
    ).toBe(true);
  });
});
