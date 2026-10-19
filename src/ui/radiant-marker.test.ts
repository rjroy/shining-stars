import { describe, expect, it } from 'vitest';
import {
  createRadiantMarkerMotion,
  getTwilightLabelCenter,
} from './radiant-marker';

describe('Radiant marker motion', () => {
  it('does not move an unchanged optimistic target just because its nominal timestamp is now past', () => {
    const motion = createRadiantMarkerMotion();
    expect(motion.update(5.1, 0)).toBe(5.1);
    expect(motion.update(5.1, 5.2)).toBe(5.1);
    expect(motion.update(5.1, 5.3)).toBe(5.1);
    expect(motion.update(6.8, 5.31)).toBe(5.1);
    expect(motion.update(6.8, 5.56)).toBeCloseTo(5.95);
    expect(motion.update(6.8, 5.81)).toBeCloseTo(6.8);
  });

  it('appears immediately, then travels linearly for exactly half a second', () => {
    const motion = createRadiantMarkerMotion();
    expect(motion.update(3, 0)).toBe(3);
    expect(motion.update(7, 1)).toBe(3);
    expect(motion.update(7, 1.125)).toBe(4);
    expect(motion.update(7, 1.25)).toBe(5);
    expect(motion.update(7, 1.5)).toBe(7);
    expect(motion.update(7, 4)).toBe(7);
  });

  it('unchanged targets never restart a slide; a changed target samples its midway position', () => {
    const motion = createRadiantMarkerMotion();
    motion.update(1, 0);
    motion.update(3, 0);
    expect(motion.update(3, 0.2)).toBeCloseTo(1.8);
    expect(motion.update(6, 0.25)).toBe(2);
    expect(motion.update(6, 0.5)).toBe(4);
    expect(motion.update(6, 0.75)).toBe(6);
  });

  it('larger deltas move faster, but never receive a longer duration', () => {
    const near = createRadiantMarkerMotion();
    const far = createRadiantMarkerMotion();
    for (const motion of [near, far]) motion.update(2, 0);
    near.update(4, 1);
    far.update(10, 1);
    expect(near.update(4, 1.25)).toBe(3);
    expect(far.update(10, 1.25)).toBe(6);
    expect(near.update(4, 1.5)).toBe(4);
    expect(far.update(10, 1.5)).toBe(10);
  });

  it('handles irregular render times, fractional note timestamps, and backward movement', () => {
    const motion = createRadiantMarkerMotion();
    motion.update(7.6, 10);
    motion.update(8.7, 10.137);
    expect(motion.update(8.7, 10.207)).toBeCloseTo(7.754);
    expect(motion.update(8.7, 10.637)).toBeCloseTo(8.7);
    motion.update(6.8, 10.7);
    expect(motion.update(6.8, 10.95)).toBeCloseTo(7.75);
    expect(motion.update(6.8, 11.2)).toBeCloseTo(6.8);
  });

  it('hides null immediately and starts a new appearance or reset without a slide', () => {
    const motion = createRadiantMarkerMotion();
    motion.update(2, 0);
    motion.update(8, 1);
    expect(motion.update(null, 1.1)).toBeNull();
    expect(motion.update(7, 1.2)).toBe(7);
    motion.update(9, 2);
    expect(motion.update(3, 2.1, { reset: true })).toBe(3);
  });

  it('freezes on pause, excludes paused time, and resumes the remaining part of the same slide', () => {
    const motion = createRadiantMarkerMotion();
    motion.update(10, 0);
    motion.update(20, 1);
    expect(motion.update(20, 1.2, { paused: true })).toBeCloseTo(14);
    expect(motion.update(20, 5, { paused: true })).toBeCloseTo(14);
    expect(motion.update(20, 6, { paused: false })).toBeCloseTo(14);
    expect(motion.update(20, 6.3)).toBeCloseTo(20);
  });

  it('retargets from its held display if the target changes during pause', () => {
    const motion = createRadiantMarkerMotion();
    motion.update(10, 0);
    motion.update(20, 1);
    motion.update(20, 1.2, { paused: true });
    expect(motion.update(30, 2, { paused: true })).toBeCloseTo(14);
    expect(motion.update(30, 3)).toBeCloseTo(14);
    expect(motion.update(30, 3.25)).toBeCloseTo(22);
    expect(motion.update(30, 3.5)).toBeCloseTo(30);
  });

  it('reduced motion is immediate, including midway through a slide and while paused', () => {
    const motion = createRadiantMarkerMotion();
    motion.update(2, 0);
    motion.update(8, 1);
    expect(motion.update(8, 1.1, { reducedMotion: true })).toBe(8);
    expect(motion.update(3, 2, { reducedMotion: true, paused: true })).toBe(3);
    expect(motion.update(3, 3)).toBe(3);
  });

  it('does not update after disposal', () => {
    const motion = createRadiantMarkerMotion();
    motion.update(2, 0);
    motion.destroy();
    expect(motion.update(9, 3, { reset: true })).toBeNull();
  });
});

describe('Radiant pointer / Twilight label separation', () => {
  it('leaves the accepted Twilight position unchanged when the pointer is hidden or far away', () => {
    expect(getTwilightLabelCenter(390, 48, 0.4, null, 12)).toBe(156);
    expect(getTwilightLabelCenter(390, 48, 0.4, 0.85, 12)).toBe(156);
  });
  it.each([390, 900, 1280])(
    'avoids a colliding pointer without leaving the %s px rail',
    (width) => {
      for (const fraction of [0.01, 0.4, 0.98]) {
        const center = getTwilightLabelCenter(
          width,
          48,
          fraction,
          fraction,
          12,
        );
        expect(Math.abs(center - width * fraction)).toBeGreaterThanOrEqual(33);
        expect(center - 24).toBeGreaterThanOrEqual(0);
        expect(center + 24).toBeLessThanOrEqual(width);
      }
    },
  );
});
