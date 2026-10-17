import { describe, expect, it, vi } from 'vitest';
import { getCreditedSealsMarkup, getSongUnlockRequest } from './observatory-ui';
import { createProgression } from '../catalog/progression';
import { createSaveDataController } from './save-data-dialog';
import { purchaseUnlock } from './unlock-dialog';
import { createSaveStore } from '../app/save-data';

describe('Progression UI', () => {
  it('never reports failed local purchase as success or silently retries session', () => {
    const purchase = vi.fn(() => ({
      status: 'failed' as const,
      notice: 'Not saved',
      persistence: 'local' as const,
      changed: false,
    }));
    expect(
      purchaseUnlock({ purchase }, { kind: 'song', songId: 'song' }, 'local'),
    ).toEqual({ done: false, notice: 'Not saved' });
    expect(purchase).toHaveBeenCalledExactlyOnceWith(
      { kind: 'song', songId: 'song' },
      'local',
    );
  });
  it('labels explicitly selected session purchases', () => {
    const purchase = vi.fn(() => ({
      status: 'session-only' as const,
      notice: null,
      persistence: 'session' as const,
      changed: true,
    }));
    expect(
      purchaseUnlock({ purchase }, { kind: 'song', songId: 'song' }, 'session'),
    ).toMatchObject({
      done: true,
      notice: expect.stringMatching(/session only/i),
    });
  });
  it('preserves balance and locks on actual failed local persistence', () => {
    const store = createSaveStore(null);
    store.progression.recordVictory('earned', 'hard');
    const before = store.progression.snapshot();
    const result = purchaseUnlock(
      store.progression,
      { kind: 'collection', collectionId: 'christmas-star' },
      'local',
    );
    expect(result.done).toBe(false);
    expect(store.progression.snapshot()).toEqual(before);
  });
  const membership = {
    songs: new Map([['song', 'paid']]),
    collections: new Map([['paid', 2]]),
  };
  it('requires collection before song and keeps free songs playable', () => {
    expect(
      getSongUnlockRequest('free-song', createProgression(), {
        songs: new Map([['free-song', 'free']]),
        collections: new Map([['free', null]]),
      }),
    ).toBeNull();
    expect(
      getSongUnlockRequest('song', createProgression(), membership),
    ).toEqual({ kind: 'collection', collectionId: 'paid' });
    expect(
      getSongUnlockRequest(
        'song',
        { ...createProgression(), collectionPurchases: { paid: 2 } },
        membership,
      ),
    ).toEqual({ kind: 'song', songId: 'song' });
    expect(
      getSongUnlockRequest(
        'song',
        {
          ...createProgression(),
          collectionPurchases: { paid: 2 },
          songPurchases: { song: 'paid' },
        },
        membership,
      ),
    ).toBeNull();
  });
  it('shows cumulative credited difficulty seals separately from stars', () => {
    const markup = getCreditedSealsMarkup('normal');
    expect(markup).toContain('Easy: credited');
    expect(markup).toContain('Normal: credited');
    expect(markup).toContain('Hard: not credited');
    expect(markup).not.toContain('<svg');
  });
  it('requires confirmation when replacing progression even while merging stars', async () => {
    const previewImport = vi.fn((_text, mode, progressionMode) => ({
      mode,
      progressionMode,
      hasChanges: true,
      changes: {},
    }));
    const applyImport = vi.fn();
    const controller = createSaveDataController({
      previewImport: previewImport as never,
      applyImport,
      onImported() {},
    });
    controller.open();
    await controller.readFile({ name: 'v1.json', text: async () => '{}' });
    controller.setProgressionMode('replace');
    expect(previewImport).toHaveBeenLastCalledWith('{}', 'merge', 'replace');
    controller.requestImport();
    expect(controller.snapshot().phase).toBe('confirm-replace');
    expect(applyImport).not.toHaveBeenCalled();
  });
});
