import type { ControllerSnapshot } from './controller';
import type { GamePhase } from './game';

export interface SceneMotionState {
  readonly powerLinePulse: boolean;
  readonly buildingPulse: boolean;
  readonly windTravel: boolean;
  /** Blend amount for a small handoff camera push; zero means no movement. */
  readonly cameraPush: number;
}

/** Pure visual inputs for the Three.js scene; no scene clock or game rules. */
export interface SceneStateProjection {
  readonly phase: GamePhase;
  /** Active city's accompaniment strength, normalized to [0, 1]. */
  readonly cityIntensity: number;
  /** Static visibility floor so city participation remains legible at zero strength. */
  readonly cityBrightness: number;
  /** Progress through a fixed two-second handoff, normalized to [0, 1]. */
  readonly transitionProgress: number;
  readonly motion: SceneMotionState;
  /** This MVP's visual scene never interprets rhythm misses as surrender. */
  readonly playerDefiant: boolean;
  readonly twilightConsumed: boolean;
}

/**
 * Project model state into visual cues. The boundary is excerpt-relative and
 * comes from the active chart; motion is derived from the saved model time.
 */
export function projectSceneState(
  snapshot: ControllerSnapshot,
  twilightAt: number,
  reducedMotion = false,
): SceneStateProjection {
  const game = snapshot.game;
  const phase = game.phase;
  const sourceValue = phase === 'audience' ? game.resonance : game.cityAnswer;
  const cityIntensity = clamp01(sourceValue / 100);
  const transitionProgress = reducedMotion
    ? phase === 'twilight'
      ? 1
      : 0
    : clamp01((game.transportTime - twilightAt) / 2);
  const motionEnabled = !reducedMotion;

  return {
    phase,
    cityIntensity,
    cityBrightness: 0.22 + cityIntensity * 0.78,
    transitionProgress,
    motion: {
      powerLinePulse: motionEnabled,
      buildingPulse: motionEnabled,
      windTravel: motionEnabled,
      cameraPush: motionEnabled ? transitionProgress : 0,
    },
    playerDefiant: true,
    twilightConsumed: false,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
