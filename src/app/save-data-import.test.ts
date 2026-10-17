import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FavoriteStorage } from '../catalog/favorites';

/**
 * Phase-two import contract. Import data is the same strict v1 save envelope
 * as phase one. previewImport(text, mode) returns an opaque preview plus
 * `mode`, `hasChanges`, and counts at `changes.favorites.{added,removed}` and
 * `changes.ratings.{added,improved,removed,downgraded}`. applyImport(preview,
 * target) returns a result with status `applied`, `session-only`, `conflict`,
 * or `stale-preview` and a notice. Invalid file input throws during preview;
 * a forged preview returns `invalid-preview`. These are observable contract
 * tests, not production stubs.
 */
const moduleUrl = new URL('./save-data.ts', import.meta.url);
const implementation = existsSync(moduleUrl)
  ? import(/* @vite-ignore */ moduleUrl.href)
  : Promise.resolve(null);

const SAVE_KEY = 'shining-stars.save';
const save = (favorites: string[], ratings: Record<string, unknown>) => ({
  format: 'shining-stars-save',
  schemaVersion: 2,
  favorites,
  ratings,
  progression: { balance: 0, victoryMarks: {}, collectionPurchases: {}, songPurchases: {} },
});
type Mode = 'merge' | 'replace';
type Target = 'local' | 'session';
type Status = 'applied' | 'session-only' | 'conflict' | 'stale-preview' | 'invalid-preview' | 'failed';
type Preview = {
  readonly mode: Mode;
  readonly hasChanges: boolean;
  readonly changes: {
    readonly favorites: { readonly added: number; readonly removed: number };
    readonly ratings: { readonly added: number; readonly improved: number; readonly removed: number; readonly downgraded: number };
  };
};
type SaveStore = {
  readonly favorites: {
    isFavorite(id: string): boolean;
    toggle(id: string): unknown;
    snapshot(): { ids: ReadonlySet<string>; persistence: string; notice: string | null };
  };
  readonly songRatings: {
    get(id: string): { played: true; normalStars: number; goldStars: number; achievementOrdinal: number } | null;
    recordCompletedResult(id: string, result: { score: number; normalMaximum: number; outcome: 'victory' | 'survived' | 'defeat'; difficulty: 'easy' | 'normal' | 'hard' }): unknown;
  };
  snapshot(): { favorites: { ids: ReadonlySet<string> }; ratings: { ratings: ReadonlyMap<string, unknown> } };
  exportJson(): string;
  previewImport(text: string, mode: Mode): Preview;
  applyImport(preview: Preview, target: Target): { status: Status; notice: string | null };
};

function storageWith(initial: string | null = null) {
  const values = new Map<string, string>();
  if (initial !== null) values.set(SAVE_KEY, initial);
  const writes: Array<{ key: string; value: string }> = [];
  let failWrite = false;
  const storage: FavoriteStorage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) {
      if (failWrite) throw new Error('quota');
      writes.push({ key, value });
      values.set(key, value);
    },
  };
  return {
    storage,
    values,
    writes,
    denyWrites() { failWrite = true; },
  };
}

async function createStore(storage: FavoriteStorage | null): Promise<SaveStore> {
  const module = await implementation;
  expect(module, 'src/app/save-data.ts must implement the import contract').not.toBeNull();
  const factory = Reflect.get(module, 'createSaveStore');
  expect(factory).toBeTypeOf('function');
  const store = (factory as (storage?: FavoriteStorage | null) => unknown)(storage);
  if (typeof store !== 'object' || store === null) {
    throw new TypeError('createSaveStore(storage) must return a SaveStore object');
  }
  expect(Reflect.get(store, 'previewImport'), 'SaveStore.previewImport(text, mode)').toBeTypeOf('function');
  expect(Reflect.get(store, 'applyImport'), 'SaveStore.applyImport(preview, target)').toBeTypeOf('function');
  return store as SaveStore;
}

function result(status: Status, notice?: RegExp) {
  return {
    status,
    ...(notice === undefined ? {} : { notice: expect.stringMatching(notice) }),
  };
}

