import { describe, expect, it } from 'vitest';
import type { ChartConfig } from '../game/chart';
import {
  createSongCatalog,
  type GeneratedSongCharts,
  type SongCollection,
} from './catalog';
import {
  canStartSong,
  normalizeSongSearch,
  reconcileSongSelection,
  selectSongs,
} from './selectors';

const collection: SongCollection = {
  id: 'all-songs',
  title: 'All Songs',
  sortOrder: 0,
  songIds: ['mixed', 'easy-only', 'unavailable'],
};

function chart(
  allowedDifficulties: ChartConfig['allowedDifficulties'],
): ChartConfig {
  return {
    sourceStart: 0,
    duration: 10,
    twilightAt: 5,
    allowedDifficulties,
    notes: [],
  };
}

const metadataSongs = [
  {
    id: 'mixed',
    title: 'Café Night',
    sortOrder: 1,
    segmentKind: 'full',
    availability: 'available',
    chartStatus: 'candidate',
  },
  {
    id: 'easy-only',
    title: 'Quiet Song',
    sortOrder: 2,
    segmentKind: 'full',
    availability: 'available',
    chartStatus: 'candidate',
  },
  {
    id: 'unavailable',
    title: 'Unavailable Song',
    sortOrder: 3,
    segmentKind: 'full',
    availability: 'unavailable',
    chartStatus: 'candidate',
  },
] as const;
const chartBundle = (
  id: string,
  charts: GeneratedSongCharts['charts'],
): GeneratedSongCharts => ({
  schemaVersion: 1,
  songId: id,
  source: `data/music/${id}.mp3`,
  scoring:
    charts.normal === undefined
      ? {
          version: 1,
          normalMaximum: null,
          fiveGoldTarget: null,
          chartFingerprint: null,
        }
      : {
          version: 1,
          normalMaximum: 0,
          fiveGoldTarget: 0,
          chartFingerprint: '0'.repeat(64),
        },
  charts,
});
const chartFiles = {
  'mixed.charts.json': chartBundle('mixed', {
    normal: chart(['normal']),
    hard: chart(['hard']),
  }),
  'easy-only.charts.json': chartBundle('easy-only', { easy: chart(['easy']) }),
  'unavailable.charts.json': chartBundle('unavailable', {
    normal: chart(['normal']),
  }),
};
const audioFiles = Object.fromEntries(
  ['mixed', 'easy-only', 'unavailable'].map((id) => [
    `../../data/music/${id}.mp3`,
    `/${id}.mp3`,
  ]),
);
const catalog = createSongCatalog(
  { schemaVersion: 1, songs: metadataSongs, collections: [collection] },
  chartFiles,
  audioFiles,
);

describe('catalog browsing selectors', () => {
  it('normalizes Unicode accents and case for title search only', () => {
    expect(normalizeSongSearch('  CAFÉ  ')).toBe('cafe');
    expect(
      selectSongs(catalog, { query: 'cafe' }).map((song) => song.id),
    ).toEqual(['mixed']);
    expect(selectSongs(catalog, { query: 'audio' })).toEqual([]);
  });

  it('intersects search, collection and favorites filters', () => {
    expect(
      selectSongs(
        catalog,
        {
          favoritesOnly: true,
          query: 'CAFÉ',
          collectionId: 'all-songs',
        },
        new Set(['mixed', 'easy-only']),
      ).map((song) => song.id),
    ).toEqual(['mixed']);
    expect(
      selectSongs(catalog, { favoritesOnly: true }, new Set(['unavailable'])),
    ).toEqual([]);
    expect(
      selectSongs(catalog, { query: 'Quiet' }).map((song) => song.id),
    ).toEqual(['easy-only']);
  });

  it('keeps run difficulty and reconciles selection by stable ID', () => {
    const initiallySelected = {
      selectedSongId: 'mixed',
      runDifficulty: 'hard' as const,
    };
    expect(reconcileSongSelection(catalog, {}, initiallySelected)).toEqual(
      initiallySelected,
    );
    expect(
      reconcileSongSelection(catalog, { query: 'Quiet' }, initiallySelected),
    ).toEqual({
      selectedSongId: 'easy-only',
      runDifficulty: 'easy',
    });
    expect(
      reconcileSongSelection(
        catalog,
        { query: 'Unavailable Song' },
        initiallySelected,
      ),
    ).toEqual({
      selectedSongId: null,
      runDifficulty: null,
    });
  });

  it('hides editorially unavailable entries in every browse scope and rejects stale starts', () => {
    expect(selectSongs(catalog).map((song) => song.id)).toEqual([
      'mixed',
      'easy-only',
    ]);
    expect(
      selectSongs(catalog, { collectionId: 'all-songs' }).map(
        (song) => song.id,
      ),
    ).toEqual(['mixed', 'easy-only']);
    const unavailable = catalog.songs.find(
      (song) => song.id === 'unavailable',
    )!;
    expect(unavailable.availability).toBe('unavailable');
    expect(canStartSong(catalog, unavailable, 'normal')).toBe(false);
    expect(canStartSong(catalog, catalog.songs[0]!, 'normal')).toBe(true);
    expect(canStartSong(catalog, catalog.songs[0]!, 'easy')).toBe(false);
    expect(
      reconcileSongSelection(
        catalog,
        {},
        { selectedSongId: unavailable.id, runDifficulty: 'normal' },
      ),
    ).toEqual({ selectedSongId: 'mixed', runDifficulty: 'normal' });
    const hiddenCatalog = { ...catalog, songs: [unavailable] };
    expect(selectSongs(hiddenCatalog)).toEqual([]);
    expect(
      reconcileSongSelection(
        hiddenCatalog,
        {},
        { selectedSongId: unavailable.id, runDifficulty: 'normal' },
      ),
    ).toEqual({ selectedSongId: null, runDifficulty: null });
  });

  it('retains a supported run difficulty, otherwise uses default, then clears when there are no results', () => {
    expect(
      reconcileSongSelection(
        catalog,
        {},
        { selectedSongId: 'mixed', runDifficulty: 'normal' },
      ),
    ).toEqual({
      selectedSongId: 'mixed',
      runDifficulty: 'normal',
    });
    expect(
      reconcileSongSelection(
        catalog,
        { query: 'nothing' },
        { selectedSongId: 'mixed', runDifficulty: 'hard' },
      ),
    ).toEqual({
      selectedSongId: null,
      runDifficulty: null,
    });
  });
});
