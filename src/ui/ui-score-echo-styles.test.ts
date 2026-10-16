import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const source = readFileSync(new URL('./ui.ts', import.meta.url), 'utf8');

// Source-level animation contracts; these do not claim browser visual coverage.
describe('score echo presentation contracts', () => {
  it('keeps cleanup later than both authored CSS animation lifetimes', () => {
    expect(css).toContain('score-echo-expand 2600ms linear both');
    expect(css).toContain('score-echo-contract 2000ms linear both');
    expect(source).toContain(
      "event.kind === 'star' || event.direction === 'grow' ? 2600 : 2000",
    );
    expect(source).toContain('setTimeout(cleanup, duration + 100)');
  });

  it('holds enlarged positive echoes bright before their final fade', () => {
    expect(css).toContain('--score-echo-scale: 3.5');
    expect(css).toContain('--score-echo-scale: 4');
    expect(css).toMatch(
      /18%,\s*65%\s*\{\s*opacity: 0\.9;\s*transform: scale\(var\(--score-echo-scale\)\)/,
    );
    expect(css).toMatch(
      /0%,\s*55%\s*\{\s*opacity: 0\.9;\s*transform: scale\(2\.2\)/,
    );
  });

  it('caps every echo keyframe at 90% and preserves fade to zero', () => {
    for (const name of ['expand', 'contract']) {
      const animation = css
        .split(`@keyframes score-echo-${name} {`)[1]
        .split(/@keyframes|@media/)[0];
      const opacities = [...animation.matchAll(/opacity:\s*([\d.]+)/g)].map(
        (match) => Number(match[1]),
      );
      expect(opacities.length).toBeGreaterThanOrEqual(2);
      expect(Math.max(...opacities)).toBe(0.9);
      expect(opacities.at(-1)).toBe(0);
    }
  });

  it('adds thin near-black outlines only to decorative echo copies', () => {
    expect(css).toMatch(
      /\.score-echo svg path\s*\{\s*stroke: #111111;\s*stroke-width: 1px;\s*vector-effect: non-scaling-stroke;\s*paint-order: stroke fill;/,
    );
    expect(css).toMatch(
      /\.score-echo\[data-score-echo='multiplier'\]\s*\{\s*-webkit-text-stroke: 0\.35px #111111;\s*paint-order: stroke fill;/,
    );
    const outlinedRules = [
      ...css.matchAll(/([^{}]+)\{([^{}]*#111111[^{}]*)\}/g),
    ];
    expect(outlinedRules).toHaveLength(2);
    for (const rule of outlinedRules) {
      expect(rule[1].trim()).toMatch(/^\.score-echo(?:\s|\[)/);
    }
    expect(css).toMatch(/\.score-echo svg\s*\{[^}]*fill: currentColor;/);
  });

  it('retains bounded copies, inward anchors and motion suppression', () => {
    expect(source).toContain('if (cleanups.size >= 24)');
    expect(css).toMatch(/\.score-echo\s*\{[^}]*transform-origin: top right/s);
    expect(css).toMatch(
      /\.score-echo--normal,\s*\.score-echo--gold\s*\{[^}]*transform-origin: top left/s,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.score-echo\s*\{\s*display: none;\s*animation: none;/,
    );
  });
});
