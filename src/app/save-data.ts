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
import { createProgression, purchase as buyProgression, recordVictory as creditVictory, validateProgression, type ProgressionPurchaseRequest, type ProgressionState } from '../catalog/progression';
import { createProgressionMembership } from '../catalog/progression-catalog';
import { isDifficulty, type Difficulty } from '../game/game-balance';
import {
  copyPersonalBestScores,
  flattenPersonalBestScores,
  personalBestScoreKey,
  validateCompletedScore,
  type PersonalBestScoreResult,
  type PersonalBestScoreSnapshot,
  type PersonalBestScoreStore,
  type StoredPersonalBestScore,
} from './personal-best-scores';

export const SAVE_STORAGE_KEY = 'shining-stars.save';
export const SAVE_FORMAT = 'shining-stars-save';
export const SAVE_SCHEMA_VERSION = 3;

const FAVORITES_STORAGE_KEY = 'shining-stars.favorite-song-ids';
const RATINGS_STORAGE_KEY = 'shining-stars.song-ratings';
const STORAGE_UNAVAILABLE_NOTICE =
  'Player data is available for this session only because local storage is unavailable or denied access.';
const SESSION_PURCHASE_NOTICE =
  'Purchase is available for this session only. It was not written to local storage and can be exported.';

export interface SaveDataSnapshot {
  readonly favorites: FavoriteSnapshot;
  readonly ratings: SongRatingSnapshot;
  readonly personalBestScores: PersonalBestScoreSnapshot & {
    readonly persistence: FavoritePersistence;
    readonly notice: string | null;
  };
}
export type ProgressionSnapshot = ProgressionState & { readonly persistence: FavoritePersistence; readonly notice: string | null };
export type ProgressionMutationResult = { readonly status: 'applied' | 'session-only' | 'conflict' | 'failed'; readonly notice: string | null; readonly persistence: FavoritePersistence; readonly changed: boolean };
export type ProgressionImportSummary = { readonly before: { readonly balance: number; readonly marks: number; readonly collectionPurchases: number; readonly songPurchases: number }; readonly after: { readonly balance: number; readonly marks: number; readonly collectionPurchases: number; readonly songPurchases: number } };
export type ProgressionImportMode = 'keep-current' | 'replace';

export interface SaveStore {
  readonly favorites: FavoriteStore;
  readonly songRatings: SongRatingStore;
  readonly personalBestScores: PersonalBestScoreStore;
  readonly progression: { snapshot(): ProgressionSnapshot; recordVictory(songId: string, difficulty: Difficulty): ProgressionMutationResult; purchase(request: ProgressionPurchaseRequest, target: SaveImportTarget): ProgressionMutationResult };
  snapshot(): SaveDataSnapshot;
  exportJson(): string;
  previewImport(text: string, mode: SaveImportMode, progressionMode?: ProgressionImportMode): SaveImportPreview;
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
  readonly personalBestScores: {
    readonly added: number;
    readonly improved: number;
    readonly removed: number;
    readonly downgraded: number;
  };
  readonly progression: ProgressionImportSummary;
}

/** Immutable preview summary. Identity is privately bound to its candidate. */
export interface SaveImportPreview {
  readonly mode: SaveImportMode;
  readonly progressionMode: ProgressionImportMode;
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
  readonly personalBestScores: Map<string, Map<Difficulty, number>>;
  readonly preview: SaveImportPreview;
  readonly progression: ProgressionState;
}