describe('player save import preview and apply contract', () => {
  it('previews a merge as favorite union and best whole rating, without mutating or writing', async () => {
    const original = JSON.stringify(save(
      ['keep', 'shared'],
      {
        better: { played: true, normalStars: 5, goldStars: 1 },
        improve: { played: true, normalStars: 2, goldStars: 0 },
      },
    ));
    const fixture = storageWith(original);
    const store = await createStore(fixture.storage);
    const candidate = JSON.stringify(save(
      ['shared', 'new/__proto__'],
      {
        better: { played: true, normalStars: 5, goldStars: 0 },
        improve: { played: true, normalStars: 3, goldStars: 0 },
        'unknown:zero': { played: true, normalStars: 0, goldStars: 0 },
      },
    ));

    const preview = store.previewImport(candidate, 'merge');
    expect(preview).toMatchObject({
      mode: 'merge',
      hasChanges: true,
      changes: {
        favorites: { added: 1, removed: 0 },
        ratings: { added: 1, improved: 1, removed: 0, downgraded: 0 },
      },
    });
    expect(store.exportJson()).toBe(original);
    expect(fixture.writes).toEqual([]);

    expect(store.applyImport(preview, 'local')).toMatchObject(result('applied'));
    expect(store.favorites.isFavorite('keep')).toBe(true);
    expect(store.favorites.isFavorite('new/__proto__')).toBe(true);
    expect(store.songRatings.get('better')).toMatchObject({ normalStars: 5, goldStars: 1 });
    expect(store.songRatings.get('improve')).toMatchObject({ normalStars: 3, goldStars: 0 });
    expect(store.songRatings.get('unknown:zero')).toMatchObject({ played: true, normalStars: 0, goldStars: 0 });
    expect(fixture.writes).toHaveLength(1);
    expect(fixture.writes[0]?.key).toBe(SAVE_KEY);
  });

  it('previews exact replacement, including removals and rating downgrades, then replaces both domains', async () => {
    const fixture = storageWith(JSON.stringify(save(
      ['remove-me', 'keep'],
      { downgrade: { played: true, normalStars: 5, goldStars: 5 }, remove: { played: true, normalStars: 1, goldStars: 0 } },
    )));
    const store = await createStore(fixture.storage);
    const preview = store.previewImport(JSON.stringify(save(
      ['keep', 'replace-with'],
      { downgrade: { played: true, normalStars: 4, goldStars: 0 }, add: { played: true, normalStars: 0, goldStars: 0 } },
    )), 'replace');
    expect(preview).toMatchObject({
      hasChanges: true,
      changes: {
        favorites: { added: 1, removed: 1 },
        ratings: { added: 1, improved: 0, removed: 1, downgraded: 1 },
      },
    });
    expect(store.applyImport(preview, 'local')).toMatchObject(result('applied'));
    expect([...store.snapshot().favorites.ids].sort()).toEqual(['keep', 'replace-with']);
    expect([...store.snapshot().ratings.ratings.keys()].sort()).toEqual(['add', 'downgrade']);
    expect(store.songRatings.get('downgrade')).toMatchObject({ normalStars: 4, goldStars: 0 });
  });

  it('treats effective no-op merge/replace as no change and permits empty replacement to clear both stores', async () => {
    const fixture = storageWith(JSON.stringify(save(['same'], { rating: { played: true, normalStars: 2, goldStars: 0 } })));
    const store = await createStore(fixture.storage);
    const same = JSON.stringify(save(['same'], { rating: { played: true, normalStars: 1, goldStars: 0 } }));
    expect(store.previewImport(same, 'merge')).toMatchObject({ hasChanges: false });
    const empty = store.previewImport(JSON.stringify(save([], {})), 'replace');
    expect(empty).toMatchObject({
      hasChanges: true,
      changes: { favorites: { added: 0, removed: 1 }, ratings: { added: 0, improved: 0, removed: 1, downgraded: 0 } },
    });
    expect(store.applyImport(empty, 'local')).toMatchObject(result('applied'));
    expect(JSON.parse(store.exportJson())).toEqual(save([], {}));
  });

  it.each([
    '{bad json',
    JSON.stringify({ ...save([], {}), extra: true }),
    JSON.stringify({ ...save([], {}), progression: { balance: 1, victoryMarks: {}, collectionPurchases: {}, songPurchases: {} } }),
    JSON.stringify(save([], { bad: { played: true, normalStars: 2, goldStars: 1 } })),
    JSON.stringify(save([], { bad: { played: true, normalStars: 0, goldStars: 0, extra: 1 } })),
  ])('rejects an invalid complete import without changing state or storage: %s', async (text) => {
    const original = JSON.stringify(save(['stay'], { existing: { played: true, normalStars: 1, goldStars: 0 } }));
    const fixture = storageWith(original);
    const store = await createStore(fixture.storage);
    expect(() => store.previewImport(text, 'replace')).toThrow();
    expect(store.exportJson()).toBe(original);
    expect(fixture.writes).toEqual([]);
  });

  it('requires the original untampered preview and rejects previews made stale by domain mutations', async () => {
    const fixture = storageWith();
    const store = await createStore(fixture.storage);
    const preview = store.previewImport(JSON.stringify(save(['imported'], {})), 'replace');
    store.favorites.toggle('changed-after-preview');
    expect(store.applyImport(preview, 'local')).toMatchObject(result('stale-preview', /stale|changed/));
    expect(store.favorites.isFavorite('changed-after-preview')).toBe(true);
    expect(store.favorites.isFavorite('imported')).toBe(false);

    const fresh = store.previewImport(JSON.stringify(save(['forged'], {})), 'replace');
    const forged = { ...fresh, hasChanges: false };
    expect(store.applyImport(forged, 'local')).toMatchObject(result('invalid-preview', /preview|invalid/));
    expect(store.favorites.isFavorite('changed-after-preview')).toBe(true);
  });

  it('leaves both memory and bytes unchanged when local persistence fails, but allows explicit session-only apply', async () => {
    const original = JSON.stringify(save(['before'], { prior: { played: true, normalStars: 1, goldStars: 0 } }));
    const fixture = storageWith(original);
    const store = await createStore(fixture.storage);
    const preview = store.previewImport(JSON.stringify(save(['after'], { next: { played: true, normalStars: 0, goldStars: 0 } })), 'replace');
    fixture.denyWrites();
    expect(store.applyImport(preview, 'local')).toMatchObject(result('failed', /storage|write|session/));
    expect(store.exportJson()).toBe(original);
    expect(fixture.values.get(SAVE_KEY)).toBe(original);

    const sessionPreview = store.previewImport(JSON.stringify(save(['after'], { next: { played: true, normalStars: 0, goldStars: 0 } })), 'replace');
    expect(store.applyImport(sessionPreview, 'session')).toMatchObject(result('session-only', /session|export/));
    expect(store.favorites.isFavorite('after')).toBe(true);
    expect(store.songRatings.get('next')).toMatchObject({ played: true, normalStars: 0, goldStars: 0 });
    expect(fixture.values.get(SAVE_KEY)).toBe(original);
  });

  it('refuses local import when storage changed externally and does not publish imported data', async () => {
    const original = JSON.stringify(save(['before'], {}));
    const fixture = storageWith(original);
    const store = await createStore(fixture.storage);
    const preview = store.previewImport(JSON.stringify(save(['imported'], {})), 'replace');
    const external = JSON.stringify(save(['external'], {}));
    fixture.values.set(SAVE_KEY, external);
    expect(store.applyImport(preview, 'local')).toMatchObject(result('conflict', /changed|conflict/));
    expect(store.favorites.isFavorite('before')).toBe(true);
    expect(store.favorites.isFavorite('imported')).toBe(false);
    expect(fixture.values.get(SAVE_KEY)).toBe(external);
    expect(fixture.writes).toEqual([]);
  });

  it('does not write a second time when applying the same resulting state again', async () => {
    const fixture = storageWith();
    const store = await createStore(fixture.storage);
    const preview = store.previewImport(JSON.stringify(save(['once'], {})), 'replace');
    expect(store.applyImport(preview, 'local')).toMatchObject(result('applied'));
    const writesAfterApply = fixture.writes.length;
    const repeated = store.previewImport(JSON.stringify(save(['once'], {})), 'replace');
    expect(repeated).toMatchObject({ hasChanges: false });
    expect(store.applyImport(repeated, 'local')).toMatchObject(result('applied'));
    expect(fixture.writes).toHaveLength(writesAfterApply);
  });

  it.each([
    ['invalid canonical save', '{bad json', null],
    ['partially corrupt legacy data', null, '{broken'],
  ] as const)(
    'refuses local import over %s, preserves every stored value, and permits explicit session apply',
    async (_description, canonical, badRatings) => {
      const values = new Map<string, string>();
      if (canonical !== null) {
        values.set(SAVE_KEY, canonical);
        values.set('shining-stars.favorite-song-ids', '["legacy-favorite"]');
      } else {
        values.set('shining-stars.favorite-song-ids', '["healthy-favorite"]');
        values.set('shining-stars.song-ratings', badRatings!);
      }
      const storage: FavoriteStorage = {
        getItem(key) { return values.get(key) ?? null; },
        setItem(key, value) { values.set(key, value); },
      };
      const initialBytes = new Map(values);
      const store = await createStore(storage);
      const initialMemory = store.exportJson();
      const preview = store.previewImport(JSON.stringify(save(['incoming'], {})), 'merge');

      expect(store.applyImport(preview, 'local')).toMatchObject(result('failed', /invalid|partial|session|read|migration/));
      expect(store.exportJson()).toBe(initialMemory);
      expect([...values]).toEqual([...initialBytes]);

      const sessionPreview = store.previewImport(JSON.stringify(save(['session-import'], {})), 'merge');
      expect(store.applyImport(sessionPreview, 'session')).toMatchObject(result('session-only', /session/));
      expect(store.favorites.isFavorite('session-import')).toBe(true);
      expect([...values]).toEqual([...initialBytes]);
    },
  );

  it('applies a local no-op only when the matching state is already durable', async () => {
    const noStorageStore = await createStore(null);
    noStorageStore.favorites.toggle('session-state');
    const matchingSessionPreview = noStorageStore.previewImport(noStorageStore.exportJson(), 'replace');
    expect(noStorageStore.applyImport(matchingSessionPreview, 'local')).toMatchObject(result('failed', /storage|durable|local/));
    expect(noStorageStore.favorites.isFavorite('session-state')).toBe(true);

    const fixture = storageWith(JSON.stringify(save(['durable'], {})));
    const localStore = await createStore(fixture.storage);
    const matchingDurablePreview = localStore.previewImport(localStore.exportJson(), 'replace');
    expect(localStore.applyImport(matchingDurablePreview, 'local')).toMatchObject(result('applied'));
    expect(fixture.writes).toEqual([]);
  });

  it('does not allow an explicit session no-op to resume automatic writes', async () => {
    const original = JSON.stringify(save(['kept'], {}));
    const fixture = storageWith(original);
    const store = await createStore(fixture.storage);
    const noOp = store.previewImport(original, 'replace');
    expect(store.applyImport(noOp, 'session')).toMatchObject(result('session-only', /session/));
    store.favorites.toggle('session-change');
    expect(fixture.writes).toEqual([]);
    expect(fixture.values.get(SAVE_KEY)).toBe(original);
    expect(store.favorites.snapshot().persistence).toBe('session');
  });

  it('checks storage conflicts even when a local import preview is otherwise a no-op', async () => {
    const original = JSON.stringify(save(['same'], {}));
    const fixture = storageWith(original);
    const store = await createStore(fixture.storage);
    const preview = store.previewImport(original, 'replace');
    const external = JSON.stringify(save(['external'], {}));
    fixture.values.set(SAVE_KEY, external);
    expect(store.applyImport(preview, 'local')).toMatchObject(result('conflict', /changed|conflict/));
    expect(store.favorites.isFavorite('same')).toBe(true);
    expect(fixture.values.get(SAVE_KEY)).toBe(external);
    expect(fixture.writes).toEqual([]);
  });

  it('round-trips blank and whitespace favorite IDs accepted from legacy storage', async () => {
    const favoritesKey = 'shining-stars.favorite-song-ids';
    const legacyValue = '["","  ","__proto__"]';
    const legacyStorage: FavoriteStorage = {
      getItem(key) { return key === favoritesKey ? legacyValue : null; },
      setItem() { throw new Error('legacy data should not be rewritten on read'); },
    };
    const legacyStore = await createStore(legacyStorage);
    const exported = legacyStore.exportJson();
    const transferred = await createStore(null);
    const preview = transferred.previewImport(exported, 'replace');
    expect(transferred.applyImport(preview, 'session')).toMatchObject(result('session-only'));
    expect(transferred.exportJson()).toBe(exported);
    expect(JSON.parse(exported).favorites).toEqual(['', '  ', '__proto__']);
  });
});
