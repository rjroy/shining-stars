export interface CosmeticClockConditions {
  readonly active: boolean;
  readonly visible: boolean;
  readonly reducedMotion: boolean;
}

/** A zero previous timestamp marks a fresh interval after visibility changes. */
export function animationFrameDeltaSeconds(
  previousFrameTime: number,
  now: number,
): number {
  return previousFrameTime === 0
    ? 0
    : Math.min(0.05, Math.max(0, (now - previousFrameTime) / 1000));
}

/** Advance visual-only gameplay time without inheriting transport or hidden time. */
export function advanceCosmeticClock(
  time: number,
  delta: number,
  conditions: CosmeticClockConditions,
): number {
  if (
    !conditions.active ||
    !conditions.visible ||
    conditions.reducedMotion ||
    !Number.isFinite(delta) ||
    delta <= 0
  ) {
    return time;
  }
  return time + Math.min(delta, 0.05);
}
