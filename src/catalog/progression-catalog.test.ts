import { describe, expect, it } from 'vitest';
import { createProgressionMembership } from './progression-catalog';

describe('progression catalog metadata adapter', () => {
  it('derives membership and configured collection prices from catalog metadata only', () => {
    const membership = createProgressionMembership();
    expect(membership.collections.get('lyra-of-brightvale')).toBeNull();
    expect(membership.collections.get('christmas-star')).toBe(3);
    expect(membership.collections.get('outside-worlds')).toBe(1);
    expect(membership.songs.get('the-first-shining-star')).toBe('lyra-of-brightvale');
  });
  it('rejects duplicate and unrepresented catalog song membership', () => {
    expect(() => createProgressionMembership({ songs: [{ id: 'beautiful-disaster' }], collections: [{ id: 'christmas-star', songIds: ['beautiful-disaster'] }, { id: 'outside-worlds', songIds: ['beautiful-disaster'] }] })).toThrow(/multiple collections/i);
    expect(() => createProgressionMembership({ songs: [{ id: 'beautiful-disaster' }], collections: [{ id: 'christmas-star', songIds: ['beautiful-disaster', 'beautiful-disaster'] }] })).toThrow(/multiple collections/i);
    expect(() => createProgressionMembership({ songs: [{ id: 'beautiful-disaster' }], collections: [{ id: 'christmas-star', songIds: ['unlisted'] }] })).toThrow(/exactly one/i);
  });
});
