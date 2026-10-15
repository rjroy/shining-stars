import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChartConfig } from './chart';

const profileJsonPath = '../../data/charts/difficulty-profiles.json';

function profileDocument() {
  const makeProfile = (miss: number) => ({
    timing: { perfect_ms: 65, good_ms: 125 },
    audience: { perfect: 3, good: 2, miss },
    twilight: {
      perfect: { personal_cost: 0, damage: 3 },
      good: { personal_cost: 3, damage: 2 },
      miss: { personal_cost: 4, damage: 0 },
    },
  });
  return {
    profiles: {
      easy: makeProfile(0),
      normal: makeProfile(0),
      hard: makeProfile(0),
    },
  };
}

async function loadGameWithProfiles(raw: unknown) {
  vi.resetModules();
  vi.doMock(profileJsonPath, () => ({ default: raw }));
  const balance = await import('./game-balance');
  const game = await import('./game');
  return { balance, game };
}

afterEach(() => {
  vi.doUnmock(profileJsonPath);
  vi.resetModules();
});

describe('signed miss outcomes', () => {
  it('loads signed miss values and applies the configured resource deltas in gameplay', async () => {
    const raw = profileDocument();
    raw.profiles.normal.audience.miss = -1;
    raw.profiles.normal.twilight.miss = {
      personal_cost: -2,
      damage: -4,
    };
    const { balance, game } = await loadGameWithProfiles(raw);

    expect(balance.getDifficultyProfile('normal')).toMatchObject({
      audience: { miss: -1 },
      twilight: { miss: { personalCost: -2, damage: -4 } },
    });

    const chart: ChartConfig = {
      sourceStart: 0,
      duration: 10,
      twilightAt: 4,
      twilightStrength: 20,
      allowedDifficulties: ['normal'],
      notes: [
        { id: 'audience-perfect', time: 1, lane: 0 },
        { id: 'audience-miss', time: 2, lane: 0 },
        { id: 'twilight-miss', time: 5, lane: 0 },
      ],
    };
    const session = game.createGame(chart, 0, 'normal');
    expect(session.press(0, 1)?.quality).toBe('perfect');
    session.advanceTo(2 + 0.125 + 0.001);
    expect(session.snapshot().renown).toBe(2);
    session.advanceTo(4);
    expect(session.snapshot().personalStrength).toBe(2);
    session.advanceTo(5 + 0.125 + 0.001);
    expect(session.snapshot()).toMatchObject({
      personalStrength: 4,
      twilightStrength: 24,
    });
  });

  it('floors audience Renown at zero and still rejects invalid timing/nonfinite miss inputs', async () => {
    const raw = profileDocument();
    raw.profiles.normal.audience.miss = -10;
    const { game } = await loadGameWithProfiles(raw);
    const chart: ChartConfig = {
      sourceStart: 0,
      duration: 5,
      twilightAt: 2,
      twilightStrength: 10,
      allowedDifficulties: ['normal'],
      notes: [{ id: 'audience-miss', time: 1, lane: 0 }],
    };
    const session = game.createGame(chart, 0, 'normal');
    session.advanceTo(1 + 0.125 + 0.001);
    expect(session.snapshot().renown).toBe(0);

    const invalidTiming = profileDocument();
    invalidTiming.profiles.normal.timing.perfect_ms = -1;
    vi.doUnmock(profileJsonPath);
    await expect(loadGameWithProfiles(invalidTiming)).rejects.toThrow(
      /must be finite and non-negative/i,
    );

    const nonfiniteMiss = profileDocument();
    nonfiniteMiss.profiles.normal.twilight.miss.damage = Number.NaN;
    vi.doUnmock(profileJsonPath);
    await expect(loadGameWithProfiles(nonfiniteMiss)).rejects.toThrow(
      /must be finite/i,
    );
  });
});
