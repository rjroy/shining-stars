import catalogData from '../../data/catalog.json';
import prices from '../../data/progression.json';
import type { ProgressionMembership } from './progression';

/** Membership and prices come from metadata/config only; no charts or audio are loaded. */
export function createProgressionMembership(catalog: { songs: readonly { id: string }[]; collections: readonly { id: string; songIds: readonly string[] }[] } = catalogData): ProgressionMembership {
  if (prices.schemaVersion !== 1 || !Number.isSafeInteger(prices.songPrice) || prices.songPrice !== 1) throw new TypeError('Progression price data is invalid.');
  const collections = new Map<string, number | null>();
  for (const collection of catalog.collections) {
    if (!Object.hasOwn(prices.collections, collection.id)) throw new TypeError(`Missing price for collection '${collection.id}'.`);
    const price = prices.collections[collection.id as keyof typeof prices.collections];
    if (price !== null && (!Number.isSafeInteger(price) || price <= 0)) throw new TypeError(`Collection '${collection.id}' has an invalid price.`);
    collections.set(collection.id, price);
  }
  const songs = new Map<string, string>();
  for (const collection of catalog.collections) for (const songId of collection.songIds) {
    if (songs.has(songId)) throw new TypeError(`Catalog song '${songId}' belongs to multiple collections.`);
    songs.set(songId, collection.id);
  }
  const catalogSongIds = new Set(catalog.songs.map((song) => song.id));
  if (songs.size !== catalog.songs.length || [...songs.keys()].some((songId) => !catalogSongIds.has(songId)) || [...catalogSongIds].some((songId) => !songs.has(songId))) throw new TypeError('Every catalog song must belong to exactly one collection.');
  if (Object.keys(prices.collections).length !== catalog.collections.length) throw new TypeError('Progression prices must match catalog collections exactly.');
  return Object.freeze({ songs, collections, songPrice: prices.songPrice });
}
