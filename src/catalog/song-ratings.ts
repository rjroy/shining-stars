import type { GameResult } from '../game/game';
import { type FavoriteStorage, type FavoritePersistence } from './favorites';
import { isDifficulty } from '../game/game-balance';
import {
  GOLD_STAR_THRESHOLDS,
  NORMAL_STAR_THRESHOLDS,
} from '../game/star-thresholds';

export interface SongRating {
  readonly played: true;
  readonly normalStars: number;
  readonly goldStars: number;
  /** Normal stars dominate; gold stars break ties between equal normal counts. */
  readonly achievementOrdinal: number;
}

export interface SongRatingSnapshot {
  readonly ratings: ReadonlyMap<string, SongRating>;
  readonly persistence: FavoritePersistence;
  readonly notice: string | null;
}

export type CompletedSongResult = Pick<
  GameResult,
  'score' | 'normalMaximum' | 'outcome' | 'difficulty'
>;

export interface SongRatingStore {
  snapshot(): SongRatingSnapshot;
  /** Returns null for never played; a zero-star completed result is an entry. */
  get(songId: string): SongRating | null;
  /** Record only after a completed result; this method does no per-frame work. */
  recordCompletedResult(
    songId: string,
    result: CompletedSongResult,
  ): SongRating;
}

const STORAGE_KEY = 'shining-stars.song-ratings';
const STORAGE_VERSION = 1;
const FALLBACK_NOTICE =
  'Song ratings are available for this session only because local storage is unavailable.';

export interface StoredRating {
  readonly played: true;
  readonly normalStars: number;
  readonly goldStars: number;
}

interface StoredRatingsEnvelope {
  readonly schemaVersion: typeof STORAGE_VERSION;
  readonly ratings: Readonly<Record<string, StoredRating>>;
}

export function isPossibleRating(value: Record<string, unknown>): value is Record<
  string,
  unknown
> & {
  readonly played: true;
  readonly normalStars: number;
  readonly goldStars: number;
} {
  return (
    value.played === true &&
    isStarCount(value.normalStars) &&
    isStarCount(value.goldStars) &&
    (value.goldStars === 0 || value.normalStars === 5)
  );
}

function getBrowserStorage(): FavoriteStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStarCount(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    typeof value === 'number' &&
    value >= 0 &&
    value <= 5
  );
}

export function parseRatings(value: string | null): Map<string, StoredRating> {
  if (value === null) return new Map();
  const parsed: unknown = JSON.parse(value);
  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== STORAGE_VERSION ||
    !isRecord(parsed.ratings)
  ) {
    throw new TypeError('Stored song ratings have an invalid envelope.');
  }

  const ratings = new Map<string, StoredRating>();
  for (const [songId, value] of Object.entries(parsed.ratings)) {
    if (songId.trim() === '' || !isRecord(value) || !isPossibleRating(value)) {
      throw new TypeError(`Stored song rating '${songId}' is invalid.`);
    }
    ratings.set(songId, {
      played: true,
      normalStars: value.normalStars,
      goldStars: value.goldStars,
    });
  }
  return ratings;
}

function withOrdinal(rating: StoredRating): SongRating {
  return {
    ...rating,
    achievementOrdinal: rating.normalStars * 6 + rating.goldStars,
  };
}

export function validateCompletedResult(result: CompletedSongResult): void {
  if (
    !Number.isFinite(result.score) ||
    result.score < 0 ||
    !Number.isFinite(result.normalMaximum) ||
    result.normalMaximum < 0 ||
    !isDifficulty(result.difficulty) ||
    (result.outcome !== 'victory' &&
      result.outcome !== 'survived' &&
      result.outcome !== 'defeat')
  ) {
    throw new TypeError('Completed song result is invalid.');
  }
}

export function ratingForResult(result: CompletedSongResult): StoredRating {
  const ratio =
    result.normalMaximum > 0 ? result.score / result.normalMaximum : 0;
  return {
    played: true,
    normalStars: NORMAL_STAR_THRESHOLDS.filter((threshold) => ratio >= threshold)
      .length,
    goldStars: GOLD_STAR_THRESHOLDS.filter((threshold) => ratio >= threshold).length,
  };
}

export function ratingOrdinal(rating: StoredRating): number {
  return rating.normalStars * 6 + rating.goldStars;
}

function copyRating(rating: StoredRating): SongRating {
  return withOrdinal(rating);
}

export function createSongRatingStore(
  storage: FavoriteStorage | null = getBrowserStorage(),
  storageKey = STORAGE_KEY,
): SongRatingStore {
  let ratings = new Map<string, StoredRating>();
  let activeStorage = storage;
  let persistence: FavoritePersistence = storage === null ? 'session' : 'local';
  let notice = storage === null ? FALLBACK_NOTICE : null;

  if (activeStorage !== null) {
    try {
      console.info('[Song ratings] storage load attempt', { storageKey });
      ratings = parseRatings(activeStorage.getItem(storageKey));
      console.info('[Song ratings] storage load succeeded', {
        storageKey,
        ratingCount: ratings.size,
      });
    } catch (error) {
      activeStorage = null;
      persistence = 'session';
      notice = FALLBACK_NOTICE;
      console.warn('[Song ratings] storage load failed; using session state', {
        storageKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    console.info('[Song ratings] using session state; storage unavailable');
  }

  function snapshot(): SongRatingSnapshot {
    return {
      ratings: new Map(
        [...ratings].map(([songId, rating]) => [songId, copyRating(rating)]),
      ),
      persistence,
      notice,
    };
  }

  function persist(songId: string): void {
    if (activeStorage === null) return;
    const envelope: StoredRatingsEnvelope = {
      schemaVersion: STORAGE_VERSION,
      ratings: Object.fromEntries(ratings),
    };
    try {
      console.info('[Song ratings] storage write attempt', {
        storageKey,
        songId,
        ratingCount: ratings.size,
      });
      activeStorage.setItem(storageKey, JSON.stringify(envelope));
      console.info('[Song ratings] storage write succeeded', {
        storageKey,
        songId,
        ratingCount: ratings.size,
      });
    } catch (error) {
      activeStorage = null;
      persistence = 'session';
      notice = FALLBACK_NOTICE;
      console.warn('[Song ratings] storage write failed; using session state', {
        storageKey,
        songId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    snapshot,
    get(songId) {
      const rating = ratings.get(songId);
      return rating === undefined ? null : copyRating(rating);
    },
    recordCompletedResult(songId, result) {
      if (songId.trim() === '') throw new TypeError('Song ID cannot be empty.');
      validateCompletedResult(result);

      const candidate = ratingForResult(result);
      const current = ratings.get(songId);
      if (current === undefined || ratingOrdinal(candidate) > ratingOrdinal(current)) {
        ratings.set(songId, candidate);
        persist(songId);
        return copyRating(candidate);
      }
      return copyRating(current);
    },
  };
}
