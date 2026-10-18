import { describe, expect, it } from 'vitest';
import type { ChartConfig } from '../game/chart';
import type { ControllerSnapshot } from '../game/controller';
import type { GameSnapshot } from '../game/game';
import { getTheoreticalMaximumScore } from '../game/game';
import { GAME_BALANCE } from '../game/game-balance';
import { getDifficultyProfile } from '../game/game-balance';
import { projectSceneState } from './scene-state';

const chart: ChartConfig = {
  sourceStart: 0,
  duration: 20,
  twilightAt: 10,
  allowedDifficulties: ['normal'],
  notes: [1, 2, 3, 4].map((time, index) => ({
    id: `a${index}`,
    time,
    lane: 0 as const,
  })),
};

function makeSnapshot(
  gameOverrides: Partial<GameSnapshot> = {},
): ControllerSnapshot {
  const game: GameSnapshot = {
    transportTime: 0,
    phase: 'audience',
    status: 'playing',
    victory: false,
    renown: 0,
    personalStrength: 0,
    twilightStrength: 100,
    initialTwilightStrength: 100,
    difficulty: 'normal',
    score: 0,
    combo: 0,
    bestCombo: 0,
    multiplier: 1,
    bestComboMultiplier: 1,
    normalMaximum: getTheoreticalMaximumScore(chart.notes.length),
    notes: [],
    result: null,
    ...gameOverrides,
  };
  return {
    audio: {
      status: 'playing',
      position: game.transportTime,
      duration: chart.duration,
      scheduledWhen: null,
      hasActiveSource: true,
      loaded: true,
      disposed: false,
      error: null,
    },
    game,
    inputOffset: 0,
    visualOffset: 0,
    selectedDifficulty: 'normal',
    feedback: [],
    pendingPlaybackRequests: false,
  };
}

describe('projectSceneState', () => {
  it('normalizes audience Renown against chart potential from shared rewards', () => {
    const audienceNotes = 4;
    const audiencePotential = audienceNotes * GAME_BALANCE.audience.perfect;
    const projected = projectSceneState(
      makeSnapshot({ renown: audiencePotential / 2 }),
      chart,
    );
    expect(projected.cityIntensity).toBeCloseTo(0.5);
  });

  it('normalizes audience scene intensity using the active run profile', () => {
    const hardPotential =
      chart.notes.filter((note) => note.time < chart.twilightAt).length *
      getDifficultyProfile('hard').audience.perfect;
    const projected = projectSceneState(
      makeSnapshot({ difficulty: 'hard', renown: hardPotential / 2 }),
      chart,
    );
    expect(projected.cityIntensity).toBeCloseTo(0.5);
  });

  it('does not use next-run selection to normalize a finished run', () => {
    const runSnapshot = {
      ...makeSnapshot({ difficulty: 'hard', renown: 10 }),
      selectedDifficulty: 'normal' as const,
    };
    const hardPotential = 4 * getDifficultyProfile('hard').audience.perfect;
    const projected = projectSceneState(runSnapshot, chart);
    expect(projected.cityIntensity).toBe(10 / hardPotential);
  });

  it('tracks the share of Twilight strength defeated, not player strength', () => {
    const projected = projectSceneState(
      makeSnapshot({
        phase: 'twilight',
        transportTime: 12,
        personalStrength: 63,
        twilightStrength: 25,
      }),
      chart,
    );
    expect(projected.cityIntensity).toBeCloseTo(0.75);
    expect(projected.victory).toBe(false);
  });

  it('projects a latched Twilight victory as a distinct fully radiant state', () => {
    const projected = projectSceneState(
      makeSnapshot({
        phase: 'twilight',
        victory: true,
        transportTime: 14,
        personalStrength: 28,
        twilightStrength: 0,
      }),
      chart,
    );
    expect(projected).toMatchObject({
      phase: 'twilight',
      victory: true,
      cityIntensity: 1,
      cityBrightness: 1,
    });
  });

  it('keeps city presence and player defiance when notes are missed', () => {
    const projected = projectSceneState(
      makeSnapshot({
        phase: 'twilight',
        transportTime: 12,
        personalStrength: 40,
        twilightStrength: 100,
        notes: [{ id: 'missed', lane: 1, phase: 'twilight', outcome: 'miss' }],
      }),
      chart,
    );
    expect(projected.cityIntensity).toBe(0);
    expect(projected.cityBrightness).toBeGreaterThan(0);
    expect(projected.playerDefiant).toBe(true);
    expect(projected.twilightConsumed).toBe(false);
  });

  it('clamps normalized visual progress and preserves reduced-motion behavior', () => {
    const state = projectSceneState(
      makeSnapshot({
        phase: 'twilight',
        victory: true,
        transportTime: 12,
        personalStrength: 40,
        twilightStrength: 0,
      }),
      chart,
      true,
    );
    expect(state.cityIntensity).toBe(1);
    expect(state.transitionProgress).toBe(1);
    expect(state.motion).toEqual({
      powerLinePulse: false,
      buildingPulse: false,
      windTravel: false,
      cameraPush: 0,
    });
    expect(state.victory).toBe(true);
  });
});
