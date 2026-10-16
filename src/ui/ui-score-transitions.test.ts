import { describe, expect, it } from 'vitest';
import * as ui from './ui';
import type { GameSnapshot } from '../game/game';

type State = Pick<
  GameSnapshot,
  | 'score'
  | 'combo'
  | 'multiplier'
  | 'normalMaximum'
  | 'transportTime'
  | 'status'
  | 'phase'
  | 'victory'
>;
type Echo =
  | {
      readonly kind: 'star';
      readonly index: number;
      readonly track: 'normal' | 'gold';
    }
  | {
      readonly kind: 'multiplier';
      readonly from: number;
      readonly to: number;
      readonly direction: 'grow' | 'shrink';
      readonly text: string;
    };
interface Tracker {
  update(
    state: State,
    options: { active: boolean; reducedMotion: boolean },
  ): readonly Echo[];
  reset(): void;
  dispose(): void;
}

// Existing Vitest environment is Node, without a DOM implementation. These are
// transition-policy tests, not animation-node or canvas integration evidence.
// Import an existing production module; missing behavior must fail an assertion,
// not module resolution. No production stubs are added to manufacture RED.
function tracker(): Tracker {
  const factory = Reflect.get(ui, 'createScoreTransitionTracker');
  expect(
    factory,
    'ui.ts exports a score milestone transition tracker',
  ).toBeTypeOf('function');
  return (factory as () => Tracker)();
}

const playing = { active: true, reducedMotion: false };
const quiet = { active: false, reducedMotion: false };
function state(percent: number, changes: Partial<State> = {}): State {
  return {
    score: percent * 200,
    normalMaximum: 20_000,
    combo: 1,
    multiplier: 1,
    transportTime: 10,
    status: 'playing',
    phase: 'audience',
    victory: false,
    ...changes,
  };
}
const star = (index: number, track: 'normal' | 'gold'): Echo => ({
  kind: 'star',
  index,
  track,
});

