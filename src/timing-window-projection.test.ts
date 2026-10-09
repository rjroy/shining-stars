import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getDifficultyProfile, type Difficulty } from './game-balance';
import { projectNotes, projectTimingWindowGeometry } from './note-projection';

const uiSource = readFileSync(new URL('./ui.ts', import.meta.url), 'utf8');
const chartNotes = [{ id: 'target', lane: 0, time: 2 }] as const;
const states = [{ id: 'target', phase: 'audience' as const, outcome: null }];

function projectWithWindowGeometry(
  difficulty: Difficulty,
  runwayTravelPx: number,
) {
  return projectNotes(states, chartNotes, 1, 2.4, {
    difficulty,
    runwayTravelPx,
  });
}

describe('difficulty timing-window projection', () => {
  it.each(['easy', 'normal', 'hard'] as const)(
    'projects matching Perfect and Good geometry for the %s run',
    (difficulty) => {
      const profile = getDifficultyProfile(difficulty);
      const runwayTravelPx = 240;
      const note = projectWithWindowGeometry(difficulty, runwayTravelPx)[0];
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

      expect(note?.timingWindows).toEqual(expectedGeometry);
      expect(
        projectTimingWindowGeometry(difficulty, runwayTravelPx, 2.4),
      ).toEqual(expectedGeometry);
    },
  );

  it('keeps Perfect nested inside Good and preserves Easy/Normal/Hard ratios', () => {
    const easy = projectWithWindowGeometry('easy', 240)[0]?.timingWindows;
    const normal = projectWithWindowGeometry('normal', 240)[0]?.timingWindows;
    const hard = projectWithWindowGeometry('hard', 240)[0]?.timingWindows;

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

  it('scales both target bands and note envelopes with responsive runway travel distance', () => {
    const narrow = projectWithWindowGeometry('normal', 180)[0]?.timingWindows;
    const wide = projectWithWindowGeometry('normal', 300)[0]?.timingWindows;

    for (const dimension of [
      'goodHalfHeightPx',
      'goodEnvelopeHeightPx',
      'perfectHalfHeightPx',
      'perfectEnvelopeHeightPx',
    ] as const) {
      expect(wide?.[dimension]).toBe((narrow?.[dimension] ?? 0) * (5 / 3));
    }
  });

  it('uses the shared active-run geometry for fixed bands and note envelopes', () => {
    expect(uiSource).toMatch(/data-timing-target/);
    expect(uiSource).toMatch(/data-timing-envelope/);
    expect(uiSource).toMatch(/projectNotes\([\s\S]{0,180}game\.difficulty/);
    expect(uiSource).not.toMatch(
      /projectNotes\([\s\S]{0,180}selectedDifficulty/,
    );
    expect(uiSource).toContain(
      '--good-half-height:${timingWindows.goodHalfHeightPx.toFixed(2)}px',
    );
    expect(uiSource).toContain(
      '--perfect-half-height:${timingWindows.perfectHalfHeightPx.toFixed(2)}px',
    );
    expect(uiSource).toContain(
      '--good-envelope-height:${note.timingWindows?.goodEnvelopeHeightPx.toFixed(2)',
    );
    expect(uiSource).toContain(
      '--perfect-envelope-height:${note.timingWindows?.perfectEnvelopeHeightPx.toFixed(2)',
    );
  });
});
