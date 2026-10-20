import { describe, expect, it, vi } from 'vitest';
import type { ChartConfig } from '../game/chart';
import {
  createSongCatalog,
  getSongChart,
  getSongDifficulties,
  type CatalogMetadata,
  type GeneratedSongCharts,
} from './catalog';
import { canStartSong, selectSongs } from './selectors';

const chart = (difficulty: 'easy' | 'normal' | 'hard'): ChartConfig => ({
  sourceStart: 0,
  duration: 20,
  twilightAt: 10,
  allowedDifficulties: [difficulty],
  notes: [{ id: `${difficulty}-note`, time: 4, lane: 0 }],
});

const metadata: CatalogMetadata = {
  schemaVersion: 1,
  songs: [
    {
      id: 'mixed-song',
      title: 'Mixed Song',
      sortOrder: 10,
      segmentKind: 'full',
      availability: 'available',
      chartStatus: 'candidate',
    },
    {
      id: 'easy-song',
      title: 'Easy Song',
      sortOrder: 20,
      segmentKind: 'full',
      availability: 'available',
      chartStatus: 'candidate',
    },
  ],
  collections: [
    {
      id: 'all-songs',
      title: 'All Songs',
      sortOrder: 0,
      songIds: ['mixed-song', 'easy-song'],
    },
  ],
};
const generated: Readonly<Record<string, GeneratedSongCharts>> = {
  'mixed-song.charts.json': {
    schemaVersion: 1,
    songId: 'mixed-song',
    source: 'data/music/Mixed Song.mp3',
    scoring: {
      version: 1,
      normalMaximum: 100,
      fiveGoldTarget: 90,
      chartFingerprint: 'a'.repeat(64),
    },
    charts: { normal: chart('normal'), hard: chart('hard') },
  },
  'easy-song.charts.json': {
    schemaVersion: 1,
    songId: 'easy-song',
    source: 'data/music/Easy Song.mp3',
    scoring: {
      version: 1,
      normalMaximum: null,
      fiveGoldTarget: null,
      chartFingerprint: null,
    },
    charts: { easy: chart('easy') },
  },
};
const audio = {
  '../../data/music/Mixed Song.mp3': '/mixed.mp3',
  '../../data/music/Easy Song.mp3': '/easy.mp3',
};

