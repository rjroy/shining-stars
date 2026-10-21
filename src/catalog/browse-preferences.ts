import type { Difficulty } from '../game/game-balance';
import type { SongBrowseFilters, SongSortMode } from './selectors';

export interface BrowsePreferences {
  readonly filters: Pick<
    SongBrowseFilters,
    | 'unlockStatus'
    | 'unplayedOnly'
    | 'undefeatedDifficulty'
    | 'belowFiveNormalStars'
    | 'belowFiveGoldStars'
  >;
  readonly sortMode: SongSortMode;
  readonly favoritesOnly: boolean;
}

export interface BrowsePreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_BROWSE_PREFERENCES: BrowsePreferences = {
  filters: {},
  sortMode: 'unsorted',
  favoritesOnly: false,
};

const STORAGE_KEY = 'shining-stars.observatory-browse-preferences';
const version = 1;

function browserStorage(): BrowsePreferenceStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function validPreferences(value: unknown): BrowsePreferences {
  if (typeof value !== 'object' || value === null) return DEFAULT_BROWSE_PREFERENCES;
  const raw = value as Record<string, unknown>;
  if (raw.version !== version || typeof raw.preferences !== 'object' || raw.preferences === null)
    return DEFAULT_BROWSE_PREFERENCES;
  const data = raw.preferences as Record<string, unknown>;
  const rawFilters = data.filters;
  const filterData = typeof rawFilters === 'object' && rawFilters !== null
    ? rawFilters as Record<string, unknown>
    : {};
  const filters: BrowsePreferences['filters'] = {
    ...(filterData.unlockStatus === 'all' || filterData.unlockStatus === 'unlocked' || filterData.unlockStatus === 'locked'
      ? { unlockStatus: filterData.unlockStatus }
      : {}),
    ...(typeof filterData.unplayedOnly === 'boolean' ? { unplayedOnly: filterData.unplayedOnly } : {}),
    ...(filterData.undefeatedDifficulty === 'easy' || filterData.undefeatedDifficulty === 'normal' || filterData.undefeatedDifficulty === 'hard'
      ? { undefeatedDifficulty: filterData.undefeatedDifficulty as Difficulty }
      : {}),
    ...(typeof filterData.belowFiveNormalStars === 'boolean' ? { belowFiveNormalStars: filterData.belowFiveNormalStars } : {}),
    ...(typeof filterData.belowFiveGoldStars === 'boolean' ? { belowFiveGoldStars: filterData.belowFiveGoldStars } : {}),
  };
  return {
    filters,
    sortMode: data.sortMode === 'alphabetical' || data.sortMode === 'length' || data.sortMode === 'difficulty'
      ? data.sortMode as SongSortMode
      : 'unsorted',
    favoritesOnly: typeof data.favoritesOnly === 'boolean' ? data.favoritesOnly : false,
  };
}

export function createBrowsePreferenceStore(
  storage: BrowsePreferenceStorage | null = browserStorage(),
  storageKey = STORAGE_KEY,
): { read(): BrowsePreferences; write(value: BrowsePreferences): void } {
  let activeStorage = storage;
  let current = DEFAULT_BROWSE_PREFERENCES;
  if (activeStorage !== null) {
    try {
      const stored = activeStorage.getItem(storageKey);
      if (stored !== null) current = validPreferences(JSON.parse(stored) as unknown);
    } catch {
      activeStorage = null;
    }
  }
  return {
    read: () => current,
    write(value) {
      current = value;
      if (activeStorage === null) return;
      try {
        activeStorage.setItem(storageKey, JSON.stringify({ version, preferences: value }));
      } catch {
        activeStorage = null;
      }
    },
  };
}
