import {
  parseFavoriteIds,
  type FavoritePersistence,
  type FavoriteSnapshot,
  type FavoriteStorage,
  type FavoriteStore,
} from '../catalog/favorites';
import {
  parseRatings,
  ratingForResult,
  ratingOrdinal,
  validateCompletedResult,
  type CompletedSongResult,
  type SongRating,
  type SongRatingSnapshot,
  type SongRatingStore,
  type StoredRating,
} from '../catalog/song-ratings';

export const SAVE_STORAGE_KEY = 'shining-stars.save';
export const SAVE_FORMAT = 'shining-stars-save';
export const SAVE_SCHEMA_VERSION = 1;

const FAVORITES_STORAGE_KEY = 'shining-stars.favorite-song-ids';
const RATINGS_STORAGE_KEY = 'shining-stars.song-ratings';
const STORAGE_UNAVAILABLE_NOTICE =
  'Player data is available for this session only because local storage is unavailable or denied access.';

export interface SaveDataSnapshot {
  readonly favorites: FavoriteSnapshot;
  readonly ratings: SongRatingSnapshot;
}

export interface SaveStore {
  readonly favorites: FavoriteStore;
  readonly songRatings: SongRatingStore;
  snapshot(): SaveDataSnapshot;
  exportJson(): string;
  previewImport(text: string, mode: SaveImportMode): SaveImportPreview;
  applyImport(preview: SaveImportPreview, target: SaveImportTarget): SaveImportResult;
}

export type SaveImportMode = 'merge' | 'replace';
export type SaveImportTarget = 'local' | 'session';
export type SaveImportStatus =
  | 'applied'
  | 'session-only'
  | 'conflict'
  | 'stale-preview'
  | 'invalid-preview'
  | 'failed';

export interface SaveImportChanges {
  readonly favorites: { readonly added: number; readonly removed: number };
  readonly ratings: {
    readonly added: number;
    readonly improved: number;
    readonly removed: number;
    readonly downgraded: number;
  };
}

/** Immutable preview summary. Identity is privately bound to its candidate. */
export interface SaveImportPreview {
  readonly mode: SaveImportMode;
  readonly hasChanges: boolean;
  readonly changes: SaveImportChanges;
}

export interface SaveImportResult {
  readonly status: SaveImportStatus;
  readonly notice: string | null;
  readonly persistence: FavoritePersistence;
  readonly changed: boolean;
}

interface ImportCandidate {
  readonly revision: number;
  readonly favorites: Set<string>;
  readonly ratings: Map<string, StoredRating>;
  readonly preview: SaveImportPreview;
}

interface StoredSave {
  readonly format: typeof SAVE_FORMAT;
  readonly schemaVersion: typeof SAVE_SCHEMA_VERSION;
  readonly favorites: readonly string[];
  readonly ratings: Readonly<Record<string, StoredRating>>;
}

function browserStorage(): FavoriteStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function parseCanonical(value: string): { favorites: Set<string>; ratings: Map<string, StoredRating> } {
  const parsed: unknown = JSON.parse(value);
  if (
    !isRecord(parsed) ||
    !hasOnlyKeys(parsed, ['format', 'schemaVersion', 'favorites', 'ratings']) ||
    parsed.format !== SAVE_FORMAT ||
    parsed.schemaVersion !== SAVE_SCHEMA_VERSION ||
    !Array.isArray(parsed.favorites) ||
    parsed.favorites.some((id) => typeof id !== 'string') ||
    !isRecord(parsed.ratings)
  ) {
    throw new TypeError('Stored player save has an invalid envelope.');
  }

  const ratings = new Map<string, StoredRating>();
  for (const [songId, rawRating] of Object.entries(parsed.ratings)) {
    if (
      songId.trim() === '' ||
      !isRecord(rawRating) ||
      !hasOnlyKeys(rawRating, ['played', 'normalStars', 'goldStars'])
    ) {
      throw new TypeError(`Stored player rating '${songId}' is invalid.`);
    }
    // Delegate star/domain rules to the existing rating parser, which also
    // ensures values are copied into plain validated domain records.
    const ratingEnvelope = JSON.stringify({
      schemaVersion: 1,
      ratings: { [songId]: rawRating },
    });
    const parsedRatings = parseRatings(ratingEnvelope);
    ratings.set(songId, parsedRatings.get(songId)!);
  }

  return { favorites: new Set(parsed.favorites), ratings };
}

