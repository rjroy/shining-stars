export interface FavoriteStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type FavoritePersistence = 'local' | 'session';

export interface FavoriteSnapshot {
  readonly ids: ReadonlySet<string>;
  readonly persistence: FavoritePersistence;
  readonly notice: string | null;
}

export interface FavoriteStore {
  snapshot(): FavoriteSnapshot;
  toggle(songId: string): FavoriteSnapshot;
  isFavorite(songId: string): boolean;
}

const STORAGE_KEY = 'shining-stars.favorite-song-ids';
const FALLBACK_NOTICE = 'Favorites are available for this session only because local storage is unavailable.';

function getBrowserStorage(): FavoriteStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function parseFavoriteIds(value: string | null): Set<string> {
  if (value === null) return new Set();
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== 'string')) {
    throw new TypeError('Stored favorites must be an array of song IDs.');
  }
  return new Set(parsed);
}

export function createFavoriteStore(
  storage: FavoriteStorage | null = getBrowserStorage(),
  storageKey = STORAGE_KEY,
): FavoriteStore {
  let ids = new Set<string>();
  let activeStorage = storage;
  let persistence: FavoritePersistence = storage === null ? 'session' : 'local';
  let notice = storage === null ? FALLBACK_NOTICE : null;

  if (activeStorage !== null) {
    try {
      ids = parseFavoriteIds(activeStorage.getItem(storageKey));
    } catch {
      activeStorage = null;
      persistence = 'session';
      notice = FALLBACK_NOTICE;
    }
  }

  function snapshot(): FavoriteSnapshot {
    return { ids: new Set(ids), persistence, notice };
  }

  return {
    snapshot,
    isFavorite: (songId) => ids.has(songId),
    toggle(songId) {
      if (songId.trim() === '') throw new TypeError('Favorite song ID cannot be empty.');
      if (ids.has(songId)) ids.delete(songId);
      else ids.add(songId);
      if (activeStorage !== null) {
        try {
          activeStorage.setItem(storageKey, JSON.stringify([...ids]));
        } catch {
          activeStorage = null;
          persistence = 'session';
          notice = FALLBACK_NOTICE;
        }
      }
      return snapshot();
    },
  };
}
