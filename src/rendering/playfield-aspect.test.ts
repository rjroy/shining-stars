import { describe, expect, it } from 'vitest';
import type { ChartConfig } from '../game/chart';
import type { ControllerSnapshot } from '../game/controller';
import { getDifficultyProfile } from '../game/game-balance';
import { projectGameplayFrame, VISIBLE_NOTE_SECONDS } from './gameplay-frame';
import type { BrightvaleViewportLayout } from './brightvale/viewport';

const chart: ChartConfig = {
  sourceStart: 0,
  duration: 20,
  twilightAt: 10,
  twilightStrength: 100,
  allowedDifficulties: ['easy', 'normal', 'hard'],
  notes: [{ id: 'wide-note', lane: 3, time: 12 }],
};

const snapshot: ControllerSnapshot = {
  audio: {
    status: 'playing',
    position: 10,
    duration: 20,
    scheduledWhen: null,
    hasActiveSource: true,
    loaded: true,
    disposed: false,
    error: null,
  },
  game: {
    transportTime: 10,
    phase: 'audience',
    status: 'playing',
    victory: false,
    renown: 0,
    personalStrength: 100,
    twilightStrength: 100,
    difficulty: 'easy',
    notes: [{ id: 'wide-note', lane: 3, phase: 'audience', outcome: null }],
    result: null,
  },
  inputOffset: 0,
  visualOffset: 0,
  selectedDifficulty: 'easy',
  feedback: [],
  pendingPlaybackRequests: false,
};

function makeLayout(width: number, height: number): BrightvaleViewportLayout {
  return {
    width,
    height,
    persistentHudExclusions: [
      { x: 0, y: 0, width, height: 70 },
      { x: 0, y: height - 64, width, height: 64 },
    ],
    labels: {
      time: { x: width - 140, y: 12, width: 100, height: 24 },
      countdown: { x: width / 2 - 80, y: height - 120, width: 160, height: 28 },
      legend: { x: 80, y: height - 96, width: width - 160, height: 24 },
      feedback: { x: width / 2 - 120, y: height - 150, width: 240, height: 28 },
    },
  };
}

describe('aspect-independent gameplay frame data', () => {
  it('keeps source note progress and lane identity independent of host aspect', () => {
    const wideLayout = makeLayout(1600, 900);
    const narrowLayout = makeLayout(1120, 700);
    const wide = projectGameplayFrame(snapshot, chart, wideLayout, false);
    const narrow = projectGameplayFrame(snapshot, chart, narrowLayout, false);

    expect(wide.layout).toBe(wideLayout);
    expect(narrow.layout).toBe(narrowLayout);
    expect(wide.notes).toEqual(narrow.notes);
    expect(wide.notes).toHaveLength(1);
    expect(wide.notes[0]).toMatchObject({
      id: 'wide-note',
      lane: 3,
      progress: 1 - 2 / VISIBLE_NOTE_SECONDS,
    });
    expect(wide.notes[0]).not.toHaveProperty('bottomPercent');
    expect(wide.lanes).toEqual([
      { index: 0 },
      { index: 1 },
      { index: 2 },
      { index: 3 },
    ]);
    expect(wide.lanes[3]).not.toHaveProperty('x');
    expect(wide.lanes[3]).not.toHaveProperty('width');
  });

  it('keeps difficulty timing envelopes as unclamped, dimensionless progress', () => {
    const frame = projectGameplayFrame(
      snapshot,
      chart,
      makeLayout(1120, 700),
      false,
    );
    const timing = getDifficultyProfile('easy').timing;
    const good = timing.goodWindowSeconds / VISIBLE_NOTE_SECONDS;
    const perfect = timing.perfectWindowSeconds / VISIBLE_NOTE_SECONDS;

    expect(frame.timingWindows).toEqual({
      goodHalfProgress: good,
      perfectHalfProgress: perfect,
    });
    expect(1 - good).toBeLessThan(1);
    expect(1 + good).toBeGreaterThan(1);
    expect(1 - perfect).toBeGreaterThan(1 - good);
    expect(1 + perfect).toBeLessThan(1 + good);
    expect(frame.timingWindows).not.toHaveProperty('goodHalfHeightPx');
    expect(frame.timingWindows).not.toHaveProperty('perfectEnvelopeHeightPx');
  });
});