describe('score milestone echo transitions', () => {
  it('does not celebrate an initial snapshot, even with completed stars and ×5', () => {
    expect(
      tracker().update(state(95, { combo: 60, multiplier: 5 }), playing),
    ).toEqual([]);
  });

  it.each([
    [20, 0],
    [30, 1],
    [40, 2],
    [50, 3],
    [60, 4],
  ] as const)(
    'emits one pearl echo when normal star %s%% completes',
    (percent, index) => {
      const t = tracker();
      t.update(state(percent - 0.005), playing);
      expect(t.update(state(percent), playing)).toEqual([
        star(index, 'normal'),
      ]);
      expect(t.update(state(percent), playing)).toEqual([]);
      expect(t.update(state(percent + 0.005), playing)).toEqual([]);
    },
  );

  it.each([
    [70, 0],
    [75, 1],
    [80, 2],
    [85, 3],
    [90, 4],
  ] as const)(
    'emits one gold echo when gold star %s%% completes',
    (percent, index) => {
      const t = tracker();
      t.update(state(percent - 0.005), playing);
      expect(t.update(state(percent), playing)).toEqual([star(index, 'gold')]);
      expect(t.update(state(percent), playing)).toEqual([]);
    },
  );

  it('does not echo partial normal/gold filling or every successful hit', () => {
    const t = tracker();
    t.update(state(0), playing);
    for (const percent of [1, 5, 10, 19.995]) {
      expect(t.update(state(percent, { combo: 2 }), playing)).toEqual([]);
    }
    t.reset();
    t.update(state(60), playing);
    for (const percent of [61, 65, 69.995]) {
      expect(t.update(state(percent), playing)).toEqual([]);
    }
  });

  it('reports every completed milestone crossed in a single update, once and in track order', () => {
    const t = tracker();
    t.update(state(19), playing);
    expect(t.update(state(86), playing)).toEqual([
      ...[0, 1, 2, 3, 4].map((index) => star(index, 'normal')),
      ...[0, 1, 2, 3].map((index) => star(index, 'gold')),
    ]);
    expect(t.update(state(86), playing)).toEqual([]);
    expect(t.update(state(150), playing)).toEqual([star(4, 'gold')]);
    expect(t.update(state(200), playing)).toEqual([]);
  });

  it.each([
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 5],
    [2, 5],
  ] as const)(
    'expands the newly displayed multiplier from ×%s to ×%s, not intermediate levels',
    (from, to) => {
      const t = tracker();
      t.update(state(1, { multiplier: from }), playing);
      expect(t.update(state(1, { multiplier: to }), playing)).toEqual([
        { kind: 'multiplier', from, to, direction: 'grow', text: `×${to}` },
      ]);
      expect(
        t.update(state(1, { multiplier: to, combo: 42 }), playing),
      ).toEqual([]);
    },
  );

  it('shrinks the OLD multiplier on a miss while the real presenter shows ×1 immediately', () => {
    const t = tracker();
    t.update(state(65, { combo: 45, multiplier: 5 }), playing);
    const missed = state(65, { combo: 0, multiplier: 1 });
    expect(t.update(missed, playing)).toEqual([
      { kind: 'multiplier', from: 5, to: 1, direction: 'shrink', text: '×5' },
    ]);
    expect(ui.getScorePresentation(missed).multiplierText).toBe('×1');
    expect(t.update(missed, playing)).toEqual([]);
  });

  it('keeps multiplier and several star completions in the same update', () => {
    const t = tracker();
    t.update(state(19, { multiplier: 1 }), playing);
    expect(t.update(state(31, { multiplier: 2 }), playing)).toEqual([
      star(0, 'normal'),
      star(1, 'normal'),
      { kind: 'multiplier', from: 1, to: 2, direction: 'grow', text: '×2' },
    ]);
  });

  it('explicit reset rearms without replaying old milestones or shrinking an old multiplier', () => {
    const t = tracker();
    t.update(state(90, { multiplier: 5 }), playing);
    t.reset();
    expect(t.update(state(0, { transportTime: 0 }), playing)).toEqual([]);
    expect(t.update(state(20, { transportTime: 2 }), playing)).toEqual([
      star(0, 'normal'),
    ]);
  });

  it('recognizes a run rewind even when an intermediate idle/reset snapshot was skipped', () => {
    const t = tracker();
    t.update(state(90, { multiplier: 5, transportTime: 50 }), playing);
    expect(
      t.update(state(25, { multiplier: 2, transportTime: 5 }), playing),
    ).toEqual([]);
    expect(
      t.update(state(30, { multiplier: 2, transportTime: 6 }), playing),
    ).toEqual([star(1, 'normal')]);
  });

  it('rebaselines a changed Normal maximum instead of celebrating a different chart', () => {
    const t = tracker();
    t.update(state(19), playing);
    expect(t.update(state(19, { normalMaximum: 1000 }), playing)).toEqual([]);
  });

  it('does not replay results or inactive/count-in updates on reactivation', () => {
    const t = tracker();
    t.update(state(19), playing);
    expect(
      t.update(state(90, { multiplier: 5, status: 'results' }), playing),
    ).toEqual([]);
    expect(
      t.update(state(90, { multiplier: 5, status: 'results' }), quiet),
    ).toEqual([]);
    t.reset();
    expect(t.update(state(19), quiet)).toEqual([]);
    expect(t.update(state(20, { multiplier: 2 }), quiet)).toEqual([]);
    expect(t.update(state(20, { multiplier: 2 }), playing)).toEqual([]);
    expect(t.update(state(30, { multiplier: 2 }), playing)).toEqual([
      star(1, 'normal'),
    ]);
  });

  it('consumes reduced-motion milestones without animating or replaying when motion returns', () => {
    const t = tracker();
    t.update(state(19), playing);
    expect(
      t.update(state(75, { multiplier: 4 }), {
        active: true,
        reducedMotion: true,
      }),
    ).toEqual([]);
    expect(t.update(state(75, { multiplier: 4 }), playing)).toEqual([]);
    expect(t.update(state(80, { multiplier: 4 }), playing)).toEqual([
      star(2, 'gold'),
    ]);
  });

  it('does not treat Audience → Twilight → Radiant as a run reset or an echo trigger', () => {
    const t = tracker();
    t.update(state(19), playing);
    expect(t.update(state(19, { phase: 'twilight' }), playing)).toEqual([]);
    expect(t.update(state(20, { phase: 'twilight' }), playing)).toEqual([
      star(0, 'normal'),
    ]);
    expect(
      t.update(state(20, { phase: 'twilight', victory: true }), playing),
    ).toEqual([]);
    expect(
      t.update(state(30, { phase: 'twilight', victory: true }), playing),
    ).toEqual([star(1, 'normal')]);
  });

  it('clears detection state on disposal and never emits again, even if reset is called', () => {
    const t = tracker();
    t.update(state(19), playing);
    t.dispose();
    t.dispose();
    expect(t.update(state(90, { multiplier: 5 }), playing)).toEqual([]);
    t.reset();
    expect(t.update(state(0), playing)).toEqual([]);
    expect(t.update(state(90, { multiplier: 5 }), playing)).toEqual([]);
  });
});