describe('song catalog runtime', () => {
  it('loads mixed per-song difficulty sets and preserves each chart variant', () => {
    const catalog = createSongCatalog(metadata, generated, audio);
    const mixed = catalog.songs[0]!;
    expect(getSongDifficulties(mixed)).toEqual(['normal', 'hard']);
    expect(getSongChart(mixed, 'normal')).toEqual(chart('normal'));
    expect(getSongChart(mixed, 'hard')).toEqual(chart('hard'));
    expect(mixed.scoring).toEqual({
      version: 1,
      normalMaximum: 100,
      fiveGoldTarget: 90,
      chartFingerprint: 'a'.repeat(64),
    });
    expect(Object.isFrozen(mixed.scoring)).toBe(true);
    expect(getSongDifficulties(catalog.songs[1]!)).toEqual(['easy']);
    expect(catalog.songs[1]?.scoring).toEqual({
      version: 1,
      normalMaximum: null,
      fiveGoldTarget: null,
      chartFingerprint: null,
    });
    expect(Object.isFrozen(getSongChart(mixed, 'normal').notes[0])).toBe(true);
    expect(
      Object.isFrozen(getSongChart(mixed, 'hard').allowedDifficulties),
    ).toBe(true);
  });

  it('requires valid generated scoring metadata and nulls it without Normal', () => {
    const bundle = generated['mixed-song.charts.json']!;
    const withScoring = (
      scoring: unknown,
    ): Readonly<Record<string, unknown>> => ({
      ...generated,
      'mixed-song.charts.json': { ...bundle, scoring },
    });

    for (const scoring of [
      undefined,
      null,
      { ...bundle.scoring, version: 2 },
      { ...bundle.scoring, normalMaximum: null },
      { ...bundle.scoring, fiveGoldTarget: 181 },
      { ...bundle.scoring, chartFingerprint: 'not-a-fingerprint' },
    ]) {
      expect(() =>
        createSongCatalog(metadata, withScoring(scoring), audio),
      ).toThrow(/scoring/);
    }

    const easyBundle = generated['easy-song.charts.json']!;
    for (const scoring of [
      { ...easyBundle.scoring, normalMaximum: 100 },
      { ...easyBundle.scoring, fiveGoldTarget: 90 },
      { ...easyBundle.scoring, chartFingerprint: 'b'.repeat(64) },
    ]) {
      expect(() =>
        createSongCatalog(
          metadata,
          {
            ...generated,
            'easy-song.charts.json': { ...easyBundle, scoring },
          },
          audio,
        ),
      ).toThrow(/scoring/);
    }
  });

  it('rejects bundle ID/source/audio mismatches and non-singleton variants', () => {
    expect(() =>
      createSongCatalog(
        metadata,
        {
          ...generated,
          'extra.charts.json': {
            ...generated['easy-song.charts.json']!,
            songId: 'extra',
            source: 'data/music/Extra.mp3',
          },
        },
        audio,
      ),
    ).toThrow(/exactly match/);
    const badVariant = {
      ...generated,
      'mixed-song.charts.json': {
        ...generated['mixed-song.charts.json']!,
        charts: {
          normal: {
            ...chart('normal'),
            allowedDifficulties: ['normal', 'hard'] as const,
          },
        },
      },
    };
    expect(() => createSongCatalog(metadata, badVariant, audio)).toThrow(
      /must allow only normal/,
    );
    expect(() =>
      createSongCatalog(metadata, generated, {
        '../../data/music/Easy Song.mp3': '/easy.mp3',
      }),
    ).toThrow(/missing audio/);
  });

  it('rejects malformed chart containers, chart fields, and note IDs clearly', () => {
    const withCharts = (
      charts: unknown,
    ): Readonly<Record<string, unknown>> => ({
      ...generated,
      'mixed-song.charts.json': {
        ...generated['mixed-song.charts.json'],
        charts,
      },
    });

    expect(() => createSongCatalog(metadata, withCharts(null), audio)).toThrow(
      /mixed-song\.charts\.json.*invalid envelope/,
    );
    expect(() => createSongCatalog(metadata, withCharts([]), audio)).toThrow(
      /mixed-song\.charts\.json.*invalid envelope/,
    );
    expect(() =>
      createSongCatalog(
        metadata,
        withCharts({
          normal: {
            sourceStart: 0,
            duration: 20,
            twilightAt: 10,
            allowedDifficulties: ['normal'],
          },
        }),
        audio,
      ),
    ).toThrow(/mixed-song.*normal chart.*invalid fields or notes/);
    expect(() =>
      createSongCatalog(
        metadata,
        withCharts({ normal: { ...chart('normal'), notes: null } }),
        audio,
      ),
    ).toThrow(/mixed-song.*normal chart.*invalid fields or notes/);

    for (const id of [undefined, 42, '  ']) {
      expect(() =>
        createSongCatalog(
          metadata,
          withCharts({
            normal: {
              ...chart('normal'),
              notes: [{ ...chart('normal').notes[0], id }],
            },
          }),
          audio,
        ),
      ).toThrow(/mixed-song.*normal chart.*non-empty string ID/);
    }
  });

  it('validates chart issues per difficulty and gates only the selected invalid variant', () => {
    const bad = {
      ...generated,
      'mixed-song.charts.json': {
        ...generated['mixed-song.charts.json']!,
        charts: {
          normal: { ...chart('normal'), duration: -1 },
          hard: chart('hard'),
        },
      },
    };
    const catalog = createSongCatalog(metadata, bad, audio);
    const mixed = catalog.songs[0]!;
    expect(catalog.chartIssues.get(mixed.id)?.normal).not.toHaveLength(0);
    expect(catalog.chartIssues.get(mixed.id)?.hard).toEqual([]);
    expect(canStartSong(catalog, mixed, 'normal')).toBe(false);
    expect(canStartSong(catalog, mixed, 'hard')).toBe(true);
    expect(
      selectSongs(catalog, { query: 'Easy' }).map((song) => song.id),
    ).toEqual(['easy-song']);
  });

  it('browses metadata without invoking audio fetch or decode APIs', () => {
    const catalog = createSongCatalog(metadata, generated, audio);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(selectSongs(catalog)).toHaveLength(2);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('preserves the authored membership order within each collection scope', () => {
    const authored = {
      ...metadata,
      collections: [
        {
          id: 'alpha',
          title: 'Alpha',
          sortOrder: 10,
          songIds: ['easy-song', 'mixed-song'],
        },
        {
          id: 'beta',
          title: 'Beta',
          sortOrder: 20,
          songIds: ['mixed-song', 'easy-song'],
        },
      ],
    };
    const catalog = createSongCatalog(authored, generated, audio);
    expect(
      selectSongs(catalog, { collectionId: 'alpha' }).map(({ id }) => id),
    ).toEqual(['easy-song', 'mixed-song']);
    expect(
      selectSongs(catalog, {
        collectionId: 'beta',
      }).map(({ id }) => id),
    ).toEqual(['mixed-song', 'easy-song']);
    expect(selectSongs(catalog).map(({ id }) => id)).toEqual([
      'mixed-song',
      'easy-song',
    ]);
  });

  it('requires stable slug IDs for authored collections', () => {
    const invalid = {
      ...metadata,
      collections: [
        {
          id: 'Christmas Star',
          title: 'Christmas Star',
          sortOrder: 10,
          songIds: ['mixed-song'],
        },
      ],
    };
    expect(() => createSongCatalog(invalid, generated, audio)).toThrow(
      /Invalid or duplicate collection ID/,
    );
  });

  it('allows an authored empty collection to resolve to no browser songs', () => {
    const empty = createSongCatalog(
      {
        ...metadata,
        collections: [
          {
            id: 'empty-sky',
            title: 'Empty Sky',
            sortOrder: 10,
            songIds: [],
          },
        ],
      },
      generated,
      audio,
    );
    expect(selectSongs(empty, { collectionId: 'empty-sky' })).toEqual([]);
  });

  it('resolves optional collection artwork and leaves unillustrated collections on fallback', () => {
    const catalog = createSongCatalog(
      {
        ...metadata,
        collections: [
          {
            ...metadata.collections[0]!,
            artwork: 'lyra-of-brightvale.webp',
          },
        ],
      },
      generated,
      audio,
    );
    expect(catalog.collections[0]?.artworkUrl).toContain('lyra-of-brightvale');
    const fallbackCatalog = createSongCatalog(metadata, generated, audio);
    expect(fallbackCatalog.collections[0]?.artworkUrl).toBeUndefined();
    expect(() =>
      createSongCatalog(
        {
          ...metadata,
          collections: [
            {
              ...metadata.collections[0]!,
              artwork: 'unregistered-art.webp',
            },
          ],
        },
        generated,
        audio,
      ),
    ).toThrow(/references missing artwork/);
  });
});
