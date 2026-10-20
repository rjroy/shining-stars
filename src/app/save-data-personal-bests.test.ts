import { describe, expect, it } from 'vitest';
import type { FavoriteStorage } from '../catalog/favorites';
import type { Difficulty } from '../game/game-balance';
import { createSaveStore, SAVE_STORAGE_KEY } from './save-data';

function memoryStorage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  const writes: Array<{ key: string; value: string }> = [];
  const storage: FavoriteStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      writes.push({ key, value });
      values.set(key, value);
    },
  };
  return { storage, values, writes };
}

function canonical(personalBestScores: unknown, version: 1 | 2 | 3 = 3) {
  const document: Record<string, unknown> = {
    format: 'shining-stars-save',
    schemaVersion: version,
    favorites: [],
    ratings: {},
  };
  if (version >= 2)
    document.progression = {
      balance: 0,
      victoryMarks: {},
      collectionPurchases: {},
      songPurchases: {},
    };
  if (version === 3) document.personalBestScores = personalBestScores;
  return JSON.stringify(document);
}

describe('canonical personal-best score records', () => {
  it('records first zero and nonzero results explicitly, then only strict improvements', () => {
    const fixture = memoryStorage();
    const scores = createSaveStore(fixture.storage).personalBestScores;

    expect(scores.getBest('first', 'normal')).toBeNull();
    expect(scores.recordCompletedScore('first', 'normal', 0)).toEqual({
      previousBest: null,
      best: 0,
      isNewBest: true,
    });
    expect(scores.recordCompletedScore('second', 'hard', 92)).toEqual({
      previousBest: null,
      best: 92,
      isNewBest: true,
    });
    expect(scores.recordCompletedScore('first', 'normal', 4)).toEqual({
      previousBest: 0,
      best: 4,
      isNewBest: true,
    });
    expect(scores.recordCompletedScore('first', 'normal', 4)).toEqual({
      previousBest: 4,
      best: 4,
      isNewBest: false,
    });
    expect(scores.recordCompletedScore('first', 'normal', 2)).toEqual({
      previousBest: 4,
      best: 4,
      isNewBest: false,
    });
    expect(scores.getBest('first', 'normal')).toBe(4);
    expect(fixture.writes).toHaveLength(3);
  });

  it('separates stable song IDs and difficulty, with defensive snapshots', () => {
    const scores = createSaveStore(null).personalBestScores;
    scores.recordCompletedScore('song:with/slashes', 'easy', 17);
    scores.recordCompletedScore('song:with/slashes', 'hard', 31);
    scores.recordCompletedScore('song:with/slashes-hard', 'easy', 22);

    expect(scores.getBest('song:with/slashes', 'easy')).toBe(17);
    expect(scores.getBest('song:with/slashes', 'hard')).toBe(31);
    expect(scores.getBest('song:with/slashes-hard', 'easy')).toBe(22);
    const snapshot = scores.snapshot();
    (snapshot.scores.get('song:with/slashes') as Map<string, number>).clear();
    expect(scores.getBest('song:with/slashes', 'easy')).toBe(17);
  });

  it('persists through canonical save reload and does not bind records to chart metadata', () => {
    const fixture = memoryStorage();
    const store = createSaveStore(fixture.storage);
    store.personalBestScores.recordCompletedScore(
      'stable-song-id',
      'normal',
      1234,
    );

    const exported = JSON.parse(store.exportJson()) as {
      schemaVersion: number;
      personalBestScores: Array<Record<string, unknown>>;
    };
    expect(exported.schemaVersion).toBe(3);
    expect(exported.personalBestScores).toEqual([
      { songId: 'stable-song-id', difficulty: 'normal', score: 1234 },
    ]);
    expect(JSON.stringify(exported)).not.toMatch(
      /fingerprint|chartHash|tuning/i,
    );
    const reloaded = createSaveStore(fixture.storage);
    expect(
      reloaded.personalBestScores.getBest('stable-song-id', 'normal'),
    ).toBe(1234);
    expect(
      reloaded.personalBestScores.getBest('stable-song-id', 'hard'),
    ).toBeNull();
  });

  it.each([1, 2] as const)(
    'reads legacy canonical schema version %i without inventing old scores',
    (version) => {
      const raw = canonical(undefined, version);
      const fixture = memoryStorage({ [SAVE_STORAGE_KEY]: raw });
      const store = createSaveStore(fixture.storage);
      expect(store.personalBestScores.getBest('old-song', 'normal')).toBeNull();
      expect(store.personalBestScores.snapshot().scores.size).toBe(0);
      expect(fixture.writes).toEqual([]);

      store.personalBestScores.recordCompletedScore('old-song', 'normal', 0);
      const migrated = JSON.parse(
        fixture.values.get(SAVE_STORAGE_KEY) ?? 'null',
      );
      expect(migrated.schemaVersion).toBe(3);
      expect(migrated.personalBestScores).toEqual([
        { songId: 'old-song', difficulty: 'normal', score: 0 },
      ]);
    },
  );

  it.each([
    null,
    [{ songId: '', difficulty: 'normal', score: 1 }],
    [{ songId: 'song', difficulty: 'impossible', score: 1 }],
    [{ songId: 'song', difficulty: 'normal', score: -1 }],
    [{ songId: 'song', difficulty: 'normal', score: null }],
    [{ songId: 'song', difficulty: 'normal', score: 1, fingerprint: 'tuned' }],
    [
      { songId: 'song', difficulty: 'normal', score: 1 },
      { songId: 'song', difficulty: 'normal', score: 2 },
    ],
  ])(
    'rejects malformed canonical score payload %j without overwriting it',
    (payload) => {
      const raw = canonical(payload);
      const fixture = memoryStorage({ [SAVE_STORAGE_KEY]: raw });
      const store = createSaveStore(fixture.storage);
      expect(store.personalBestScores.snapshot().scores.size).toBe(0);
      expect(store.favorites.snapshot().persistence).toBe('session');
      expect(fixture.values.get(SAVE_STORAGE_KEY)).toBe(raw);
      expect(fixture.writes).toEqual([]);
    },
  );

  it('rejects invalid completed results before changing or persisting records', () => {
    const fixture = memoryStorage();
    const scores = createSaveStore(fixture.storage).personalBestScores;
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(() =>
        scores.recordCompletedScore('song', 'normal', invalid),
      ).toThrow(/finite nonnegative/i);
    }
    expect(() => scores.recordCompletedScore('  ', 'normal', 1)).toThrow();
    expect(() =>
      scores.recordCompletedScore('song', 'expert' as Difficulty, 1),
    ).toThrow();
    expect(fixture.writes).toEqual([]);
    expect(scores.getBest('song', 'normal')).toBeNull();
  });

  it('exports, merges highest imported records, replaces exactly, and resets scores by empty replacement', () => {
    const source = createSaveStore(null);
    source.personalBestScores.recordCompletedScore('same', 'normal', 90);
    source.personalBestScores.recordCompletedScore('added', 'hard', 11);
    source.personalBestScores.recordCompletedScore('improve', 'normal', 5);
    const target = createSaveStore(null);
    target.personalBestScores.recordCompletedScore('same', 'normal', 100);
    target.personalBestScores.recordCompletedScore('improve', 'normal', 3);
    target.personalBestScores.recordCompletedScore('removed', 'easy', 20);

    const merge = target.previewImport(source.exportJson(), 'merge');
    expect(merge.changes.personalBestScores).toEqual({
      added: 1,
      improved: 1,
      removed: 0,
      downgraded: 0,
    });
    expect(target.applyImport(merge, 'session').status).toBe('session-only');
    expect(target.personalBestScores.getBest('same', 'normal')).toBe(100);
    expect(target.personalBestScores.getBest('added', 'hard')).toBe(11);
    expect(target.personalBestScores.getBest('improve', 'normal')).toBe(5);
    expect(target.personalBestScores.getBest('removed', 'easy')).toBe(20);

    const replace = target.previewImport(source.exportJson(), 'replace');
    expect(replace.changes.personalBestScores).toEqual({
      added: 0,
      improved: 0,
      removed: 1,
      downgraded: 1,
    });
    expect(target.applyImport(replace, 'session').changed).toBe(true);
    expect(target.personalBestScores.getBest('same', 'normal')).toBe(90);
    expect(target.personalBestScores.getBest('removed', 'easy')).toBeNull();

    const reset = target.previewImport(canonical([]), 'replace');
    expect(reset.hasChanges).toBe(true);
    expect(target.applyImport(reset, 'session').changed).toBe(true);
    expect(target.personalBestScores.snapshot().scores.size).toBe(0);
  });
});