interface StoredSave {
  readonly format: typeof SAVE_FORMAT;
  readonly schemaVersion: 1 | 2 | typeof SAVE_SCHEMA_VERSION;
  readonly favorites: readonly string[];
  readonly ratings: Readonly<Record<string, StoredRating>>;
  readonly progression?: ProgressionState;
  readonly personalBestScores?: readonly StoredPersonalBestScore[];
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

function parseCanonical(value: string, membership?: ReturnType<typeof createProgressionMembership>): { favorites: Set<string>; ratings: Map<string, StoredRating>; progression: ProgressionState; personalBestScores: Map<string, Map<Difficulty, number>> } {
  const parsed: unknown = JSON.parse(value);
  const allowedKeys = isRecord(parsed)
    ? parsed.schemaVersion === 1
      ? ['format', 'schemaVersion', 'favorites', 'ratings']
      : parsed.schemaVersion === 2
        ? ['format', 'schemaVersion', 'favorites', 'ratings', 'progression']
        : ['format', 'schemaVersion', 'favorites', 'ratings', 'progression', 'personalBestScores']
    : [];
  if (
    !isRecord(parsed) ||
    !hasOnlyKeys(parsed, allowedKeys) ||
    parsed.format !== SAVE_FORMAT ||
    (parsed.schemaVersion !== 1 && parsed.schemaVersion !== 2 && parsed.schemaVersion !== SAVE_SCHEMA_VERSION) ||
    !Array.isArray(parsed.favorites) ||
    parsed.favorites.some((id) => typeof id !== 'string') ||
    !isRecord(parsed.ratings) ||
    (parsed.schemaVersion !== 1 && !Object.hasOwn(parsed, 'progression')) ||
    (parsed.schemaVersion === SAVE_SCHEMA_VERSION && !Object.hasOwn(parsed, 'personalBestScores')) ||
    (parsed.schemaVersion === SAVE_SCHEMA_VERSION && !Array.isArray(parsed.personalBestScores))
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

  const progression = parsed.schemaVersion === 1 ? createProgression() : validateProgression(parsed.progression, membership);
  const personalBestScores = new Map<string, Map<Difficulty, number>>();
  const seenScores = new Set<string>();
  if (parsed.schemaVersion === SAVE_SCHEMA_VERSION) {
    const rawScores = parsed.personalBestScores as unknown[];
    for (const rawScore of rawScores) {
      if (
        !isRecord(rawScore) ||
        !hasOnlyKeys(rawScore, ['songId', 'difficulty', 'score']) ||
        typeof rawScore.songId !== 'string' ||
        typeof rawScore.score !== 'number' ||
        !isDifficulty(rawScore.difficulty)
      ) {
        throw new TypeError('Stored personal-best score is invalid.');
      }
      validateCompletedScore(rawScore.songId, rawScore.difficulty, rawScore.score);
      const key = personalBestScoreKey(rawScore.songId, rawScore.difficulty);
      if (seenScores.has(key)) throw new TypeError('Stored personal-best score is duplicated.');
      seenScores.add(key);
      let byDifficulty = personalBestScores.get(rawScore.songId);
      if (byDifficulty === undefined) {
        byDifficulty = new Map();
        personalBestScores.set(rawScore.songId, byDifficulty);
      }
      byDifficulty.set(rawScore.difficulty, rawScore.score);
    }
  }
  return { favorites: new Set(parsed.favorites), ratings, progression, personalBestScores };
}

function savedRating(rating: StoredRating): SongRating {
  return { ...rating, achievementOrdinal: ratingOrdinal(rating) };
}

function getInitialStorage(): FavoriteStorage | null {
  return browserStorage();
}

function serializeSave(favorites: ReadonlySet<string>, ratings: ReadonlyMap<string, StoredRating>, progression: ProgressionState, personalBestScores: ReadonlyMap<string, ReadonlyMap<Difficulty, number>>): string {
  const savedRatings = Object.create(null) as Record<string, StoredRating>;
  for (const [id, rating] of ratings) savedRatings[id] = { ...rating };
  const document: StoredSave = {
    format: SAVE_FORMAT,
    schemaVersion: SAVE_SCHEMA_VERSION,
    favorites: [...favorites],
    ratings: savedRatings,
    progression,
    personalBestScores: flattenPersonalBestScores(personalBestScores),
  };
  return JSON.stringify(document);
}

function countChanges(
  currentFavorites: ReadonlySet<string>,
  currentRatings: ReadonlyMap<string, StoredRating>,
  nextFavorites: ReadonlySet<string>,
  nextRatings: ReadonlyMap<string, StoredRating>,
  currentScores: ReadonlyMap<string, ReadonlyMap<Difficulty, number>>,
  nextScores: ReadonlyMap<string, ReadonlyMap<Difficulty, number>>,
): SaveImportChanges {
  let ratingAdded = 0;
  let ratingImproved = 0;
  let ratingRemoved = 0;
  let ratingDowngraded = 0;
  let scoreAdded = 0;
  let scoreImproved = 0;
  let scoreRemoved = 0;
  let scoreDowngraded = 0;
  for (const [id, next] of nextRatings) {
    const current = currentRatings.get(id);
    if (current === undefined) ratingAdded += 1;
    else if (ratingOrdinal(next) > ratingOrdinal(current)) ratingImproved += 1;
    else if (ratingOrdinal(next) < ratingOrdinal(current)) ratingDowngraded += 1;
  }
  for (const id of currentRatings.keys()) {
    if (!nextRatings.has(id)) ratingRemoved += 1;
  }
  const currentScoreValues = new Map<string, number>();
  const nextScoreValues = new Map<string, number>();
  for (const [songId, scores] of currentScores)
    for (const [difficulty, score] of scores)
      currentScoreValues.set(personalBestScoreKey(songId, difficulty), score);
  for (const [songId, scores] of nextScores)
    for (const [difficulty, score] of scores)
      nextScoreValues.set(personalBestScoreKey(songId, difficulty), score);
  for (const [key, score] of nextScoreValues) {
    const current = currentScoreValues.get(key);
    if (current === undefined) scoreAdded += 1;
    else if (score > current) scoreImproved += 1;
    else if (score < current) scoreDowngraded += 1;
  }
  for (const key of currentScoreValues.keys())
    if (!nextScoreValues.has(key)) scoreRemoved += 1;
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
    personalBestScores: Object.freeze({ added: scoreAdded, improved: scoreImproved, removed: scoreRemoved, downgraded: scoreDowngraded }),
    progression: Object.freeze({ before: Object.freeze({ balance: 0, marks: 0, collectionPurchases: 0, songPurchases: 0 }), after: Object.freeze({ balance: 0, marks: 0, collectionPurchases: 0, songPurchases: 0 }) }),
  });
}