function savedRating(rating: StoredRating): SongRating {
  return { ...rating, achievementOrdinal: ratingOrdinal(rating) };
}

function getInitialStorage(): FavoriteStorage | null {
  return browserStorage();
}

function serializeSave(favorites: ReadonlySet<string>, ratings: ReadonlyMap<string, StoredRating>): string {
  const savedRatings = Object.create(null) as Record<string, StoredRating>;
  for (const [id, rating] of ratings) savedRatings[id] = { ...rating };
  const document: StoredSave = {
    format: SAVE_FORMAT,
    schemaVersion: SAVE_SCHEMA_VERSION,
    favorites: [...favorites],
    ratings: savedRatings,
  };
  return JSON.stringify(document);
}

function countChanges(
  currentFavorites: ReadonlySet<string>,
  currentRatings: ReadonlyMap<string, StoredRating>,
  nextFavorites: ReadonlySet<string>,
  nextRatings: ReadonlyMap<string, StoredRating>,
): SaveImportChanges {
  let ratingAdded = 0;
  let ratingImproved = 0;
  let ratingRemoved = 0;
  let ratingDowngraded = 0;
  for (const [id, next] of nextRatings) {
    const current = currentRatings.get(id);
    if (current === undefined) ratingAdded += 1;
    else if (ratingOrdinal(next) > ratingOrdinal(current)) ratingImproved += 1;
    else if (ratingOrdinal(next) < ratingOrdinal(current)) ratingDowngraded += 1;
  }
  for (const id of currentRatings.keys()) {
    if (!nextRatings.has(id)) ratingRemoved += 1;
  }
  return Object.freeze({
    favorites: Object.freeze({
      added: [...nextFavorites].filter((id) => !currentFavorites.has(id)).length,
      removed: [...currentFavorites].filter((id) => !nextFavorites.has(id)).length,
    }),
    ratings: Object.freeze({
      added: ratingAdded,
      improved: ratingImproved,
      removed: ratingRemoved,
      downgraded: ratingDowngraded,
    }),
  });
}

function hasChanges(changes: SaveImportChanges): boolean {
  return Object.values(changes.favorites).some((count) => count > 0) ||
    Object.values(changes.ratings).some((count) => count > 0);
}

