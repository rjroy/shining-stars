import { MVP_CHART as firstShiningStarChart } from '../game/mvp-chart';
import { MVP_CHART as neverAgainChart } from '../game/never-again.candidate';
import { MVP_CHART as abandonedChildChart } from '../game/the-abandoned-child.candidate';
import { MVP_CHART as commodityChart } from '../game/the-commodity.candidate';
import { MVP_CHART as gameChart } from '../game/the-game.candidate';
import { MVP_CHART as lastTruePerformerChart } from '../game/the-last-true-performer.candidate';
import { MVP_CHART as risingStarChart } from '../game/the-rising-star.candidate';
import { validateChart, type ChartConfig } from '../game/chart';
import { defaultDifficulty, parseAllowedDifficulties } from '../game/game-balance';

export type SongAvailability = 'available' | 'unavailable';
export type SongChartStatus = 'candidate' | 'verified';
export type SongSegmentKind = 'excerpt' | 'full';

export interface SongCollection {
  readonly id: string;
  readonly title: string;
  readonly sortOrder: number;
  readonly songIds: readonly string[];
}

export interface SongCatalogEntry {
  readonly id: string;
  readonly title: string;
  readonly sortOrder: number;
  readonly audioUrl: string;
  readonly chart: ChartConfig;
  readonly segmentKind: SongSegmentKind;
  readonly availability: SongAvailability;
  readonly chartStatus: SongChartStatus;
  readonly collections: readonly string[];
}

export interface SongCatalog {
  readonly songs: readonly SongCatalogEntry[];
  readonly collections: readonly SongCollection[];
  readonly chartIssues: ReadonlyMap<string, ReturnType<typeof validateChart>>;
}

const INITIAL_COLLECTION_ID = 'all-songs';

/** Metadata-only static registry; URL creation does not fetch or decode audio. */
export const SONG_CATALOG = createSongCatalog(
  [
    {
      id: 'the-first-shining-star',
      title: 'The First Shining Star (Demo Excerpt)',
      sortOrder: 10,
      audioUrl: new URL('../../data/music/The First Shining Star (Remastered).mp3', import.meta.url).href,
      chart: firstShiningStarChart,
      segmentKind: 'excerpt',
      availability: 'available',
      chartStatus: 'candidate',
      collections: [INITIAL_COLLECTION_ID],
    },
    {
      id: 'never-again',
      title: 'Never Again',
      sortOrder: 20,
      audioUrl: new URL('../../data/music/Never Again (Remastered).mp3', import.meta.url).href,
      chart: neverAgainChart,
      segmentKind: 'full',
      availability: 'available',
      chartStatus: 'candidate',
      collections: [INITIAL_COLLECTION_ID],
    },
    {
      id: 'the-abandoned-child',
      title: 'The Abandoned Child',
      sortOrder: 30,
      audioUrl: new URL('../../data/music/The Abandoned Child (Remastered).mp3', import.meta.url).href,
      chart: abandonedChildChart,
      segmentKind: 'full',
      availability: 'available',
      chartStatus: 'candidate',
      collections: [INITIAL_COLLECTION_ID],
    },
    {
      id: 'the-commodity',
      title: 'The Commodity',
      sortOrder: 40,
      audioUrl: new URL('../../data/music/The Commodity (Remastered).mp3', import.meta.url).href,
      chart: commodityChart,
      segmentKind: 'full',
      availability: 'available',
      chartStatus: 'candidate',
      collections: [INITIAL_COLLECTION_ID],
    },
    {
      id: 'the-game',
      title: 'The Game',
      sortOrder: 50,
      audioUrl: new URL('../../data/music/The Game.mp3', import.meta.url).href,
      chart: gameChart,
      segmentKind: 'full',
      availability: 'available',
      chartStatus: 'candidate',
      collections: [INITIAL_COLLECTION_ID],
    },
    {
      id: 'the-last-true-performer',
      title: 'The Last True Performer',
      sortOrder: 60,
      audioUrl: new URL('../../data/music/The Last True Performer (Remastered).mp3', import.meta.url).href,
      chart: lastTruePerformerChart,
      segmentKind: 'full',
      availability: 'available',
      chartStatus: 'candidate',
      collections: [INITIAL_COLLECTION_ID],
    },
    {
      id: 'the-rising-star',
      title: 'The Rising Star',
      sortOrder: 70,
      audioUrl: new URL('../../data/music/The Rising Star (Remastered).mp3', import.meta.url).href,
      chart: risingStarChart,
      segmentKind: 'full',
      availability: 'available',
      chartStatus: 'candidate',
      collections: [INITIAL_COLLECTION_ID],
    },
  ],
  [
    {
      id: INITIAL_COLLECTION_ID,
      title: 'All Songs',
      sortOrder: 0,
      songIds: [
        'the-first-shining-star',
        'never-again',
        'the-abandoned-child',
        'the-commodity',
        'the-game',
        'the-last-true-performer',
        'the-rising-star',
      ],
    },
  ],
);

