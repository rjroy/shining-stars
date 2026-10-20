import { describe, expect, it } from 'vitest';
import {
  createPersonalBestResultSnapshot,
  formatPersonalBestResult,
  formatPersonalBestScore,
} from './personal-best-copy';

describe('personal best score presentation', () => {
  it('labels selected difficulty and distinguishes missing from zero', () => {
    expect(formatPersonalBestScore('easy', null)).toBe(
      'Easy best score: No score yet',
    );
    expect(formatPersonalBestScore('normal', 0)).toBe('Normal best score: 0');
    expect(formatPersonalBestScore('hard', 1234)).toBe(
      'Hard best score: 1,234',
    );
  });
  it('distinguishes first score, improvements, ties and lower results', () => {
    expect(
      formatPersonalBestResult({
        previousBest: null,
        best: 0,
        isNewBest: true,
      }),
    ).toBe('First score recorded · Personal best: 0');
    expect(
      formatPersonalBestResult({ previousBest: 0, best: 12, isNewBest: true }),
    ).toBe('New personal best · Previous best: 0');
    for (const best of [0, 12])
      expect(
        formatPersonalBestResult({
          previousBest: best,
          best,
          isNewBest: false,
        }),
      ).not.toContain('New personal best');
    expect(
      formatPersonalBestResult({
        previousBest: 12,
        best: 12,
        isNewBest: false,
      }),
    ).toContain('Previous best: 12');
  });
  it('copies comparisons, rejects other runs, and resets on retry or a new performance', () => {
    const tracker = createPersonalBestResultSnapshot();
    expect(tracker.read(1, true)).toBeNull();
    const comparison = { previousBest: 0, best: 12, isNewBest: true };
    tracker.record(1, comparison);
    comparison.best = 999;
    expect(tracker.read(1, true)?.best).toBe(12);
    const copy = tracker.read(1, true)!;
    expect(tracker.read(2, true)).toBeNull();
    expect(tracker.read(1, true)).toEqual(copy);
    expect(tracker.read(2, false)).toBeNull();
    expect(tracker.read(1, true)).toBeNull();
    tracker.record(2, { previousBest: 12, best: 12, isNewBest: false });
    expect(tracker.read(2, true)?.isNewBest).toBe(false);
    expect(createPersonalBestResultSnapshot().read(2, true)).toBeNull();
  });
});
