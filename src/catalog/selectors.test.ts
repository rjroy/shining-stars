import { describe, expect, it } from 'vitest';
import type { ChartConfig } from '../game/chart';
import { createSongCatalog, type SongCatalogEntry, type SongCollection } from './catalog';
import { normalizeSongSearch, reconcileSongSelection, selectSongs } from './selectors';

const collection: SongCollection = {
  id: 'all-songs', title: 'All Songs', sortOrder: 0, songIds: ['mixed', 'easy-only', 'unavailable'],
};

function chart(allowedDifficulties: ChartConfig['allowedDifficulties']): ChartConfig {
  return {
    sourceStart: 0, duration: 10, twilightAt: 5, twilightStrength: 100,
    allowedDifficulties, notes: [],
  };
}

const songs: readonly SongCatalogEntry[] = [
  {
    id: 'mixed', title: 'Café Night', sortOrder: 1, audioUrl: '/cafe.mp3',
    chart: chart(['normal', 'hard']), segmentKind: 'full', availability: 'available',
    chartStatus: 'candidate', collections: ['all-songs'],
  },
  {
    id: 'easy-only', title: 'Quiet Song', sortOrder: 2, audioUrl: '/quiet.mp3',
    chart: chart(['easy']), segmentKind: 'full', availability: 'available',
    chartStatus: 'candidate', collections: ['all-songs'],
  },
  {
    id: 'unavailable', title: 'Unavailable Song', sortOrder: 3, audioUrl: '/unavailable.mp3',
    chart: chart(['normal']), segmentKind: 'full', availability: 'unavailable',
    chartStatus: 'candidate', collections: ['all-songs'],
  },
];
const catalog = createSongCatalog(songs, [collection]);

describe('catalog browsing selectors', () => {
  it('normalizes Unicode accents and case for title search only', () => {
    expect(normalizeSongSearch('  CAFÉ  ')).toBe('cafe');
    expect(selectSongs(catalog, { query: 'cafe' }).map((song) => song.id)).toEqual(['mixed']);
    expect(selectSongs(catalog, { query: 'audio' })).toEqual([]);
  });

  it('intersects favorites, availability and supports-difficulty filters independently', () => {
    expect(selectSongs(catalog, { favoritesOnly: true, availability: 'available', supportsDifficulty: 'hard' }, new Set(['mixed', 'easy-only'])).map((song) => song.id)).toEqual(['mixed']);
    expect(selectSongs(catalog, { availability: 'unavailable' }).map((song) => song.id)).toEqual(['unavailable']);
    expect(selectSongs(catalog, { supportsDifficulty: 'easy' }).map((song) => song.id)).toEqual(['easy-only']);
  });

  it('keeps run difficulty independent of a supports-difficulty filter and reconciles selection by stable ID', () => {
    const initiallySelected = { selectedSongId: 'mixed', runDifficulty: 'hard' as const };
    expect(reconcileSongSelection(catalog, { supportsDifficulty: 'hard' }, initiallySelected)).toEqual(initiallySelected);
    expect(reconcileSongSelection(catalog, { supportsDifficulty: 'easy' }, initiallySelected)).toEqual({
      selectedSongId: 'easy-only', runDifficulty: 'easy',
    });
    expect(reconcileSongSelection(catalog, { availability: 'unavailable' }, initiallySelected)).toEqual({
      selectedSongId: null, runDifficulty: null,
    });
  });

  it('retains a supported run difficulty, otherwise uses default, then clears when there are no results', () => {
    expect(reconcileSongSelection(catalog, {}, { selectedSongId: 'mixed', runDifficulty: 'normal' })).toEqual({
      selectedSongId: 'mixed', runDifficulty: 'normal',
    });
    expect(reconcileSongSelection(catalog, { query: 'nothing' }, { selectedSongId: 'mixed', runDifficulty: 'hard' })).toEqual({
      selectedSongId: null, runDifficulty: null,
    });
  });
});
