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

const chart = (
  difficulty: 'easy' | 'normal' | 'hard',
  strength = 80,
): ChartConfig => ({
  sourceStart: 0,
  duration: 20,
  twilightAt: 10,
  twilightStrength: strength,
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
    charts: { normal: chart('normal', 72), hard: chart('hard', 94) },
  },
  'easy-song.charts.json': {
    schemaVersion: 1,
    songId: 'easy-song',
    source: 'data/music/Easy Song.mp3',
    charts: { easy: chart('easy', 60) },
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
    expect(getSongChart(mixed, 'normal').twilightStrength).toBe(72);
    expect(getSongChart(mixed, 'hard').twilightStrength).toBe(94);
    expect(getSongDifficulties(catalog.songs[1]!)).toEqual(['easy']);
    expect(Object.isFrozen(getSongChart(mixed, 'normal').notes[0])).toBe(true);
    expect(
      Object.isFrozen(getSongChart(mixed, 'hard').allowedDifficulties),
    ).toBe(true);
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
            twilightStrength: 80,
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
      selectSongs(catalog, { supportsDifficulty: 'easy' }).map(
        (song) => song.id,
      ),
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
        supportsDifficulty: 'easy',
      }).map(({ id }) => id),
    ).toEqual(['easy-song']);
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
});
