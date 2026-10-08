export interface SyntheticClock {
  now(): number;
  advanceTo(timeSeconds: number): void;
}

export function createSyntheticClock(startAtSeconds = 0): SyntheticClock {
  if (!Number.isFinite(startAtSeconds) || startAtSeconds < 0) {
    throw new RangeError('Clock start must be a finite, non-negative time.');
  }

  let currentTimeSeconds = startAtSeconds;

  return {
    now: () => currentTimeSeconds,
    advanceTo(timeSeconds) {
      if (!Number.isFinite(timeSeconds) || timeSeconds < currentTimeSeconds) {
        throw new RangeError('Clock time must be finite and monotonic.');
      }

      currentTimeSeconds = timeSeconds;
    },
  };
}
