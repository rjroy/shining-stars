import { describe, expect, it } from 'vitest';
import type { SongCatalog, SongCatalogEntry } from './catalog';
import type { SongRating } from './song-ratings';
import {
  reconcileSongSelection,
  selectSongs,
  type SongBrowseFilters,
  type SongBrowseProgress,
} from './selectors';

const ids = ['new', 'zero', 'four', 'five', 'gold', 'perfect', 'hidden'];
const songs: SongCatalogEntry[] = ids.map((id, index) => ({
  id,
  title: `Fixture ${id}`,
  sortOrder: index,
  audioUrl: `/${id}.mp3`,
  source: id,
  segmentKind: 'full',
  availability: id === 'hidden' ? 'unavailable' : 'available',
  chartStatus: 'candidate',
  collections: ['fixture'],
  scoring: {
    version: 1,
    normalMaximum: 0,
    fiveGoldTarget: 0,
    chartFingerprint: null,
  },
  charts: {
    normal: {
      sourceStart: 0,
      duration: 10,
      twilightAt: 5,
      notes: [],
      allowedDifficulties: ['normal'],
    },
  },
}));
const catalog: SongCatalog = {
  songs,
  collections: [
    { id: 'fixture', title: 'Fixture', sortOrder: 0, songIds: ids },
  ],
  chartIssues: new Map(),
};
const rating = (normalStars: number, goldStars = 0): SongRating => ({
  played: true,
  normalStars,
  goldStars,
  achievementOrdinal: normalStars * 6 + goldStars,
});
const ratings = new Map([
  ['zero', rating(0)],
  ['four', rating(4)],
  ['five', rating(5)],
  ['gold', rating(5, 1)],
  ['perfect', rating(5, 5)],
]);
const progress: SongBrowseProgress = {
  getRating: (id) => ratings.get(id) ?? null,
  isUnlocked: (id) => id !== 'four',
  getVictoryDifficulty: (id) =>
    id === 'five'
      ? 'normal'
      : id === 'perfect'
        ? 'hard'
        : id === 'four'
          ? 'easy'
          : undefined,
};
const results = (
  filters: SongBrowseFilters,
  state = progress,
  favorites = new Set(ids),
) => selectSongs(catalog, filters, favorites, state).map((song) => song.id);