function hasChanges(changes: SaveImportChanges): boolean {
  return Object.values(changes.favorites).some((count) => count > 0) ||
    Object.values(changes.ratings).some((count) => count > 0) ||
    Object.values(changes.personalBestScores).some((count) => count > 0);
}

export function createSaveStore(storage: FavoriteStorage | null = getInitialStorage()): SaveStore {
  const backingStorage = storage;
  const previews = new WeakMap<SaveImportPreview, ImportCandidate>();
  let favorites = new Set<string>();
  let ratings = new Map<string, StoredRating>();
  let personalBestScores = new Map<string, Map<Difficulty, number>>();
  let progression = createProgression();
  const membership = createProgressionMembership();
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
          data = parseCanonical(observedSave, membership);
        } catch (error) {
          notice = 'The canonical player save is invalid or unsupported. Legacy values were not loaded; export contains only current session data and existing storage contents were preserved.';
          throw error;
        }
        favorites = data.favorites;
        ratings = data.ratings;
        personalBestScores = data.personalBestScores;
        progression = data.progression;
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
    return {
      favorites: favoriteSnapshot,
      ratings: ratingSnapshot,
      personalBestScores: {
        scores: copyPersonalBestScores(personalBestScores),
        persistence,
        notice,
      },
    };
  }

  function exportJson(): string {
    return serializeSave(favorites, ratings, progression, personalBestScores);
  }

  function persist(): void {
    if (activeStorage === null) return;
    try {
      console.info('[Save data] storage write attempt', {
        storageKey: SAVE_STORAGE_KEY,
        favoriteCount: favorites.size,
        ratingCount: ratings.size,
        personalBestScoreCount: flattenPersonalBestScores(personalBestScores).length,
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
        personalBestScoreCount: flattenPersonalBestScores(personalBestScores).length,
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

  const personalBestScoreStore: PersonalBestScoreStore = {
    snapshot: () => ({ scores: copyPersonalBestScores(personalBestScores) }),
    getBest(songId, difficulty) {
      return personalBestScores.get(songId)?.get(difficulty) ?? null;
    },
    recordCompletedScore(songId, difficulty, score): PersonalBestScoreResult {
      validateCompletedScore(songId, difficulty, score);
      const byDifficulty = personalBestScores.get(songId);
      const previousBest = byDifficulty?.get(difficulty) ?? null;
      if (previousBest !== null && score <= previousBest)
        return Object.freeze({ previousBest, best: previousBest, isNewBest: false });
      const nextByDifficulty = byDifficulty ?? new Map<Difficulty, number>();
      nextByDifficulty.set(difficulty, score);
      if (byDifficulty === undefined) personalBestScores.set(songId, nextByDifficulty);
      revision += 1;
      persist();
      return Object.freeze({ previousBest, best: score, isNewBest: true });
    },
  };

  const progressionStore = {
    snapshot(): ProgressionSnapshot { return Object.freeze({ balance: progression.balance, victoryMarks: Object.freeze({ ...progression.victoryMarks }), collectionPurchases: Object.freeze({ ...progression.collectionPurchases }), songPurchases: Object.freeze({ ...progression.songPurchases }), persistence, notice }); },
    recordVictory(songId: string, difficulty: Difficulty): ProgressionMutationResult {
      console.info('[Save data] victory credit attempt', { trigger: 'twilight-defeat', songId, difficulty, persistence });
      try {
        const next = creditVictory(progression, songId, difficulty);
        const changed = next !== progression;
        const awardAmount = next.balance - progression.balance;
        if (changed) { progression = next; revision += 1; persist(); }
        const result = Object.freeze({ status: persistence === 'local' ? 'applied' as const : 'session-only' as const, notice, persistence, changed });
        console.info('[Save data] victory credit outcome', { trigger: 'twilight-defeat', songId, difficulty, awardAmount, balance: progression.balance, persistence, outcome: result.status, changed });
        return result;
      } catch (error) {
        console.warn('[Save data] victory credit rejected', { error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },
    purchase(request: ProgressionPurchaseRequest, target: SaveImportTarget): ProgressionMutationResult {
      const purchaseId = request?.kind === 'collection' ? request.collectionId : request?.kind === 'song' ? request.songId : null;
      const configuredCost = request?.kind === 'collection' ? membership.collections.get(request.collectionId) : request?.kind === 'song' ? membership.songPrice : undefined;
      const spendAmount = typeof configuredCost === 'number' ? configuredCost : 0;
      console.info('[Save data] progression purchase attempt', { trigger: 'explicit-purchase', kind: request?.kind, purchaseId, spendAmount, target, persistence });
      const failed = (cause: string, error?: unknown): ProgressionMutationResult => {
        const resultNotice = cause === 'invalid-target' ? 'Purchase target must be local or session.' : 'Local purchase was not saved; choose session-only explicitly.';
        console.warn('[Save data] progression purchase failed', { trigger: 'explicit-purchase', kind: request?.kind, purchaseId, spendAmount, balance: progression.balance, persistence, cause, ...(error === undefined ? {} : { error: error instanceof Error ? error.message : String(error) }) });
        return Object.freeze({ status: 'failed', notice: resultNotice, persistence, changed: false });
      };
      if (target !== 'local' && target !== 'session') return failed('invalid-target');
      let next: ProgressionState;
      try { next = buyProgression(progression, request, membership); }
      catch (error) { console.warn('[Save data] progression purchase rejected', { trigger: 'explicit-purchase', kind: request?.kind, purchaseId, spendAmount, balance: progression.balance, persistence, error: error instanceof Error ? error.message : String(error) }); throw error; }
      if (next === progression) {
        if (target === 'session') {
          const policyChanged = activeStorage !== null || persistence !== 'session';
          activeStorage = null; persistence = 'session';
          notice = SESSION_PURCHASE_NOTICE;
          if (policyChanged) revision += 1;
        }
        const result = Object.freeze({ status: target === 'local' && persistence === 'local' ? 'applied' as const : 'session-only' as const, notice, persistence, changed: false });
        console.info('[Save data] progression purchase outcome', { trigger: 'explicit-purchase', kind: request.kind, purchaseId, spendAmount: 0, balance: progression.balance, persistence, outcome: result.status, changed: false });
        return result;
      }
      if (target === 'session') { progression = next; revision += 1; activeStorage = null; persistence = 'session'; notice = SESSION_PURCHASE_NOTICE; const result = Object.freeze({ status: 'session-only' as const, notice, persistence, changed: true }); console.info('[Save data] progression purchase outcome', { trigger: 'explicit-purchase', kind: request.kind, purchaseId, spendAmount, balance: progression.balance, persistence, outcome: result.status, changed: true }); return result; }
      if (backingStorage === null || activeStorage === null || !initialLoadSafe) return failed('unsafe-or-unavailable-storage');
      try {
        if (backingStorage.getItem(SAVE_STORAGE_KEY) !== observedSave || (!loadedCanonical && (backingStorage.getItem(FAVORITES_STORAGE_KEY) !== observedFavoriteLegacy || backingStorage.getItem(RATINGS_STORAGE_KEY) !== observedRatingLegacy))) {
          activeStorage = null; persistence = 'session'; notice = 'Player data changed in storage since it was loaded. Purchase was not applied.';
          console.warn('[Save data] progression purchase conflict', { trigger: 'explicit-purchase', kind: request.kind, purchaseId, spendAmount, balance: progression.balance, persistence, cause: 'storage-changed' });
          return Object.freeze({ status: 'conflict', notice, persistence, changed: false });
        }
        const serialized = serializeSave(favorites, ratings, next, personalBestScores);
        backingStorage.setItem(SAVE_STORAGE_KEY, serialized); observedSave = serialized; loadedCanonical = true; progression = next; revision += 1;
        console.info('[Save data] progression purchase outcome', { trigger: 'explicit-purchase', kind: request.kind, purchaseId, spendAmount: progression.balance - next.balance, balance: progression.balance, persistence, outcome: 'applied', changed: true });
        return Object.freeze({ status: 'applied', notice: null, persistence, changed: true });
      } catch (error) { console.warn('[Save data] progression purchase failed', { trigger: 'explicit-purchase', kind: request.kind, purchaseId, spendAmount, balance: progression.balance, persistence, cause: 'storage-access-or-write', error: error instanceof Error ? error.message : String(error) }); return Object.freeze({ status: 'failed', notice: 'Local purchase could not be saved; it was not applied.', persistence, changed: false }); }
    },
  };

  function previewImport(text: string, mode: SaveImportMode, progressionMode: ProgressionImportMode = 'keep-current'): SaveImportPreview {
    if (mode !== 'merge' && mode !== 'replace') {
      throw new TypeError('Import mode must be merge or replace.');
    }
    if (progressionMode !== 'keep-current' && progressionMode !== 'replace') throw new TypeError('Progression import mode must be keep-current or replace.');
    const imported = parseCanonical(text, membership);

    let nextFavorites: Set<string>;
    let nextRatings: Map<string, StoredRating>;
    let nextPersonalBestScores: Map<string, Map<Difficulty, number>>;
    if (mode === 'replace') {
      nextFavorites = new Set(imported.favorites);
      nextRatings = new Map(imported.ratings);
      nextPersonalBestScores = copyPersonalBestScores(imported.personalBestScores);
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
      nextPersonalBestScores = copyPersonalBestScores(personalBestScores);
      for (const [songId, importedScores] of imported.personalBestScores) {
        let currentScores = nextPersonalBestScores.get(songId);
        if (currentScores === undefined) {
          currentScores = new Map();
          nextPersonalBestScores.set(songId, currentScores);
        }
        for (const [difficulty, importedBest] of importedScores) {
          const currentBest = currentScores.get(difficulty);
          if (currentBest === undefined || importedBest > currentBest)
            currentScores.set(difficulty, importedBest);
        }
      }
    }

    const changes = countChanges(favorites, ratings, nextFavorites, nextRatings, personalBestScores, nextPersonalBestScores);
    const nextProgression = progressionMode === 'replace' ? imported.progression : progression;
    const progressSummary = (p: ProgressionState) => Object.freeze({ balance: p.balance, marks: Object.values(p.victoryMarks).reduce((sum, tier) => sum + ({ easy: 1, normal: 2, hard: 3 }[tier]), 0), collectionPurchases: Object.keys(p.collectionPurchases).length, songPurchases: Object.keys(p.songPurchases).length });
    const progressChanges = Object.freeze({ before: progressSummary(progression), after: progressSummary(nextProgression) });
    const allChanges = Object.freeze({ ...changes, progression: progressChanges });
    const preview: SaveImportPreview = Object.freeze({
      mode,
      progressionMode,
      hasChanges: hasChanges(changes) || JSON.stringify(progression) !== JSON.stringify(nextProgression),
      changes: allChanges,
    });
    previews.set(preview, {
      revision,
      favorites: nextFavorites,
      ratings: nextRatings,
      personalBestScores: nextPersonalBestScores,
      progression: nextProgression,
      preview,
    });
    console.info('[Save data] import preview created', {
      mode, progressionMode,
      hasChanges: preview.hasChanges,
      favoritesAdded: changes.favorites.added,
      favoritesRemoved: changes.favorites.removed,
      ratingsAdded: changes.ratings.added,
      ratingsImproved: changes.ratings.improved,
      ratingsRemoved: changes.ratings.removed,
      ratingsDowngraded: changes.ratings.downgraded,
      personalBestScoresAdded: changes.personalBestScores.added,
      personalBestScoresImproved: changes.personalBestScores.improved,
      personalBestScoresRemoved: changes.personalBestScores.removed,
      personalBestScoresDowngraded: changes.personalBestScores.downgraded,
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
        personalBestScores = copyPersonalBestScores(candidate.personalBestScores);
        progression = validateProgression(candidate.progression);
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
        personalBestScoreCount: flattenPersonalBestScores(personalBestScores).length,
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
        personalBestScoreCount: flattenPersonalBestScores(candidate.personalBestScores).length,
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

      const serialized = serializeSave(candidate.favorites, candidate.ratings, candidate.progression, candidate.personalBestScores);
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
      personalBestScores = copyPersonalBestScores(candidate.personalBestScores);
      progression = validateProgression(candidate.progression);
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
        personalBestScoreCount: flattenPersonalBestScores(personalBestScores).length,
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
    personalBestScores: personalBestScoreStore,
    progression: progressionStore,
    snapshot,
    exportJson,
    previewImport,
    applyImport,
  };
}
