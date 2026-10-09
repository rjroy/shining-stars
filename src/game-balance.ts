/** One immutable source for audience rewards and Twilight combat values. */
export const GAME_BALANCE = Object.freeze({
  audience: Object.freeze({ miss: 0, good: 2, perfect: 3 }),
  twilight: Object.freeze({
    miss: Object.freeze({ personalCost: 3, damage: 0 }),
    good: Object.freeze({ personalCost: 1, damage: 2 }),
    perfect: Object.freeze({ personalCost: 0, damage: 3 }),
  }),
});
