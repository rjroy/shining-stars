import { describe, expect, it } from 'vitest';
import { createFavoriteStore, type FavoriteStorage } from './favorites';

function memoryStorage(initial: string | null = null): FavoriteStorage & { value: string | null } {
  return {
    value: initial,
    getItem() { return this.value; },
    setItem(_key, value) { this.value = value; },
  };
}

describe('local favorite adapter', () => {
  it('toggles stable IDs and persists locally', () => {
    const storage = memoryStorage('["song-a"]');
    const favorites = createFavoriteStore(storage);
    expect(favorites.isFavorite('song-a')).toBe(true);
    expect(favorites.toggle('song-b').persistence).toBe('local');
    expect(JSON.parse(storage.value ?? 'null')).toEqual(['song-a', 'song-b']);
    favorites.toggle('song-a');
    expect(favorites.isFavorite('song-a')).toBe(false);
  });

  it('falls back to session favorites when storage is corrupt or unavailable', () => {
    const invalid = createFavoriteStore(memoryStorage('{bad json'));
    expect(invalid.snapshot()).toMatchObject({ persistence: 'session', notice: expect.any(String) });
    expect(invalid.toggle('song-a').ids.has('song-a')).toBe(true);
    expect(createFavoriteStore(null).snapshot().persistence).toBe('session');
  });

  it('keeps the current session state if reads or writes throw', () => {
    const failingRead: FavoriteStorage = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
    };
    const readFallback = createFavoriteStore(failingRead);
    expect(readFallback.toggle('song-a').ids.has('song-a')).toBe(true);

    const failingWrite: FavoriteStorage = {
      getItem() { return '["song-a"]'; },
      setItem() { throw new Error('quota'); },
    };
    const writeFallback = createFavoriteStore(failingWrite);
    expect(writeFallback.toggle('song-b')).toMatchObject({
      persistence: 'session',
      ids: new Set(['song-a', 'song-b']),
    });
    expect(writeFallback.toggle('song-a').ids).toEqual(new Set(['song-b']));
  });
});
