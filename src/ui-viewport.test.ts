import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const uiSource = readFileSync(resolve(process.cwd(), 'src/ui.ts'), 'utf8');
const stylesSource = readFileSync(
  resolve(process.cwd(), 'src/styles.css'),
  'utf8',
);

describe('full-viewport game surface', () => {
  it('does not render page-level masthead or footer copy outside the game area', () => {
    expect(uiSource).not.toMatch(/<header class="masthead"/);
    expect(uiSource).not.toMatch(/<footer class="experience-footer"/);
  });

  it('sizes the experience to the viewport instead of adding document height', () => {
    expect(stylesSource).toMatch(/html,\s*body\s*\{[^}]*height:\s*100dvh/s);
    expect(stylesSource).toMatch(/\.experience\s*\{[^}]*height:\s*100%/s);
    expect(stylesSource).toMatch(/body\s*\{[^}]*overflow:\s*hidden/s);
  });

  it('retains renderer recovery, pending status, and gameplay layout anchors', () => {
    expect(uiSource).toMatch(
      /<div class="renderer-status" data-renderer-status role="status">[\s\S]*?<span data-renderer-message>[\s\S]*?<button[^>]+data-action="renderer-retry" disabled>/,
    );
    expect(uiSource).toMatch(
      /action === 'renderer-retry'\) actions\.onRendererRetry\?\.\(\)/,
    );
    expect(uiSource).toMatch(/rendererStatus\.hidden !== rendererAvailable/);
    expect(uiSource).toMatch(
      /rendererAvailable \|\| actions\.onRendererRetry === undefined/,
    );
    expect(uiSource).toMatch(/setRendererStatus\(available, message\)/);
    expect(uiSource).toMatch(
      /data-pending-status role="status" aria-live="polite" hidden/,
    );
    expect(uiSource).toMatch(
      /playSurface\?\.setAttribute\('aria-busy', String\(pendingPlaybackRequests\)\)/,
    );
    expect(uiSource).toMatch(/class="stage-frame"/);
    expect(uiSource).toMatch(/class="lane-board"/);
    expect(uiSource).toMatch(/class="stage-topline"/);
    expect(uiSource).toMatch(/class="feedback-row"/);
    expect(uiSource).toMatch(/getGameplayLayout\(\)/);
  });

  it('removes the unused scene-fallback channel without changing renderer status', () => {
    expect(uiSource).not.toMatch(
      /setSceneFallback|data-scene-fallback|scene-fallback/,
    );
    expect(stylesSource).not.toMatch(/\.scene-fallback\s*\{/);
    expect(uiSource).toMatch(/setRendererStatus\(available, message\)/);
    expect(uiSource).toMatch(/data-renderer-status/);
    expect(uiSource).toMatch(/data-action="renderer-retry"/);
  });
});
