import { describe, expect, it, vi } from 'vitest';
import {
  AUDIO_PREFERENCES_STORAGE_KEY,
  createAudioPreferencesStore,
  type AudioPreferencesStorage,
} from './audio-preferences';

const DEFAULT_PREFERENCES = {
  volume: 1,
  muted: false,
  lastAudibleVolume: 1,
} as const;

function memoryStorage(initial: string | null = null) {
  const values = new Map<string, string>();
  if (initial !== null) values.set(AUDIO_PREFERENCES_STORAGE_KEY, initial);
  return {
    values,
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  } satisfies AudioPreferencesStorage & { values: Map<string, string> };
}

describe('separate local music-volume preferences', () => {
  it('persists only the versioned preference payload and reloads the mute restore level', () => {
    const storage = memoryStorage();
    const preferences = {
      volume: 0,
      muted: true,
      lastAudibleVolume: 0.37,
    } as const;

    expect(createAudioPreferencesStore(storage).write(preferences)).toEqual(
      preferences,
    );
    expect([...storage.values.entries()]).toEqual([
      [
        AUDIO_PREFERENCES_STORAGE_KEY,
        JSON.stringify({ version: 1, preferences }),
      ],
    ]);
    expect(storage.values.has('shining-stars.save')).toBe(false);
    expect(createAudioPreferencesStore(storage).read()).toEqual(preferences);
    expect(createAudioPreferencesStore(storage).snapshot().persistence).toBe(
      'local',
    );
  });

  it.each([
    ['malformed JSON', '{bad json'],
    ['unsupported version', JSON.stringify({ version: 2, preferences: DEFAULT_PREFERENCES })],
    [
      'volume below zero',
      JSON.stringify({ version: 1, preferences: { ...DEFAULT_PREFERENCES, volume: -0.01 } }),
    ],
    [
      'volume above one',
      JSON.stringify({ version: 1, preferences: { ...DEFAULT_PREFERENCES, volume: 1.01 } }),
    ],
    [
      'non-finite volume',
      '{"version":1,"preferences":{"volume":1e400,"muted":false,"lastAudibleVolume":1}}',
    ],
    [
      'non-finite remembered volume',
      '{"version":1,"preferences":{"volume":0.5,"muted":false,"lastAudibleVolume":1e400}}',
    ],
    [
      'non-positive remembered volume',
      JSON.stringify({ version: 1, preferences: { volume: 0, muted: true, lastAudibleVolume: 0 } }),
    ],
    [
      'inconsistent muted state',
      JSON.stringify({ version: 1, preferences: { volume: 0.5, muted: true, lastAudibleVolume: 0.5 } }),
    ],
  ])('uses safe defaults for %s', (_label, record) => {
    const store = createAudioPreferencesStore(memoryStorage(record));

    expect(store.read()).toEqual(DEFAULT_PREFERENCES);
    expect(store.snapshot().persistence).toBe('local');
  });

  it('keeps defaults and subsequent writes in session when storage reads are denied', () => {
    const setItem = vi.fn<AudioPreferencesStorage['setItem']>();
    const denied: AudioPreferencesStorage = {
      getItem() {
        throw new Error('storage access denied');
      },
      setItem,
    };
    const store = createAudioPreferencesStore(denied);
    const changed = { volume: 0.6, muted: false, lastAudibleVolume: 0.6 };

    expect(store.read()).toEqual(DEFAULT_PREFERENCES);
    expect(store.snapshot().persistence).toBe('session');
    expect(store.write(changed)).toEqual(changed);
    expect(store.read()).toEqual(changed);
    expect(store.snapshot().persistence).toBe('session');
    expect(setItem).not.toHaveBeenCalled();
  });

  it('retains current and subsequent preference changes after storage writes fail', () => {
    const setItem = vi.fn<AudioPreferencesStorage['setItem']>(() => {
      throw new Error('storage quota exceeded');
    });
    const denied: AudioPreferencesStorage = {
      getItem: () => null,
      setItem,
    };
    const store = createAudioPreferencesStore(denied);
    const first = { volume: 0.6, muted: false, lastAudibleVolume: 0.6 };
    const second = { volume: 0, muted: true, lastAudibleVolume: 0.6 };

    expect(store.write(first)).toEqual(first);
    expect(store.snapshot().persistence).toBe('session');
    expect(store.write(second)).toEqual(second);
    expect(store.read()).toEqual(second);
    expect(store.snapshot()).toEqual({
      preferences: second,
      persistence: 'session',
    });
    expect(setItem).toHaveBeenCalledTimes(1);
  });
});
