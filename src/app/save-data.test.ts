import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FavoriteStorage } from '../catalog/favorites';

/**
 * Proposed phase-one contract for src/app/save-data.ts. The unified store owns
 * the existing favorite/rating domain stores and exposes snapshot() and
 * exportJson(). Persistence uses shining-stars.save with
 * schema v3 stores favorites, ratings, progression, and personalBestScores in
 * the canonical save. Older schema v1/v2 saves remain readable.
 * Legacy inputs are shining-stars.favorite-song-ids (JSON string array) and
 * shining-stars.song-ratings (the existing schemaVersion/ratings envelope).
 * This test specifies observable behavior; only module resolution is guarded
 * so a missing feature is reported as an explicit contract failure.
 */
const moduleUrl = new URL('./save-data.ts', import.meta.url);
const implementation = existsSync(moduleUrl)
  ? import(/* @vite-ignore */ moduleUrl.href)
  : Promise.resolve(null);

const SAVE_KEY = 'shining-stars.save';
const FAVORITES_KEY = 'shining-stars.favorite-song-ids';
const RATINGS_KEY = 'shining-stars.song-ratings';

type StorageMap = FavoriteStorage & {
  readonly values: Map<string, string>;
  readonly writes: Array<{ key: string; value: string }>;
};

type RatingRecord = Record<string, { played: true; normalStars: number; goldStars: number }>;

type SaveStore = {
  readonly favorites: {
    snapshot(): { ids: ReadonlySet<string>; persistence: string; notice: string | null };
    toggle(id: string): unknown;
    isFavorite(id: string): boolean;
  };
  readonly songRatings: {
    snapshot(): { ratings: ReadonlyMap<string, { played: true; normalStars: number; goldStars: number; achievementOrdinal: number }> };
    get(id: string): { played: true; normalStars: number; goldStars: number; achievementOrdinal: number } | null;
    recordCompletedResult(id: string, result: { score: number; normalMaximum: number; outcome: 'victory' | 'survived' | 'defeat'; difficulty: 'easy' | 'normal' | 'hard' }): unknown;
  };
  snapshot(): { favorites: { ids: ReadonlySet<string> }; ratings: { ratings: ReadonlyMap<string, { played: true; normalStars: number; goldStars: number; achievementOrdinal: number }> } };
  exportJson(): string;
};

function memoryStorage(seed: Record<string, string> = {}): StorageMap {
  const values = new Map(Object.entries(seed));
  const writes: Array<{ key: string; value: string }> = [];
  return {
    values,
    writes,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { writes.push({ key, value }); values.set(key, value); },
  };
}

async function createSaveStore(storage: FavoriteStorage | null): Promise<SaveStore> {
  const module = await implementation;
  expect(module, 'src/app/save-data.ts must implement createSaveStore').not.toBeNull();
  const factory = Reflect.get(module, 'createSaveStore');
  expect(factory, 'save-data.ts exports createSaveStore(storage)').toBeTypeOf('function');
  return (factory as (storage?: FavoriteStorage | null) => SaveStore)(storage);
}

const legacyRatings = (ratings: Record<string, unknown>) =>
  JSON.stringify({ schemaVersion: 1, ratings });
const save = (favorites: string[], ratings: Record<string, unknown>) => ({
  format: 'shining-stars-save',
  schemaVersion: 3,
  favorites,
  ratings,
  progression: { balance: 0, victoryMarks: {}, collectionPurchases: {}, songPurchases: {} },
  personalBestScores: [],
});
const completed = { score: 0, normalMaximum: 10_000, outcome: 'defeat' as const, difficulty: 'normal' as const };
const throwingLegacyCases: Array<{
  throwingKey: string;
  healthyKey: string;
  healthyValue: string;
  expectedFavorites: string[];
  expectedRatings: RatingRecord;
}> = [
  {
    throwingKey: FAVORITES_KEY,
    healthyKey: RATINGS_KEY,
    healthyValue: legacyRatings({ 'healthy-rating': { played: true, normalStars: 1, goldStars: 0 } }),
    expectedFavorites: [],
    expectedRatings: { 'healthy-rating': { played: true, normalStars: 1, goldStars: 0 } },
  },
  {
    throwingKey: RATINGS_KEY,
    healthyKey: FAVORITES_KEY,
    healthyValue: '["healthy-favorite"]',
    expectedFavorites: ['healthy-favorite'],
    expectedRatings: {},
  },
];

