import { describe, expect, it, vi } from 'vitest';
import { SONG_CATALOG, createSongCatalog, type SongCatalogEntry, type SongCollection } from './catalog';
import { canStartSong, getOrderedSongs, selectSongs } from './selectors';

describe('static song catalog', () => {
  it('registers seven statically paired records with explicit demo metadata', () => {
    expect(SONG_CATALOG.songs).toHaveLength(7);
    expect(SONG_CATALOG.collections[0]?.title).toBe('All Songs');
    expect(SONG_CATALOG.collections[0]?.songIds).toHaveLength(7);
    const demo = SONG_CATALOG.songs[0];
    expect(demo).toMatchObject({ id: 'the-first-shining-star', segmentKind: 'excerpt', chartStatus: 'candidate' });
    expect(demo?.chart).toMatchObject({ sourceStart: 107.1, duration: 65.8, twilightAt: 39.2 });
    expect(SONG_CATALOG.songs.slice(1).every((song) => song.segmentKind === 'full')).toBe(true);
    expect(SONG_CATALOG.songs.every((song) => song.audioUrl.endsWith('.mp3'))).toBe(true);
    expect([...SONG_CATALOG.chartIssues.values()].every((issues) => issues.length === 0)).toBe(true);
  });

  it('sorts deterministically and does not gate candidate songs from play', () => {
    expect(getOrderedSongs(SONG_CATALOG).map((song) => song.sortOrder)).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(canStartSong(SONG_CATALOG, SONG_CATALOG.songs[0] ?? null, 'normal')).toBe(true);
  });

  it('validates duplicate IDs, collection references and chart validity at construction', () => {
    const first = SONG_CATALOG.songs[0];
    if (first === undefined) throw new Error('Expected registered song fixture.');
    const collection: SongCollection = { id: 'fixture', title: 'Fixture', sortOrder: 0, songIds: [first.id] };
    const entry: SongCatalogEntry = { ...first, collections: ['fixture'] };
    expect(() => createSongCatalog([entry, entry], [collection])).toThrow(/duplicate song ID/);
    expect(() => createSongCatalog([{ ...entry, collections: ['missing'] }], [collection])).toThrow(/unknown collection/);
    expect(() => createSongCatalog([{ ...entry, chart: { ...entry.chart, allowedDifficulties: [] } }], [collection])).toThrow(/non-empty array/);
    const invalid = createSongCatalog([{ ...entry, chart: { ...entry.chart, sourceStart: -1 } }], [collection]);
    expect(invalid.chartIssues.get(entry.id)).not.toHaveLength(0);
    expect(canStartSong(invalid, invalid.songs[0] ?? null, 'normal')).toBe(false);
  });

  it('browses metadata without invoking audio fetch or decode APIs', () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    try {
      expect(selectSongs(SONG_CATALOG).length).toBe(7);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
