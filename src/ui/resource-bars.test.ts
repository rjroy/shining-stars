import { describe, expect, it } from 'vitest';
import type { ChartConfig } from '../game/chart';
import { createGame } from '../game/game';
import { getResourceBars } from './resource-bars';

const CHART: ChartConfig = {
  sourceStart: 0,
  duration: 65.8,
  twilightAt: 39.2,
  twilightStrength: 100,
  allowedDifficulties: ['normal', 'hard'],
  notes: [
    { id: 'audience-one', time: 1.214102, lane: 0 },
    { id: 'audience-two', time: 3.198477, lane: 2 },
    ...Array.from({ length: 42 }, (_, index) => ({
      id: `audience-generated-${index}`,
      time: 4 + index * 0.78,
      lane: (index % 4) as 0 | 1 | 2 | 3,
    })),
    { id: 'twilight-one', time: 40.534079, lane: 0 },
  ],
};

describe('resource bar display ranges', () => {
  it('uses chart notes and selected difficulty for the uncapped Renown range', () => {
    const normal = getResourceBars(CHART, createGame(CHART).snapshot());
    expect(normal.audience).toEqual({ value: 0, maximum: 132, fraction: 0 });

    const hard = createGame(CHART, 0, 'hard').snapshot();
    expect(getResourceBars(CHART, hard).audience.maximum).toBe(220);
  });

  it('uses carried Renown and configured Twilight strength as run-relative ranges', () => {
    const runChart: ChartConfig = {
      ...CHART,
      notes: CHART.notes.filter((note) =>
        ['audience-one', 'audience-two', 'twilight-one'].includes(note.id),
      ),
    };
    const game = createGame(runChart);
    game.press(0, 1.214102);
    game.press(2, 3.198477);
    const beforeHandoff = getResourceBars(runChart, game.snapshot());
    expect(beforeHandoff.audience.value).toBe(6);

    game.advanceTo(runChart.twilightAt);
    const twilight = getResourceBars(runChart, game.snapshot());
    expect(twilight.personal).toEqual({ value: 6, maximum: 6, fraction: 1 });
    expect(twilight.twilight).toEqual({
      value: 100,
      maximum: 100,
      fraction: 1,
    });

    game.press(0, 40.534079);
    const afterHit = getResourceBars(runChart, game.snapshot());
    expect(afterHit.personal).toEqual({ value: 6, maximum: 6, fraction: 1 });
    expect(afterHit.twilight).toEqual({
      value: 97,
      maximum: 100,
      fraction: 0.97,
    });
  });

  it('keeps a zero earned-strength range at zero after the handoff', () => {
    const game = createGame(CHART);
    game.advanceTo(CHART.twilightAt);
    expect(getResourceBars(CHART, game.snapshot()).personal).toEqual({
      value: 0,
      maximum: 0,
      fraction: 0,
    });
  });

  it('clamps only visual fractions and handles a zero range without NaN', () => {
    const snapshot = createGame(CHART).snapshot();
    const bars = getResourceBars(CHART, {
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
