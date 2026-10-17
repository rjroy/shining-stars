import { describe, expect, it } from 'vitest';
import { createProgression, purchase, recordVictory, validateProgression, type ProgressionState } from './progression';

describe('victory-credit progression', () => {
  it('credits the won tier and every still-uncredited lower tier once', () => {
    let state: ProgressionState = createProgression();
    state = recordVictory(state, 'song', 'normal');
    expect(state).toEqual({ balance: 2, victoryMarks: { song: 'normal' }, collectionPurchases: {}, songPurchases: {} });
    expect(recordVictory(state, 'song', 'easy')).toBe(state);
    expect(recordVictory(state, 'song', 'hard')).toEqual({ balance: 3, victoryMarks: { song: 'hard' }, collectionPurchases: {}, songPurchases: {} });
  });
  it('tracks configured purchases without repeating charges and rejects unknown membership', () => {
    const membership = { collections: new Map([['paid', 1], ['free', null]]), songs: new Map([['song', 'paid'], ['free-song', 'free']]) };
    const earned = recordVictory(createProgression(), 'starter', 'normal');
    const collection = purchase(earned, { kind: 'collection', collectionId: 'paid' }, membership);
    expect(collection.balance).toBe(1);
    expect(purchase(collection, { kind: 'collection', collectionId: 'paid' }, membership)).toBe(collection);
    expect(purchase(collection, { kind: 'song', songId: 'song' }, membership)).toMatchObject({ songPurchases: { song: 'paid' } });
    expect(() => purchase(collection, { kind: 'song', songId: 'unknown' }, membership)).toThrow();
    expect(() => purchase(collection, { kind: 'collection', collectionId: 'missing' }, membership)).toThrow();
  });
  it('requires positive receipts and validates known paid/free collection prices', () => {
    const membership = { collections: new Map([['paid', 3], ['lyra-of-brightvale', null]]), songs: new Map([['lyra-song', 'lyra-of-brightvale']]) };
    expect(() => validateProgression({ balance: 0, victoryMarks: {}, collectionPurchases: { paid: 0 }, songPurchases: {} }, membership)).toThrow();
    expect(() => validateProgression({ balance: 2, victoryMarks: { s: 'hard' }, collectionPurchases: { paid: 1 }, songPurchases: {} }, membership)).toThrow();
    expect(() => validateProgression({ balance: 0, victoryMarks: {}, collectionPurchases: { 'lyra-of-brightvale': 1 }, songPurchases: {} }, membership)).toThrow();
    expect(() => validateProgression({ balance: 0, victoryMarks: {}, collectionPurchases: {}, songPurchases: {}, extra: true }, membership)).toThrow();
    expect(validateProgression({ balance: 0, victoryMarks: { source: 'easy' }, collectionPurchases: { future: 1 }, songPurchases: {} }, membership).collectionPurchases).toHaveProperty('future', 1);
  });
});
