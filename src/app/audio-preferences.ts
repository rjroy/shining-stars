import type { MusicVolumeState } from '../ui/music-volume-control';

export interface AudioPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface AudioPreferencesSnapshot {
  readonly preferences: MusicVolumeState;
  readonly persistence: 'local' | 'session';
}

export interface AudioPreferencesStore {
  read(): MusicVolumeState;
  write(preferences: MusicVolumeState): MusicVolumeState;
  snapshot(): AudioPreferencesSnapshot;
}

export const AUDIO_PREFERENCES_STORAGE_KEY = 'shining-stars.audio-preferences';

const VERSION = 1;
const DEFAULT_PREFERENCES: MusicVolumeState = {
  volume: 1,
  muted: false,
  lastAudibleVolume: 1,
};

function copyPreferences(preferences: MusicVolumeState): MusicVolumeState {
  return {
    volume: preferences.volume,
    muted: preferences.muted,
    lastAudibleVolume: preferences.lastAudibleVolume,
  };
}

function browserStorage(): AudioPreferencesStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function validPreferences(value: unknown): value is MusicVolumeState {
  if (typeof value !== 'object' || value === null) return false;
  const preferences = value as Record<string, unknown>;
  const volume = preferences.volume;
  const lastAudibleVolume = preferences.lastAudibleVolume;
  const muted = preferences.muted;
  return (
    typeof volume === 'number' &&
    Number.isFinite(volume) &&
    volume >= 0 &&
    volume <= 1 &&
    typeof muted === 'boolean' &&
    typeof lastAudibleVolume === 'number' &&
    Number.isFinite(lastAudibleVolume) &&
    lastAudibleVolume > 0 &&
    lastAudibleVolume <= 1 &&
    (muted ? volume === 0 : volume > 0)
  );
}

function parsePreferences(value: unknown): MusicVolumeState {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_PREFERENCES };
  const record = value as Record<string, unknown>;
  if (record.version !== VERSION || !validPreferences(record.preferences))
    return { ...DEFAULT_PREFERENCES };
  return copyPreferences(record.preferences);
}

/** Persist music volume separately; storage failures retain an in-memory session value. */
export function createAudioPreferencesStore(
  storage: AudioPreferencesStorage | null = browserStorage(),
  storageKey = AUDIO_PREFERENCES_STORAGE_KEY,
): AudioPreferencesStore {
  let activeStorage = storage;
  let current: MusicVolumeState = { ...DEFAULT_PREFERENCES };
  if (activeStorage !== null) {
    let stored: string | null = null;
    try {
      stored = activeStorage.getItem(storageKey);
    } catch {
      activeStorage = null;
    }
    if (stored !== null) {
      try {
        current = parsePreferences(JSON.parse(stored) as unknown);
      } catch {
        current = { ...DEFAULT_PREFERENCES };
      }
    }
  }

  return {
    read: () => copyPreferences(current),
    write(preferences) {
      current = validPreferences(preferences)
        ? copyPreferences(preferences)
        : { ...DEFAULT_PREFERENCES };
      if (activeStorage !== null) {
        try {
          activeStorage.setItem(
            storageKey,
            JSON.stringify({ version: VERSION, preferences: current }),
          );
        } catch {
          activeStorage = null;
        }
      }
      return copyPreferences(current);
    },
    snapshot: () => ({
      preferences: copyPreferences(current),
      persistence: activeStorage === null ? 'session' : 'local',
    }),
  };
}
