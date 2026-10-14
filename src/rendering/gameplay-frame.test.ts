import { describe, expect, it } from 'vitest';
import type { ChartConfig } from '../game/chart';
import type { ControllerSnapshot } from '../game/controller';
import { getDifficultyProfile } from '../game/game-balance';
import {
  FEEDBACK_VISIBLE_SECONDS,
  isFeedbackWithinVisibleAge,
  projectGameplayFrame,
  VISIBLE_NOTE_SECONDS,
} from './gameplay-frame';
import type { BrightvaleViewportLayout } from './brightvale/viewport';

const chart: ChartConfig = {
  sourceStart: 0,
  duration: 20,
  twilightAt: 10,
  twilightStrength: 100,
  allowedDifficulties: ['normal', 'hard'],
  notes: [{ id: 'n-1', lane: 2, time: 12 }],
};

const layout: BrightvaleViewportLayout = {
  width: 640,
  height: 480,
  persistentHudExclusions: [{ x: 4, y: 8, width: 120, height: 24 }],
  labels: {
    time: { x: 8, y: 8, width: 70, height: 20 },
    countdown: { x: 80, y: 8, width: 70, height: 20 },
    legend: { x: 8, y: 420, width: 200, height: 24 },
    feedback: { x: 220, y: 420, width: 200, height: 24 },
  },
};

function snapshot(
  overrides: Partial<ControllerSnapshot> = {},
): ControllerSnapshot {
  const game = {
    transportTime: 12,
    phase: 'audience' as const,
    status: 'playing' as const,
    renown: 0,
    personalStrength: 100,
    twilightStrength: 100,
    difficulty: 'hard' as const,
    notes: [{ id: 'n-1', lane: 2 as const, phase: 'audience' as const, outcome: null }],
    result: null,
  };
  return {
    audio: {
      status: 'playing',
      position: game.transportTime,
      duration: chart.duration,
      scheduledWhen: null,
      hasActiveSource: true,
      loaded: true,
      disposed: false,
      error: null,
    },
    game,
    inputOffset: 0,
    visualOffset: 0,
    selectedDifficulty: 'normal',
    feedback: [{
      noteId: 'n-1',
      lane: 2,
      quality: 'perfect',
      timingErrorSeconds: 0.01,
      eventId: 4,
      runId: 3,
      onsetTransportTime: 12,
    }],
    pendingPlaybackRequests: false,
    ...overrides,
  };
}

