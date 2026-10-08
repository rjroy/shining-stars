import { describe, expect, it } from 'vitest';
import type { ControllerSnapshot } from './controller';
import type { GameSnapshot } from './game';
import { projectSceneState } from './scene-state';

function makeSnapshot(
  gameOverrides: Partial<GameSnapshot> = {},
  audioOverrides: Partial<ControllerSnapshot['audio']> = {},
): ControllerSnapshot {
  const game: GameSnapshot = {
    transportTime: 0,
    phase: 'audience',
    status: 'playing',
    resonance: 0,
    resonanceEarned: 0,
    cityAnswer: 0,
    notes: [],
    result: null,
    ...gameOverrides,
  };

  return {
    audio: {
      status: 'playing',
      position: game.transportTime,
      duration: 65.8,
      scheduledWhen: null,
      hasActiveSource: true,
      disposed: false,
      error: null,
      ...audioOverrides,
    },
    game,
    inputOffset: 0,
    visualOffset: 0,
    feedback: null,
  };
}

describe('projectSceneState', () => {
  it('uses audience Resonance as normalized city accompaniment strength', () => {
    const projected = projectSceneState(
      makeSnapshot({ resonance: 72, cityAnswer: 8 }),
      39.2,
    );

    expect(projected.phase).toBe('audience');
    expect(projected.cityIntensity).toBeCloseTo(0.72);
    expect(projected.cityBrightness).toBeGreaterThan(0);
  });

  it('uses City Answer in Twilight after Resonance has been spent to zero', () => {
    const projected = projectSceneState(
      makeSnapshot({
        phase: 'twilight',
        transportTime: 43,
        resonance: 0,
        cityAnswer: 64,
      }),
      39.2,
    );

    expect(projected.phase).toBe('twilight');
    expect(projected.cityIntensity).toBeCloseTo(0.64);
  });

  it('derives a bounded two-second transition from model time, not frame delta', () => {
    const twilightAt = 39.2;
    const progressAt = (transportTime: number) =>
      projectSceneState(
        makeSnapshot({ phase: 'twilight', transportTime }),
        twilightAt,
      ).transitionProgress;

    expect(progressAt(twilightAt - 0.1)).toBe(0);
    expect(progressAt(twilightAt)).toBe(0);
    expect(progressAt(twilightAt + 1)).toBeCloseTo(0.5);
    expect(progressAt(twilightAt + 2)).toBe(1);
    expect(progressAt(twilightAt + 20)).toBe(1);
  });

  it('keeps a zero-resource all-miss Twilight state defiant and unconsumed', () => {
    const projected = projectSceneState(
      makeSnapshot({
        phase: 'twilight',
        transportTime: 45,
        resonance: 0,
        cityAnswer: 0,
        notes: [
          { id: 'a-miss', phase: 'audience', outcome: 'miss' },
          { id: 't-miss', phase: 'twilight', outcome: 'miss' },
        ],
      }),
      39.2,
    );

    expect(projected.playerDefiant).toBe(true);
    expect(projected.twilightConsumed).toBe(false);
    expect(projected.cityIntensity).toBe(0);
    expect(projected.cityBrightness).toBeGreaterThan(0);
  });

  it('reduces motion while keeping static city presence and phase cues', () => {
    const audience = projectSceneState(
      makeSnapshot({ phase: 'audience', resonance: 0 }),
      39.2,
      true,
    );
    const twilight = projectSceneState(
      makeSnapshot({ phase: 'twilight', transportTime: 43, cityAnswer: 40 }),
      39.2,
      true,
    );

    expect(audience.phase).toBe('audience');
    expect(twilight.phase).toBe('twilight');
    expect(audience.cityBrightness).toBeGreaterThan(0);
    expect(twilight.cityBrightness).toBeGreaterThan(0);
    expect(audience.motion).toEqual({
      powerLinePulse: false,
      buildingPulse: false,
      windTravel: false,
      cameraPush: 0,
    });
    expect(twilight.transitionProgress).toBe(1);
  });

  it('projects the same paused model position identically, regardless of missed notes', () => {
    const paused = makeSnapshot(
      {
        phase: 'twilight',
        transportTime: 41.5,
        resonance: 0,
        cityAnswer: 26,
      },
      { status: 'paused', position: 41.5, hasActiveSource: false },
    );
    const allMisses = {
      ...paused,
      game: {
        ...paused.game,
        notes: [
          {
            id: 'missed',
            phase: 'twilight' as const,
            outcome: 'miss' as const,
          },
        ],
      },
    };

    expect(projectSceneState(paused, 39.2)).toEqual(
      projectSceneState(paused, 39.2),
    );
    expect(projectSceneState(allMisses, 39.2)).toEqual(
      projectSceneState(paused, 39.2),
    );
    expect(projectSceneState(allMisses, 39.2).playerDefiant).toBe(true);
  });
});
