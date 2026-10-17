export type Difficulty = 'easy' | 'normal' | 'hard';
export interface ProgressionState {
  readonly balance: number;
  readonly victoryMarks: Readonly<Record<string, Difficulty>>;
  readonly collectionPurchases: Readonly<Record<string, number>>;
  readonly songPurchases: Readonly<Record<string, string>>;
}
export type ProgressionMembership = {
  readonly songs: ReadonlyMap<string, string>;
  readonly collections: ReadonlyMap<string, number | null>;
  readonly songPrice?: number;
};
export type ProgressionPurchaseRequest = { readonly kind: 'collection'; readonly collectionId: string } | { readonly kind: 'song'; readonly songId: string };
export const createProgression = (): ProgressionState => Object.freeze({ balance: 0, victoryMarks: Object.freeze({}), collectionPurchases: Object.freeze({}), songPurchases: Object.freeze({}) });
const tiers: readonly Difficulty[] = ['easy', 'normal', 'hard'];
const safeId = (id: string) => typeof id === 'string' && id.trim().length > 0;
export function validateProgression(value: unknown, membership?: ProgressionMembership): ProgressionState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Progression must be an object.');
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join(',') !== 'balance,collectionPurchases,songPurchases,victoryMarks') throw new TypeError('Progression has unexpected fields.');
  if (!Number.isSafeInteger(raw.balance) || (raw.balance as number) < 0 || !raw.victoryMarks || typeof raw.victoryMarks !== 'object' || Array.isArray(raw.victoryMarks) || !raw.collectionPurchases || typeof raw.collectionPurchases !== 'object' || Array.isArray(raw.collectionPurchases) || !raw.songPurchases || typeof raw.songPurchases !== 'object' || Array.isArray(raw.songPurchases)) throw new TypeError('Progression fields are invalid.');
  const marks: Record<string, Difficulty> = Object.create(null);
  const collections: Record<string, number> = Object.create(null);
  const songs: Record<string, string> = Object.create(null);
  let earned = 0; let spent = 0;
  for (const [id, tier] of Object.entries(raw.victoryMarks as object)) { if (!safeId(id) || !tiers.includes(tier as Difficulty)) throw new TypeError('Victory mark is invalid.'); marks[id] = tier as Difficulty; earned += tiers.indexOf(tier as Difficulty) + 1; }
  for (const [id, price] of Object.entries(raw.collectionPurchases as object)) {
    if (!safeId(id) || !Number.isSafeInteger(price) || (price as number) <= 0) throw new TypeError('Collection purchase is invalid.');
    if (membership?.collections.has(id)) {
      const configuredPrice = membership.collections.get(id);
      if (configuredPrice === null || configuredPrice !== price) throw new TypeError('Collection receipt does not match its configured price.');
    }
    collections[id] = price as number; spent += price as number;
  }
  for (const [id, parent] of Object.entries(raw.songPurchases as object)) {
    if (!safeId(id) || !safeId(parent as string) || !Object.hasOwn(collections, parent as string)) throw new TypeError('Song purchase is invalid.');
    const knownParent = membership?.songs.get(id);
    if (knownParent !== undefined && (knownParent !== parent || knownParent === 'lyra-of-brightvale')) throw new TypeError('Song receipt does not match catalog membership.');
    if (membership?.collections.has(parent as string) && membership.collections.get(parent as string) === null) throw new TypeError('Free collection songs cannot have purchase receipts.');
    songs[id] = parent as string; spent += 1;
  }
  if (!Number.isSafeInteger(earned + spent) || raw.balance as number + spent !== earned) throw new TypeError('Progression credit conservation failed.');
  return Object.freeze({ balance: raw.balance as number, victoryMarks: Object.freeze(marks), collectionPurchases: Object.freeze(collections), songPurchases: Object.freeze(songs) });
}
export function recordVictory(state: ProgressionState, songId: string, difficulty: Difficulty): ProgressionState {
  if (!safeId(songId) || !tiers.includes(difficulty)) throw new TypeError('Victory is invalid.');
  const prior = state.victoryMarks[songId]; const count = prior === undefined ? tiers.indexOf(difficulty) + 1 : Math.max(0, tiers.indexOf(difficulty) - tiers.indexOf(prior));
  if (count === 0) return state;
  const marks = { ...state.victoryMarks, [songId]: prior === undefined || tiers.indexOf(difficulty) > tiers.indexOf(prior) ? difficulty : prior };
  return validateProgression({ ...state, balance: state.balance + count, victoryMarks: marks });
}
export function purchase(state: ProgressionState, request: ProgressionPurchaseRequest, membership: ProgressionMembership): ProgressionState {
  if (request.kind === 'collection') {
    const cost = membership.collections.get(request.collectionId);
    if (cost === undefined) throw new TypeError('Unknown collection.');
    if (Object.hasOwn(state.collectionPurchases, request.collectionId)) return state;
    if (cost === null) throw new TypeError('Collection is already free.');
    if (!Number.isSafeInteger(cost) || cost < 0 || state.balance < cost) throw new RangeError('Insufficient balance or invalid price.');
    return validateProgression({ ...state, balance: state.balance - cost, collectionPurchases: { ...state.collectionPurchases, [request.collectionId]: cost } }, membership);
  }
  const parent = membership.songs.get(request.songId);
  if (!parent) throw new TypeError('Unknown song.');
  if (parent === 'lyra-of-brightvale' || Object.hasOwn(state.songPurchases, request.songId)) return state;
  if (!Object.hasOwn(state.collectionPurchases, parent)) throw new TypeError('Parent collection is locked.');
  const cost = membership.songPrice ?? 1;
  if (!Number.isSafeInteger(cost) || cost < 0 || state.balance < cost) throw new RangeError('Insufficient balance or invalid song price.');
  return validateProgression({ ...state, balance: state.balance - cost, songPurchases: { ...state.songPurchases, [request.songId]: parent } }, membership);
}
