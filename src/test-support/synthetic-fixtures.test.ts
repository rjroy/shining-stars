import { describe, expect, it } from 'vitest';
import { syntheticChart } from './synthetic-chart';
import { createSyntheticClock } from './synthetic-clock';

describe('synthetic test support', () => {
  it('advances a controllable clock monotonically', () => {
    const clock = createSyntheticClock(2);

    expect(clock.now()).toBe(2);
    clock.advanceTo(2.25);
    expect(clock.now()).toBe(2.25);
    expect(() => clock.advanceTo(2)).toThrow(RangeError);
    expect(clock.now()).toBe(2.25);
  });

  it('provides stable, music-independent chart fixture notes', () => {
    expect(syntheticChart).toEqual([
      { id: 'synthetic-1', time: 0.5, lane: 0 },
      { id: 'synthetic-2', time: 1.25, lane: 3 },
    ]);
    expect(syntheticChart.every((note) => Number.isFinite(note.time))).toBe(
      true,
    );
  });
});