describe('unified player save store (phase one)', () => {
  it('loads both legacy stores without writing, then migrates both through one envelope on mutation', async () => {
    const oldFavorites = '["legacy-song"]';
    const oldRatings = legacyRatings({ 'played/zero': { played: true, normalStars: 0, goldStars: 0 } });
    const storage = memoryStorage({ [FAVORITES_KEY]: oldFavorites, [RATINGS_KEY]: oldRatings });
    const store = await createSaveStore(storage);

    expect(store.favorites.isFavorite('legacy-song')).toBe(true);
    expect(store.songRatings.get('played/zero')).toMatchObject({ played: true, normalStars: 0, goldStars: 0 });
    expect(storage.writes).toEqual([]);
    expect(storage.values.get(FAVORITES_KEY)).toBe(oldFavorites);
    expect(storage.values.get(RATINGS_KEY)).toBe(oldRatings);

    store.favorites.toggle('another:unknown-song');
    expect(storage.writes).toHaveLength(1);
    expect(storage.writes[0]?.key).toBe(SAVE_KEY);
    expect(JSON.parse(storage.values.get(SAVE_KEY) ?? 'null')).toEqual(save(
      ['legacy-song', 'another:unknown-song'],
      { 'played/zero': { played: true, normalStars: 0, goldStars: 0 } },
    ));
    const reloaded = await createSaveStore(storage);
    expect(reloaded.favorites.isFavorite('another:unknown-song')).toBe(true);
    expect(reloaded.songRatings.get('played/zero')).toMatchObject({ played: true, normalStars: 0, goldStars: 0 });
  });

  it('gives a valid canonical save precedence and never falls back to legacy data', async () => {
    const storage = memoryStorage({
      [SAVE_KEY]: JSON.stringify(save(['canonical'], { keep: { played: true, normalStars: 2, goldStars: 0 } })),
      [FAVORITES_KEY]: '["stale-legacy"]',
      [RATINGS_KEY]: legacyRatings({ stale: { played: true, normalStars: 5, goldStars: 5 } }),
    });
    const store = await createSaveStore(storage);
    expect(store.favorites.isFavorite('canonical')).toBe(true);
    expect(store.favorites.isFavorite('stale-legacy')).toBe(false);
    expect(store.songRatings.get('keep')).toMatchObject({ normalStars: 2 });
    expect(store.songRatings.get('stale')).toBeNull();
    expect(storage.writes).toEqual([]);
  });

  it('does not use legacy values when the canonical save is corrupt or unsupported', async () => {
    for (const canonical of ['{bad json', JSON.stringify({ ...save(['bad'], {}), schemaVersion: 99 })]) {
      const storage = memoryStorage({ [SAVE_KEY]: canonical, [FAVORITES_KEY]: '["legacy"]', [RATINGS_KEY]: legacyRatings({}) });
      const store = await createSaveStore(storage);
      expect(store.favorites.snapshot().persistence).toBe('session');
      expect(store.favorites.isFavorite('legacy')).toBe(false);
      expect(store.favorites.snapshot().notice?.toLowerCase()).toMatch(/invalid|corrupt/);
      expect(store.favorites.snapshot().notice?.toLowerCase()).toMatch(/save|canonical/);
      expect(storage.writes).toEqual([]);
    }
  });

  it('keeps a valid legacy domain in memory when the other legacy domain is corrupt, without overwriting either', async () => {
    const validFavorites = '["still-here"]';
    const badRatings = '{broken';
    const storage = memoryStorage({ [FAVORITES_KEY]: validFavorites, [RATINGS_KEY]: badRatings });
    const store = await createSaveStore(storage);
    expect(store.favorites.isFavorite('still-here')).toBe(true);
    expect(store.favorites.snapshot().persistence).toBe('session');
    const notice = store.favorites.snapshot().notice?.toLowerCase() ?? '';
    expect(notice).toMatch(/partial|incomplete/);
    expect(notice).toMatch(/favorite/);
    expect(storage.writes).toEqual([]);
    store.favorites.toggle('session-only');
    expect(storage.values.get(FAVORITES_KEY)).toBe(validFavorites);
    expect(storage.values.get(RATINGS_KEY)).toBe(badRatings);
    expect(storage.values.has(SAVE_KEY)).toBe(false);
    expect(JSON.parse(store.exportJson())).toEqual(save(['still-here', 'session-only'], {}));
  });

  it.each(throwingLegacyCases)(
    'retains the readable legacy domain when reading $throwingKey throws',
    async ({ throwingKey, healthyKey, healthyValue, expectedFavorites, expectedRatings }) => {
      const values = new Map<string, string>([[healthyKey, healthyValue]]);
      const writes: Array<{ key: string; value: string }> = [];
      const storage: FavoriteStorage = {
        getItem(key) {
          if (key === throwingKey) throw new Error('blocked key');
          return values.get(key) ?? null;
        },
        setItem(key, value) { writes.push({ key, value }); values.set(key, value); },
      };
      const store = await createSaveStore(storage);
      expect([...store.snapshot().favorites.ids]).toEqual(expectedFavorites);
      const actualRatings: RatingRecord = Object.fromEntries(
        [...store.snapshot().ratings.ratings].map(([id, rating]) => [id, {
          played: rating.played,
          normalStars: rating.normalStars,
          goldStars: rating.goldStars,
        }]),
      );
      expect(actualRatings).toEqual(expectedRatings);
      expect(store.favorites.snapshot().persistence).toBe('session');
      expect(store.favorites.snapshot().notice?.toLowerCase()).toMatch(/partial|incomplete/);
      expect(writes).toEqual([]);
      store.favorites.toggle('session-only');
      expect(writes).toEqual([]);
      expect(JSON.parse(store.exportJson())).toEqual(save(
        [...expectedFavorites, 'session-only'],
        expectedRatings,
      ));
    },
  );

  it('reports a storage conflict differently from an ordinary storage write failure', async () => {
    const changedStorage = memoryStorage();
    const changedStore = await createSaveStore(changedStorage);
    changedStorage.values.set(SAVE_KEY, JSON.stringify(save(['external'], {})));
    changedStore.favorites.toggle('local');
    const conflictNotice = changedStore.favorites.snapshot().notice?.toLowerCase() ?? '';
    expect(conflictNotice).toMatch(/changed|conflict/);

    const deniedStorage: FavoriteStorage = {
      getItem() { return null; },
      setItem() { throw new Error('quota'); },
    };
    const deniedStore = await createSaveStore(deniedStorage);
    deniedStore.favorites.toggle('local');
    const failureNotice = deniedStore.favorites.snapshot().notice?.toLowerCase() ?? '';
    expect(failureNotice).not.toBe(conflictNotice);
    expect(failureNotice).toMatch(/storage|write|quota/);
  });

  it('reports a canonical save conflict rather than treating it as invalid data', async () => {
    const storage = memoryStorage({ [SAVE_KEY]: '{bad json', [FAVORITES_KEY]: '["legacy"]' });
    const store = await createSaveStore(storage);
    const notice = store.favorites.snapshot().notice?.toLowerCase() ?? '';
    expect(notice).toMatch(/invalid|corrupt/);
    expect(notice).not.toMatch(/changed|conflict/);
  });

  it('keeps legacy rating extra-key tolerance distinct from canonical rating validation', async () => {
    const legacyBytes = legacyRatings({
      legacy: { played: true, normalStars: 2, goldStars: 0, legacyNote: 'ignored' },
    });
    const legacyStorage = memoryStorage({ [RATINGS_KEY]: legacyBytes });
    const legacyStore = await createSaveStore(legacyStorage);
    expect(legacyStore.songRatings.get('legacy')).toMatchObject({ normalStars: 2, goldStars: 0 });
    expect(legacyStorage.writes).toEqual([]);

    const canonicalBytes = JSON.stringify(save([], {
      canonical: { played: true, normalStars: 2, goldStars: 0, unexpected: true },
    }));
    const canonicalStorage = memoryStorage({ [SAVE_KEY]: canonicalBytes });
    const canonicalStore = await createSaveStore(canonicalStorage);
    expect(canonicalStore.favorites.snapshot().persistence).toBe('session');
    expect(canonicalStore.favorites.snapshot().notice?.toLowerCase()).toMatch(/invalid|unsupported/);
    canonicalStore.favorites.toggle('session-only');
    expect(canonicalStorage.values.get(SAVE_KEY)).toBe(canonicalBytes);
    expect(canonicalStorage.writes).toEqual([]);
  });

  it('unifies favorite and completed-rating mutations without serializing ordinals', async () => {
    const storage = memoryStorage();
    const store = await createSaveStore(storage);
    store.favorites.toggle('id/with:punctuation');
    store.songRatings.recordCompletedResult('zero+unknown', completed);
    const persisted = JSON.parse(storage.values.get(SAVE_KEY) ?? 'null');
    expect(persisted).toEqual(save(
      ['id/with:punctuation'],
      { 'zero+unknown': { played: true, normalStars: 0, goldStars: 0 } },
    ));
    expect(JSON.stringify(persisted)).not.toContain('achievementOrdinal');
    expect(await (await createSaveStore(storage)).songRatings.get('zero+unknown')).toMatchObject({ played: true, normalStars: 0, goldStars: 0 });
  });

  it('returns defensive snapshot copies and exports current in-memory state', async () => {
    const store = await createSaveStore(null);
    store.favorites.toggle('session-song');
    store.songRatings.recordCompletedResult('session-played', completed);
    const snapshot = store.snapshot();
    (snapshot.favorites.ids as Set<string>).clear();
    (snapshot.ratings.ratings as Map<string, unknown>).clear();
    expect(store.favorites.isFavorite('session-song')).toBe(true);
    expect(store.songRatings.get('session-played')).not.toBeNull();
    expect(JSON.parse(store.exportJson())).toEqual(save(
      ['session-song'],
      { 'session-played': { played: true, normalStars: 0, goldStars: 0 } },
    ));
  });

  it('falls back to session-only on storage failures and preserves readable state for export', async () => {
    const storage: FavoriteStorage = {
      getItem() { return null; },
      setItem() { throw new Error('quota'); },
    };
    const store = await createSaveStore(storage);
    store.favorites.toggle('retained');
    expect(store.favorites.snapshot().persistence).toBe('session');
    expect(store.favorites.snapshot().notice?.toLowerCase()).toMatch(/storage|write|quota/);
    expect(store.favorites.isFavorite('retained')).toBe(true);
    expect(JSON.parse(store.exportJson())).toEqual(save(['retained'], {}));
  });

  it('refuses to overwrite a save changed by another writer since it was observed', async () => {
    const storage = memoryStorage();
    const store = await createSaveStore(storage);
    const external = JSON.stringify(save(['other-tab'], {}));
    storage.values.set(SAVE_KEY, external);
    store.favorites.toggle('local-tab');
    expect(storage.values.get(SAVE_KEY)).toBe(external);
    expect(store.favorites.snapshot().persistence).toBe('session');
    expect(store.favorites.snapshot().notice?.toLowerCase()).toMatch(/changed|conflict/);
    expect(store.favorites.isFavorite('local-tab')).toBe(true);
  });
});
