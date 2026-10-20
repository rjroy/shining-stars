import {
  defaultDifficulty,
  isDifficulty,
  type Difficulty,
} from '../game/game-balance';
import { getSongChart, getSongDifficulties } from './catalog';
import type { SongCatalog, SongCatalogEntry } from './catalog';
import type { SongRating } from './song-ratings';

export interface SongBrowseFilters {
  readonly query?: string;
  readonly collectionId?: string;
  readonly favoritesOnly?: boolean;
  readonly unlockStatus?: 'all' | 'unlocked' | 'locked';
  readonly unplayedOnly?: boolean;
  /** No tier means no condition; independent from the selected run difficulty. */
  readonly undefeatedDifficulty?: Difficulty;
  readonly belowFiveNormalStars?: boolean;
  readonly belowFiveGoldStars?: boolean;
}

export type SongSortMode =
  'unsorted' | 'alphabetical' | 'length' | 'difficulty';

/** Match the catalog's browse duration, never the player's run difficulty. */
function sortMetric(song: SongCatalogEntry, mode: SongSortMode): number | null {
  const difficulties = getSongDifficulties(song);
  if (difficulties.length === 0) return null;
  const duration = getSongChart(song, defaultDifficulty(difficulties)).duration;
  if (!Number.isFinite(duration) || duration <= 0) return null;
  if (mode === 'length') return duration;
  const target = song.scoring.fiveGoldTarget;
  if (target === null || !Number.isFinite(target) || target < 0) return null;
  const metric = target / duration;
  return Number.isFinite(metric) ? metric : null;
}

function sortSongs(
  songs: SongCatalogEntry[],
  mode: SongSortMode,
): SongCatalogEntry[] {
  if (mode === 'unsorted') return songs;
  return songs.sort((left, right) => {
    if (mode === 'alphabetical')
      return normalizeSongSearch(left.title).localeCompare(
        normalizeSongSearch(right.title),
      );
    const a = sortMetric(left, mode);
    const b = sortMetric(right, mode);
    return a === null ? (b === null ? 0 : 1) : b === null ? -1 : a - b;
  });
}

/** Read the current save, not cached filter results. Missing ratings mean unplayed. */
export interface SongBrowseProgress {
  readonly getRating?: (songId: string) => SongRating | null;
  readonly isUnlocked?: (songId: string) => boolean;
  readonly getVictoryDifficulty?: (songId: string) => Difficulty | undefined;
}

function matchesProgress(
  songId: string,
  filters: SongBrowseFilters,
  progress: SongBrowseProgress,
): boolean {
  const unlocked = progress.isUnlocked?.(songId) ?? true;
  if (filters.unlockStatus === 'unlocked' && !unlocked) return false;
  if (filters.unlockStatus === 'locked' && unlocked) return false;
  const rating = progress.getRating?.(songId) ?? null;
  if (filters.unplayedOnly && rating !== null) return false;
  if (
    filters.belowFiveNormalStars &&
    rating !== null &&
    (rating.normalStars >= 5 || rating.goldStars > 0)
  )
    return false;
  if (filters.belowFiveGoldStars && (rating?.goldStars ?? 0) >= 5) return false;
  const tier = filters.undefeatedDifficulty;
  if (tier !== undefined) {
    const tiers: readonly Difficulty[] = ['easy', 'normal', 'hard'];
    const credited = progress.getVictoryDifficulty?.(songId);
    if (
      credited !== undefined &&
      tiers.indexOf(credited) >= tiers.indexOf(tier)
    )
      return false;
  }
  return true;
}

export interface SongSelection {
  readonly selectedSongId: string | null;
  readonly runDifficulty: Difficulty | null;
}

export interface SongSelectionInput {
  readonly selectedSongId: string | null;
  readonly runDifficulty: Difficulty | null;
}

export function normalizeSongSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim();
}

export function getOrderedSongs(
  catalog: SongCatalog,
): readonly SongCatalogEntry[] {
  return [...catalog.songs].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      normalizeSongSearch(left.title).localeCompare(
        normalizeSongSearch(right.title),
      ) ||
      left.id.localeCompare(right.id),
  );
}

export function selectSongs(
  catalog: SongCatalog,
  filters: SongBrowseFilters = {},
  favoriteIds: ReadonlySet<string> = new Set(),
  progress: SongBrowseProgress = {},
  sortMode: SongSortMode = 'unsorted',
): readonly SongCatalogEntry[] {
  const query = normalizeSongSearch(filters.query ?? '');
  const collection =
    filters.collectionId === undefined
      ? undefined
      : catalog.collections.find((item) => item.id === filters.collectionId);
  const ordered =
    collection === undefined
      ? getOrderedSongs(catalog)
      : collection.songIds.flatMap((id) => {
          const song = catalog.songs.find((entry) => entry.id === id);
          return song === undefined ? [] : [song];
        });
  return sortSongs(
    ordered.filter(
      (song) =>
        song.availability === 'available' &&
        (query === '' || normalizeSongSearch(song.title).includes(query)) &&
        (filters.collectionId === undefined ||
          song.collections.includes(filters.collectionId)) &&
        (!filters.favoritesOnly || favoriteIds.has(song.id)) &&
        matchesProgress(song.id, filters, progress),
    ),
    sortMode,
  );
}

export function reconcileSongSelection(
  catalog: SongCatalog,
  filters: SongBrowseFilters,
  current: SongSelectionInput,
  favoriteIds: ReadonlySet<string> = new Set(),
  progress: SongBrowseProgress = {},
  sortMode: SongSortMode = 'unsorted',
): SongSelection {
  const results = selectSongs(
    catalog,
    filters,
    favoriteIds,
    progress,
    sortMode,
  );
  const retained = results.find((song) => song.id === current.selectedSongId);
  const selected = retained ?? results[0] ?? null;
  if (selected === null) return { selectedSongId: null, runDifficulty: null };
  const allowed = getSongDifficulties(selected);
  return {
    selectedSongId: selected.id,
    runDifficulty:
      current.runDifficulty !== null && allowed.includes(current.runDifficulty)
        ? current.runDifficulty
        : defaultDifficulty(allowed),
  };
}

export function canStartSong(
  catalog: SongCatalog,
  song: SongCatalogEntry | null,
  runDifficulty: Difficulty | null,
): boolean {
  if (
    song === null ||
    song.availability !== 'available' ||
    runDifficulty === null
  )
    return false;
  return (
    catalog.chartIssues.get(song.id)?.[runDifficulty]?.length === 0 &&
    isDifficulty(runDifficulty) &&
    getSongDifficulties(song).includes(runDifficulty)
  );
}
