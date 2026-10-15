import { describe, expect, it } from 'vitest';
import type { ChartConfig } from '../game/chart';
import { createSongCatalog, type SongCatalogEntry } from '../catalog/catalog';
import {
  chooseObservatorySong,
  formatSongDuration,
  getObservatoryBrowserTitle,
} from './observatory-ui';

const collection = {
  id: 'all-songs',
  title: 'All Songs',
  sortOrder: 0,
  songIds: ['mixed', 'easy-only'],
} as const;
const chart = (
  allowedDifficulties: ChartConfig['allowedDifficulties'],
): ChartConfig => ({
  sourceStart: 0,
  duration: 10,
  twilightAt: 5,
  twilightStrength: 100,
  allowedDifficulties,
  notes: [],
});
const songs: readonly SongCatalogEntry[] = [
  {
    id: 'mixed',
    title: 'Mixed Song',
    sortOrder: 1,
    audioUrl: '/mixed.mp3',
    chart: chart(['normal', 'hard']),
    segmentKind: 'full',
    availability: 'available',
    chartStatus: 'candidate',
    collections: ['all-songs'],
  },
  {
    id: 'easy-only',
    title: 'Easy Song',
    sortOrder: 2,
    audioUrl: '/easy.mp3',
    chart: chart(['easy']),
    segmentKind: 'full',
    availability: 'available',
    chartStatus: 'candidate',
    collections: ['all-songs'],
  },
];
const catalog = createSongCatalog(songs, [collection]);

describe('Observatory selection transitions', () => {
  it.each([
    [8.4, '0:08'],
    [65.8, '1:06'],
    [417.24, '6:57'],
  ])('formats %s seconds as %s', (seconds, expected) => {
    expect(formatSongDuration(seconds)).toBe(expected);
  });

  it('keeps the run difficulty when supported and defaults when the next song does not support it', () => {
    expect(
      chooseObservatorySong(
        catalog,
        { selectedSongId: 'easy-only', runDifficulty: 'hard' },
        'mixed',
      ),
    ).toEqual({ selectedSongId: 'mixed', runDifficulty: 'hard' });
    expect(
      chooseObservatorySong(
        catalog,
        { selectedSongId: 'mixed', runDifficulty: 'hard' },
        'easy-only',
      ),
    ).toEqual({ selectedSongId: 'easy-only', runDifficulty: 'easy' });
  });

  it('does not change selection for an unknown song and labels collection, All Songs, and Favorites routes', () => {
    const current = {
      selectedSongId: 'mixed',
      runDifficulty: 'normal' as const,
    };
    expect(chooseObservatorySong(catalog, current, 'missing')).toBeNull();
    expect(
      getObservatoryBrowserTitle(catalog, { collectionId: 'all-songs' }, false),
    ).toBe('All Songs');
    expect(getObservatoryBrowserTitle(catalog, {}, false)).toBe('All Songs');
    expect(getObservatoryBrowserTitle(catalog, {}, true)).toBe('Favorites');
  });
});
