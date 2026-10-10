import { describe, expect, it } from 'vitest';
import type { ChartConfig } from './chart';
import type { ControllerSnapshot } from './controller';
import { getDifficultyProfile, type Difficulty } from './game-balance';
import { projectTimingWindowGeometry } from './note-projection';
import { projectGameplayFrame, type GameplayLayout } from './gameplay-frame';

const chartNotes = [{ id: 'target', lane: 0, time: 2 }] as const;
const states = [{ id: 'target', phase: 'audience' as const, outcome: null }];
const chart: ChartConfig = {
  sourceStart: 0,
  duration: 20,
  twilightAt: 10,
  twilightStrength: 100,
  allowedDifficulties: ['normal', 'hard'],
  notes: [...chartNotes],
};
const layout: GameplayLayout = {
  width: 640,
  height: 480,
  stage: { x: 0, y: 0, width: 640, height: 480 },
  board: { x: 0, y: 0, width: 640, height: 300 },
  header: { x: 0, y: 0, width: 640, height: 20 },
  legend: { x: 0, y: 340, width: 640, height: 20 },
  feedback: { x: 0, y: 380, width: 640, height: 20 },
};

function makeSnapshot(): ControllerSnapshot {
  return {
    audio: {
      status: 'playing',
      position: 1,
      duration: chart.duration,
      scheduledWhen: null,
      hasActiveSource: true,
      loaded: true,
      disposed: false,
      error: null,
    },
    game: {
      transportTime: 1,
      phase: 'audience',
      status: 'playing',
      renown: 0,
      personalStrength: 100,
      twilightStrength: 100,
      difficulty: 'hard',
      notes: states,
      result: null,
    },
    inputOffset: 0,
    visualOffset: 0,
    selectedDifficulty: 'normal',
    feedback: null,
    pendingPlaybackRequests: false,
  };
}

function geometryFor(difficulty: Difficulty, runwayTravelPx: number) {
  return projectTimingWindowGeometry(difficulty, runwayTravelPx, 2.4);
}

describe('difficulty timing-window projection', () => {
  it.each(['easy', 'normal', 'hard'] as const)(
    'calculates matching Perfect and Good geometry for the %s profile',
    (difficulty) => {
      const profile = getDifficultyProfile(difficulty);
      const runwayTravelPx = 240;
      const expectedGeometry = {
        goodHalfHeightPx:
          profile.timing.goodWindowSeconds * (runwayTravelPx / 2.4),
        goodEnvelopeHeightPx:
          2 * profile.timing.goodWindowSeconds * (runwayTravelPx / 2.4),
        perfectHalfHeightPx:
          profile.timing.perfectWindowSeconds * (runwayTravelPx / 2.4),
        perfectEnvelopeHeightPx:
          2 * profile.timing.perfectWindowSeconds * (runwayTravelPx / 2.4),
      };

      expect(geometryFor(difficulty, runwayTravelPx)).toEqual(expectedGeometry);
    },
  );

  it('keeps Perfect nested inside Good and preserves Easy/Normal/Hard ratios', () => {
    const easy = geometryFor('easy', 240);
    const normal = geometryFor('normal', 240);
    const hard = geometryFor('hard', 240);

    expect(easy?.perfectHalfHeightPx).toBeLessThan(easy?.goodHalfHeightPx ?? 0);
    expect(easy?.goodHalfHeightPx).toBe((hard?.goodHalfHeightPx ?? 0) * 5);
    expect(easy?.perfectHalfHeightPx).toBe(
      (hard?.perfectHalfHeightPx ?? 0) * 5,
    );
    expect(normal?.goodHalfHeightPx).toBe((hard?.goodHalfHeightPx ?? 0) * 1.5);
    expect(normal?.perfectHalfHeightPx).toBe(
      (hard?.perfectHalfHeightPx ?? 0) * 1.5,
    );
  });

  it('scales timing-window geometry with responsive runway travel distance', () => {
    const narrow = geometryFor('normal', 180);
    const wide = geometryFor('normal', 300);

    for (const dimension of [
      'goodHalfHeightPx',
      'goodEnvelopeHeightPx',
      'perfectHalfHeightPx',
      'perfectEnvelopeHeightPx',
    ] as const) {
      expect(wide[dimension]).toBe(narrow[dimension] * (5 / 3));
    }
  });

  it('projects GPU notes and target geometry from the active run profile, not the next selection', () => {
    const frame = projectGameplayFrame(makeSnapshot(), chart, layout, false);
    const activeGeometry = projectTimingWindowGeometry(
      'hard',
      layout.board.height * 0.64,
      2.4,
    );

    expect(frame.difficulty).toBe('hard');
    expect(frame.timingWindows).toEqual(activeGeometry);
  });
});
