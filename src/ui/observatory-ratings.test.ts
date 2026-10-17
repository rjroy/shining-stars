import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as observatory from './observatory-ui';
import type { SongCatalogEntry } from '../catalog/catalog';
import type { Difficulty } from '../game/game-balance';
import type { SongRating as Rating } from '../catalog/song-ratings';
type Presentation = Readonly<{
  durationText: string;
  bestText: string;
  starsMarkup: string;
  fiveGoldTargetText: string;
  targetBasisText: string;
}>;

const chart = (duration: number, difficulty: Difficulty) => ({
  sourceStart: 0,
  duration,
  twilightAt: duration / 2,
  twilightStrength: 100,
  allowedDifficulties: [difficulty],
  notes: [],
});
const song: SongCatalogEntry = {
  id: 'rating-fixture',
  title: 'Rating Fixture',
  sortOrder: 1,
  audioUrl: '/fixture.mp3',
  source: 'fixture.mp3',
  charts: {
    easy: chart(65.8, 'easy'),
    normal: chart(65.8, 'normal'),
    hard: chart(65.8, 'hard'),
  },
  scoring: {
    version: 1,
    normalMaximum: 123450,
    fiveGoldTarget: 111105,
    chartFingerprint: 'fixture-revision',
  },
  segmentKind: 'excerpt',
  availability: 'available',
  chartStatus: 'candidate',
  collections: [],
};

// The project has no DOM test runtime. This pure presentation seam must be
// consumed by the actual row/detail renderers; it is not a fake selector page.
function present(entry: SongCatalogEntry, rating: Rating | null): Presentation {
  const factory = Reflect.get(observatory, 'getObservatorySongPresentation');
  expect(factory, 'shared selector presentation exists').toBeTypeOf('function');
  return (
    factory as (song: SongCatalogEntry, rating: Rating | null) => Presentation
  )(entry, rating);
}

describe('Observatory saved song-rating presentation', () => {
  it('keeps duration and distinguishes unplayed from played with zero stars', () => {
    const unplayed = present(song, null);
    const played = present(song, {
      played: true,
      normalStars: 0,
      goldStars: 0,
      achievementOrdinal: 0,
    });
    expect(unplayed.durationText).toBe('1:06');
    expect(played.durationText).toBe('1:06');
    expect(unplayed.bestText).toBe('Not played');
    expect(played.bestText).toBe('0 normal · 0 gold');
    expect(unplayed.starsMarkup.match(/data-rating-slot=/g)).toHaveLength(5);
    expect(played.starsMarkup.match(/data-rating-slot=/g)).toHaveLength(5);
  });

  it.each([
    [3, 0, 18],
    [5, 2, 32],
    [5, 5, 35],
  ])(
    'shows five slots for %s normal and %s gold stars',
    (normalStars, goldStars, achievementOrdinal) => {
      const value = present(song, {
        played: true,
        normalStars,
        goldStars,
        achievementOrdinal,
      });
      expect(value.bestText).toBe(`${normalStars} normal · ${goldStars} gold`);
      expect(value.starsMarkup.match(/data-rating-slot=/g)).toHaveLength(5);
      expect(
        value.starsMarkup.match(/data-rating-normal="true"/g) ?? [],
      ).toHaveLength(normalStars);
      expect(
        value.starsMarkup.match(/data-rating-gold="true"/g) ?? [],
      ).toHaveLength(goldStars);
      expect(value.starsMarkup).toContain('role="img"');
      expect(value.starsMarkup).toContain(
        `aria-label="Normal stars: ${normalStars} of 5; Gold stars: ${goldStars} of 5."`,
      );
      expect(value.starsMarkup).not.toMatch(/score-echo|<animate|<set\b/);
    },
  );

  it('uses the precomputed Normal target unchanged across difficulty choices', () => {
    const catalog = { songs: [song], collections: [], chartIssues: new Map() };
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const selection = observatory.chooseObservatorySong(
        catalog,
        { selectedSongId: song.id, runDifficulty: difficulty },
        song.id,
      );
      expect(selection?.runDifficulty).toBe(difficulty);
      const value = present(song, {
        played: true,
        normalStars: 5,
        goldStars: 2,
        achievementOrdinal: 32,
      });
      expect(value.fiveGoldTargetText).toBe('111,105');
      expect(value.targetBasisText).toBe(
        '90% of the Normal maximum · Same for every difficulty',
      );
    }
    // The UI consumes metadata rather than independently recalculating charts.
    expect(
      present(
        { ...song, scoring: { ...song.scoring, fiveGoldTarget: 90000 } },
        null,
      ).fiveGoldTargetText,
    ).toBe('90,000');
  });

  it('does not invent a zero target when a song has no Normal chart', () => {
    const value = present(
      {
        ...song,
        charts: { easy: chart(417.24, 'easy') },
        scoring: {
          version: 1,
          normalMaximum: null,
          fiveGoldTarget: null,
          chartFingerprint: null,
        },
      },
      null,
    );
    expect(value.durationText).toBe('6:57');
    expect(value.fiveGoldTargetText).toBe('Not available');
    expect(value.targetBasisText).toBe('No Normal chart');
  });

  it('wires the shared presentation and injected ratings into the real list and detail', () => {
    const source = readFileSync(
      new URL('./observatory-ui.ts', import.meta.url),
      'utf8',
    );
    const rows =
      source
        .split('function renderRows(): void {')[1]
        ?.split('function renderDetail(): void {')[0] ?? '';
    const detail =
      source
        .split('function renderDetail(): void {')[1]
        ?.split('function render(): void {')[0] ?? '';
    expect(source).toMatch(/getSongRating\??\s*:/);
    for (const render of [rows, detail]) {
      expect(render).toContain('getObservatorySongPresentation(');
      expect(render).toContain('getSongRating');
      expect(render).toContain('starsMarkup');
      expect(render).toContain('durationText');
      expect(render).toContain('bestText');
      expect(render).not.toContain('score-echo');
    }
    expect(detail).toContain('fiveGoldTargetText');
    expect(detail).toContain('Five-gold target');
    expect(detail).toContain('Personal best');
  });
});

