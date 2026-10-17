import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FavoriteStorage } from './favorites';

/**
 * Proposed storage API contract for src/catalog/song-ratings.ts:
 *
 * createSongRatingStore(storage?: FavoriteStorage | null, storageKey?: string)
 * returns a store with snapshot(), get(songId) -> SongRating | null and
 * recordCompletedResult(songId, { score, normalMaximum, outcome }) -> SongRating.
 * snapshot() reports persistence: 'local' | 'session' and a session-only notice.
 * SongRating is { played: true, normalStars, goldStars, achievementOrdinal }.
 * The ordinal is normalStars * 6 + goldStars, so each normal star outranks
 * every possible gold-star difference and N5/G1 is greater than N5/G0.
 * Saved counts use score / shared-Normal normalMaximum and inclusive thresholds
 * Normal [20, 30, 40, 50, 60]% and Gold [70, 75, 80, 85, 90]%.
 *
 * The production module does not exist yet. Import it dynamically so RED is an
 * explicit missing-feature assertion, not a test-module resolution failure.
 * No production behavior is stubbed here; the memory storage below exercises
 * the same injectable storage seam as favorites.ts.
 */
const moduleUrl = new URL('./song-ratings.ts', import.meta.url);
const implementation = existsSync(moduleUrl)
  ? import(/* @vite-ignore */ moduleUrl.href)
  : Promise.resolve(null);

type CompletedResult = {
  readonly score: number;
  /** Shared Normal target, even when the result came from another difficulty. */
  readonly normalMaximum: number;
  readonly difficulty: 'easy' | 'normal' | 'hard';
  readonly outcome: 'victory' | 'survived' | 'defeat';
};

type SongRating = {
  readonly played: true;
  readonly normalStars: number;
  readonly goldStars: number;
  readonly achievementOrdinal: number;
};

type SongRatingStore = {
  snapshot(): {
    readonly ratings: ReadonlyMap<string, SongRating>;
    readonly persistence: 'local' | 'session';
    readonly notice: string | null;
  };
  get(songId: string): SongRating | null;
  recordCompletedResult(songId: string, result: CompletedResult): SongRating;
};

type StoreFactory = (
  storage?: FavoriteStorage | null,
  storageKey?: string,
) => SongRatingStore;

function memoryStorage(initial: string | null = null) {
  return {
    value: initial,
    writes: 0,
    getItem() {
      return this.value;
    },
    setItem(_key: string, value: string) {
      this.value = value;
      this.writes += 1;
    },
  };
}

async function createStore(
  storage: FavoriteStorage | null,
  storageKey = 'ratings-test',
): Promise<SongRatingStore> {
  const module = await implementation;
  expect(
    module,
    'src/catalog/song-ratings.ts must implement the saved-rating store',
  ).not.toBeNull();
  const factory = Reflect.get(module, 'createSongRatingStore');
  expect(
    factory,
    'song-ratings.ts exports createSongRatingStore(storage, storageKey)',
  ).toBeTypeOf('function');
  return (factory as StoreFactory)(storage, storageKey);
}

const result = (
  score: number,
  outcome: CompletedResult['outcome'] = 'victory',
  normalMaximum = 10_000,
  difficulty: CompletedResult['difficulty'] = 'normal',
): CompletedResult => ({ score, normalMaximum, difficulty, outcome });

