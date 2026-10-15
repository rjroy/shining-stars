import { describe, expect, it } from 'vitest';
import type { ChartConfig } from '../game/chart';
import { createGame } from '../game/game';
import { getDifficultyProfile } from '../game/game-balance';
import { projectNotes, VISIBLE_NOTE_SECONDS } from './note-projection';

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
      { id: 'far', lane: 0 as const, phase: 'audience' as const, outcome: null },
      { id: 'near', lane: 2 as const, phase: 'audience' as const, outcome: null },
      { id: 'hit', lane: 1 as const, phase: 'audience' as const, outcome: 'good' as const },
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

  it('projects an overdue unresolved note beyond the hit line', () => {
    expect(
      projectNotes(
        [{ id: 'now', lane: 3, phase: 'audience', outcome: null }],
        [{ id: 'now', lane: 3, time: 0.8 }],
        1,
        2,
      ),
    ).toEqual([{ id: 'now', lane: 3, progress: 1.1 }]);
  });

  it('does not project chart notes when there is no active game state', () => {
    expect(projectNotes([], easyChart.notes, 24, 2.4)).toEqual([]);
  });

  it('keeps an Easy note moving past the hit line while its expanded Good window is still active', () => {
    const inputOffset = 0.2;
    const game = createGame(easyChart, inputOffset, 'easy');
    const goodWindow = getDifficultyProfile('easy').timing.goodWindowSeconds;
    const snapshot = game.advanceTo(
      easyChart.notes[0]!.time + goodWindow + inputOffset - 0.01,
    );

    expect(snapshot.notes[0]?.outcome).toBeNull();
    expect(
      projectNotes(
        snapshot.notes,
        easyChart.notes,
        snapshot.transportTime,
        VISIBLE_NOTE_SECONDS,
      )[0]?.progress,
    ).toBeCloseTo(
      1 + (goodWindow + inputOffset - 0.01) / VISIBLE_NOTE_SECONDS,
    );
  });

  it('moves unresolved notes beyond the hit line through the late window, then removes them on miss or hit', () => {
    const goodWindow = getDifficultyProfile('easy').timing.goodWindowSeconds;
    const lateGame = createGame(easyChart, 0, 'easy');
    const beforeIdeal = lateGame.advanceTo(1.99);
    const atIdeal = lateGame.advanceTo(2);
    const afterIdeal = lateGame.advanceTo(2.05);
    const atMissCutoff = lateGame.advanceTo(2 + goodWindow);

    const progressAt = (snapshot: ReturnType<typeof lateGame.snapshot>) =>
      projectNotes(
        snapshot.notes,
        easyChart.notes,
        snapshot.transportTime,
        VISIBLE_NOTE_SECONDS,
      )[0]
        ?.progress;

    expect(progressAt(beforeIdeal)).toBeLessThan(1);
    expect(progressAt(atIdeal)).toBe(1);
    expect(progressAt(afterIdeal)).toBeGreaterThan(1);
    expect(progressAt(atMissCutoff)).toBeCloseTo(
      1 + goodWindow / VISIBLE_NOTE_SECONDS,
    );
    expect(atMissCutoff.notes[0]?.outcome).toBeNull();

    const afterMiss = lateGame.advanceTo(2 + goodWindow + 0.001);
    expect(afterMiss.notes[0]?.outcome).toBe('miss');
    expect(progressAt(afterMiss)).toBeUndefined();

    const lateHitGame = createGame(easyChart, 0, 'easy');
    const lateHit = lateHitGame.press(0, 2 + goodWindow);
    expect(lateHit?.quality).toBe('good');
    expect(
      projectNotes(
        lateHitGame.snapshot().notes,
        easyChart.notes,
        lateHitGame.snapshot().transportTime,
        VISIBLE_NOTE_SECONDS,
      ),
    ).toEqual([]);
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
      expect(visualClock - easyChart.notes[0]!.time).toBeGreaterThan(0);
      expect(
        projectNotes(
          atDeadline.notes,
          easyChart.notes,
          visualClock,
          VISIBLE_NOTE_SECONDS,
        )[0]?.progress,
      ).toBeCloseTo(
        1 +
          (goodWindow + inputOffset + visualOffset) / VISIBLE_NOTE_SECONDS,
      );

      const afterDeadline = game.advanceTo(deadline + 0.001);
      expect(afterDeadline.notes[0]?.outcome).toBe('miss');
      expect(
        projectNotes(
          afterDeadline.notes,
          easyChart.notes,
          afterDeadline.transportTime,
          VISIBLE_NOTE_SECONDS,
        ),
      ).toEqual([]);
    },
  );
});
