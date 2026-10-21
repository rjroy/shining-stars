import { describe, expect, it } from 'vitest';
import {
  createBrowsePreferenceStore,
  DEFAULT_BROWSE_PREFERENCES,
  type BrowsePreferenceStorage,
} from './browse-preferences';

function memoryStorage(initial: string | null = null) {
  return {
    value: initial,
    getItem() { return this.value; },
    setItem(_key: string, value: string) { this.value = value; },
  };
}

describe('local observatory browse preferences', () => {
  it('round-trips only the validated browse preference record', () => {
    const storage = memoryStorage();
    const preferences = {
      filters: {
        unlockStatus: 'locked' as const,
        unplayedOnly: true,
        undefeatedDifficulty: 'hard' as const,
        belowFiveNormalStars: true,
        belowFiveGoldStars: false,
      },
      sortMode: 'difficulty' as const,
      favoritesOnly: true,
    };
    createBrowsePreferenceStore(storage).write(preferences);
    expect(createBrowsePreferenceStore(storage).read()).toEqual(preferences);
    expect(storage.value).not.toContain('query');
    expect(storage.value).not.toContain('collectionId');
  });

  it('defaults malformed records and validates each field', () => {
    expect(createBrowsePreferenceStore(memoryStorage('{bad')).read()).toEqual(DEFAULT_BROWSE_PREFERENCES);
    const invalid = memoryStorage(JSON.stringify({
      version: 1,
      preferences: { unlockStatus: 'other', unplayedOnly: 'yes', undefeatedDifficulty: 'expert', sortMode: 'random', favoritesOnly: 1 },
    }));
    expect(createBrowsePreferenceStore(invalid).read()).toEqual(DEFAULT_BROWSE_PREFERENCES);
  });

  it('keeps in-memory defaults and writes working when storage is unavailable', () => {
    const failing: BrowsePreferenceStorage = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('quota'); },
    };
    const store = createBrowsePreferenceStore(failing);
    expect(store.read()).toEqual(DEFAULT_BROWSE_PREFERENCES);
    const changed = { ...DEFAULT_BROWSE_PREFERENCES, favoritesOnly: true };
    store.write(changed);
    expect(store.read()).toEqual(changed);
    expect(createBrowsePreferenceStore(null).read()).toEqual(DEFAULT_BROWSE_PREFERENCES);
  });
});
