import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./observatory.css', import.meta.url), 'utf8');

describe('Observatory detail fit safeguards', () => {
  it('uses the compact heading and two-column achievement layout before a 621px panel runs out of space', () => {
    // Actual-app evidence: a 621px desktop panel overflowed with a long title,
    // credited seals and unlock help. This is a CSS contract, not a browser fit test.
    const compact = css.indexOf('@container song-browser (max-height: 700px)');
    const tight = css.indexOf('@container song-browser (max-height: 440px)');
    expect(compact).toBeGreaterThan(-1);
    const rules = css.slice(compact, tight);
    expect(rules).toContain('grid-template-columns: 50px minmax(0, 1fr)');
    expect(rules).toContain(
      'grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)',
    );
  });

  it('reclaims padding in short desktop panels without clipping content or shrinking controls', () => {
    const tight = css.slice(
      css.indexOf('@container song-browser (max-height: 440px)'),
      css.indexOf('.song-detail-empty {'),
    );
    expect(tight).toMatch(/\.song-detail-panel\s*\{[^}]*padding:\s*12px 18px/s);
    expect(tight).toContain('min-height: 43px');
    expect(tight).not.toMatch(/overflow:\s*(hidden|clip)/);
    expect(css).toMatch(/\.song-detail-panel\s*\{[^}]*overflow:\s*auto/s);
  });
});
