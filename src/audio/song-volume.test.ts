import { describe, expect, it } from 'vitest';
import { parseSongOutputVolume } from './song-volume';

describe('song output volume setting', () => {
  it('defaults to existing full-volume output when unset or blank', () => {
    expect(parseSongOutputVolume(undefined)).toBe(1);
    expect(parseSongOutputVolume('')).toBe(1);
    expect(parseSongOutputVolume('  ')).toBe(1);
  });

  it('accepts zero and finite values through one', () => {
    expect(parseSongOutputVolume('0')).toBe(0);
    expect(parseSongOutputVolume('0.35')).toBe(0.35);
    expect(parseSongOutputVolume('1')).toBe(1);
  });

  it.each(['-0.1', '1.01', 'NaN', 'Infinity', 'quiet'])(
    'uses full volume for invalid or out-of-range value %s',
    (value) => {
      expect(parseSongOutputVolume(value)).toBe(1);
    },
  );
});
