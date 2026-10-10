import { describe, expect, it } from 'vitest';
import type { ChartConfig } from './chart';
import type { ControllerSnapshot } from './controller';
import { projectGameplayFrame, type GameplayLayout } from './gameplay-frame';
import { projectTimingWindowGeometry } from './note-projection';

const chart: ChartConfig = {
  sourceStart: 0,
  duration: 20,
  twilightAt: 10,
  twilightStrength: 100,
  allowedDifficulties: ['normal', 'hard'],
  notes: [{ id: 'n-1', lane: 2, time: 12 }],
};

const layout: GameplayLayout = {
  width: 640,
  height: 480,
  stage: { x: 20, y: 30, width: 600, height: 400 },
  board: { x: 80, y: 80, width: 480, height: 240 },
  header: { x: 40, y: 40, width: 500, height: 24 },
  legend: { x: 80, y: 340, width: 480, height: 30 },
  feedback: { x: 80, y: 380, width: 480, height: 25 },
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
    notes: [{ id: 'n-1', phase: 'audience' as const, outcome: null }],
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
    feedback: {
      noteId: 'n-1',
      quality: 'perfect',
      timingErrorSeconds: 0.01,
      eventId: 4,
      runId: 3,
      onsetTransportTime: 12,
    },
    pendingPlaybackRequests: false,
    ...overrides,
  };
}

describe('shared gameplay timing geometry', () => {
  it('scales note and fixed-target envelopes from the active profile and measured runway', () => {
    const normalTarget = projectTimingWindowGeometry('normal', 153.6, 2.4);
    const hardTarget = projectTimingWindowGeometry('hard', 153.6, 2.4);
    const resizedTarget = projectTimingWindowGeometry('normal', 76.8, 2.4);

    expect(
      hardTarget.goodEnvelopeHeightPx / normalTarget.goodEnvelopeHeightPx,
    ).toBeCloseTo(2 / 3);
    expect(
      hardTarget.perfectEnvelopeHeightPx / normalTarget.perfectEnvelopeHeightPx,
    ).toBeCloseTo(2 / 3);
    expect(resizedTarget.goodEnvelopeHeightPx).toBeCloseTo(
      normalTarget.goodEnvelopeHeightPx / 2,
    );

    const projected = projectGameplayFrame(snapshot(), chart, layout, false);
    expect(projected.difficulty).toBe('hard');
    expect(projected.notes).toHaveLength(1);
    expect(projected.notes[0]).toMatchObject({
      lane: 2,
      progress: 1,
      bottomPercent: 18,
    });
    expect(projected.timingWindows).toEqual(hardTarget);
    expect(projected.lanes.map((lane) => lane.x)).toEqual([80, 200, 320, 440]);
  });

  it('uses immutable run feedback and expires or clears it without wall-clock time', () => {
    const initial = projectGameplayFrame(snapshot(), chart, layout, false);
    expect(initial.feedback).toMatchObject({ eventId: 4, runId: 3 });
    expect(initial.feedbackLabel).toBe('Perfect');

    const nearExpiry = projectGameplayFrame(
      snapshot({ game: { ...snapshot().game, transportTime: 12.649 } }),
      chart,
      layout,
      false,
    );
    expect(nearExpiry.feedback).not.toBeNull();

    const expired = projectGameplayFrame(
      snapshot({ game: { ...snapshot().game, transportTime: 12.65 } }),
      chart,
      layout,
      false,
    );
    expect(expired.feedback).toBeNull();

    const paused = projectGameplayFrame(
      snapshot({
        audio: { ...snapshot().audio, status: 'paused' },
        game: { ...snapshot().game, transportTime: 12.2 },
      }),
      chart,
      layout,
      false,
    );
    expect(paused.feedback).toBeNull();
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
    expect(result.feedback).toBeNull();
    expect(result.notes).toEqual([]);
  });
});