export function createSaveStore(storage: FavoriteStorage | null = getInitialStorage()): SaveStore {
  const backingStorage = storage;
  const previews = new WeakMap<SaveImportPreview, ImportCandidate>();
  let favorites = new Set<string>();
  let ratings = new Map<string, StoredRating>();
  let activeStorage = storage;
  let revision = 0;
  let persistence: FavoritePersistence = storage === null ? 'session' : 'local';
  let notice = storage === null ? STORAGE_UNAVAILABLE_NOTICE : null;
  let observedSave: string | null = null;
  let observedFavoriteLegacy: string | null = null;
  let observedRatingLegacy: string | null = null;
  let loadedCanonical = false;
  let initialLoadSafe = true;

  if (activeStorage !== null) {
    console.info('[Save data] storage load attempt', { storageKey: SAVE_STORAGE_KEY });
    try {
      observedSave = activeStorage.getItem(SAVE_STORAGE_KEY);
      if (observedSave !== null) {
        let data: ReturnType<typeof parseCanonical>;
        try {
          data = parseCanonical(observedSave);
        } catch (error) {
          notice = 'The canonical player save is invalid or unsupported. Legacy values were not loaded; export contains only current session data and existing storage contents were preserved.';
          throw error;
        }
        favorites = data.favorites;
        ratings = data.ratings;
        loadedCanonical = true;
        console.info('[Save data] storage load succeeded', {
          storageKey: SAVE_STORAGE_KEY,
          source: 'canonical',
          favoriteCount: favorites.size,
          ratingCount: ratings.size,
        });
      } else {
        // Each read and parse is isolated: failure of one key must not lose a
        // usable value from the other key.
        const failedDomains: string[] = [];
        let favoritesLoaded = false;
        let ratingsLoaded = false;
        console.info('[Save data] legacy read attempt', { storageKey: FAVORITES_STORAGE_KEY });
        try {
          observedFavoriteLegacy = activeStorage.getItem(FAVORITES_STORAGE_KEY);
          favorites = parseFavoriteIds(observedFavoriteLegacy);
          favoritesLoaded = true;
          console.info('[Save data] legacy read succeeded', {
            storageKey: FAVORITES_STORAGE_KEY,
            itemCount: favorites.size,
          });
        } catch (error) {
          failedDomains.push('favorites');
          console.warn('[Save data] legacy read failed', {
            storageKey: FAVORITES_STORAGE_KEY,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        console.info('[Save data] legacy read attempt', { storageKey: RATINGS_STORAGE_KEY });
        try {
          observedRatingLegacy = activeStorage.getItem(RATINGS_STORAGE_KEY);
          ratings = parseRatings(observedRatingLegacy);
          ratingsLoaded = true;
          console.info('[Save data] legacy read succeeded', {
            storageKey: RATINGS_STORAGE_KEY,
            itemCount: ratings.size,
          });
        } catch (error) {
          failedDomains.push('ratings');
          console.warn('[Save data] legacy read failed', {
            storageKey: RATINGS_STORAGE_KEY,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        if (failedDomains.length > 0) {
          initialLoadSafe = false;
          activeStorage = null;
          persistence = 'session';
          const availableDomains = [
            favoritesLoaded ? 'favorites' : null,
            ratingsLoaded ? 'ratings' : null,
          ].filter((domain): domain is string => domain !== null);
          const loadedDescription = availableDomains.length > 0
            ? `${availableDomains.join(' and ')} were loaded`
            : 'no legacy data was loaded';
          notice = `Only partial player data is available for this session: ${loadedDescription}; ${failedDomains.join(' and ')} could not be read or validated. Export contains only loaded data and current session changes; existing storage contents were preserved.`;
          console.warn('[Save data] partial legacy recovery; using session state', {
            loadedDomains: availableDomains,
            failedDomains,
            storedBytesPreserved: true,
          });
        } else {
          console.info('[Save data] storage load succeeded', {
            storageKey: SAVE_STORAGE_KEY,
            source: 'legacy',
            favoriteCount: favorites.size,
            ratingCount: ratings.size,
          });
        }
      }
    } catch (error) {
      // A present but invalid canonical record is authoritative: do not revive
      // stale legacy bytes and risk silently restoring superseded progress.
      const invalidCanonical = observedSave !== null;
      initialLoadSafe = false;
      if (!invalidCanonical) {
        favorites = new Set();
        ratings = new Map();
        notice ??= 'Player data could not be read from local storage. Export contains current session data; existing storage contents were preserved.';
      }
      activeStorage = null;
      persistence = 'session';
      console.warn('[Save data] storage load failed; using session state', {
        storageKey: SAVE_STORAGE_KEY,
        cause: invalidCanonical ? 'invalid-canonical-save' : 'storage-access',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function snapshot(): SaveDataSnapshot {
    const favoriteSnapshot: FavoriteSnapshot = {
      ids: new Set(favorites),
      persistence,
      notice,
    };
    const ratingSnapshot: SongRatingSnapshot = {
      ratings: new Map([...ratings].map(([id, rating]) => [id, savedRating(rating)])),
      persistence,
      notice,
    };
    return { favorites: favoriteSnapshot, ratings: ratingSnapshot };
  }

  function exportJson(): string {
    return serializeSave(favorites, ratings);
  }

  function persist(): void {
    if (activeStorage === null) return;
    try {
      console.info('[Save data] storage write attempt', {
        storageKey: SAVE_STORAGE_KEY,
        favoriteCount: favorites.size,
        ratingCount: ratings.size,
      });
      const currentSave = activeStorage.getItem(SAVE_STORAGE_KEY);
      const changedSave = currentSave !== observedSave;
      const changedLegacy = !loadedCanonical && (
        activeStorage.getItem(FAVORITES_STORAGE_KEY) !== observedFavoriteLegacy ||
        activeStorage.getItem(RATINGS_STORAGE_KEY) !== observedRatingLegacy
      );
      if (changedSave || changedLegacy) {
        activeStorage = null;
        persistence = 'session';
        notice = 'Player data changed in storage since it was loaded. This session will not overwrite that save; export contains this session’s data.';
        console.warn('[Save data] storage write refused; observed data changed', {
          storageKey: SAVE_STORAGE_KEY,
          outcome: 'conflict',
        });
        return;
      }

      const value = exportJson();
      activeStorage.setItem(SAVE_STORAGE_KEY, value);
      observedSave = value;
      loadedCanonical = true;
      console.info('[Save data] storage write succeeded', {
        storageKey: SAVE_STORAGE_KEY,
        favoriteCount: favorites.size,
        ratingCount: ratings.size,
      });
    } catch (error) {
      activeStorage = null;
      persistence = 'session';
      notice = 'Player data could not be written to local storage. Changes are available for this session only and can be exported.';
      console.warn('[Save data] storage write failed; using session state', {
        storageKey: SAVE_STORAGE_KEY,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const favoriteStore: FavoriteStore = {
    snapshot: () => snapshot().favorites,
    isFavorite: (songId) => favorites.has(songId),
    toggle(songId) {
      if (songId.trim() === '') throw new TypeError('Favorite song ID cannot be empty.');
      if (favorites.has(songId)) favorites.delete(songId);
      else favorites.add(songId);
      revision += 1;
      persist();
      return snapshot().favorites;
    },
  };

  const songRatingStore: SongRatingStore = {
    snapshot: () => snapshot().ratings,
    get(songId) {
      const rating = ratings.get(songId);
      return rating === undefined ? null : savedRating(rating);
    },
    recordCompletedResult(songId: string, result: CompletedSongResult) {
      if (songId.trim() === '') throw new TypeError('Song ID cannot be empty.');
      validateCompletedResult(result);
      const candidate = ratingForResult(result);
      const current = ratings.get(songId);
      if (current === undefined || ratingOrdinal(candidate) > ratingOrdinal(current)) {
        ratings.set(songId, candidate);
        revision += 1;
        persist();
        return savedRating(candidate);
      }
      return savedRating(current);
    },
  };

  function previewImport(text: string, mode: SaveImportMode): SaveImportPreview {
    if (mode !== 'merge' && mode !== 'replace') {
      throw new TypeError('Import mode must be merge or replace.');
    }
    const imported = parseCanonical(text);

    let nextFavorites: Set<string>;
    let nextRatings: Map<string, StoredRating>;
    if (mode === 'replace') {
      nextFavorites = new Set(imported.favorites);
      nextRatings = new Map(imported.ratings);
    } else {
      nextFavorites = new Set(favorites);
      for (const id of imported.favorites) nextFavorites.add(id);
      nextRatings = new Map(ratings);
      for (const [id, incoming] of imported.ratings) {
        const existing = nextRatings.get(id);
        if (existing === undefined || ratingOrdinal(incoming) > ratingOrdinal(existing)) {
          nextRatings.set(id, { ...incoming });
        }
      }
    }

    const changes = countChanges(favorites, ratings, nextFavorites, nextRatings);
    const preview: SaveImportPreview = Object.freeze({
      mode,
      hasChanges: hasChanges(changes),
      changes,
    });
    previews.set(preview, {
      revision,
      favorites: nextFavorites,
      ratings: nextRatings,
      preview,
    });
    console.info('[Save data] import preview created', {
      mode,
      hasChanges: preview.hasChanges,
      favoritesAdded: changes.favorites.added,
      favoritesRemoved: changes.favorites.removed,
      ratingsAdded: changes.ratings.added,
      ratingsImproved: changes.ratings.improved,
      ratingsRemoved: changes.ratings.removed,
      ratingsDowngraded: changes.ratings.downgraded,
    });
    return preview;
  }

  function importResult(
    status: SaveImportStatus,
    resultNotice: string | null,
    changed: boolean,
  ): SaveImportResult {
    return Object.freeze({ status, notice: resultNotice, persistence, changed });
  }

  function applyImport(preview: SaveImportPreview, target: SaveImportTarget): SaveImportResult {
    if (target !== 'local' && target !== 'session') {
      return importResult('invalid-preview', 'Import target must be local or session.', false);
    }
    const candidate = preview !== null && typeof preview === 'object'
      ? previews.get(preview)
      : undefined;
    if (candidate === undefined) {
      return importResult('invalid-preview', 'This import preview is invalid or belongs to another save store.', false);
    }
    if (candidate.revision !== revision) {
      return importResult('stale-preview', 'Player data changed after this preview; create a new preview before applying it.', false);
    }

    const changed = candidate.preview.hasChanges;
    if (target === 'session') {
      const persistencePolicyChanged = activeStorage !== null || persistence !== 'session';
      if (changed) {
        favorites = new Set(candidate.favorites);
        ratings = new Map([...candidate.ratings].map(([id, value]) => [id, { ...value }]));
      }
      if (changed || persistencePolicyChanged) revision += 1;
      activeStorage = null;
      persistence = 'session';
      notice = 'Imported player data is available for this session only. It was not written to storage and can be exported.';
      console.info('[Save data] import applied', {
        target,
        mode: candidate.preview.mode,
        outcome: 'session-only',
        changed,
        favoritesCount: favorites.size,
        ratingsCount: ratings.size,
      });
      return importResult('session-only', notice, changed);
    }

    if (backingStorage === null) {
      const unavailableNotice = 'Local storage is unavailable; import was not applied. Choose session-only explicitly or try again when storage is available.';
      console.warn('[Save data] local import failed', { target, cause: 'storage-unavailable' });
      return importResult('failed', unavailableNotice, false);
    }
    if (!initialLoadSafe) {
      const unsafeNotice = 'Local player data could not be read or validated completely. The import was not applied so unreadable stored bytes are preserved; choose session-only explicitly to continue.';
      console.warn('[Save data] local import failed', {
        target,
        cause: 'unsafe-initial-storage-state',
      });
      return importResult('failed', unsafeNotice, false);
    }

    try {
      console.info('[Save data] import write attempt', {
        target,
        mode: candidate.preview.mode,
        favoritesCount: candidate.favorites.size,
        ratingsCount: candidate.ratings.size,
      });
      const currentSave = backingStorage.getItem(SAVE_STORAGE_KEY);
      const changedSave = currentSave !== observedSave;
      const changedLegacy = !loadedCanonical && (
        backingStorage.getItem(FAVORITES_STORAGE_KEY) !== observedFavoriteLegacy ||
        backingStorage.getItem(RATINGS_STORAGE_KEY) !== observedRatingLegacy
      );
      if (changedSave || changedLegacy) {
        activeStorage = null;
        persistence = 'session';
        notice = 'Player data changed in storage since it was loaded. Import was not applied; current session data and stored bytes were preserved.';
        console.warn('[Save data] import write refused', {
          target,
          cause: 'storage-conflict',
        });
        return importResult('conflict', notice, false);
      }

      const serialized = serializeSave(candidate.favorites, candidate.ratings);
      if (!changed && loadedCanonical && serialized === observedSave) {
        activeStorage = backingStorage;
        persistence = 'local';
        notice = null;
        console.info('[Save data] local import was already durable', {
          target,
          mode: candidate.preview.mode,
          outcome: 'no-op',
        });
        return importResult('applied', null, false);
      }

      backingStorage.setItem(SAVE_STORAGE_KEY, serialized);
      observedSave = serialized;
      loadedCanonical = true;
      favorites = new Set(candidate.favorites);
      ratings = new Map([...candidate.ratings].map(([id, value]) => [id, { ...value }]));
      revision += 1;
      activeStorage = backingStorage;
      persistence = 'local';
      notice = null;
      console.info('[Save data] import applied', {
        target,
        mode: candidate.preview.mode,
        outcome: 'local',
        favoritesCount: favorites.size,
        ratingsCount: ratings.size,
      });
      return importResult('applied', null, true);
    } catch (error) {
      const failureNotice = 'The import could not be saved locally, so it was not applied. Current player data was preserved; choose session-only explicitly to continue without writing.';
      console.warn('[Save data] local import failed', {
        target,
        cause: 'storage-access-or-write',
        error: error instanceof Error ? error.message : String(error),
      });
      return importResult('failed', failureNotice, false);
    }
  }

  return {
    favorites: favoriteStore,
    songRatings: songRatingStore,
    snapshot,
    exportJson,
    previewImport,
    applyImport,
  };
}
