import type { ControllerSnapshot } from '../game/controller';
import type { ChartConfig } from '../game/chart';
import type { GamePhase } from '../game/game';
import { getDifficultyProfile } from '../game/game-balance';

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
  /** Locked victory mode remains distinct from a depleted Twilight light level. */
  readonly victory: boolean;
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
  chart: ChartConfig,
  reducedMotion = false,
): SceneStateProjection {
  const game = snapshot.game;
  const phase = game.phase;
  const victory = game.victory;
  const profile = getDifficultyProfile(game.difficulty);
  const audiencePotential =
    chart.notes.filter((note) => note.time < chart.twilightAt).length *
    profile.audience.perfect;
  const cityIntensity = victory
    ? 1
    : phase === 'audience'
      ? clamp01(audiencePotential === 0 ? 0 : game.renown / audiencePotential)
      : clamp01(
          (game.initialTwilightStrength - game.twilightStrength) /
            game.initialTwilightStrength,
        );
  const transitionProgress = reducedMotion
    ? phase === 'twilight'
      ? 1
      : 0
    : clamp01((game.transportTime - chart.twilightAt) / 2);
  const motionEnabled = !reducedMotion;

  return {
    phase,
    victory,
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
