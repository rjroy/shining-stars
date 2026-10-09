import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const uiSource = readFileSync(resolve(process.cwd(), 'src/ui.ts'), 'utf8');

describe('gameplay copy', () => {
  it('explains Renown rewards and that audience misses do not remove Renown', () => {
    expect(uiSource).toMatch(/Renown/i);
    expect(uiSource).toMatch(
      /Audience Renown: Perfect \$\{profile\.audience\.perfect\}/i,
    );
    expect(uiSource).toMatch(/Good \$\{profile\.audience\.good\}/i);
    expect(uiSource).toMatch(/Miss \$\{profile\.audience\.miss\}/i);
    expect(uiSource).toMatch(/getDifficultyProfile\(activeDifficulty\)/);
  });

  it('explains both Twilight strengths and all combat costs and damage', () => {
    expect(uiSource).toMatch(/Personal Strength/i);
    expect(uiSource).toMatch(/Twilight Strength/i);
    expect(uiSource).toMatch(/twilight\.miss\.personalCost/);
    expect(uiSource).toMatch(/twilight\.good\.personalCost/);
    expect(uiSource).toMatch(/twilight\.good\.damage/);
    expect(uiSource).toMatch(/twilight\.perfect\.personalCost/);
    expect(uiSource).toMatch(/twilight\.perfect\.damage/);
  });

  it('communicates outcome names without framing missed notes as surrender', () => {
    expect(uiSource).toMatch(/Victory/i);
    expect(uiSource).toMatch(/Defeat/i);
    expect(uiSource).toMatch(/Survived/i);
    expect(uiSource).toMatch(/miss(?:ed)? note[^.]*not[^.]*surrender/i);
    expect(uiSource).toMatch(/result\.outcome/);
    expect(uiSource).toMatch(/result\.personalStrength/);
    expect(uiSource).toMatch(/result\.twilightStrength/);
  });

  it('does not describe legacy conversion, City Answer, or resource caps', () => {
    expect(uiSource).not.toMatch(
      /City Answer|automatically spent|converted|discarded|cap(?:ped)? at 40/,
    );
  });

  it('keeps the existing onset chart notice and avoids prescriptive chart density', () => {
    expect(uiSource).toMatch(/Notes follow aubio-detected onsets\./i);
    expect(uiSource).toMatch(/Aubio onset chart/i);
    expect(uiSource).not.toMatch(/one note per\b/i);
    expect(uiSource).not.toMatch(/detected beats/i);
  });
});
