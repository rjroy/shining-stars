export interface RadiantMarkerFrame {
  readonly target: number | null;
  readonly achieved: boolean;
  /** Existing render clock, in seconds; never the predicted target or song time. */
  readonly clockTime: number;
  readonly paused: boolean;
  readonly reducedMotion: boolean;
  readonly runId?: number;
}

export interface MarkerMotionOptions {
  readonly paused?: boolean;
  readonly reducedMotion?: boolean;
  readonly reset?: boolean;
}

/** A render-driven, linear half-second slide. No timers or animation callbacks. */
export function createRadiantMarkerMotion() {
  let from: number | null = null;
  let target: number | null = null;
  let startedAt = 0;
  let motionTime = 0;
  let previousClock: number | null = null;
  let wasPaused = false;
  let disposed = false;
  const sample = () => {
    if (target === null || from === null) return null;
    const fraction = Math.min(1, Math.max(0, (motionTime - startedAt) / 0.5));
    return from + (target - from) * fraction;
  };
  return {
    update(
      nextTarget: number | null,
      clockTime: number,
      options: MarkerMotionOptions = {},
    ): number | null {
      if (disposed) return null;
      if (previousClock !== null && !wasPaused)
        motionTime += Math.max(0, clockTime - previousClock);
      previousClock = clockTime;
      wasPaused = options.paused ?? false;
      const displayed = sample();
      if (
        nextTarget === null ||
        displayed === null ||
        options.reset ||
        options.reducedMotion
      ) {
        from = nextTarget;
        target = nextTarget;
        startedAt = motionTime;
        return nextTarget;
      }
      if (nextTarget !== target) {
        // Sample BEFORE replacing the target, including when the old slide is midway.
        from = displayed;
        target = nextTarget;
        startedAt = motionTime;
      }
      return sample();
    },
    destroy(): void {
      disposed = true;
      from = null;
      target = null;
    },
  };
}

/** Keep the existing Twilight word clear of the moving pointer in the same slim row. */
export function getTwilightLabelCenter(
  width: number,
  labelWidth: number,
  twilightFraction: number,
  radiantFraction: number | null,
  markerWidth: number,
): number {
  const edge = Math.max(32, labelWidth / 2);
  const clamp = (value: number) =>
    Math.min(width - edge, Math.max(edge, value));
  const preferred = clamp(width * twilightFraction);
  if (radiantFraction === null) return preferred;
  const marker = width * radiantFraction;
  const clearance = labelWidth / 2 + markerWidth / 2 + 3;
  if (Math.abs(preferred - marker) >= clearance) return preferred;
  const left = marker - clearance;
  return left >= edge ? clamp(left) : clamp(marker + clearance);
}
