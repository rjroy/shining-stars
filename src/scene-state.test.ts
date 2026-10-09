import { describe, expect, it } from 'vitest';
import type { ChartConfig } from './chart';
import type { ControllerSnapshot } from './controller';
import type { GameSnapshot } from './game';
import { GAME_BALANCE } from './game-balance';
import { getDifficultyProfile } from './game-balance';
import { projectSceneState } from './scene-state';

const chart: ChartConfig = {
  sourceStart: 0,
  duration: 20,
  twilightAt: 10,
  twilightStrength: 100,
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
    renown: 0,
    personalStrength: 0,
    twilightStrength: chart.twilightStrength,
    difficulty: 'normal',
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
      disposed: false,
      error: null,
    },
    game,
    inputOffset: 0,
    visualOffset: 0,
    selectedDifficulty: 'normal',
    feedback: null,
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
  });

  it('keeps city presence and player defiance when notes are missed', () => {
    const projected = projectSceneState(
      makeSnapshot({
        phase: 'twilight',
        transportTime: 12,
        personalStrength: 40,
        twilightStrength: 100,
        notes: [{ id: 'missed', phase: 'twilight', outcome: 'miss' }],
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
  });
});
