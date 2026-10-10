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
});
