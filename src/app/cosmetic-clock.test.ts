import { describe, expect, it } from 'vitest';
import {
  advanceCosmeticClock,
  animationFrameDeltaSeconds,
} from './cosmetic-clock';

describe('animationFrameDeltaSeconds', () => {
  it('starts a fresh interval after RAF suspension or visibility change', () => {
    expect(animationFrameDeltaSeconds(0, 60_000)).toBe(0);
    expect(animationFrameDeltaSeconds(60_000, 60_016)).toBeCloseTo(0.016);
  });
});

describe('advanceCosmeticClock', () => {
  it('continues during a visible gameplay pause without a resume jump', () => {
    const conditions = {
      active: true,
      visible: true,
      reducedMotion: false,
    } as const;
    const beforePause = advanceCosmeticClock(4, 0.04, conditions);
    const whilePaused = advanceCosmeticClock(beforePause, 0.04, conditions);
    const afterResume = advanceCosmeticClock(whilePaused, 0.04, conditions);

    expect(beforePause).toBeCloseTo(4.04);
    expect(whilePaused).toBeCloseTo(4.08);
    expect(afterResume).toBeCloseTo(4.12);
  });

  it.each([
    { active: false, visible: true, reducedMotion: false },
    { active: true, visible: false, reducedMotion: false },
    { active: true, visible: true, reducedMotion: true },
  ])('holds when conditions disable cosmetic time: %o', (conditions) => {
    expect(advanceCosmeticClock(3, 0.05, conditions)).toBe(3);
  });

  it('caps a delayed frame so a resumed tab cannot jump', () => {
    expect(
      advanceCosmeticClock(3, 60, {
        active: true,
        visible: true,
        reducedMotion: false,
      }),
    ).toBe(3.05);
  });
});
