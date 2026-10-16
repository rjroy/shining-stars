import catalogData from '../../data/catalog.json';
import {
  validateChart,
  type ChartConfig,
  type ChartIssue,
} from '../game/chart';
import {
  defaultDifficulty,
  isDifficulty,
  parseAllowedDifficulties,
  type Difficulty,
} from '../game/game-balance';

export type SongAvailability = 'available' | 'unavailable';
export type SongChartStatus = 'candidate' | 'verified';
export type SongSegmentKind = 'excerpt' | 'full';

export interface SongScoringMetadata {
  readonly version: 1;
  readonly normalMaximum: number | null;
  readonly fiveGoldTarget: number | null;
  readonly chartFingerprint: string | null;
}

export interface SongCollection {
  readonly id: string;
  readonly title: string;
  readonly sortOrder: number;
  readonly songIds: readonly string[];
  readonly artworkUrl?: string;
}

export interface SongCollectionMetadata {
  readonly id: string;
  readonly title: string;
  readonly sortOrder: number;
  readonly songIds: readonly string[];
  readonly artwork?: string;
}

export interface SongCatalogEntry {
  readonly id: string;
  readonly title: string;
  readonly sortOrder: number;
  readonly audioUrl: string;
  readonly source: string;
  readonly charts: Readonly<Partial<Record<Difficulty, ChartConfig>>>;
  readonly scoring: SongScoringMetadata;
  readonly segmentKind: SongSegmentKind;
  readonly availability: SongAvailability;
  readonly chartStatus: SongChartStatus;
  readonly collections: readonly string[];
}

export interface SongCatalog {
  readonly songs: readonly SongCatalogEntry[];
  readonly collections: readonly SongCollection[];
  readonly chartIssues: ReadonlyMap<
    string,
    Readonly<Partial<Record<Difficulty, readonly ChartIssue[]>>>
  >;
}

export interface CatalogMetadata {
  readonly schemaVersion: number;
  readonly songs: readonly Omit<
    SongCatalogEntry,
    'audioUrl' | 'source' | 'charts' | 'scoring' | 'collections'
  >[];
  readonly collections: readonly SongCollectionMetadata[];
}

export interface GeneratedSongCharts {
  readonly schemaVersion: number;
  readonly songId: string;
  readonly source: string;
  readonly scoring: SongScoringMetadata;
  readonly charts: Readonly<Partial<Record<Difficulty, ChartConfig>>>;
}

interface GeneratedSongChartsEnvelope {
  readonly schemaVersion: 1;
  readonly songId: string;
  readonly source: string;
  readonly scoring: unknown;
  readonly charts: Readonly<Record<string, unknown>>;
}

const generatedChartFiles = import.meta.glob<unknown>(
  '../../data/charts/generated/*.charts.json',
  { eager: true, import: 'default' },
);
const audioFiles = import.meta.glob<string>('../../data/music/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
});
const collectionArtworkFiles = import.meta.glob<string>(
  '../../assets/production/observatory-medallions/*.webp',
  { eager: true, query: '?url', import: 'default' },
);

function resolveCollectionArtwork(
  fileName: string,
  collectionId: string,
): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\.webp$/.test(fileName))
    throw new TypeError(
      `Collection '${collectionId}' has an invalid artwork file name '${fileName}'.`,
    );
  const path = `../../assets/production/observatory-medallions/${fileName}`;
  const artworkUrl = collectionArtworkFiles[path];
  if (artworkUrl === undefined)
    throw new TypeError(
      `Collection '${collectionId}' references missing artwork '${fileName}'.`,
    );
  return artworkUrl;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSongScoringMetadata(
  value: unknown,
  hasNormalChart: boolean,
): value is SongScoringMetadata {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 4 ||
    value.version !== 1 ||
    !Object.prototype.hasOwnProperty.call(value, 'normalMaximum') ||
    !Object.prototype.hasOwnProperty.call(value, 'fiveGoldTarget') ||
    !Object.prototype.hasOwnProperty.call(value, 'chartFingerprint')
  )
    return false;
  if (!hasNormalChart)
    return (
      value.normalMaximum === null &&
      value.fiveGoldTarget === null &&
      value.chartFingerprint === null
    );
  return (
    typeof value.normalMaximum === 'number' &&
    Number.isSafeInteger(value.normalMaximum) &&
    value.normalMaximum >= 0 &&
    typeof value.fiveGoldTarget === 'number' &&
    Number.isSafeInteger(value.fiveGoldTarget) &&
    value.fiveGoldTarget === Math.ceil(value.normalMaximum * 0.9) &&
    typeof value.chartFingerprint === 'string' &&
    /^[0-9a-f]{64}$/.test(value.chartFingerprint)
  );
}

function isChartNote(value: unknown): value is ChartConfig['notes'][number] {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.trim().length > 0 &&
    typeof value.time === 'number' &&
    typeof value.lane === 'number'
  );
}