export function createSongCatalog(
  songs: readonly SongCatalogEntry[],
  collections: readonly SongCollection[],
): SongCatalog {
  const songIds = new Set<string>();
  const collectionIds = new Set<string>();
  for (const collection of collections) {
    if (!collection.id.trim() || collectionIds.has(collection.id)) {
      throw new TypeError(`Invalid or duplicate collection ID '${collection.id}'.`);
    }
    if (!collection.title.trim()) {
      throw new TypeError(`Collection '${collection.id}' must have a title.`);
    }
    collectionIds.add(collection.id);
  }

  const chartIssues = new Map<string, ReturnType<typeof validateChart>>();
  for (const song of songs) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(song.id) || songIds.has(song.id)) {
      throw new TypeError(`Invalid or duplicate song ID '${song.id}'.`);
    }
    songIds.add(song.id);
    if (!song.title.trim()) throw new TypeError(`Song '${song.id}' must have a title.`);
    if (!Number.isInteger(song.sortOrder)) {
      throw new TypeError(`Song '${song.id}' must have an integer sort order.`);
    }
    if (!song.audioUrl.trim()) throw new TypeError(`Song '${song.id}' must have an audio URL.`);
    if (song.segmentKind !== 'excerpt' && song.segmentKind !== 'full') {
      throw new TypeError(`Song '${song.id}' has an invalid segment declaration.`);
    }
    if (song.segmentKind === 'full' && song.chart.sourceStart !== 0) {
      throw new TypeError(`Full-track song '${song.id}' must start at source time zero.`);
    }
    if (!['available', 'unavailable'].includes(song.availability)) {
      throw new TypeError(`Song '${song.id}' has invalid availability.`);
    }
    if (!['candidate', 'verified'].includes(song.chartStatus)) {
      throw new TypeError(`Song '${song.id}' has invalid chart status.`);
    }
    const supportedDifficulties = parseAllowedDifficulties(song.chart.allowedDifficulties);
    defaultDifficulty(supportedDifficulties);
    const issues = validateChart(song.chart);
    chartIssues.set(song.id, issues);
    for (const collectionId of song.collections) {
      if (!collectionIds.has(collectionId)) {
        throw new TypeError(`Song '${song.id}' references unknown collection '${collectionId}'.`);
      }
    }
  }

  for (const collection of collections) {
    for (const songId of collection.songIds) {
      const song = songs.find((entry) => entry.id === songId);
      if (song === undefined || !song.collections.includes(collection.id)) {
        throw new TypeError(`Collection '${collection.id}' has an invalid song reference '${songId}'.`);
      }
    }
  }
  for (const song of songs) {
    for (const collectionId of song.collections) {
      const collection = collections.find((entry) => entry.id === collectionId);
      if (collection === undefined || !collection.songIds.includes(song.id)) {
        throw new TypeError(`Song '${song.id}' is missing from collection '${collectionId}'.`);
      }
    }
  }

  return Object.freeze({
    songs: Object.freeze([...songs]),
    collections: Object.freeze([...collections]),
    chartIssues,
  });
}