describe('Observatory return-time rating refresh policy', () => {
  // Execute the production lifecycle method, not a replacement implementation.
  // Render doubles observe injected state; this is not DOM/browser coverage.
  const source = readFileSync(
    new URL('./observatory-ui.ts', import.meta.url),
    'utf8',
  );
  function returnToSelection(
    renderRows: () => void,
    renderDetail: () => void,
    syncStorageNotice: () => void,
  ) {
    const match = source.match(
      /setPlayStatus\(status, message = ''\) \{([\s\S]*?)\n {4}\},\n {4}focusSelectedSong/,
    );
    if (match === null) throw new Error('Production setPlayStatus method was not found');
    const body = match[1];
    const invoke = new Function(
      'renderRows',
      'renderDetail',
      'syncStorageNotice',
      'setNotice',
      'render',
      `let playStatus, playMessage; return function(status, message = '') {${body}}`,
    );
    invoke(renderRows, renderDetail, syncStorageNotice, vi.fn(), () => {
      renderRows();
      renderDetail();
      syncStorageNotice();
    })('idle');
  }

  function combineNotices(
    favorites: string | null,
    ratings: string | null,
  ): string | null {
    const combine = Reflect.get(observatory, 'getObservatoryStorageNotice');
    expect(combine, 'shared storage notice policy exists').toBeTypeOf(
      'function',
    );
    return (
      combine as (
        favoriteNotice: string | null,
        ratingNotice: string | null,
      ) => string | null
    )(favorites, ratings);
  }

  it.each([
    [
      null,
      { played: true, normalStars: 3, goldStars: 0, achievementOrdinal: 18 },
    ],
    [
      { played: true, normalStars: 3, goldStars: 0, achievementOrdinal: 18 },
      { played: true, normalStars: 5, goldStars: 2, achievementOrdinal: 32 },
    ],
  ] as const)(
    'refreshes both list and detail from the changed getter on idle return',
    (before, after) => {
      let rating: Rating | null = before;
      const options = { getSongRating: () => rating };
      const read = () => present(song, options.getSongRating()).bestText;
      let row = read();
      let detail = read();
      rating = after;
      returnToSelection(
        () => {
          row = read();
        },
        () => {
          detail = read();
        },
        vi.fn(),
      );
      expect(row).toBe(`${after.normalStars} normal · ${after.goldStars} gold`);
      expect(detail).toBe(row);
    },
  );

  it('shows rating storage trouble even when Favorites storage is healthy', () => {
    expect(
      combineNotices(null, 'Song ratings are available for this session only.'),
    ).toBe('Song ratings are available for this session only.');
    expect(combineNotices(null, null)).toBeNull();
  });

  it('retains both Favorites and rating notices rather than replacing either', () => {
    const favorites = 'Favorites are available for this session only.';
    const ratings = 'Song ratings are available for this session only.';
    expect(combineNotices(favorites, null)).toBe(favorites);
    const combined = combineNotices(favorites, ratings);
    expect(combined).toContain(favorites);
    expect(combined).toContain(ratings);
  });

  it('reads a fresh rating-storage notice after a result write falls back to session storage', () => {
    let ratingNotice: string | null = null;
    const options = { getRatingNotice: () => ratingNotice };
    let displayedNotice: string | null = null;
    const syncStorageNotice = () => {
      displayedNotice = combineNotices(null, options.getRatingNotice());
    };
    ratingNotice = 'Song ratings are available for this session only.';
    returnToSelection(vi.fn(), vi.fn(), syncStorageNotice);
    expect(displayedNotice).toBe(ratingNotice);
  });
});