function isChartConfig(value: unknown): value is ChartConfig {
  return (
    isRecord(value) &&
    typeof value.sourceStart === 'number' &&
    typeof value.duration === 'number' &&
    typeof value.twilightAt === 'number' &&
    typeof value.twilightStrength === 'number' &&
    Array.isArray(value.allowedDifficulties) &&
    value.allowedDifficulties.every(isDifficulty) &&
    Array.isArray(value.notes) &&
    value.notes.every(isChartNote)
  );
}

function deepFreezeChart(chart: ChartConfig): ChartConfig {
  const notes = Object.freeze(
    chart.notes.map((note) => Object.freeze({ ...note })),
  );
  return Object.freeze({
    ...chart,
    allowedDifficulties: Object.freeze([...chart.allowedDifficulties]),
    notes,
  });
}

function chartFilesById(
  files: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, GeneratedSongChartsEnvelope> {
  const byId = new Map<string, GeneratedSongChartsEnvelope>();
  for (const [path, value] of Object.entries(files)) {
    if (
      !isRecord(value) ||
      value.schemaVersion !== 1 ||
      typeof value.songId !== 'string' ||
      value.songId.length === 0 ||
      typeof value.source !== 'string' ||
      !isRecord(value.charts)
    ) {
      throw new TypeError(
        `Generated chart bundle '${path}' has an invalid envelope.`,
      );
    }
    const bundle: GeneratedSongChartsEnvelope = {
      schemaVersion: 1,
      songId: value.songId,
      source: value.source,
      scoring: value.scoring,
      charts: value.charts,
    };
    const fileId = path
      .split('/')
      .at(-1)
      ?.replace(/\.charts\.json$/, '');
    if (
      fileId === undefined ||
      fileId !== bundle.songId ||
      byId.has(bundle.songId)
    ) {
      throw new TypeError(
        `Generated chart bundle '${path}' has an invalid or duplicate song ID.`,
      );
    }
    byId.set(bundle.songId, bundle);
  }
  return byId;
}

export function getSongDifficulties(
  song: SongCatalogEntry,
): readonly Difficulty[] {
  return Object.freeze(
    (['easy', 'normal', 'hard'] as const).filter(
      (difficulty) => song.charts[difficulty] !== undefined,
    ),
  );
}

export function getSongChart(
  song: SongCatalogEntry,
  difficulty: Difficulty,
): ChartConfig {
  const chart = song.charts[difficulty];
  if (chart === undefined) {
    throw new RangeError(
      `Difficulty '${difficulty}' is not supported by '${song.id}'.`,
    );
  }
  return chart;
}

export function createSongCatalog(
  metadata: CatalogMetadata,
  chartFiles: Readonly<Record<string, unknown>>,
  audioUrls: Readonly<Record<string, string>>,
): SongCatalog {
  if (metadata.schemaVersion !== 1)
    throw new TypeError('Catalog schemaVersion must be 1.');
  if (!Array.isArray(metadata.songs) || !Array.isArray(metadata.collections))
    throw new TypeError('Catalog must define songs and collections arrays.');
  const bundles = chartFilesById(chartFiles);
  const songIds = new Set<string>();
  for (const song of metadata.songs) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(song.id) || songIds.has(song.id))
      throw new TypeError(`Invalid or duplicate song ID '${song.id}'.`);
    songIds.add(song.id);
    if (!song.title.trim())
      throw new TypeError(`Song '${song.id}' must have a title.`);
    if (!Number.isInteger(song.sortOrder))
      throw new TypeError(`Song '${song.id}' must have an integer sort order.`);
    if (song.segmentKind !== 'excerpt' && song.segmentKind !== 'full')
      throw new TypeError(
        `Song '${song.id}' has an invalid segment declaration.`,
      );
    if (
      song.availability !== 'available' &&
      song.availability !== 'unavailable'
    )
      throw new TypeError(`Song '${song.id}' has invalid availability.`);
    if (song.chartStatus !== 'candidate' && song.chartStatus !== 'verified')
      throw new TypeError(`Song '${song.id}' has invalid chart status.`);
  }
  const metadataIds = songIds;
  const bundleIds = new Set(bundles.keys());
  if (metadataIds.size !== metadata.songs.length)
    throw new TypeError('Catalog contains duplicate song IDs.');
  if (
    metadataIds.size !== bundleIds.size ||
    [...metadataIds].some((id) => !bundleIds.has(id))
  ) {
    throw new TypeError(
      'Catalog song IDs must exactly match generated chart bundle IDs.',
    );
  }

  const songs: SongCatalogEntry[] = metadata.songs.map((metadataSong) => {
    const bundle = bundles.get(metadataSong.id);
    if (
      bundle === undefined ||
      bundle.schemaVersion !== 1 ||
      bundle.songId !== metadataSong.id
    ) {
      throw new TypeError(
        `Song '${metadataSong.id}' has an invalid generated chart bundle.`,
      );
    }
    if (typeof bundle.source !== 'string') {
      throw new TypeError(
        `Song '${metadataSong.id}' generated chart source must be a path string.`,
      );
    }
    const source = bundle.source;
    if (!source.startsWith('data/music/') || !source.endsWith('.mp3')) {
      throw new TypeError(
        `Song '${metadataSong.id}' has an invalid audio source.`,
      );
    }
    const audioPath = `../../${source}`;
    const audioUrl = audioUrls[audioPath];
    if (audioUrl === undefined)
      throw new TypeError(
        `Song '${metadataSong.id}' references missing audio '${source}'.`,
      );
    const difficulties = Object.keys(bundle.charts);
    if (difficulties.length === 0)
      throw new TypeError(
        `Song '${metadataSong.id}' has no difficulty charts.`,
      );
    for (const difficulty of difficulties) {
      if (
        difficulty !== 'easy' &&
        difficulty !== 'normal' &&
        difficulty !== 'hard'
      ) {
        throw new TypeError(
          `Song '${metadataSong.id}' has an unknown chart difficulty '${difficulty}'.`,
        );
      }
    }
    const charts = {} as Record<Difficulty, ChartConfig>;
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const chart = bundle.charts[difficulty];
      if (chart === undefined) continue;
      if (!isChartConfig(chart)) {
        throw new TypeError(
          `Song '${metadataSong.id}' ${difficulty} chart has invalid fields or notes (each note needs a non-empty string ID, numeric time, and numeric lane).`,
        );
      }
      const allowed = parseAllowedDifficulties(chart.allowedDifficulties);
      if (allowed.length !== 1 || allowed[0] !== difficulty) {
        throw new TypeError(
          `Song '${metadataSong.id}' ${difficulty} chart must allow only ${difficulty}.`,
        );
      }
      charts[difficulty] = deepFreezeChart(chart);
    }
    const present = Object.keys(charts) as Difficulty[];
    if (!isSongScoringMetadata(bundle.scoring, charts.normal !== undefined))
      throw new TypeError(
        `Song '${metadataSong.id}' has invalid generated scoring metadata.`,
      );
    defaultDifficulty(present);
    if (
      metadataSong.segmentKind === 'full' &&
      present.some((difficulty) => charts[difficulty].sourceStart !== 0)
    ) {
      throw new TypeError(
        `Full-track song '${metadataSong.id}' must start at source time zero.`,
      );
    }
    return Object.freeze({
      ...metadataSong,
      source,
      audioUrl,
      charts: Object.freeze(charts),
      scoring: Object.freeze({ ...bundle.scoring }),
      collections: Object.freeze(
        metadata.collections
          .filter((collection) => collection.songIds.includes(metadataSong.id))
          .map((collection) => collection.id),
      ),
    });
  });

  const chartIssues = new Map<
    string,
    Readonly<Partial<Record<Difficulty, readonly ChartIssue[]>>>
  >();
  for (const song of songs) {
    const issues: Partial<Record<Difficulty, readonly ChartIssue[]>> = {};
    for (const difficulty of getSongDifficulties(song))
      issues[difficulty] = Object.freeze(
        validateChart(getSongChart(song, difficulty)),
      );
    chartIssues.set(song.id, Object.freeze(issues));
  }
  const collectionIds = new Set<string>();
  for (const collection of metadata.collections) {
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(collection.id) ||
      collectionIds.has(collection.id) ||
      !collection.title.trim() ||
      !Number.isInteger(collection.sortOrder)
    )
      throw new TypeError(
        `Invalid or duplicate collection ID '${collection.id}'.`,
      );
    collectionIds.add(collection.id);
    if (new Set(collection.songIds).size !== collection.songIds.length)
      throw new TypeError(
        `Collection '${collection.id}' contains duplicate song references.`,
      );
    for (const id of collection.songIds)
      if (!metadataIds.has(id))
        throw new TypeError(
          `Collection '${collection.id}' references unknown song '${id}'.`,
        );
  }
  for (const song of songs)
    for (const collectionId of song.collections)
      if (!collectionIds.has(collectionId))
        throw new TypeError(
          `Song '${song.id}' references unknown collection '${collectionId}'.`,
        );
  const expectedAudioPaths = new Set(
    songs.map((song) => `../../${song.source}`),
  );
  const actualAudioPaths = new Set(Object.keys(audioUrls));
  if (
    expectedAudioPaths.size !== actualAudioPaths.size ||
    [...expectedAudioPaths].some((path) => !actualAudioPaths.has(path))
  ) {
    throw new TypeError(
      'Audio asset paths must exactly match catalog chart sources.',
    );
  }
  return Object.freeze({
    songs: Object.freeze(songs),
    collections: Object.freeze(
      metadata.collections.map((collection) => {
        const { artwork, ...metadataCollection } = collection;
        return Object.freeze({
          ...metadataCollection,
          ...(artwork === undefined
            ? {}
            : {
                artworkUrl: resolveCollectionArtwork(artwork, collection.id),
              }),
          songIds: Object.freeze([...collection.songIds]),
        });
      }),
    ),
    chartIssues,
  });
}

let loadedCatalog: SongCatalog | null = null;
export const SONG_CATALOG: SongCatalog = new Proxy({} as SongCatalog, {
  get(_target, property) {
    loadedCatalog ??= createSongCatalog(
      catalogData as CatalogMetadata,
      generatedChartFiles,
      audioFiles,
    );
    return Reflect.get(loadedCatalog, property);
  },
});
