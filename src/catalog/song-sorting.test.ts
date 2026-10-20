import { describe, expect, it } from 'vitest';
import type { SongCatalog, SongCatalogEntry } from './catalog';
import {
  reconcileSongSelection,
  selectSongs,
  type SongSortMode,
} from './selectors';

const song = (
  id: string,
  title: string,
  duration: number,
  target: number | null,
  sortOrder: number,
): SongCatalogEntry => ({
  id,
  title,
  sortOrder,
  audioUrl: `/${id}.mp3`,
  source: id,
  segmentKind: 'full',
  availability: 'available',
  chartStatus: 'candidate',
  collections: ['fixture'],
  scoring: {
    version: 1,
    normalMaximum: null,
    fiveGoldTarget: target,
    chartFingerprint: null,
  },
  charts: {
    normal: {
      sourceStart: 0,
      duration,
      twilightAt: duration / 2,
      allowedDifficulties: ['normal'],
      notes: [],
    },
    hard: {
      sourceStart: 0,
      duration: 1,
      twilightAt: 0.5,
      allowedDifficulties: ['hard'],
      notes: [],
    },
  },
});
const catalog: SongCatalog = {
  songs: [
    song('a', 'Zulu', 20, 100, 0),
    song('b', 'Alpha', 10, 100, 1),
    song('c', 'Alpha', 20, 100, 2),
    song('d', 'Missing', 5, null, 3),
    song('e', 'Invalid', 0, 20, 4),
    song('f', 'Negative', 10, -1, 5),
  ],
  collections: [
    {
      id: 'fixture',
      title: 'Fixture',
      sortOrder: 0,
      songIds: ['c', 'b', 'a', 'd', 'e', 'f'],
    },
  ],
  chartIssues: new Map(),
};
const ids = (mode: SongSortMode = 'unsorted') =>
  selectSongs(catalog, {}, new Set(), {}, mode).map((s) => s.id);

describe('ephemeral song sorting', () => {
  it('defaults to original catalog/collection order and never mutates either', () => {
    const original = JSON.stringify(catalog);
    expect(selectSongs(catalog).map((s) => s.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
    ]);
    expect(
      selectSongs(catalog, { collectionId: 'fixture' }).map((s) => s.id),
    ).toEqual(['c', 'b', 'a', 'd', 'e', 'f']);
    ids('alphabetical');
    ids('length');
    ids('difficulty');
    expect(JSON.stringify(catalog)).toBe(original);
  });
  it('sorts A–Z with equal titles retaining original scope order', () => {
    expect(ids('alphabetical')).toEqual(['b', 'c', 'e', 'd', 'f', 'a']);
    expect(
      selectSongs(
        catalog,
        { collectionId: 'fixture' },
        new Set(),
        {},
        'alphabetical',
      )
        .slice(0, 2)
        .map((s) => s.id),
    ).toEqual(['c', 'b']);
  });
  it('sorts shortest first with invalid duration last and stable ties', () => {
    expect(ids('length')).toEqual(['d', 'b', 'f', 'a', 'c', 'e']);
  });
  it('uses fiveGoldTarget / browse seconds, with missing/invalid metrics last', () => {
    expect(ids('difficulty')).toEqual(['a', 'c', 'b', 'd', 'e', 'f']);
    const invalid = {
      ...catalog,
      songs: [
        song('nan', 'NaN', NaN, 10, 0),
        song('infinite', 'Infinite', 10, Infinity, 1),
        song('zero', 'Zero', 10, 0, 2),
      ],
    };
    expect(
      selectSongs(invalid, {}, new Set(), {}, 'difficulty').map((s) => s.id),
    ).toEqual(['zero', 'nan', 'infinite']);
  });
  it('composes with AND filters and preserves selected song and run difficulty', () => {
    const filters = {
      query: 'a',
      collectionId: 'fixture',
      favoritesOnly: true,
      unlockStatus: 'unlocked' as const,
      unplayedOnly: true,
      undefeatedDifficulty: 'hard' as const,
      belowFiveNormalStars: true,
      belowFiveGoldStars: true,
    };
    const favorites = new Set(['a', 'b', 'c']);
    const progress = { isUnlocked: (id: string) => id !== 'b' };
    expect(
      selectSongs(catalog, filters, favorites, progress, 'difficulty').map(
        (s) => s.id,
      ),
    ).toEqual(['c']);
    for (const mode of [
      'unsorted',
      'alphabetical',
      'length',
      'difficulty',
    ] as const) {
      for (const runDifficulty of ['normal', 'hard'] as const) {
        const selected = { selectedSongId: 'a', runDifficulty };
        expect(
          reconcileSongSelection(
            catalog,
            {},
            selected,
            favorites,
            progress,
            mode,
          ),
        ).toEqual(selected);
      }
    }
    expect(
      reconcileSongSelection(
        catalog,
        { query: 'Alpha' },
        { selectedSongId: 'a', runDifficulty: 'hard' },
        favorites,
        progress,
        'difficulty',
      ).selectedSongId,
    ).toBe('c');
  });
});
