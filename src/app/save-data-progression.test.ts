import { describe, expect, it } from 'vitest';
import { createSaveStore, SAVE_STORAGE_KEY } from './save-data';
import type { FavoriteStorage } from '../catalog/favorites';

function storage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed)); const writes: string[] = []; let fail = false;
  const api: FavoriteStorage = { getItem: (key) => values.get(key) ?? null, setItem(key, value) { if (fail) throw new Error('quota'); values.set(key, value); writes.push(value); } };
  return { api, values, writes, failWrites: () => { fail = true; } };
}
const v2 = (progression: unknown) => JSON.stringify({ format: 'shining-stars-save', schemaVersion: 2, favorites: [], ratings: {}, progression });
const empty = { balance: 0, victoryMarks: {}, collectionPurchases: {}, songPurchases: {} };

describe('save progression persistence and imports', () => {
  it('migrates v1 lazily, exports v2, and preserves empty progression', () => {
    const legacy = JSON.stringify({ format: 'shining-stars-save', schemaVersion: 1, favorites: ['old'], ratings: { saved: { played: true, normalStars: 4, goldStars: 0 } } });
    const fixture = storage({ [SAVE_STORAGE_KEY]: legacy }); const store = createSaveStore(fixture.api);
    expect(fixture.writes).toEqual([]);
    expect(JSON.parse(store.exportJson())).toMatchObject({ schemaVersion: 3, favorites: ['old'], progression: empty, personalBestScores: [] });
    expect(store.songRatings.get('saved')).toMatchObject({ normalStars: 4, goldStars: 0 });
    store.favorites.toggle('another');
    expect(JSON.parse(fixture.values.get(SAVE_STORAGE_KEY)!)).toMatchObject({ schemaVersion: 3, progression: empty, personalBestScores: [] });
  });
  it('awards tier credits once, persists/reloads, and returns defensive snapshots', () => {
    const fixture = storage(); const store = createSaveStore(fixture.api);
    expect(store.progression.recordVictory('unknown-song', 'normal')).toMatchObject({ changed: true, status: 'applied' });
    expect(store.progression.recordVictory('unknown-song', 'easy')).toMatchObject({ changed: false });
    expect(store.progression.snapshot().balance).toBe(2);
    const snapshot = store.progression.snapshot();
    expect(() => ((snapshot.victoryMarks as Record<string, string>)['fake'] = 'hard')).toThrow();
    expect(store.progression.snapshot().victoryMarks).not.toHaveProperty('fake');
    expect(createSaveStore(fixture.api).progression.snapshot()).toMatchObject({ balance: 2, victoryMarks: { 'unknown-song': 'normal' } });
  });
  it('keeps victory credits in memory with an honest notice after persistence fails', () => {
    const fixture = storage(); const store = createSaveStore(fixture.api); fixture.failWrites();
    const result = store.progression.recordVictory('session-award', 'hard');
    expect(result).toMatchObject({ status: 'session-only', changed: true, persistence: 'session' });
    expect(result.notice).toMatch(/session only|session/i);
    expect(store.progression.snapshot().balance).toBe(3);
    expect(fixture.values.has(SAVE_STORAGE_KEY)).toBe(false);
  });
  it('does not debit or unlock on failed/conflicted local purchase; session purchase is explicit', () => {
    const fixture = storage(); const store = createSaveStore(fixture.api);
    store.progression.recordVictory('credit-source', 'hard');
    fixture.failWrites();
    const before = store.progression.snapshot();
    expect(store.progression.purchase({ kind: 'collection', collectionId: 'christmas-star' }, 'local')).toMatchObject({ status: 'failed', changed: false });
    expect(store.progression.snapshot().balance).toBe(before.balance);
    expect(store.progression.snapshot().collectionPurchases).toEqual({});
    const session = createSaveStore(null);
    session.progression.recordVictory('credit-source', 'hard');
    expect(session.progression.purchase({ kind: 'collection', collectionId: 'christmas-star' }, 'session')).toMatchObject({ status: 'session-only', changed: true });
    expect(session.progression.snapshot().collectionPurchases).toEqual({ 'christmas-star': 3 });
  });
  it('refuses local purchases after unsafe load and validates unknown IDs, prototype keys, and conservation', () => {
    const bad = storage({ [SAVE_STORAGE_KEY]: '{bad json' }); const unsafe = createSaveStore(bad.api);
    unsafe.progression.recordVictory('earned', 'hard');
    expect(unsafe.progression.purchase({ kind: 'collection', collectionId: 'outside-worlds' }, 'local').status).toBe('failed');
    const proto = JSON.parse('{"balance":1,"victoryMarks":{"__proto__":"easy"},"collectionPurchases":{},"songPurchases":{}}');
    const protoStore = createSaveStore(storage({ [SAVE_STORAGE_KEY]: v2(proto) }).api);
    expect(protoStore.progression.snapshot().victoryMarks).toHaveProperty('__proto__', 'easy');
    const unknown = { balance: 0, victoryMarks: { 'future-song': 'easy' }, collectionPurchases: {}, songPurchases: {} };
    expect(createSaveStore(storage({ [SAVE_STORAGE_KEY]: v2(unknown) }).api).progression.snapshot().persistence).toBe('session');
  });
  it('refuses a conflicted local purchase without publishing its debit or unlock', () => {
    const fixture = storage(); const store = createSaveStore(fixture.api);
    store.progression.recordVictory('earned', 'hard');
    const external = v2(empty); fixture.values.set(SAVE_STORAGE_KEY, external);
    expect(store.progression.purchase({ kind: 'collection', collectionId: 'christmas-star' }, 'local')).toMatchObject({ status: 'conflict', changed: false });
    expect(store.progression.snapshot().balance).toBe(3);
    expect(store.progression.snapshot().collectionPurchases).toEqual({});
    expect(fixture.values.get(SAVE_STORAGE_KEY)).toBe(external);
  });
  it('persists and reloads paid collection and song receipts', () => {
    const fixture = storage(); const store = createSaveStore(fixture.api);
    store.progression.recordVictory('earned', 'hard');
    expect(store.progression.purchase({ kind: 'collection', collectionId: 'outside-worlds' }, 'local').status).toBe('applied');
    expect(store.progression.purchase({ kind: 'song', songId: 'the-game' }, 'local').status).toBe('applied');
    expect(createSaveStore(fixture.api).progression.snapshot()).toMatchObject({ balance: 1, collectionPurchases: { 'outside-worlds': 1 }, songPurchases: { 'the-game': 'outside-worlds' } });
  });
  it('round-trips unknown paid collection/song IDs and preserves corrupt receipt bytes', () => {
    const unknown = { balance: 0, victoryMarks: { source: 'hard' }, collectionPurchases: { 'future-collection': 2 }, songPurchases: { 'future-song': 'future-collection' } };
    const original = v2(unknown); const fixture = storage({ [SAVE_STORAGE_KEY]: original });
    expect(createSaveStore(fixture.api).progression.snapshot()).toMatchObject(unknown);
    const transferred = createSaveStore(null);
    const imported = transferred.previewImport(createSaveStore(fixture.api).exportJson(), 'replace', 'replace');
    expect(transferred.applyImport(imported, 'session').status).toBe('session-only');
    expect(JSON.parse(transferred.exportJson()).progression).toEqual(unknown);
    const malformed = v2({ balance: 3, victoryMarks: { source: 'hard' }, collectionPurchases: { 'lyra-of-brightvale': 1 }, songPurchases: {} });
    const bad = storage({ [SAVE_STORAGE_KEY]: malformed });
    expect(createSaveStore(bad.api).progression.snapshot().persistence).toBe('session');
    expect(bad.values.get(SAVE_STORAGE_KEY)).toBe(malformed);
    const store = createSaveStore(storage().api);
    expect(() => store.previewImport(v2({ balance: 2, victoryMarks: { source: 'hard' }, collectionPurchases: { 'christmas-star': 1 }, songPurchases: {} }), 'replace', 'replace')).toThrow(/configured price/i);
  });
  it('round-trips prototype-looking unknown receipt IDs safely', () => {
    const progression = JSON.parse('{"balance":1,"victoryMarks":{"__proto__":"hard"},"collectionPurchases":{"constructor":1},"songPurchases":{"toString":"constructor"}}');
    const fixture = storage({ [SAVE_STORAGE_KEY]: v2(progression) });
    const exported = createSaveStore(fixture.api).exportJson();
    const transferred = createSaveStore(null);
    const preview = transferred.previewImport(exported, 'replace', 'replace');
    expect(transferred.applyImport(preview, 'session').status).toBe('session-only');
    const roundTrip = JSON.parse(transferred.exportJson()).progression;
    expect(Object.hasOwn(roundTrip.victoryMarks, '__proto__')).toBe(true);
    expect(Object.hasOwn(roundTrip.collectionPurchases, 'constructor')).toBe(true);
    expect(Object.hasOwn(roundTrip.songPurchases, 'toString')).toBe(true);
  });
  it('validates purchase targets even for already-owned requests and explicit session no-ops stop auto-writes', () => {
    const fixture = storage(); const store = createSaveStore(fixture.api);
    store.progression.recordVictory('earned', 'hard');
    store.progression.purchase({ kind: 'collection', collectionId: 'outside-worlds' }, 'local');
    const preview = store.previewImport(store.exportJson(), 'replace');
    expect(store.progression.purchase({ kind: 'collection', collectionId: 'outside-worlds' }, 'invalid' as never).status).toBe('failed');
    expect(store.progression.purchase({ kind: 'collection', collectionId: 'outside-worlds' }, 'session').status).toBe('session-only');
    expect(store.applyImport(preview, 'local').status).toBe('stale-preview');
    store.favorites.toggle('after-session-noop');
    expect(fixture.writes).toHaveLength(2);
  });
  it('stales an import preview after a successful local purchase', () => {
    const fixture = storage(); const store = createSaveStore(fixture.api);
    store.progression.recordVictory('earned', 'hard');
    const preview = store.previewImport(v2(empty), 'replace', 'replace');
    expect(store.progression.purchase({ kind: 'collection', collectionId: 'outside-worlds' }, 'local').status).toBe('applied');
    expect(store.applyImport(preview, 'local').status).toBe('stale-preview');
  });
  it('rejects schema 99 imports and unsafe numeric progression values', () => {
    const store = createSaveStore(null);
    for (const value of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => store.previewImport(v2({ balance: value, victoryMarks: {}, collectionPurchases: {}, songPurchases: {} }), 'replace', 'replace')).toThrow();
    }
    const unsupported = JSON.stringify({ format: 'shining-stars-save', schemaVersion: 99, favorites: [], ratings: {}, progression: empty });
    expect(() => store.previewImport(unsupported, 'replace', 'replace')).toThrow(/invalid envelope/i);
    for (const [id, price] of [['zero', 0], ['negative', -1], ['fraction', 1.5], ['unsafe', Number.MAX_SAFE_INTEGER + 1]] as const) {
      const state = { balance: price, victoryMarks: {}, collectionPurchases: { [id]: price }, songPurchases: {} };
      expect(() => store.previewImport(v2(state), 'replace', 'replace')).toThrow();
    }
  });
  it('keeps or explicitly replaces all progression during import; progression-only changes are previewed and stale previews rejected', () => {
    const current = { balance: 2, victoryMarks: { local: 'normal' }, collectionPurchases: {}, songPurchases: {} };
    const incoming = { balance: 1, victoryMarks: { 'future-song': 'easy' }, collectionPurchases: {}, songPurchases: {} };
    const fixture = storage({ [SAVE_STORAGE_KEY]: v2(current) }); const store = createSaveStore(fixture.api);
    const incomingSave = JSON.stringify({ format: 'shining-stars-save', schemaVersion: 2, favorites: [], ratings: {}, progression: incoming });
    const keep = store.previewImport(incomingSave, 'merge');
    expect(keep.hasChanges).toBe(false);
    const replace = store.previewImport(incomingSave, 'merge', 'replace');
    expect(replace.hasChanges).toBe(true);
    expect(replace.changes.progression).toMatchObject({ before: { balance: 2, marks: 2 }, after: { balance: 1, marks: 1 } });
    expect(store.applyImport(replace, 'local').status).toBe('applied');
    expect(store.progression.snapshot().victoryMarks).toHaveProperty('future-song', 'easy');
    const stale = store.previewImport(v2(current), 'merge', 'replace');
    store.progression.recordVictory('new-run', 'easy');
    expect(store.applyImport(stale, 'local').status).toBe('stale-preview');
  });
  it('counts earned marks by tier value rather than number of songs', () => {
    const progression = { balance: 3, victoryMarks: { easy: 'easy', normal: 'normal' }, collectionPurchases: {}, songPurchases: {} };
    const fixture = storage({ [SAVE_STORAGE_KEY]: v2(progression) }); const store = createSaveStore(fixture.api);
    const candidate = v2({ balance: 3, victoryMarks: { hard: 'hard' }, collectionPurchases: {}, songPurchases: {} });
    const preview = store.previewImport(candidate, 'merge', 'replace');
    expect(preview.changes.progression.before.marks).toBe(3);
    expect(preview.changes.progression.after.marks).toBe(3);
  });
  it('replacing with an old v1 save explicitly clears the progression domain', () => {
    const fixture = storage({ [SAVE_STORAGE_KEY]: v2({ balance: 1, victoryMarks: { earned: 'easy' }, collectionPurchases: {}, songPurchases: {} }) });
    const store = createSaveStore(fixture.api);
    const v1 = JSON.stringify({ format: 'shining-stars-save', schemaVersion: 1, favorites: [], ratings: {} });
    const preview = store.previewImport(v1, 'replace', 'replace');
    expect(preview.changes.progression.after).toEqual({ balance: 0, marks: 0, collectionPurchases: 0, songPurchases: 0 });
    expect(store.applyImport(preview, 'local').status).toBe('applied');
    expect(store.progression.snapshot()).toMatchObject(empty);
  });
  it('rejects malformed progression keys/parent purchases and preserves imported unknown IDs', () => {
    const valid = { balance: 1, victoryMarks: { 'future-song': 'easy' }, collectionPurchases: {}, songPurchases: {} };
    const fixture = storage(); const store = createSaveStore(fixture.api);
    const preview = store.previewImport(v2(valid), 'replace', 'replace');
    expect(store.applyImport(preview, 'session').status).toBe('session-only');
    expect(store.progression.snapshot().victoryMarks).toHaveProperty('future-song', 'easy');
    const malformed = createSaveStore(storage({ [SAVE_STORAGE_KEY]: v2({ balance: 1, victoryMarks: {}, collectionPurchases: {}, songPurchases: { song: 'unbought' } }) }).api);
    expect(malformed.progression.snapshot().persistence).toBe('session');
    expect(createSaveStore(storage({ [SAVE_STORAGE_KEY]: v2({ balance: 0, victoryMarks: { ' ': 'easy' }, collectionPurchases: {}, songPurchases: {} }) }).api).progression.snapshot().persistence).toBe('session');
  });
});
