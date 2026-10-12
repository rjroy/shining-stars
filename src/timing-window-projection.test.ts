import { describe, expect, it } from 'vitest';
import type { ChartConfig } from './chart';
import type { ControllerSnapshot } from './controller';
import { getDifficultyProfile, type Difficulty } from './game-balance';
import {
  projectGameplayFrame,
  VISIBLE_NOTE_SECONDS,
} from './gameplay-frame';
import type { BrightvaleViewportLayout } from './brightvale/viewport';

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
const layout: BrightvaleViewportLayout = {
  width: 640,
  height: 480,
  persistentHudExclusions: [],
  labels: {
    time: { x: 0, y: 0, width: 80, height: 20 },
    countdown: { x: 80, y: 0, width: 80, height: 20 },
    legend: { x: 0, y: 340, width: 640, height: 20 },
    feedback: { x: 0, y: 380, width: 640, height: 20 },
  },
};

function makeSnapshot(
  difficulty: Difficulty = 'hard',
  transportTime = 1,
): ControllerSnapshot {
  return {
    audio: {
      status: 'playing',
      position: transportTime,
      duration: chart.duration,
      scheduledWhen: null,
      hasActiveSource: true,
      loaded: true,
      disposed: false,
      error: null,
    },
    game: {
      transportTime,
      phase: 'audience',
      status: 'playing',
      renown: 0,
      personalStrength: 100,
      twilightStrength: 100,
      difficulty,
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

describe('difficulty timing-window projection', () => {
  it.each(['easy', 'normal', 'hard'] as const)(
    'calculates matching Perfect and Good geometry for the %s profile',
    (difficulty) => {
      const profile = getDifficultyProfile(difficulty);
      const frame = projectGameplayFrame(
        makeSnapshot(difficulty),
        chart,
        layout,
        false,
      );
      expect(frame.timingWindows).toEqual({
        goodHalfProgress:
          profile.timing.goodWindowSeconds / VISIBLE_NOTE_SECONDS,
        perfectHalfProgress:
          profile.timing.perfectWindowSeconds / VISIBLE_NOTE_SECONDS,
      });
      expect(frame.timingWindows).not.toHaveProperty('goodHalfHeightPx');
    },
  );

  it('keeps Perfect nested inside Good and preserves Easy/Normal/Hard ratios', () => {
    const halfProgress = (difficulty: Difficulty) =>
      projectGameplayFrame(
        makeSnapshot(difficulty),
        chart,
        layout,
        false,
      ).timingWindows;
    const easy = halfProgress('easy');
    const normal = halfProgress('normal');
    const hard = halfProgress('hard');

    expect(easy.goodHalfProgress).toBeDefined();
    expect(normal.goodHalfProgress).toBeDefined();
    expect(hard.goodHalfProgress).toBeDefined();
    expect(easy.perfectHalfProgress).toBeLessThan(easy.goodHalfProgress);
    expect(easy.goodHalfProgress).toBeCloseTo(hard.goodHalfProgress * 5, 14);
    expect(easy.perfectHalfProgress).toBeCloseTo(
      hard.perfectHalfProgress * 5,
      14,
    );
    expect(normal.goodHalfProgress).toBeCloseTo(
      hard.goodHalfProgress * 1.5,
      14,
    );
    expect(normal.perfectHalfProgress).toBeCloseTo(
      hard.perfectHalfProgress * 1.5,
      14,
    );
  });

  it('leaves timing-envelope endpoints unclamped outside note progress', () => {
    const early = projectGameplayFrame(
      makeSnapshot('hard', -0.4),
      chart,
      layout,
      false,
    );
    expect(early.notes[0]?.progress).toBe(0);
    expect(early.timingWindows.goodHalfProgress).toBeDefined();
    expect(early.timingWindows.goodHalfProgress).toBeGreaterThan(0);
    expect(
      early.notes[0]!.progress - early.timingWindows.goodHalfProgress,
    ).toBeLessThan(0);

    const late = projectGameplayFrame(
      makeSnapshot('hard', 2.4),
      chart,
      layout,
      false,
    );
    expect(late.notes[0]?.progress).toBe(1);
    expect(late.timingWindows.goodHalfProgress).toBeDefined();
    expect(late.timingWindows.goodHalfProgress).toBeGreaterThan(0);
    expect(
      late.notes[0]!.progress + late.timingWindows.goodHalfProgress,
    ).toBeGreaterThan(1);
  });

  it('projects GPU notes and target geometry from the active run profile, not the next selection', () => {
    const frame = projectGameplayFrame(makeSnapshot(), chart, layout, false);
    const activeProfile = getDifficultyProfile('hard');

    expect(frame.difficulty).toBe('hard');
    expect(frame.timingWindows).toEqual({
      goodHalfProgress:
        activeProfile.timing.goodWindowSeconds / VISIBLE_NOTE_SECONDS,
      perfectHalfProgress:
        activeProfile.timing.perfectWindowSeconds / VISIBLE_NOTE_SECONDS,
    });
    expect(frame.layout).toBe(layout);
  });
});
