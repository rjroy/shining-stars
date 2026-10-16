import { describe, expect, it } from 'vitest';
import * as ui from './ui';
import type { GameResult, GameSnapshot } from '../game/game';

type ScoreFields = Pick<
  GameSnapshot,
  'score' | 'combo' | 'multiplier' | 'normalMaximum'
>;
interface ScorePresentation {
  readonly scoreText: string;
  readonly comboText: string;
  readonly multiplierText: string;
  readonly stars: readonly {
    readonly normalFill: number;
    readonly goldFill: number;
  }[];
  readonly starSummary: string;
  readonly ariaLive: 'off';
}

// No DOM test environment is installed. Import the existing module so RED is
// an assertion about absent behavior, never an unresolved new-module import.
// Production HUD and results must both consume this pure presentation helper;
// actual DOM wiring and canvas safety require the later real-game browser pass.
function present(fields: ScoreFields): ScorePresentation {
  const helper = Reflect.get(ui, 'getScorePresentation');
  expect(helper, 'ui.ts exports the shared HUD/results score presenter').toBeTypeOf(
    'function',
  );
  return (helper as (input: ScoreFields) => ScorePresentation)(fields);
}

function atPercent(percent: number): ScorePresentation {
  return present({
    score: percent * 200,
    normalMaximum: 20_000,
    combo: 24,
    multiplier: 3,
  });
}

function expectFills(
  value: ScorePresentation,
  normal: readonly number[],
  gold: readonly number[],
): void {
  expect(value.stars).toHaveLength(5);
  value.stars.forEach((star, index) => {
    expect(star.normalFill).toBeCloseTo(normal[index]!);
    expect(star.goldFill).toBeCloseTo(gold[index]!);
  });
}

describe('shared score presentation contract', () => {
  it('formats authoritative integers and displays the supplied NEXT-hit multiplier', () => {
    const value = present({
      score: 20_001,
      combo: 10,
      multiplier: 2,
      normalMaximum: 20_000,
    });
    expect(value.scoreText).toBe('20,001');
    expect(value.comboText).toBe('10');
    expect(value.multiplierText).toBe('×2');
  });

  it('starts with five empty silhouettes, zero combo, and ×1', () => {
    const value = present({
      score: 0,
      combo: 0,
      multiplier: 1,
      normalMaximum: 20_000,
    });
    expect(value.scoreText).toBe('0');
    expect(value.comboText).toBe('0');
    expect(value.multiplierText).toBe('×1');
    expectFills(value, [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]);
  });

  it.each([
    [10, [0.5, 0, 0, 0, 0]],
    [20, [1, 0, 0, 0, 0]],
    [25, [1, 0.5, 0, 0, 0]],
    [30, [1, 1, 0, 0, 0]],
    [35, [1, 1, 0.5, 0, 0]],
    [40, [1, 1, 1, 0, 0]],
    [45, [1, 1, 1, 0.5, 0]],
    [50, [1, 1, 1, 1, 0]],
    [55, [1, 1, 1, 1, 0.5]],
    [60, [1, 1, 1, 1, 1]],
  ] as const)('progressively fills normal silhouettes at %s%%', (percent, normal) => {
    expectFills(atPercent(percent), normal, [0, 0, 0, 0, 0]);
  });

  it.each([
    [65, [0.5, 0, 0, 0, 0]],
    [70, [1, 0, 0, 0, 0]],
    [72.5, [1, 0.5, 0, 0, 0]],
    [75, [1, 1, 0, 0, 0]],
    [77.5, [1, 1, 0.5, 0, 0]],
    [80, [1, 1, 1, 0, 0]],
    [82.5, [1, 1, 1, 0.5, 0]],
    [85, [1, 1, 1, 1, 0]],
    [87.5, [1, 1, 1, 1, 0.5]],
    [90, [1, 1, 1, 1, 1]],
    [125, [1, 1, 1, 1, 1]],
  ] as const)('overlays progressive gold in the SAME five silhouettes at %s%%', (percent, gold) => {
    expectFills(atPercent(percent), [1, 1, 1, 1, 1], gold);
  });

  it('uses the supplied Normal baseline, not a difficulty-specific ceiling', () => {
    expectFills(
      present({ score: 1000, normalMaximum: 10_000, combo: 1, multiplier: 1 }),
      [0.5, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    );
  });

  it('keeps a zero-maximum chart finite and empty', () => {
    const value = present({ score: 0, normalMaximum: 0, combo: 0, multiplier: 1 });
    expectFills(value, [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]);
    expect(value.starSummary).not.toMatch(/NaN|Infinity/);
  });

  it('provides non-live accessible text describing BOTH partial progress tracks', () => {
    const halfwayNormal = atPercent(10);
    const halfwayGold = atPercent(65);
    expect(halfwayNormal.starSummary).toMatch(/normal.*0\.5.*5/i);
    expect(halfwayNormal.starSummary).toMatch(/gold.*0.*5/i);
    expect(halfwayGold.starSummary).toMatch(/normal.*5.*5/i);
    expect(halfwayGold.starSummary).toMatch(/gold.*0\.5.*5/i);
    for (const value of [halfwayNormal, halfwayGold, atPercent(66)]) {
      expect(value.ariaLive).toBe('off');
    }
  });

  it('presents identical snapshot and frozen-result values without using phase or victory', () => {
    const scoring: ScoreFields = {
      score: 13_000,
      normalMaximum: 20_000,
      combo: 24,
      multiplier: 3,
    };
    const stats = { perfect: 24, good: 0, miss: 0, accuracy: 100 };
    const result: GameResult = {
      ...scoring,
      audience: stats,
      twilight: stats,
      overall: stats,
      renown: 80,
      personalStrength: 60,
      twilightStrength: 0,
      difficulty: 'normal',
      outcome: 'victory',
    };
    for (const phase of ['audience', 'twilight'] as const) {
      for (const victory of [false, true]) {
        const snapshot: GameSnapshot = {
          ...scoring,
          phase,
          victory,
          status: 'playing',
          transportTime: 42,
          renown: 80,
          personalStrength: 60,
          twilightStrength: victory ? 0 : 40,
          difficulty: 'normal',
          notes: [],
          result: null,
        };
        expect(present(snapshot)).toEqual(present(result));
      }
    }
  });
});
