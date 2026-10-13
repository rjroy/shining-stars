import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDifficultyProfile } from '../game/game-balance';

// Vitest currently runs without a DOM environment; these focused source checks
// cover the UI contract while scene behavior is exercised through projection tests.
const ui = readFileSync(resolve(process.cwd(), 'src/ui/ui.ts'), 'utf8');

describe('difficulty presentation contract', () => {
  it('keeps accessible judgment feedback gated by actual playback and its age', () => {
    const visibilityRule = ui.slice(
      ui.indexOf('const isJudgmentVisible'),
      ui.indexOf('const difficultySelect'),
    );
    expect(visibilityRule).toMatch(/judgment !== null/);
    expect(visibilityRule).toMatch(/isPlaying/);
    expect(visibilityRule).toMatch(
      /isFeedbackWithinVisibleAge\(\s*game\.transportTime,\s*judgment\.onsetTransportTime,\s*\)/,
    );
    expect(ui).toMatch(
      /isPlaying = audio\.status === 'playing' && game\.status === 'playing'/,
    );
    expect(ui).toMatch(/!isJudgmentVisible \|\| judgment === null/);
    expect(ui).toMatch(/role="status" aria-live="polite"/);
  });

  it('offers only chart-allowed profiles and defaults through the shared helper', () => {
    expect(ui).toMatch(/chart\.allowedDifficulties/);
    expect(ui).toMatch(/defaultDifficulty\(/);
    expect(ui).toMatch(/<label[^>]+for=["']difficulty["']/i);
    expect(ui).toMatch(/<select[^>]+id=["']difficulty["']/i);
    expect(ui).not.toMatch(/option[^>]+value=["']easy["']/i);

    const profile = getDifficultyProfile('normal');
    expect(profile.timing).toEqual({
      perfectWindowSeconds: 0.075,
      goodWindowSeconds: 0.15,
    });
  });

  it('routes profile changes to the UI action instead of a separate balance copy', () => {
    expect(ui).toMatch(/selectDifficulty\s*:\s*\([^)]*Difficulty/);
    expect(ui).toMatch(/actions\.selectDifficulty\(/);
    expect(ui).toMatch(/getDifficultyProfile\(/);
    expect(ui).toMatch(/profile\.timing\.perfectWindowSeconds/);
    expect(ui).toMatch(/profile\.timing\.goodWindowSeconds/);
    expect(ui).toMatch(/profile\.audience\.perfect/);
    expect(ui).toMatch(/profile\.audience\.good/);
    expect(ui).toMatch(/profile\.audience\.miss/);
    expect(ui).toMatch(/profile\.twilight\.miss\.personalCost/);
    expect(ui).toMatch(/profile\.twilight\.good\.personalCost/);
    expect(ui).toMatch(/profile\.twilight\.good\.damage/);
    expect(ui).toMatch(/profile\.twilight\.perfect\.damage/);
  });

  it('allows unrequested initial loading, then locks selection while a request is pending', () => {
    expect(ui).toMatch(
      /pendingPlaybackRequests\s*=\s*snapshot\.pendingPlaybackRequests/,
    );
    expect(ui).toMatch(
      /audio\.status\s*===\s*'paused'\s*&&\s*audio\.loaded\s*&&\s*!pendingPlaybackRequests/,
    );
    const selectorDisableRule = ui.slice(
      ui.indexOf('const disabled =', ui.indexOf('const difficultySelect')),
      ui.indexOf(
        'if (difficultySelect.disabled',
        ui.indexOf('const difficultySelect'),
      ),
    );
    expect(selectorDisableRule).toMatch(/pendingPlaybackRequests/);
    expect(selectorDisableRule).not.toMatch(/audio\.status\s*===\s*'loading'/);
    expect(ui).toMatch(/audio\.status\s*===\s*'starting'/);
    expect(ui).toMatch(/audio\.status\s*===\s*'playing'/);
    expect(ui).toMatch(/audio\.status\s*===\s*'paused'/);
    expect(ui).toMatch(/audio\.status\s*===\s*'error'/);
    expect(ui).toMatch(/difficultySelect\.disabled/);
    expect(ui).toMatch(/isResults/);
    expect(ui).toMatch(/isReady/);
    expect(ui).not.toMatch(/hasAttemptedStart/);
  });

  it('shows the finished run profile in results, separately from the next selection', () => {
    expect(ui).toMatch(/result\.difficulty/);
    expect(ui).toMatch(/selectedDifficulty/);
    expect(ui).toMatch(/actions\.restart/);
    expect(ui).not.toMatch(/result\.difficulty\s*\|\|\s*selectedDifficulty/);
  });

  it('keeps the existing D/F/J/K instruction and Enter handling visible in the UI contract', () => {
    expect(ui).toMatch(
      /Press <kbd>D<\/kbd> <kbd>F<\/kbd> <kbd>J<\/kbd> <kbd>K<\/kbd>/,
    );
    const mainInput = readFileSync(
      resolve(process.cwd(), 'src/main-input.test.ts'),
      'utf8',
    );
    expect(mainInput).toMatch(/Enter/);
    expect(mainInput).toMatch(/keyDown/);
  });
});