describe('independent progression browse filters', () => {
  it.each([
    [{}, ['new', 'zero', 'four', 'five', 'gold', 'perfect']],
    [
      { unlockStatus: 'all' },
      ['new', 'zero', 'four', 'five', 'gold', 'perfect'],
    ],
    [{ unlockStatus: 'unlocked' }, ['new', 'zero', 'five', 'gold', 'perfect']],
    [{ unlockStatus: 'locked' }, ['four']],
    [{ unplayedOnly: true }, ['new']],
    [{ belowFiveNormalStars: true }, ['new', 'zero', 'four']],
    [{ belowFiveGoldStars: true }, ['new', 'zero', 'four', 'five', 'gold']],
    [{ undefeatedDifficulty: 'easy' }, ['new', 'zero', 'gold']],
    [{ undefeatedDifficulty: 'normal' }, ['new', 'zero', 'four', 'gold']],
    [{ undefeatedDifficulty: 'hard' }, ['new', 'zero', 'four', 'five', 'gold']],
  ] as const)(
    'applies %j without hiding unrelated locked or candidate songs',
    (filters, expected) => {
      expect(results(filters)).toEqual(expected);
    },
  );

  it('unchecked and None apply no opposite condition; missing save means unplayed and no credited victories', () => {
    expect(
      results({
        unlockStatus: 'all',
        unplayedOnly: false,
        belowFiveNormalStars: false,
        belowFiveGoldStars: false,
        undefeatedDifficulty: undefined,
      }),
    ).toEqual(results({}));
    expect(
      results(
        {
          unplayedOnly: true,
          belowFiveNormalStars: true,
          belowFiveGoldStars: true,
          undefeatedDifficulty: 'hard',
        },
        {},
      ),
    ).toEqual(results({}));
    expect(results({ unplayedOnly: true })).not.toContain('zero');
    expect(
      results(
        { belowFiveNormalStars: true },
        { getRating: () => rating(0, 1) },
      ),
    ).toEqual([]);
  });

  it('ANDs all five criteria with search, collection and favorites', () => {
    const filters: SongBrowseFilters = {
      query: 'FIXTURE',
      collectionId: 'fixture',
      favoritesOnly: true,
      unlockStatus: 'unlocked',
      unplayedOnly: true,
      undefeatedDifficulty: 'hard',
      belowFiveNormalStars: true,
      belowFiveGoldStars: true,
    };
    expect(results(filters)).toEqual(['new']);
    expect(results(filters, progress, new Set(['zero']))).toEqual([]);
    expect(results({ ...filters, unlockStatus: 'locked' })).toEqual([]);
    expect(results({ ...filters, unlockStatus: 'all' })).toEqual(['new']);
    expect(results({ ...filters, collectionId: 'other' })).toEqual([]);
    expect(results({ ...filters, query: 'not present' })).toEqual([]);
  });

  it('uses highest credited victory and not run difficulty, including tiers without a supported chart', () => {
    const selected = {
      selectedSongId: 'five',
      runDifficulty: 'normal' as const,
    };
    expect(
      reconcileSongSelection(
        catalog,
        { undefeatedDifficulty: 'hard' },
        selected,
        new Set(),
        progress,
      ),
    ).toEqual(selected);
    expect(
      reconcileSongSelection(
        catalog,
        { undefeatedDifficulty: 'normal' },
        selected,
        new Set(),
        progress,
      ).selectedSongId,
    ).toBe('new');
    expect(results({ undefeatedDifficulty: 'easy' })).not.toContain('five');
    expect(results({ undefeatedDifficulty: 'normal' })).not.toContain(
      'perfect',
    );
  });

  it('recomputes save-derived matches and selection after results, unlocks, import and reset', () => {
    let currentRating: SongRating | null = null;
    let unlocked = false;
    let credit: 'hard' | undefined;
    const state: SongBrowseProgress = {
      getRating: () => currentRating,
      isUnlocked: () => unlocked,
      getVictoryDifficulty: () => credit,
    };
    const filters: SongBrowseFilters = {
      unplayedOnly: true,
      belowFiveGoldStars: true,
    };
    const selected = {
      selectedSongId: 'four',
      runDifficulty: 'normal' as const,
    };
    expect(
      reconcileSongSelection(catalog, filters, selected, new Set(), state),
    ).toEqual(selected);
    currentRating = rating(0); // Completed defeat still counts as played.
    expect(
      reconcileSongSelection(catalog, filters, selected, new Set(), state),
    ).toEqual({ selectedSongId: null, runDifficulty: null });
    expect(results({ unlockStatus: 'unlocked' }, state)).toEqual([]);
    expect(results({ unlockStatus: 'locked' }, state)).toEqual(results({}));
    unlocked = true;
    expect(results({ unlockStatus: 'unlocked' }, state)).toEqual(results({}));
    expect(results({ unlockStatus: 'locked' }, state)).toEqual([]);
    expect(
      reconcileSongSelection(
        catalog,
        { unlockStatus: 'locked' },
        selected,
        new Set(),
        state,
      ),
    ).toEqual({ selectedSongId: null, runDifficulty: null });
    currentRating = rating(5, 5);
    credit = 'hard'; // Imported best result and credit.
    expect(results({ belowFiveGoldStars: true }, state)).toEqual([]);
    expect(results({ undefeatedDifficulty: 'easy' }, state)).toEqual([]);
    currentRating = null;
    credit = undefined;
    unlocked = false; // Reset.
    expect(
      reconcileSongSelection(catalog, filters, selected, new Set(), state),
    ).toEqual(selected);
  });
});
