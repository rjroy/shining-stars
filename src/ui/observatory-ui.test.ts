import { describe, expect, it } from 'vitest';
import type { ChartConfig } from '../game/chart';
import { createSongCatalog } from '../catalog/catalog';
import { selectSongs } from '../catalog/selectors';
import { createProgression } from '../catalog/progression';
import {
  chooseObservatorySong,
  formatSongDuration,
  getObservatoryBrowserTitle,
  getSongUnlockRequest,
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
  allowedDifficulties,
  notes: [],
});
const metadataSongs = [
  {
    id: 'mixed',
    title: 'Mixed Song',
    sortOrder: 1,
    segmentKind: 'full',
    availability: 'available',
    chartStatus: 'candidate',
  },
  {
    id: 'easy-only',
    title: 'Easy Song',
    sortOrder: 2,
    segmentKind: 'full',
    availability: 'available',
    chartStatus: 'candidate',
  },
] as const;
const catalog = createSongCatalog(
  { schemaVersion: 1, songs: metadataSongs, collections: [collection] },
  {
    'mixed.charts.json': {
      schemaVersion: 1,
      songId: 'mixed',
      source: 'data/music/mixed.mp3',
      scoring: {
        version: 1,
        normalMaximum: 0,
        fiveGoldTarget: 0,
        chartFingerprint: 'a'.repeat(64),
      },
      charts: { normal: chart(['normal']), hard: chart(['hard']) },
    },
    'easy-only.charts.json': {
      schemaVersion: 1,
      songId: 'easy-only',
      source: 'data/music/easy.mp3',
      scoring: {
        version: 1,
        normalMaximum: null,
        fiveGoldTarget: null,
        chartFingerprint: null,
      },
      charts: { easy: chart(['easy']) },
    },
  },
  {
    '../../data/music/mixed.mp3': '/mixed.mp3',
    '../../data/music/easy.mp3': '/easy.mp3',
  },
);

describe('Observatory selection transitions', () => {
  it('keeps progression-locked songs browsable and selectable through both unlock steps', () => {
    const membership = {
      songs: new Map([['mixed', 'paid']]),
      collections: new Map([['paid', 2]]),
    };
    const state = createProgression();
    expect(selectSongs(catalog).map((song) => song.id)).toContain('mixed');
    expect(
      chooseObservatorySong(
        catalog,
        { selectedSongId: null, runDifficulty: null },
        'mixed',
      ),
    ).toEqual({ selectedSongId: 'mixed', runDifficulty: 'normal' });
    expect(getSongUnlockRequest('mixed', state, membership)).toEqual({
      kind: 'collection',
      collectionId: 'paid',
    });
    expect(
      getSongUnlockRequest(
        'mixed',
        { ...state, collectionPurchases: { paid: 2 } },
        membership,
      ),
    ).toEqual({ kind: 'song', songId: 'mixed' });
  });
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
      chooseObservatorySong(
        {
          ...catalog,
          songs: catalog.songs.map((song) => ({
            ...song,
            availability: 'unavailable' as const,
          })),
        },
        current,
        'mixed',
      ),
    ).toBeNull();
    expect(
      getObservatoryBrowserTitle(catalog, { collectionId: 'all-songs' }, false),
    ).toBe('All Songs');
    expect(getObservatoryBrowserTitle(catalog, {}, false)).toBe('All Songs');
    expect(getObservatoryBrowserTitle(catalog, {}, true)).toBe('Favorites');
  });
});
