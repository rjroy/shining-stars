import { describe, expect, it } from 'vitest';
import type { ChartConfig } from './chart';
import { createGame } from './game';
import { getDifficultyProfile } from './game-balance';
import { projectNotes } from './note-projection';

const easyChart: ChartConfig = {
  sourceStart: 0,
  duration: 12,
  twilightAt: 8,
  twilightStrength: 100,
  allowedDifficulties: ['easy'],
  notes: [{ id: 'easy-late', lane: 0, time: 2 }],
};

describe('projectNotes', () => {
  it('projects unresolved upcoming notes into the visible runway and hides resolved or distant notes', () => {
    const notes = [
      { id: 'far', phase: 'audience' as const, outcome: null },
      { id: 'near', phase: 'audience' as const, outcome: null },
      { id: 'hit', phase: 'audience' as const, outcome: 'good' as const },
    ];

    expect(
      projectNotes(
        notes,
        [
          { id: 'far', lane: 0, time: 4 },
          { id: 'near', lane: 2, time: 2 },
          { id: 'hit', lane: 1, time: 1 },
        ],
        1,
        2,
      ),
    ).toEqual([{ id: 'near', lane: 2, progress: 0.5 }]);
  });

  it('clamps an imminent note to the hit line', () => {
    expect(
      projectNotes(
        [{ id: 'now', phase: 'audience', outcome: null }],
        [{ id: 'now', lane: 3, time: 0.8 }],
        1,
        2,
      ),
    ).toEqual([{ id: 'now', lane: 3, progress: 1 }]);
  });

  it('does not project chart notes when there is no active game state', () => {
    expect(projectNotes([], easyChart.notes, 24, 2.4)).toEqual([]);
  });

  it('keeps an Easy note on the hit line while its expanded Good window is still active', () => {
    const inputOffset = 0.2;
    const game = createGame(easyChart, inputOffset, 'easy');
    const snapshot = game.advanceTo(2.4);

    expect(snapshot.notes[0]?.outcome).toBeNull();
    expect(
      projectNotes(
        snapshot.notes,
        easyChart.notes,
        snapshot.transportTime,
        2.4,
      ),
    ).toEqual([{ id: 'easy-late', lane: 0, progress: 1 }]);
  });

  it.each([-0.2, 0.2])(
    'keeps the Easy note visible at its inclusive Good deadline with input offset %s, then hides it after the model records a miss',
    (inputOffset) => {
      const visualOffset = 0.2;
      const game = createGame(easyChart, inputOffset, 'easy');
      const goodWindow = getDifficultyProfile('easy').timing.goodWindowSeconds;
      const deadline = easyChart.notes[0]!.time + goodWindow + inputOffset;
      const atDeadline = game.advanceTo(deadline);
      const visualClock = atDeadline.transportTime + visualOffset;

      expect(atDeadline.notes[0]?.outcome).toBeNull();
      expect(visualClock - easyChart.notes[0]!.time).toBeGreaterThan(0.35);
      expect(
        projectNotes(atDeadline.notes, easyChart.notes, visualClock, 2.4),
        ).toEqual([{ id: 'easy-late', lane: 0, progress: 1 }]);

      const afterDeadline = game.advanceTo(deadline + 0.001);
      expect(afterDeadline.notes[0]?.outcome).toBe('miss');
      expect(
        projectNotes(
          afterDeadline.notes,
          easyChart.notes,
          afterDeadline.transportTime,
          2.4,
        ),
      ).toEqual([]);
    },
  );
});
