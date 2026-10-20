import type { SceneStateProjection } from '../scene-state';

/** Saved song time only: no wall clock, random state, or independent lifecycle. */
export interface BrightvaleAmbience {
  readonly time: number;
  readonly cloudTint: readonly [number, number, number];
  readonly cloudGradeColor: readonly [number, number, number];
  readonly cloudGradeAmount: number;
  readonly waterStrength: number;
  readonly windowsEnabled: boolean;
}

/** Default for Observatory and callers that do not opt into gameplay ambience. */
export const STATIC_AMBIENCE: BrightvaleAmbience = {
  time: 0,
  cloudTint: [1, 1, 1],
  cloudGradeColor: [1, 1, 1],
  cloudGradeAmount: 0,
  waterStrength: 0,
  windowsEnabled: false,
};

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

// Linear RGB pigments. The cloud shader normalizes luminance before the fixed
// 65% blend, so these need saturated hues rather than near-white light colors.
const AUDIENCE_CLOUD_WARM = [1, 0.24, 0.025] as const;
const AUDIENCE_CLOUD_COOL = [0.72, 0.44, 1] as const;
const TWILIGHT_CLOUD_EMBER = [1, 0.025, 0.16] as const;
const TWILIGHT_CLOUD_ION = [0.025, 0.32, 1] as const;
const RADIANT_CLOUD_GOLD = [1, 0.48, 0.035] as const;
const RADIANT_CLOUD_ROSE = [0.6, 0.045, 0.85] as const;

export function projectBrightvaleAmbience(
  state: SceneStateProjection,
  transportTime: number,
  reducedMotion: boolean,
): BrightvaleAmbience {
  const time =
    reducedMotion || !Number.isFinite(transportTime)
      ? 0
      : Math.max(0, transportTime);
  const gentle = Math.sin(time * 0.12);
  // Grade the painted clouds, rather than expecting a near-white multiplier to
  // visibly recolor them. Reach orange at six seconds and violet at eighteen.
  const warmth = 0.5 + 0.5 * Math.sin(time * (Math.PI / 8));
  const audienceGrade = (channel: 0 | 1 | 2): number =>
    AUDIENCE_CLOUD_COOL[channel] * (1 - warmth) +
    AUDIENCE_CLOUD_WARM[channel] * warmth;
  // Interference, not noise or stepped randomness: restless but always continuous.
  const restless =
    0.45 * Math.sin(time * 0.36) +
    0.35 * Math.sin(time * 0.20 + 0.4) +
    0.2 * Math.sin(time * 0.065 + 1);
  const serene = Math.sin(time * 0.08);
  const audience = [1, 0.975 + gentle * 0.02, 0.94 + gentle * 0.04] as const;
  const twilight = [
    0.94 + restless * 0.05,
    0.94 + restless * 0.035,
    1,
  ] as const;
  const radiant = [1, 0.98 + serene * 0.015, 0.94 + serene * 0.025] as const;
  const twilightAmount = clamp01(state.transitionProgress);
  const radiantAmount = state.victory ? clamp01(state.radiantProgress) : 0;
  // Phase-warped oscillation: no random jumps or short repeated beat. The 13s
  // carrier speeds/slows under 19s and 31s waves, always travelling continuously.
  const unease =
    0.5 +
    0.25 *
    Math.sin(
      time * (Math.PI / 8) +
      0.85 * Math.sin(time * (Math.PI / 10)) +
      0.4 * Math.sin(time * (Math.PI / 15))
    ) +
    0.25 * Math.sin(time * Math.PI);
  const radiance = 0.5 + 0.5 * Math.sin(time * (Math.PI / 12));
  const cloudGrade = (channel: 0 | 1 | 2): number => {
    const twilightGrade =
      TWILIGHT_CLOUD_ION[channel] * (1 - unease) +
      TWILIGHT_CLOUD_EMBER[channel] * unease;
    const radiantGrade =
      RADIANT_CLOUD_ROSE[channel] * (1 - radiance) +
      RADIANT_CLOUD_GOLD[channel] * radiance;
    const base =
      audienceGrade(channel) * (1 - twilightAmount) +
      twilightGrade * twilightAmount;
    return base * (1 - radiantAmount) + radiantGrade * radiantAmount;
  };
  const tint = (index: 0 | 1 | 2): number => {
    const base =
      audience[index] * (1 - twilightAmount) + twilight[index] * twilightAmount;
    return base * (1 - radiantAmount) + radiant[index] * radiantAmount;
  };
  return {
    time,
    cloudTint: [tint(0), tint(1), tint(2)],
    cloudGradeColor: [cloudGrade(0), cloudGrade(1), cloudGrade(2)],
    cloudGradeAmount: 0.65,
    waterStrength: 1,
    windowsEnabled: true,
  };
}

/** Authored material groups, not individual windows or added real light sources. */
const WINDOW_PHASES: Readonly<Record<string, number>> = {
  'Citadel detail | amber glazing 0': 0.3,
  'Ravine detail | amber': 2.1,
  'District detail | Left lit glazing': 3.8,
  'District detail | Right lit glazing': 5.4,
};

export function windowAmbienceMultiplier(
  sourceMaterial: string,
  ambience: BrightvaleAmbience,
): number {
  const phase = WINDOW_PHASES[sourceMaterial];
  if (!ambience.windowsEnabled || phase === undefined) {
    return 1;
  }

  const wave =
    0.9 * Math.sin(ambience.time * (Math.PI / 8) + phase) +
    0.1 * Math.sin(ambience.time * (Math.PI / 2) + phase * 1.7);
  return 30 * (0.50 + wave * 0.50);
}
