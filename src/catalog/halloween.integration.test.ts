import { describe, expect, it } from 'vitest';
import { SONG_CATALOG } from './catalog';
import { createProgressionMembership } from './progression-catalog';
import { canStartSong, selectSongs } from './selectors';

describe('Halloween collection integration', () => {
  it('contains all ten supplied songs with playable charts at every difficulty', () => {
    const collection = SONG_CATALOG.collections.find(
      (item) => item.id === 'halloween',
    );
    expect(collection?.artworkUrl).toContain('halloween');
    expect(collection?.songIds).toEqual([
      'it-was-just-a-game',
      'march-of-scarecrows',
      'only-for-tonight',
      'set-it-out-again',
      'someone-must-lead',
      'the-little-crooked-window',
      'the-shadows-night',
      'the-thirteenth-shift',
      'when-the-storm-brings-the-damned',
      'you-will-remain',
    ]);
    const songs = selectSongs(SONG_CATALOG, { collectionId: 'halloween' });
    expect(songs).toHaveLength(10);
    const membership = createProgressionMembership();
    for (const song of songs) {
      expect(membership.songs.get(song.id)).toBe('halloween');
      expect(song.audioUrl).toBeTruthy();
      for (const difficulty of ['easy', 'normal', 'hard'] as const) {
        expect(
          canStartSong(SONG_CATALOG, song, difficulty),
          `${song.id} ${difficulty}`,
        ).toBe(true);
      }
    }
  });
});
