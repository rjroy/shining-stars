import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultDifficulty, getDifficultyProfile } from '../game/game-balance';
import { MVP_CHART } from '../game/mvp-chart';
import { createGame } from '../game/game';

// Vitest currently runs without a DOM environment; these focused source checks
// cover the UI contract while scene behavior is exercised through projection tests.
const ui = readFileSync(resolve(process.cwd(), 'src/ui/ui.ts'), 'utf8');

describe('difficulty presentation contract', () => {
  it('keeps gameplay feedback in a polite live region', () => {
    // Event ordering, deduplication, reset, and announcement wording are
    // behaviorally covered by ui-feedback.test.ts.
    expect(ui).toMatch(
      /data-gameplay-status role="status" aria-live="polite"/,
    );
  });

  it('removes difficulty selection UI but keeps the default run configuration', () => {
    expect(ui).not.toMatch(
      /data-difficulty-select|difficulty-rules|difficulty-help/,
    );
    expect(ui).not.toMatch(/<select[^>]*difficulty/i);
    expect(defaultDifficulty(MVP_CHART.allowedDifficulties)).toBe('normal');
    expect(createGame(MVP_CHART, 0).snapshot().difficulty).toBe('normal');
    const profile = getDifficultyProfile('normal');
    expect(profile.timing).toEqual({
      perfectWindowSeconds: 0.075,
      goodWindowSeconds: 0.15,
    });
  });

  it('keeps run difficulty visible in result reporting', () => {
    expect(ui).toMatch(/result\.difficulty/);
    expect(ui).toMatch(
      /Difficulty: \$\{difficultyLabel\(result\.difficulty\)\}/,
    );
  });

  it('keeps key instructions accessible and Escape pause available without visible key hints', () => {
    expect(ui).toMatch(/id="lane-instructions"/);
    expect(ui).toMatch(/D, F, J, and K keys shown on the four lane fronts/);
    expect(ui).toMatch(/Escape pauses the performance/);
    expect(ui).not.toMatch(/Press <kbd>D/);
    expect(ui).not.toMatch(/Pause <kbd>Esc/);
    expect(ui).not.toMatch(/data-action="pause"/);
    const scene = readFileSync(
      resolve(process.cwd(), 'src/rendering/scene.ts'),
      'utf8',
    );
    expect(scene).toMatch(
      /composition\.frontProgress = getFrontPlatformProgress\(\s*composition\.playfield,\s*composition\.profile,?\s*\)/,
    );
    const mainInput = readFileSync(
      resolve(process.cwd(), 'src/main-input.test.ts'),
      'utf8',
    );
    expect(mainInput).toMatch(/Enter/);
    expect(mainInput).toMatch(/keyDown/);
  });

  it('renders inset graphic resource bars with actual values and derived denominators', () => {
    expect(ui).toMatch(/data-audience-bar/);
    expect(ui).toMatch(/data-personal-bar/);
    expect(ui).toMatch(/data-twilight-bar/);
    expect(ui).toMatch(/bars\.audience\.maximum/);
    expect(ui).toMatch(/bars\.personal\.maximum/);
    expect(ui).toMatch(/bars\.twilight\.maximum/);
    expect(ui).toMatch(/aria-valuetext/);
    const css = readFileSync(
      resolve(process.cwd(), 'src/ui/styles.css'),
      'utf8',
    );
    expect(css).toMatch(/resource-meter progress/);
    expect(css).toMatch(/twilight-meter progress::-webkit-progress-value/);
  });
});
