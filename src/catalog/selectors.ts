import { defaultDifficulty, isDifficulty, type Difficulty } from '../game/game-balance';
import type { SongAvailability, SongCatalog, SongCatalogEntry } from './catalog';

export interface SongBrowseFilters {
  readonly query?: string;
  readonly collectionId?: string;
  readonly favoritesOnly?: boolean;
  readonly availability?: SongAvailability;
  /** Filters songs that support this difficulty; does not configure a run. */
  readonly supportsDifficulty?: Difficulty;
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

export function getOrderedSongs(catalog: SongCatalog): readonly SongCatalogEntry[] {
  return [...catalog.songs].sort((left, right) =>
    left.sortOrder - right.sortOrder ||
    normalizeSongSearch(left.title).localeCompare(normalizeSongSearch(right.title)) ||
    left.id.localeCompare(right.id),
  );
}

export function selectSongs(
  catalog: SongCatalog,
  filters: SongBrowseFilters = {},
  favoriteIds: ReadonlySet<string> = new Set(),
): readonly SongCatalogEntry[] {
  const query = normalizeSongSearch(filters.query ?? '');
  return getOrderedSongs(catalog).filter((song) =>
    (query === '' || normalizeSongSearch(song.title).includes(query)) &&
    (filters.collectionId === undefined || song.collections.includes(filters.collectionId)) &&
    (!filters.favoritesOnly || favoriteIds.has(song.id)) &&
    (filters.availability === undefined || song.availability === filters.availability) &&
    (filters.supportsDifficulty === undefined || song.chart.allowedDifficulties.includes(filters.supportsDifficulty)),
  );
}

export function reconcileSongSelection(
  catalog: SongCatalog,
  filters: SongBrowseFilters,
  current: SongSelectionInput,
  favoriteIds: ReadonlySet<string> = new Set(),
): SongSelection {
  const results = selectSongs(catalog, filters, favoriteIds);
  const retained = results.find((song) => song.id === current.selectedSongId);
  const selected = retained ?? results.find((song) => song.availability === 'available') ?? null;
  if (selected === null) return { selectedSongId: null, runDifficulty: null };
  const allowed = selected.chart.allowedDifficulties;
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
  if (song === null || song.availability !== 'available' || runDifficulty === null) return false;
  return (
    catalog.chartIssues.get(song.id)?.length === 0 &&
    isDifficulty(runDifficulty) &&
    song.chart.allowedDifficulties.includes(runDifficulty)
  );
}
