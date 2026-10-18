import { describe, expect, it } from 'vitest';
import { getStartCountdown } from './ui';

describe('scheduled start countdown', () => {
  it.each([
    [10, 5],
    [10.001, 5],
    [11, 4],
    [12, 3],
    [13, 2],
    [14, 1],
    [14.999, 1],
    [15, null],
    [15.001, null],
  ])('reads the authoritative audio clock at %s as %s', (now, expected) => {
    expect(
      getStartCountdown({ status: 'starting', scheduledWhen: 15 }, now),
    ).toBe(expected);
  });

  it.each([
    'loading',
    'ready',
    'playing',
    'paused',
    'results',
    'error',
  ] as const)('does not show a countdown while %s', (status) => {
    expect(getStartCountdown({ status, scheduledWhen: 15 }, 10)).toBeNull();
  });

  it('does not guess a countdown before the transport has scheduled its start', () => {
    expect(
      getStartCountdown({ status: 'starting', scheduledWhen: null }, 10),
    ).toBeNull();
  });

  it('reads a newly scheduled resume rather than retaining the previous count', () => {
    expect(
      getStartCountdown({ status: 'starting', scheduledWhen: 15 }, 14),
    ).toBe(1);
    expect(
      getStartCountdown({ status: 'starting', scheduledWhen: 25 }, 20),
    ).toBe(5);
  });
});