describe('shared gameplay timing geometry', () => {
  it('passes the measured viewport through without fitting a legacy board', () => {
    const projected = projectGameplayFrame(snapshot(), chart, layout, false);
    expect(projected.layout).toBe(layout);
    expect(projected.layout).toMatchObject({
      width: 640,
      height: 480,
      persistentHudExclusions: layout.persistentHudExclusions,
      labels: layout.labels,
    });
  });

  it('projects note centers and indexed lanes without legacy pixel positions', () => {
    const projected = projectGameplayFrame(snapshot(), chart, layout, false);
    expect(projected.difficulty).toBe('hard');
    expect(projected.notes).toHaveLength(1);
    expect(projected.notes[0]).toEqual({ id: 'n-1', lane: 2, progress: 1 });
    expect(projected.notes[0]).not.toHaveProperty('bottomPercent');
    expect(projected.lanes).toEqual([
      { index: 0 },
      { index: 1 },
      { index: 2 },
      { index: 3 },
    ]);
    expect(projected.lanes[0]).not.toHaveProperty('x');
    expect(projected.lanes[0]).not.toHaveProperty('width');
  });

  it('projects difficulty timing windows as half-progress over the fixed approach duration', () => {
    const projected = projectGameplayFrame(snapshot(), chart, layout, false);
    const profile = getDifficultyProfile('hard');
    expect(projected.timingWindows).toEqual({
      goodHalfProgress:
        profile.timing.goodWindowSeconds / VISIBLE_NOTE_SECONDS,
      perfectHalfProgress:
        profile.timing.perfectWindowSeconds / VISIBLE_NOTE_SECONDS,
    });
    expect(projected.timingWindows).not.toHaveProperty('goodHalfHeightPx');
    expect(1 + projected.timingWindows.goodHalfProgress).toBeGreaterThan(1);
  });

  it('uses immutable run feedback and expires or clears it without wall-clock time', () => {
    const initial = projectGameplayFrame(snapshot(), chart, layout, false);
    expect(initial.feedback).toMatchObject([{ eventId: 4, runId: 3, lane: 2 }]);

    const nearExpiry = projectGameplayFrame(
      snapshot({ game: { ...snapshot().game, transportTime: 13.099 } }),
      chart,
      layout,
      false,
    );
    expect(nearExpiry.feedback).toHaveLength(1);

    const expired = projectGameplayFrame(
      snapshot({ game: { ...snapshot().game, transportTime: 13.101 } }),
      chart,
      layout,
      false,
    );
    expect(expired.feedback).toEqual([]);

    const paused = projectGameplayFrame(
      snapshot({
        audio: { ...snapshot().audio, status: 'paused' },
        game: { ...snapshot().game, transportTime: 12.2 },
      }),
      chart,
      layout,
      false,
    );
    expect(paused.feedback).toEqual([]);
    expect(paused.notes).toEqual([]);

    const result = projectGameplayFrame(
      snapshot({
        audio: { ...snapshot().audio, status: 'paused' },
        game: { ...snapshot().game, status: 'results' },
      }),
      chart,
      layout,
      false,
    );
    expect(result.feedback).toEqual([]);
    expect(result.notes).toEqual([]);
  });

  it('keeps frame feedback boundaries and count-in/run identity guards', () => {
    expect(isFeedbackWithinVisibleAge(0.999, 1)).toBe(false);
    expect(isFeedbackWithinVisibleAge(1, 1)).toBe(true);
    expect(isFeedbackWithinVisibleAge(2.099, 1)).toBe(true);
    expect(isFeedbackWithinVisibleAge(FEEDBACK_VISIBLE_SECONDS, 0)).toBe(false);

    const atTransportTime = (
      transportTime: number,
      overrides: Partial<ControllerSnapshot> = {},
    ) =>
      projectGameplayFrame(
        snapshot({
          game: { ...snapshot().game, transportTime },
          ...overrides,
        }),
        chart,
        layout,
        false,
      );

    expect(atTransportTime(11.999).feedback).toEqual([]);
    expect(atTransportTime(12).feedback).toMatchObject([{ runId: 3 }]);
    expect(atTransportTime(13.099).feedback).toMatchObject([{ runId: 3 }]);
    expect(
      atTransportTime(FEEDBACK_VISIBLE_SECONDS, {
        feedback: [{
          ...snapshot().feedback[0]!,
          onsetTransportTime: 0,
        }],
        game: { ...snapshot().game, transportTime: FEEDBACK_VISIBLE_SECONDS },
      }).feedback,
    ).toEqual([]);

    const countIn = atTransportTime(12, {
      audio: { ...snapshot().audio, status: 'starting' },
    });
    expect(countIn.playing).toBe(true);
    expect(countIn.feedback).toMatchObject([{ runId: 3 }]);

    const invalidRun = atTransportTime(12, {
      feedback: [{ ...snapshot().feedback[0]!, runId: 0 }],
    });
    expect(invalidRun.feedback).toEqual([]);
  });

  it('projects simultaneous lane judgments independently and omits expired or future events', () => {
    const base = snapshot();
    const projected = projectGameplayFrame(
      snapshot({
        feedback: [
          { ...base.feedback[0]!, lane: 0, eventId: 10, quality: 'good' },
          { ...base.feedback[0]!, lane: 3, eventId: 11, quality: 'miss' },
          {
            ...base.feedback[0]!,
            lane: 1,
            eventId: 12,
        onsetTransportTime: 10.8,
          },
          {
            ...base.feedback[0]!,
            lane: 2,
            eventId: 13,
            onsetTransportTime: 12.1,
          },
        ],
      }),
      chart,
      layout,
      false,
    );

    expect(projected.feedback).toMatchObject([
      { eventId: 10, lane: 0, quality: 'good' },
      { eventId: 11, lane: 3, quality: 'miss' },
    ]);
  });
});