describe('saved song rating storage contract (proposed)', () => {
  it('distinguishes never played from a completed zero-score result', async () => {
    const store = await createStore(memoryStorage());
    expect(store.get('song-a')).toBeNull();
    expect(store.recordCompletedResult('song-a', result(0))).toEqual({
      played: true,
      normalStars: 0,
      goldStars: 0,
      achievementOrdinal: 0,
    });
  });

  it.each([
    [800, 1, 0],
    [1_800, 2, 0],
    [3_000, 3, 0],
    [4_400, 4, 0],
    [6_000, 5, 0],
    [7_000, 5, 1],
    [7_500, 5, 2],
    [8_000, 5, 3],
    [8_500, 5, 4],
    [9_000, 5, 5],
  ] as const)(
    'counts score %i against the shared Normal baseline as N%i/G%i',
    async (score, normalStars, goldStars) => {
      const store = await createStore(memoryStorage());
      expect(
        store.recordCompletedResult('song-a', result(score)),
      ).toMatchObject({ normalStars, goldStars });
    },
  );

  it.each([
    [6_999, 0], [7_000, 1], [7_001, 1],
    [7_499, 1], [7_500, 2], [7_501, 2],
    [7_999, 2], [8_000, 3], [8_001, 3],
    [8_499, 3], [8_500, 4], [8_501, 4],
    [8_999, 4], [9_000, 5], [9_001, 5],
  ] as const)(
    'preserves gold-star boundary at score %i as G%i',
    async (score, goldStars) => {
      const store = await createStore(memoryStorage());
      expect(store.recordCompletedResult('song-a', result(score))).toMatchObject({
        normalStars: 5,
        goldStars,
      });
    },
  );

  it.each([
    [799, 0], [800, 1], [801, 1],
    [1_799, 1], [1_800, 2], [1_801, 2],
    [2_999, 2], [3_000, 3], [3_001, 3],
    [4_399, 3], [4_400, 4], [4_401, 4],
    [5_999, 4], [6_000, 5], [6_001, 5],
  ] as const)(
    'counts the normal-star boundary at score %i as N%i',
    async (score, normalStars) => {
      const store = await createStore(memoryStorage());
      expect(store.recordCompletedResult('song-a', result(score))).toMatchObject({
        normalStars,
        goldStars: 0,
      });
    },
  );

  it('preserves historical stored rating counts without recalculating thresholds', async () => {
    const storage = memoryStorage(JSON.stringify({
      schemaVersion: 1,
      ratings: { 'old-song': { played: true, normalStars: 3, goldStars: 0 } },
    }));
    const store = await createStore(storage);
    expect(store.get('old-song')).toMatchObject({ normalStars: 3, goldStars: 0 });
    expect(storage.writes).toBe(0);
  });

  it('retains the best achievement across runs and orders gold as a tie-break', async () => {
    const store = await createStore(memoryStorage());
    const oneGold = store.recordCompletedResult(
      'song-a',
      result(7_000, 'victory', 10_000, 'easy'),
    );
    const lowerRatingStore = await createStore(memoryStorage());
    const noGold = lowerRatingStore.recordCompletedResult(
      'song-a',
      result(6_000, 'victory', 10_000, 'hard'),
    );
    expect(oneGold.achievementOrdinal).toBeGreaterThan(
      noGold.achievementOrdinal,
    );
    expect(
      store.recordCompletedResult(
        'song-a',
        result(6_000, 'victory', 10_000, 'hard'),
      ),
    ).toEqual(oneGold);

    const allGold = store.recordCompletedResult(
      'song-a',
      result(9_000, 'victory', 10_000, 'normal'),
    );
    expect(store.recordCompletedResult('song-a', result(7_000))).toEqual(
      allGold,
    );
    expect(allGold.achievementOrdinal).toBe(35);
  });

  it('keeps independent best ratings for distinct song IDs across reloads', async () => {
    const storage = memoryStorage();
    const firstRun = await createStore(storage);
    const songA = firstRun.recordCompletedResult('song-a', result(9_000));
    const songB = firstRun.recordCompletedResult('song-b', result(2_000));
    expect(songA.achievementOrdinal).toBeGreaterThan(songB.achievementOrdinal);
    expect(
      firstRun.recordCompletedResult('song-a', result(0, 'defeat')),
    ).toEqual(songA);
    const improvedSongB = firstRun.recordCompletedResult(
      'song-b',
      result(3_000, 'survived'),
    );
    expect(improvedSongB).not.toEqual(songA);
    expect(firstRun.get('song-a')).toEqual(songA);
    expect(firstRun.get('song-b')).toEqual(improvedSongB);

    const reloaded = await createStore(storage);
    expect(reloaded.get('song-a')).toEqual(songA);
    expect(reloaded.get('song-b')).toEqual(improvedSongB);
    expect(reloaded.get('song-c')).toBeNull();
  });

  it.each(['victory', 'survived', 'defeat'] as const)(
    'accepts a completed %s outcome as a recordable result',
    async (outcome) => {
      const store = await createStore(memoryStorage());
      expect(
        store.recordCompletedResult('song-a', result(2_000, outcome)),
      ).toMatchObject({ played: true, normalStars: 2, goldStars: 0 });
    },
  );

  it('keeps separate per-song histories across reload and target changes', async () => {
    const storage = memoryStorage();
    const firstRun = await createStore(storage);
    expect(firstRun.snapshot().persistence).toBe('local');
    const earned = firstRun.recordCompletedResult('song-a', result(7_500));
    const otherSong = firstRun.recordCompletedResult('song-b', result(3_000));
    expect(firstRun.get('song-a')).toEqual(earned);
    expect(firstRun.get('song-b')).toEqual(otherSong);
    expect(firstRun.get('song-c')).toBeNull();
    // A later target revision changes this run's computed counts, not history.
    expect(
      firstRun.recordCompletedResult(
        'song-a',
        result(7_500, 'defeat', 20_000, 'hard'),
      ),
    ).toEqual(earned);
    const writesAfterResult = storage.writes;

    const reloaded = await createStore(storage);
    expect(reloaded.get('song-a')).toEqual(earned);
    expect(reloaded.get('song-b')).toEqual(otherSong);
    expect(reloaded.get('song-c')).toBeNull();
    expect(reloaded.get('song-a')?.normalStars).toBe(5);
    expect(reloaded.get('song-a')?.goldStars).toBe(2);
    expect(storage.writes).toBe(writesAfterResult);
  });

  it('does not write on fresh-store creation or reads; records only explicit results', async () => {
    const storage = memoryStorage();
    const store = await createStore(storage);
    expect(storage.writes).toBe(0);
    expect(store.get('unplayed-song')).toBeNull();
    expect(storage.writes).toBe(0);
    store.recordCompletedResult('song-a', result(0));
    expect(storage.writes).toBe(1);
  });

  it('falls back to session state for corrupt or denied storage', async () => {
    const corrupt = await createStore(memoryStorage('{bad json'));
    expect(corrupt.snapshot()).toMatchObject({
      persistence: 'session',
      notice: expect.any(String),
    });
    expect(corrupt.get('song-a')).toBeNull();
    expect(
      corrupt.recordCompletedResult('song-a', result(2_000)),
    ).toMatchObject({ played: true, normalStars: 2 });

    const deniedRead: FavoriteStorage = {
      getItem() {
        throw new Error('storage denied');
      },
      setItem() {
        throw new Error('storage denied');
      },
    };
    const readFallback = await createStore(deniedRead);
    expect(readFallback.snapshot().persistence).toBe('session');
    expect(
      readFallback.recordCompletedResult('song-b', result(0)),
    ).toMatchObject({ played: true, normalStars: 0, goldStars: 0 });

    const deniedWrite: FavoriteStorage = {
      getItem() {
        return null;
      },
      setItem() {
        throw new Error('storage denied');
      },
    };
    const writeFallback = await createStore(deniedWrite);
    expect(writeFallback.snapshot().persistence).toBe('local');
    expect(
      writeFallback.recordCompletedResult('song-c', result(7_000)),
    ).toMatchObject({ played: true, normalStars: 5, goldStars: 1 });
    expect(writeFallback.snapshot().persistence).toBe('session');
    expect(writeFallback.get('song-c')).toMatchObject({
      played: true,
      normalStars: 5,
      goldStars: 1,
    });
  });

  it('rejects persisted gold stars without all five normal stars and falls back empty', async () => {
    const impossibleRating = memoryStorage(
      JSON.stringify({
        schemaVersion: 1,
        ratings: {
          'impossible-song': {
            played: true,
            normalStars: 0,
            goldStars: 5,
          },
        },
      }),
    );
    const store = await createStore(impossibleRating);

    expect(store.snapshot()).toMatchObject({
      persistence: 'session',
      notice: expect.any(String),
    });
    expect(store.get('impossible-song')).toBeNull();
  });
});

// Wiring-level follow-ups deliberately live outside this storage suite: prove
// restart/quit do not persist and only the terminal result hook calls
// recordCompletedResult (never the per-frame update path).
